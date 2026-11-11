// ゲーム画面:テーブル配置・場・手札・操作ボタン・演出
import { sortCards, cardLabel, rankLabel, MAX_PASS } from '../cards.js';
import { interpretations, canPlay, legalPlays, direction, describeCombo, lockLabel, requiredNumber } from '../rules.js';
import { canPassNow, TITLES, fieldTop } from '../engine.js';
import { cardSvg } from './card-svg.js';
import { flyFrom, flyCard, banner, revolutionFlash, bubble, sweep, dropBadge, reduceMotion, wait } from './anim.js';
import { sound } from './sound.js';
import { esc, toast, openModal, closeModal } from './dom.js';

const FX_TEXT = {
  revolution: ['革命!', 'big red'],
  revolutionBack: ['革命返し!', 'big red'],
  elevenBack: ['11バック', 'purple'],
  suitLock: ['縛り', 'blue'],
  numberLock: ['数字縛り', 'blue'],
  seven: ['7渡し', 'green'],
  ten: ['10捨て', 'green'],
  bomb: ['12ボンバー', 'orange'],
  eight: ['8切り', 'gold'],
  skip: ['5スキップ', 'green'],
  spe3: ['スペ3返し!', 'gold big'],
};

// 人数ごとの席の振り分け [左, 上, 右]
const DIST = { 0: [0, 0, 0], 1: [0, 1, 0], 2: [1, 0, 1], 3: [1, 1, 1], 4: [1, 2, 1], 5: [1, 3, 1], 6: [2, 2, 2], 7: [2, 3, 2] };
const LEFT = { 1: [52], 2: [66, 34] };
const TOP = { 1: [50], 2: [32, 68], 3: [19, 50, 81] };
const RIGHT = { 1: [52], 2: [34, 66] };

function seatPositions(k, landscape) {
  if (landscape) {
    // 横長で背の低いテーブル:左右に1人ずつ、残りは上の列に並べる(時計回り=左→上→右)
    if (k === 0) return [];
    if (k === 1) return [{ x: 50, y: 20 }];
    const top = k - 2;
    const pos = [{ x: 8, y: 60 }];
    for (let i = 0; i < top; i++) pos.push({ x: top === 1 ? 50 : 22 + (56 * i) / (top - 1), y: 20 });
    pos.push({ x: 92, y: 60 });
    return pos;
  }
  const [l, t, r] = DIST[k];
  const pos = [];
  for (const y of LEFT[l] || []) pos.push({ x: 10.5, y });
  for (const x of TOP[t] || []) pos.push({ x, y: t === 3 && x === 50 ? 9 : 11 });
  for (const y of RIGHT[r] || []) pos.push({ x: 89.5, y });
  return pos;
}

function hashRot(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 9) - 4) * 1;
}

export class GameView {
  constructor(root, ctrl, settings, hooks) {
    this.root = root;
    this.ctrl = ctrl;
    this.settings = settings;
    this.hooks = hooks; // { openMenu, openRules, startNext, backToLobby }
    this.sel = new Set();
    this.queue = [];
    this.running = false;
    this.bannerChain = Promise.resolve();
    this.myPlayRects = null;
    this.resultShownFor = null;
    this.bombPromptFor = null;
    this.displayGame = null;
    this.mount();
  }

  mount() {
    this.root.innerHTML = `
      <div class="game">
        <header class="g-top">
          <div class="g-room"><span class="muted">部屋</span> <b class="g-code"></b> <span class="g-no muted"></span></div>
          <div class="g-actions">
            <button class="icon-btn" data-act="rules" aria-label="ルール">ルール</button>
            <button class="icon-btn" data-act="menu" aria-label="メニュー">≡</button>
          </div>
        </header>
        <div class="table" id="table">
          <div class="felt"></div>
          <div class="seats"></div>
          <div class="center">
            <div class="badges"></div>
            <div class="field" id="field"></div>
            <div class="field-info"></div>
          </div>
          <div class="status-line"></div>
        </div>
        <div class="me-bar"></div>
        <div class="prompt"></div>
        <div class="hand" id="hand"></div>
        <div class="controls">
          <button class="btn ghost sort-btn" data-act="sort">並び替え</button>
          <button class="btn pass-btn" data-act="pass">パス</button>
          <button class="btn primary play-btn" data-act="play">出す</button>
        </div>
      </div>`;
    const q = (s) => this.root.querySelector(s);
    this.el = {
      code: q('.g-code'), no: q('.g-no'), table: q('#table'), seats: q('.seats'), field: q('#field'),
      fieldInfo: q('.field-info'), badges: q('.badges'), status: q('.status-line'), me: q('.me-bar'),
      prompt: q('.prompt'), hand: q('#hand'), pass: q('.pass-btn'), play: q('.play-btn'), sort: q('.sort-btn'),
    };
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.bindHand();
    this.resizeObs = new ResizeObserver(() => this.layoutHand());
    this.resizeObs.observe(this.el.hand);
    this.onResize = () => this.render(this.displayGame || this.ctrl.game);
    window.addEventListener('resize', this.onResize);
  }

  destroy() {
    this.resizeObs?.disconnect();
    window.removeEventListener('resize', this.onResize);
  }

  get me() {
    return this.ctrl.uid;
  }

  name(uid) {
    return this.ctrl.player(uid)?.name || '(退出)';
  }

  // ---------- 状態更新 ----------
  onRoom({ prev, game }) {
    if (!game) return;
    this.queue.push({ prev, game });
    this.renderControls(game);
    if (!this.running) this.runQueue();
    // 手番の通知
    const mine = (g) => g && ((g.status === 'playing' && g.turn === this.me && !g.pending && !g.bombApply) || g.pending?.uid === this.me || (g.status === 'exchange' && g.exchange?.[this.me] && !g.exchange[this.me].done));
    if (mine(game) && !mine(prev)) {
      if (this.settings.vibrate) navigator.vibrate?.(40);
      sound.play('turn');
    }
  }

  async runQueue() {
    this.running = true;
    while (this.queue.length) {
      const { prev, game } = this.queue.shift();
      const animate = prev && game.seq === prev.seq + 1 && this.queue.length < 3 && document.visibilityState === 'visible';
      try {
        if (animate) await this.playEvents(prev, game);
      } catch (e) {
        console.warn(e);
      }
      this.render(game);
      this.afterEvents(prev, game, animate);
    }
    this.running = false;
  }

  onHand() {
    const hand = this.ctrl.hand;
    for (const c of [...this.sel]) if (!hand.includes(c)) this.sel.delete(c);
    this.renderHand();
    const g = this.displayGame || this.ctrl.game;
    if (g) {
      this.renderMe(g);
      this.renderPrompt(g);
    }
    this.renderControls(g);
  }

  // ---------- 描画 ----------
  render(g) {
    if (!g) return;
    this.displayGame = g;
    const room = this.ctrl.room;
    this.el.code.textContent = room?.meta?.code || '';
    this.el.no.textContent = `第${g.gameNo}ゲーム`;
    this.renderSeats(g);
    this.renderField(g.field);
    this.renderBadges(g);
    this.renderStatus(g);
    this.renderMe(g);
    this.renderPrompt(g);
    this.renderHand();
    this.renderControls(g);
    if (g.status === 'result' && this.resultShownFor !== g.gameNo) {
      this.resultShownFor = g.gameNo;
      setTimeout(() => this.hooks.showResult(), reduceMotion() ? 0 : 700);
    }
    if (g.pending?.type === 'bomb' && g.pending.uid === this.me && this.bombPromptFor !== g.seq) {
      this.bombPromptFor = g.seq;
      this.openBomb(g.pending.count);
    }
  }

  viewOrder(g) {
    const order = g.order;
    const i = order.indexOf(this.me);
    if (i < 0) return { bottom: order[0], others: order.slice(1), spectator: true };
    return { bottom: this.me, others: [...order.slice(i + 1), ...order.slice(0, i)], spectator: false };
  }

  seatEl(uid) {
    if (uid === this.me) return this.el.hand;
    return this.el.seats.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
  }

  seatRect(uid) {
    const el = this.seatEl(uid);
    if (!el) return null;
    const fan = el.querySelector('.seat-fan') || el;
    return fan.getBoundingClientRect();
  }

  renderSeats(g) {
    const { bottom, others, spectator } = this.viewOrder(g);
    const rect = this.el.table.getBoundingClientRect();
    const landscape = rect.width > rect.height * 1.25;
    const pos = seatPositions(others.length, landscape);
    const list = others.map((u, i) => ({ u, ...pos[i] }));
    if (spectator && bottom) list.push({ u: bottom, x: 50, y: landscape ? 80 : 86 });
    const html = list.map(({ u, x, y }) => this.seatHtml(g, u, x, y, landscape)).join('');
    this.el.seats.innerHTML = html;
  }

  seatHtml(g, u, x, y, landscape) {
    const p = this.ctrl.player(u) || {};
    const count = g.handCount[u] ?? 0;
    const turn = (g.status === 'playing' && g.turn === u && !g.pending && !g.bombApply) || g.pending?.uid === u;
    const place = g.finished.indexOf(u);
    const title = g.status === 'result' ? g.result?.titles?.[u] : g.prevTitles?.[u];
    const tags = [];
    if (title) tags.push(`<span class="tag t-${title}">${TITLES[title]}</span>`);
    if (p.online === false) tags.push('<span class="tag off">切断中</span>');
    if (g.passed[u] && place < 0) tags.push('<span class="tag pass">パス</span>');
    if (g.status === 'playing' && place < 0 && g.ochi !== u) tags.push(`<span class="tag mini">パス残${Math.max(0, MAX_PASS - (g.passesUsed[u] || 0))}</span>`);
    const shown = Math.min(count, 8);
    const spread = Math.min(40, 6 + shown * 5);
    const fan = Array.from({ length: shown }, (_, i) => {
      const a = shown > 1 ? -spread / 2 + (spread * i) / (shown - 1) : 0;
      return `<div class="mini-back" style="transform: rotate(${a}deg)"></div>`;
    }).join('');
    const placeBadge = place >= 0 ? `<div class="place-badge">${place + 1}位</div>` : g.ochi === u ? '<div class="place-badge ochi">都落ち</div>' : '';
    const host = this.ctrl.hostUid === u ? '<span class="host-mark" title="ホスト">★</span>' : '';
    return `<div class="seat${turn ? ' turn' : ''}${p.online === false ? ' offline' : ''}${place >= 0 || g.ochi === u ? ' done' : ''}" data-uid="${esc(u)}" style="left:${x}%;top:clamp(${landscape ? 36 : 50}px, ${y}%, calc(100% - 40px))">
      <div class="seat-fan">${fan}${count ? `<span class="seat-count">×${count}</span>` : ''}</div>
      <div class="seat-name">${host}${esc(p.name || '?')}</div>
      <div class="seat-tags">${tags.join('')}</div>
      ${placeBadge}
    </div>`;
  }

  fieldCardWidth() {
    const r = this.el.table.getBoundingClientRect();
    return Math.round(Math.max(42, Math.min(74, r.width * 0.15, r.height * 0.2)));
  }

  renderField(entries) {
    const cw = this.fieldCardWidth();
    const show = entries.slice(-4);
    this.el.field.style.setProperty('--cw', cw + 'px');
    this.el.field.innerHTML = show
      .map((e, idx) => {
        const d = show.length - 1 - idx;
        const n = e.cards.length;
        const sp = n > 4 ? cw * 0.38 : cw * 0.5;
        const w = cw + (n - 1) * sp;
        const cards = e.cards
          .map((c, i) => `<div class="card" data-code="${c}" style="left:${i * sp}px;transform:rotate(${hashRot(c + idx)}deg)">${cardSvg(c)}</div>`)
          .join('');
        return `<div class="play${d === 0 ? ' top' : ''}" style="--d:${d};width:${w}px;margin-left:${-w / 2}px">${cards}</div>`;
      })
      .join('');
    const t = entries[entries.length - 1];
    if (t) {
      const kind = t.type === 'seq' ? '階段' : t.type === 'group' ? `${t.size}枚` : '';
      this.el.fieldInfo.innerHTML = `<b>${esc(this.name(t.by))}</b> ×${t.size}${kind && t.type === 'seq' ? ' 階段' : ''}`;
    } else {
      this.el.fieldInfo.innerHTML = '';
    }
  }

  renderBadges(g) {
    const b = [];
    const e = g.effects;
    if (e.revolution) b.push('<span class="badge red">革命中</span>');
    if (e.elevenBack) b.push('<span class="badge purple">11バック</span>');
    if (e.suitLock) b.push(`<span class="badge blue">縛り ${lockLabel(e.suitLock)}</span>`);
    if (e.numberLock) {
      const r = requiredNumber(fieldTop(g), e);
      b.push(`<span class="badge blue">数字縛り${r ? ` 次は${rankLabel(r)}` : ''}</span>`);
    }
    this.el.badges.innerHTML = b.join('');
  }

  renderStatus(g) {
    const host = this.ctrl.isHost;
    const off = (u) => this.ctrl.player(u)?.online === false;
    let text = '';
    const btns = [];
    if (g.status === 'exchange') {
      const waiting = Object.entries(g.exchange || {}).filter(([, x]) => !x.done).map(([u]) => u);
      text = `カード交換中… ${waiting.map((u) => esc(this.name(u))).join('、')}さんが返すカードを選んでいます`;
      if (host && waiting.some(off)) btns.push(['skipExchange', '交換をスキップ']);
    } else if (g.status === 'result') {
      text = 'ゲーム終了';
      btns.push(['showResult', '結果を見る']);
      if (host) btns.push(['next', '次のゲームへ']);
    } else if (g.bombApply) {
      const w = Object.keys(g.bombApply.waiting);
      text = `12ボンバー:${w.map((u) => esc(this.name(u))).join('、')}さんの反映待ち`;
      if (host && w.some(off)) btns.push(['skipBombWait', '待たずに進める']);
    } else if (g.pending) {
      const p = g.pending;
      const what = { seven: '7渡しのカード', ten: '10捨てのカード', bomb: '12ボンバーの数字' }[p.type];
      if (p.uid !== this.me) text = `${esc(this.name(p.uid))}さんが${what}を選んでいます…`;
      else text = '';
      if (host && p.uid !== this.me && off(p.uid)) btns.push(['skipPending', '代わりにスキップ']);
    } else if (g.status === 'playing') {
      if (g.turn === this.me) text = '<b>あなたの番です</b>';
      else text = `${esc(this.name(g.turn))}さんの番`;
      if (host && g.turn !== this.me && off(g.turn)) btns.push(['forcePass', '代わりにパス']);
    }
    this.el.status.innerHTML = `<span>${text}</span>${btns.map(([a, l]) => `<button class="btn small" data-act="${a}">${l}</button>`).join('')}`;
  }

  renderMe(g) {
    const me = this.ctrl.player(this.me);
    if (!g.order.includes(this.me)) {
      this.el.me.innerHTML = `<span class="muted">観戦中 — 次のゲームから参加します</span>`;
      return;
    }
    const title = g.status === 'result' ? g.result?.titles?.[this.me] : g.prevTitles?.[this.me];
    const place = g.finished.indexOf(this.me);
    const parts = [`<b>${esc(me?.name || '')}</b>`];
    if (title) parts.push(`<span class="tag t-${title}">${TITLES[title]}</span>`);
    if (place >= 0) parts.push(`<span class="tag gold">${place + 1}位あがり</span>`);
    if (g.ochi === this.me) parts.push('<span class="tag off">都落ち</span>');
    parts.push(`<span class="muted">残り${this.ctrl.hand.length}枚</span>`);
    if (this.ctrl.isHost) parts.push('<span class="host-mark">★ホスト</span>');
    this.el.me.innerHTML = parts.join(' ');
  }

  renderPrompt(g) {
    const p = g.pending;
    let html = '';
    if (g.status === 'exchange') {
      const item = g.exchange?.[this.me];
      if (item && !item.done) {
        const got = [...this.ctrl.received];
        html = `<b>カード交換</b>:${esc(this.name(item.to))}さんから ${got.map(cardLabel).join('・') || `${item.count}枚`} を受け取りました。返すカードを<b>${item.count}枚</b>選んでください`;
      }
      const given = this.ctrl.notices.filter((n) => n.reason === 'exchangeGive');
      if (given.length) html = `${esc(this.name(given[0].to))}さんに ${given[0].cards.map(cardLabel).join('・')} を渡しました。` + (html ? '<br>' + html : '相手が返すカードを選んでいます');
    } else if (p && p.uid === this.me) {
      if (p.type === 'seven') html = `<b>7渡し</b>:${esc(this.name(p.to))}さんに渡すカードを<b>${p.count}枚</b>選んでください`;
      if (p.type === 'ten') html = `<b>10捨て</b>:捨てるカードを<b>${p.count}枚</b>選んでください`;
      if (p.type === 'bomb') html = `<b>12ボンバー</b>:数字を${p.count}つ指定してください <button class="btn small" data-act="bombOpen">数字を選ぶ</button>`;
    }
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.toggle('show', !!html);
  }

  // 手札:強さ順に扇状に重ねる
  renderHand() {
    const g = this.displayGame || this.ctrl.game;
    const hand = this.ctrl.hand;
    const reversed = g ? direction(g.effects) < 0 : false;
    const sorted = sortCards(hand, this.settings.sort, reversed);
    const existing = new Map([...this.el.hand.querySelectorAll('.hcard')].map((el) => [el.dataset.code, el]));
    const frag = [];
    for (const code of sorted) {
      let el = existing.get(code);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hcard card';
        el.dataset.code = code;
        el.innerHTML = cardSvg(code);
      }
      existing.delete(code);
      frag.push(el);
    }
    for (const el of existing.values()) el.remove();
    frag.forEach((el, i) => {
      if (this.el.hand.children[i] !== el) this.el.hand.insertBefore(el, this.el.hand.children[i] || null);
    });
    this.sortedHand = sorted;
    this.layoutHand();
  }

  layoutHand() {
    const els = [...this.el.hand.querySelectorAll('.hcard')];
    const n = els.length;
    const W = this.el.hand.clientWidth - 24;
    const H = window.innerHeight;
    if (W <= 0) return;
    const maxCw = Math.min(76, W / 5, (H * (H < 560 ? 0.24 : 0.2) * 63) / 88);
    const cw = Math.min(maxCw, W / (0.36 * Math.max(0, n - 1) + 1));
    const step = n > 1 ? Math.min(cw * 0.62, (W - cw) / (n - 1)) : 0;
    const total = cw + step * (n - 1);
    const x0 = 12 + (W - total) / 2;
    const ang = n > 1 ? Math.min(1.8, 16 / n) : 0;
    const half = Math.max(1, (n - 1) / 2);
    const g = this.displayGame || this.ctrl.game;
    let hint = null;
    if (this.settings.hint && g && g.status === 'playing' && g.turn === this.me && !g.pending && !g.bombApply) {
      hint = legalPlays(this.ctrl.hand, fieldTop(g), g.effects).cards;
    }
    const ch = (cw * 88) / 63;
    this.el.hand.style.height = Math.round(ch + 34) + 'px';
    els.forEach((el, i) => {
      const off = i - (n - 1) / 2;
      const rot = off * ang;
      const dy = (off * off * 9) / (half * half);
      const sel = this.sel.has(el.dataset.code);
      el.style.width = cw + 'px';
      el.style.left = x0 + i * step + 'px';
      el.style.zIndex = i + 1;
      el.style.transform = `translateY(${dy - (sel ? 18 : 0)}px) rotate(${rot}deg)`;
      el.classList.toggle('selected', sel);
      el.classList.toggle('hint', !!hint && hint.has(el.dataset.code));
      el.classList.toggle('new', this.ctrl.received.has(el.dataset.code));
    });
  }

  bindHand() {
    const hand = this.el.hand;
    hand.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.hcard');
      if (!card) return;
      e.preventDefault();
      sound.unlock();
      this.drag = { mode: !this.sel.has(card.dataset.code), visited: new Set() };
      this.dragApply(card);
      try { hand.setPointerCapture(e.pointerId); } catch {}
    });
    hand.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.hcard');
      if (el) this.dragApply(el);
    });
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      this.renderControls(this.displayGame || this.ctrl.game);
    };
    hand.addEventListener('pointerup', end);
    hand.addEventListener('pointercancel', end);
  }

  dragApply(el) {
    const code = el.dataset.code;
    if (this.drag.visited.has(code)) return;
    this.drag.visited.add(code);
    if (this.drag.mode) this.sel.add(code);
    else this.sel.delete(code);
    this.layoutHand();
    this.renderControls(this.displayGame || this.ctrl.game);
  }

  // いまの選択で何ができるか
  mode(g) {
    if (!g) return { kind: 'none' };
    const me = this.me;
    if (g.status === 'exchange') {
      const item = g.exchange?.[me];
      if (item && !item.done) return { kind: 'exchange', count: item.count };
      return { kind: 'none' };
    }
    if (g.status !== 'playing') return { kind: 'none' };
    if (g.pending?.uid === me && (g.pending.type === 'seven' || g.pending.type === 'ten')) return { kind: g.pending.type, count: g.pending.count };
    if (g.turn === me && !g.pending && !g.bombApply) return { kind: 'turn' };
    return { kind: 'none' };
  }

  playOptions(g) {
    const t = fieldTop(g);
    return interpretations([...this.sel]).filter((c) => canPlay(c, t, g.effects));
  }

  renderControls() {
    // 操作ボタンは演出の進み具合に関係なく最新の状態に合わせる
    const g = this.ctrl.game;
    const m = this.mode(g);
    const synced = this.ctrl.synced();
    const { play, pass } = this.el;
    pass.style.visibility = 'visible';
    if (m.kind === 'turn') {
      play.textContent = '出す';
      play.disabled = !synced || this.playOptions(g).length === 0;
      const cp = canPassNow(g, this.me, this.ctrl.hand);
      const left = MAX_PASS - (g.passesUsed[this.me] || 0);
      pass.textContent = `パス 残り${Math.max(0, left)}`;
      pass.disabled = !synced || !cp.ok;
      pass.title = cp.reason || '';
    } else if (m.kind === 'seven' || m.kind === 'ten' || m.kind === 'exchange') {
      play.textContent = { seven: '渡す', ten: '捨てる', exchange: '返す' }[m.kind] + ` (${this.sel.size}/${m.count})`;
      play.disabled = !synced || this.sel.size !== m.count;
      pass.style.visibility = 'hidden';
    } else {
      play.textContent = '出す';
      play.disabled = true;
      const left = g && g.status === 'playing' && g.order.includes(this.me) ? MAX_PASS - (g.passesUsed[this.me] || 0) : null;
      pass.textContent = left == null ? 'パス' : `パス 残り${Math.max(0, left)}`;
      pass.disabled = true;
    }
    this.el.sort.textContent = this.settings.sort === 'suit' ? 'マーク順' : '強さ順';
  }

  // ---------- 操作 ----------
  async onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    sound.unlock();
    const act = btn.dataset.act;
    const g = this.ctrl.game;
    const run = async (action) => {
      try {
        await this.ctrl.perform(action);
        return true;
      } catch (err) {
        toast(err.message || String(err));
        return false;
      }
    };
    switch (act) {
      case 'rules': return this.hooks.openRules();
      case 'menu': return this.hooks.openMenu();
      case 'sort':
        this.settings.sort = this.settings.sort === 'suit' ? 'strength' : 'suit';
        this.hooks.saveSettings();
        this.renderHand();
        this.renderControls(g);
        return;
      case 'pass':
        this.sel.clear();
        await run({ type: 'pass' });
        return;
      case 'play': {
        const m = this.mode(g);
        const cards = [...this.sel];
        if (m.kind === 'turn') {
          const opts = this.playOptions(g);
          if (!opts.length) return;
          let interp = opts[0].key;
          if (opts.length > 1) {
            interp = await this.choose(opts);
            if (!interp) return;
          }
          this.captureRects(cards);
          this.sel.clear();
          if (!(await run({ type: 'play', cards, interp }))) this.myPlayRects = null;
        } else if (m.kind === 'seven' || m.kind === 'ten' || m.kind === 'exchange') {
          this.captureRects(cards);
          this.sel.clear();
          await run({ type: m.kind === 'exchange' ? 'exchangeReturn' : m.kind, cards });
        }
        this.renderControls(this.ctrl.game);
        return;
      }
      case 'bombOpen': return this.openBomb(g.pending?.count || 1);
      case 'forcePass': case 'skipPending': case 'skipBombWait': case 'skipExchange':
        await run({ type: act });
        return;
      case 'showResult': return this.hooks.showResult();
      case 'next': return this.hooks.startNext();
    }
  }

  captureRects(cards) {
    this.myPlayRects = {};
    for (const c of cards) {
      const el = this.el.hand.querySelector(`.hcard[data-code="${c}"]`);
      if (el) this.myPlayRects[c] = el.getBoundingClientRect();
    }
  }

  choose(opts) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.innerHTML = `<h2>どう出しますか?</h2><div class="choice-list">${opts
        .map((o) => `<button class="btn" data-key="${esc(o.key)}">${esc(describeCombo(o))}</button>`)
        .join('')}</div><button class="btn ghost" data-key="">やめる</button>`;
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-key]');
        if (!b) return;
        closeModal();
        resolve(b.dataset.key || null);
      });
      openModal(body, () => resolve(null));
    });
  }

  openBomb(count) {
    const ranks = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2', 'JK'];
    const label = (r) => (r === 'JK' ? 'JOKER' : r === 'T' ? '10' : r);
    const chosen = new Set();
    const body = document.createElement('div');
    body.innerHTML = `<h2>12ボンバー</h2><p>全員の手札から捨てさせる数字を<b>${count}つ</b>選んでください</p>
      <div class="bomb-grid">${ranks.map((r) => `<button class="bomb-btn" data-r="${r}">${label(r)}</button>`).join('')}</div>
      <button class="btn primary wide" data-ok disabled>決定</button>`;
    const ok = body.querySelector('[data-ok]');
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('.bomb-btn');
      if (b) {
        const r = b.dataset.r;
        if (chosen.has(r)) chosen.delete(r);
        else if (chosen.size < count) chosen.add(r);
        else if (count === 1) { chosen.clear(); chosen.add(r); }
        body.querySelectorAll('.bomb-btn').forEach((x) => x.classList.toggle('on', chosen.has(x.dataset.r)));
        ok.disabled = chosen.size !== count;
        ok.textContent = `決定 (${chosen.size}/${count})`;
      }
      if (e.target.closest('[data-ok]') && chosen.size === count) {
        try {
          await this.ctrl.perform({ type: 'bomb', ranks: [...chosen] });
          closeModal();
        } catch (err) {
          toast(err.message);
        }
      }
    });
    openModal(body);
  }

  // ---------- 演出 ----------
  fx(text, cls) {
    this.bannerChain = this.bannerChain.then(() => banner(text, cls));
  }

  async playEvents(prev, g) {
    let field = [...prev.field];
    const tasks = [];
    for (const ev of g.events) {
      switch (ev.t) {
        case 'deal':
          this.render(g);
          await this.dealAnimation(g);
          break;
        case 'play': {
          field = [...field, { by: ev.uid, cards: ev.cards, type: ev.type, size: ev.size, low: ev.low, jr: ev.jr }];
          // 席の枚数は先に減らしておく
          this.renderSeats({ ...g, field });
          this.renderField(field);
          const els = [...this.el.field.querySelectorAll('.play.top .card')];
          const mine = ev.uid === this.me && this.myPlayRects;
          const src = mine ? null : this.seatRect(ev.uid);
          sound.play('place');
          await Promise.all(els.map((el, i) => flyFrom(el, mine ? this.myPlayRects[el.dataset.code] : src, { delay: i * 40, rotate: mine ? 0 : -10 })));
          this.myPlayRects = null;
          for (const f of ev.fx || []) {
            const [text, cls] = FX_TEXT[f] || [f, ''];
            if (f === 'revolution' || f === 'revolutionBack') revolutionFlash();
            const t = f === 'suitLock' ? `縛り ${lockLabel(g.effects.suitLock || [])}` : text;
            this.fx(t, cls);
          }
          this.renderBadges({ ...g, field });
          break;
        }
        case 'pass':
          bubble(this.seatEl(ev.uid), ev.forced ? 'パス(代理)' : 'パス', 'pass');
          break;
        case 'skip':
          for (const u of ev.skipped || []) bubble(this.seatEl(u), 'スキップ', 'skip');
          break;
        case 'flow':
          if (ev.reason === 'noNext') this.fx('流れ', '');
          await wait(ev.reason === 'eight' ? 450 : 250);
          sound.play('flow');
          await sweep(this.el.field, ev.reason === 'eight');
          field = [];
          this.el.fieldInfo.innerHTML = '';
          break;
        case 'give': {
          const from = this.seatRect(ev.uid), to = this.seatRect(ev.to);
          const w = Math.max(28, this.fieldCardWidth() * 0.6);
          for (let i = 0; i < ev.count; i++) tasks.push(flyCard(null, from, to, { delay: i * 90, width: w }));
          this.fx(`${this.name(ev.uid)} → ${this.name(ev.to)} ${ev.count}枚`, 'small');
          break;
        }
        case 'discard':
        case 'bombHit': {
          if (!ev.cards?.length) break;
          const from = ev.uid === this.me ? this.el.hand.getBoundingClientRect() : this.seatRect(ev.uid);
          const w = this.fieldCardWidth() * 0.75;
          const off = { left: window.innerWidth + 40, top: from ? from.top - 60 : 0, width: w, height: w };
          const offL = { left: -80, top: from ? from.top - 60 : 0, width: w, height: w };
          const fr = from && from.left > window.innerWidth / 2 ? off : offL;
          // 捨てたカードは全員に見せる
          const mid = this.el.field.getBoundingClientRect();
          ev.cards.forEach((c, i) => {
            const midRect = { left: mid.left + mid.width / 2 - w + i * w * 0.45, top: mid.top + mid.height * 0.2, width: w, height: w };
            tasks.push(flyCard(c, from, midRect, { delay: i * 80, width: w, duration: 420 }).then(() => flyCard(c, midRect, fr, { width: w, duration: 600, fade: true, spin: 40 })));
          });
          if (ev.t === 'discard') this.fx(`${this.name(ev.uid)} ${ev.cards.map(cardLabel).join(' ')} を捨てた`, 'small');
          break;
        }
        case 'bomb':
          this.fx(`ボンバー:${ev.ranks.map((r) => (r === 'JK' ? 'ジョーカー' : r === 'T' ? '10' : r)).join('・')}`, 'orange');
          break;
        case 'ochi':
          this.fx(`${this.name(ev.uid)} 都落ち…`, 'purple');
          break;
        case 'start':
          if (prev.status === 'exchange') this.fx('スタート', 'gold');
          break;
        case 'skipPending':
          this.fx('スキップされました', 'small');
          break;
      }
    }
    await Promise.all(tasks);
  }

  afterEvents(prev, g, animated) {
    if (!animated) return;
    for (const ev of g.events) {
      if (ev.t === 'finish') {
        dropBadge(this.seatEl(ev.uid), ev.place);
        this.fx(`${this.name(ev.uid)} ${ev.place}位あがり!`, 'gold');
      }
      if (ev.t === 'end') this.fx('ゲーム終了', 'big');
    }
  }

  async dealAnimation(g) {
    if (reduceMotion()) return;
    let skipped = false;
    const skip = () => {
      skipped = true;
      document.getAnimations?.().forEach((a) => a.finish());
    };
    window.addEventListener('pointerdown', skip, { once: true });
    const c = this.el.field.getBoundingClientRect();
    const from = { left: c.left + c.width / 2 - 20, top: c.top + c.height / 2 - 28, width: 40, height: 56 };
    const { others } = this.viewOrder(g);
    const tasks = [];
    const per = 6;
    others.forEach((u, si) => {
      const to = this.seatRect(u);
      for (let i = 0; i < Math.min(per, g.handCount[u]); i++) tasks.push(flyCard(null, from, to, { delay: (i * others.length + si) * 35, width: 30, duration: 380 }));
    });
    const mine = [...this.el.hand.querySelectorAll('.hcard')];
    mine.forEach((el, i) => tasks.push(flyFrom(el, from, { delay: 80 + i * 45, duration: 380, rotate: 180 })));
    await Promise.race([Promise.all(tasks), wait(2000)]);
    window.removeEventListener('pointerdown', skip);
    if (skipped) document.getAnimations?.().forEach((a) => a.finish());
  }
}
