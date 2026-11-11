// 部屋への参加・同期・操作の送信。エンジン(純粋関数)とバックエンド(Firebase/ローカル)をつなぐ。
import { applyAction, dealGame, normalizeGame, serializeGame, RuleError } from './engine.js';

const DAY = 24 * 60 * 60 * 1000;
const MAX_PLAYERS = 8;

function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
}

export class RoomController extends EventTarget {
  constructor(backend) {
    super();
    this.b = backend;
    this.uid = backend.uid;
    this.roomId = null;
    this.room = null; // 部屋の生データ(meta, players)
    this.game = null; // 正規化したゲーム状態
    this.hand = [];
    this.inbox = {};
    this.notices = []; // 交換で渡したカードなど
    this.received = new Set(); // 受け取ったカード(強調表示用)
    this.subs = [];
    this.busy = false;
    this.tickTimer = null;
    this.mismatchSince = 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---------- 部屋 ----------
  get players() {
    const ps = this.room?.players || {};
    return Object.entries(ps)
      .map(([uid, p]) => ({ uid, ...p }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || (a.uid < b.uid ? -1 : 1));
  }
  player(uid) {
    return this.room?.players?.[uid] || null;
  }
  get isHost() {
    return this.room?.meta?.hostUid === this.uid;
  }
  get hostUid() {
    return this.room?.meta?.hostUid || null;
  }

  async createRoom(name) {
    const roomId = this.b.newKey();
    let code = null;
    for (let i = 0; i < 30 && !code; i++) {
      const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (await this.b.createIfAbsent(`roomCodes/${c}`, roomId)) code = c;
    }
    if (!code) throw new Error('部屋コードを発行できませんでした');
    const t = this.b.serverTime();
    await this.b.update({
      [`rooms/${roomId}/meta`]: { code, hostUid: this.uid, createdAt: t, updatedAt: t },
      [`rooms/${roomId}/rules`]: { version: 1 },
      [`rooms/${roomId}/players/${this.uid}`]: { name, joinedAt: t, online: true, points: 0 },
      [`roomIndex/${roomId}`]: { updatedAt: t, code },
    });
    await this.enter(roomId);
    return roomId;
  }

  async findByCode(code) {
    return (await this.b.get(`roomCodes/${code}`)) || null;
  }

  async memberRecord(roomId) {
    try {
      return (await this.b.get(`rooms/${roomId}/players/${this.uid}`)) || null;
    } catch {
      return null;
    }
  }

  async join(roomId, name) {
    if (this.b.kind === 'local' && !(await this.b.get(`rooms/${roomId}/meta`))) throw new Error('部屋が見つかりません');
    let me = null;
    try {
      me = await this.b.get(`rooms/${roomId}/players/${this.uid}`);
    } catch { /* 権限なし=未参加 */ }
    try {
      if (me) {
        await this.b.update({ [`rooms/${roomId}/players/${this.uid}/name`]: name, [`rooms/${roomId}/players/${this.uid}/online`]: true });
      } else {
        await this.b.update({
          [`rooms/${roomId}/players/${this.uid}`]: { name, joinedAt: this.b.serverTime(), online: true, points: 0 },
        });
      }
    } catch (e) {
      throw new Error('部屋が見つかりません');
    }
    await this.enter(roomId);
  }

  async enter(roomId) {
    this.unsubscribe();
    this.roomId = roomId;
    this.room = null;
    this.game = null;
    this.hand = [];
    this.inbox = {};
    this.b.presence(`rooms/${roomId}/players/${this.uid}/online`);
    let first = true;
    this.subs.push(
      this.b.on(`rooms/${roomId}`, (v) => {
        if (!v || !v.meta) {
          if (!first || v === null) this.emit('closed');
          return;
        }
        first = false;
        if (!v.players?.[this.uid]) {
          this.emit('kicked');
          return;
        }
        const prev = this.game;
        this.room = v;
        const g = normalizeGame(v.game);
        if (prev && g && g.gameNo !== prev.gameNo) {
          this.notices = [];
          this.received = new Set();
        }
        this.game = g;
        this.emit('room', { prev, game: g });
        this.scheduleTick();
      }, (e) => this.emit('error', e)),
    );
    this.subs.push(
      this.b.on(`hands/${roomId}/${this.uid}`, (v) => {
        this.hand = toArray(v);
        this.emit('hand');
        this.scheduleTick();
      }),
    );
    this.subs.push(
      this.b.on(`inbox/${roomId}/${this.uid}`, (v) => {
        this.inbox = v || {};
        this.scheduleTick();
      }),
    );
  }

  unsubscribe() {
    for (const off of this.subs) off?.();
    this.subs = [];
  }

  async leave() {
    const rid = this.roomId;
    if (!rid) return;
    const inGame = this.game && (this.game.status === 'playing' || this.game.status === 'exchange') && this.game.order.includes(this.uid);
    this.unsubscribe();
    await this.b.clearPresence(`rooms/${rid}/players/${this.uid}/online`);
    try {
      if (inGame) {
        // ゲーム中は席を残して「切断中」に
        await this.b.update({ [`rooms/${rid}/players/${this.uid}/online`]: false });
      } else {
        const paths = { [`rooms/${rid}/players/${this.uid}`]: null };
        if (this.isHost) {
          const next = this.players.find((p) => p.uid !== this.uid && p.online) || this.players.find((p) => p.uid !== this.uid);
          if (next) paths[`rooms/${rid}/meta/hostUid`] = next.uid;
        }
        await this.b.update(paths);
      }
    } catch (e) {
      console.warn(e);
    }
    this.roomId = null;
    this.room = null;
    this.game = null;
  }

  async takeHost() {
    await this.b.update({ [`rooms/${this.roomId}/meta/hostUid`]: this.uid, ...this.touch() });
  }

  touch() {
    const t = this.b.serverTime();
    return { [`rooms/${this.roomId}/meta/updatedAt`]: t, [`roomIndex/${this.roomId}/updatedAt`]: t };
  }

  // ---------- ゲーム開始(ホスト) ----------
  // 次のゲームに座る人:待合室で「参加する」を押していて接続中の人(ホストは常に含む)。参加順に最大8人
  seatedForNextGame() {
    return this.players.filter((p) => p.online !== false && (p.ready || p.uid === this.hostUid)).slice(0, MAX_PLAYERS);
  }

  isReady(uid = this.uid) {
    return uid === this.hostUid || !!this.player(uid)?.ready;
  }

  async setReady(ready) {
    await this.b.update({ [`rooms/${this.roomId}/players/${this.uid}/ready`]: ready ? true : null, ...this.touch() });
  }

  // 待合室で切断中の人を外す(ホスト)
  async removePlayer(uid) {
    if (!this.isHost) throw new Error('ホストだけが操作できます');
    if (uid === this.uid) return;
    await this.b.update({ [`rooms/${this.roomId}/players/${uid}`]: null, ...this.touch() });
  }

  get inGame() {
    const g = this.game;
    return !!g && (g.status === 'playing' || g.status === 'exchange');
  }

  async startGame() {
    if (!this.isHost) throw new Error('ホストだけが開始できます');
    const seated = this.seatedForNextGame();
    if (seated.length < 2) throw new Error('2人以上で開始できます');
    const order = seated.map((p) => p.uid);
    const prev = this.game;
    // 交換・先手・都落ちは直前のゲームの称号だけで決める(途中で抜けた人の古い称号は使わない)
    const prevTitles = {};
    const last = prev?.result?.titles || {};
    for (const p of seated) if (last[p.uid]) prevTitles[p.uid] = last[p.uid];
    const gameNo = (prev?.gameNo || 0) + 1;
    const { game, hands, inbox } = dealGame({ order, gameNo, prevTitles, seq: prev?.seq || 0, actor: this.uid });
    const rid = this.roomId;
    const paths = { [`rooms/${rid}/game`]: serializeGame(game), ...this.touch() };
    for (const u of order) {
      paths[`hands/${rid}/${u}`] = hands[u];
      const items = {};
      for (const it of inbox[u] || []) items[this.b.newKey()] = it;
      paths[`inbox/${rid}/${u}`] = Object.keys(items).length ? items : null;
    }
    // 参加の意思表示はゲームごとにリセット(次のゲームの前にもう一度押してもらう)
    for (const p of this.players) if (p.ready) paths[`rooms/${rid}/players/${p.uid}/ready`] = null;
    await this.b.update(paths);
  }

  // ゲームを中止して待合室へ戻る(ホスト)
  async backToLobby() {
    const g = this.game;
    if (!g) return;
    const next = { ...g, seq: g.seq + 1, actor: this.uid, status: 'lobby', events: [] };
    await this.b.update({ [`rooms/${this.roomId}/game`]: serializeGame(next), ...this.touch() });
  }

  // ---------- 操作 ----------
  synced() {
    return !!this.game && (this.game.handCount[this.uid] ?? 0) === this.hand.length;
  }

  async perform(action) {
    const g = this.game;
    if (!g) throw new RuleError('ゲームがありません');
    const out = applyAction(g, this.uid, action, this.hand, { isHost: this.isHost });
    const rid = this.roomId;
    const paths = { [`rooms/${rid}/game`]: serializeGame(out.game), ...this.touch() };
    if (out.hand) paths[`hands/${rid}/${this.uid}`] = out.hand;
    for (const { to, item } of out.inbox) paths[`inbox/${rid}/${to}/${this.b.newKey()}`] = item;
    if (out.game.status === 'result' && out.game.result) {
      const { titles, delta } = out.game.result;
      for (const u of Object.keys(titles)) {
        if (!this.room?.players?.[u]) continue;
        paths[`rooms/${rid}/players/${u}/title`] = titles[u];
        paths[`rooms/${rid}/players/${u}/points`] = this.b.increment(delta[u]);
      }
    }
    if (action.type === 'play' || action.type === 'seven' || action.type === 'ten' || action.type === 'exchangeReturn') {
      this.received = new Set();
    }
    try {
      await this.b.update(paths);
    } catch (e) {
      const err = new RuleError('ほかの操作と重なりました。もう一度どうぞ');
      err.conflict = true;
      throw err;
    }
  }

  // ---------- 自動処理(受け箱の取り込み・ボンバーの適用) ----------
  scheduleTick(delay = 60) {
    clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (this.busy || !this.roomId) return;
    const g = this.game;
    if (!g) return;
    this.busy = true;
    let again = false;
    try {
      const entries = Object.entries(this.inbox || {});
      if (entries.length) {
        const paths = {};
        let add = [];
        const notices = [];
        for (const [k, it] of entries) {
          if ((it.gameNo || 0) > g.gameNo) continue; // 次のゲームの分(状態の到着待ち)
          if ((it.gameNo || 0) === g.gameNo) {
            if (it.kind === 'cards') add.push(...toArray(it.cards));
            else notices.push({ ...it, cards: toArray(it.cards) });
          }
          paths[`inbox/${this.roomId}/${this.uid}/${k}`] = null;
        }
        if (Object.keys(paths).length) {
          const expected = g.handCount[this.uid] ?? 0;
          const ok = this.hand.length + add.length === expected;
          if (!ok && add.length) {
            // 手札の到着待ち。長く続くならそのまま取り込む
            if (!this.mismatchSince) this.mismatchSince = Date.now();
            if (Date.now() - this.mismatchSince < 3000) {
              again = true;
              return;
            }
          }
          this.mismatchSince = 0;
          if (add.length) paths[`hands/${this.roomId}/${this.uid}`] = [...this.hand, ...add];
          await this.b.update(paths);
          for (const c of add) this.received.add(c);
          if (notices.length) this.notices.push(...notices);
          if (add.length || notices.length) this.emit('received', { cards: add, notices });
          again = true;
          return;
        }
      }
      if (g.bombApply?.waiting?.[this.uid] && this.synced()) {
        try {
          await this.perform({ type: 'bombApply' });
        } catch (e) {
          again = true;
        }
        return;
      }
    } catch (e) {
      console.warn('tick', e);
      again = true;
    } finally {
      this.busy = false;
      if (again) this.scheduleTick(200 + Math.random() * 400);
    }
  }

  // ---------- 古い部屋の掃除(起動時) ----------
  async cleanupOldRooms() {
    try {
      const old = await this.b.queryOlder('roomIndex', 'updatedAt', Date.now() - DAY, 5);
      for (const [rid, info] of Object.entries(old)) {
        const paths = {
          [`rooms/${rid}`]: null, [`hands/${rid}`]: null, [`inbox/${rid}`]: null, [`roomIndex/${rid}`]: null,
        };
        if (info?.code) {
          const cur = await this.b.get(`roomCodes/${info.code}`).catch(() => null);
          if (cur === rid) paths[`roomCodes/${info.code}`] = null;
        }
        await this.b.update(paths).catch(() => {});
      }
    } catch (e) {
      /* 掃除は失敗しても問題ない */
    }
  }
}
