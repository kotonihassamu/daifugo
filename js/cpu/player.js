// CPU プレイヤー本体(ブラウザ・PC の Node 共通)。
// RoomController(人と同じ接続)を1つ持ち、自分の番や選択が来たら判断して打つ。
// 何があっても「判断 → ルールの手 → パス」の順に必ず進めるので、CPU がゲームを止めることはない。
import { heuristicTurn, heuristicChoice, pendingDecision } from './policy.js';
import { cardLabel } from '../cards.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function describeAction(action) {
  if (!action) return '-';
  if (action.type === 'play') return `出す ${action.cards.map(cardLabel).join(' ')}`;
  if (action.type === 'pass') return 'パス';
  if (action.cards) return `${{ seven: '7渡し', ten: '10捨て', exchangeReturn: '交換で返す' }[action.type] || action.type} ${action.cards.map(cardLabel).join(' ')}`;
  if (action.ranks) return `ボンバー ${action.ranks.join('・')}`;
  return action.type;
}

// 最初の1手までの待ち時間(ミリ秒)
const OPENING_DELAY = 4500;

export class CpuPlayer {
  // decideAsync(game, uid, hand, opts) → Promise<action>(Worker で先読みするときなど)
  constructor(name, ctrl, { decideAsync, level = 'search', thinkMs = 1200, minDelay = 1500, log = () => {} } = {}) {
    this.name = name;
    this.ctrl = ctrl;
    this.decideAsync = decideAsync;
    this.opts = { level, timeMs: thinkMs };
    this.minDelay = minDelay;
    this.logFn = log;
    this.busy = false;
    this.timer = null;
    this.stopped = false;
    this.onStop = null;
  }

  log(msg) {
    this.logFn(`[${this.name}] ${msg}`);
  }

  start() {
    const kick = () => this.kick();
    this.ctrl.addEventListener('room', kick);
    this.ctrl.addEventListener('hand', kick);
    const end = (why) => {
      if (this.stopped) return;
      this.log(why);
      this.stop();
    };
    this.ctrl.addEventListener('kicked', () => end('部屋から外されました'));
    this.ctrl.addEventListener('closed', () => end('部屋がなくなりました'));
    this.kick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ctrl.unsubscribe();
    this.onStop?.();
  }

  kick(delay = 80) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.act().catch((e) => this.log('エラー ' + e.message)), delay);
  }

  async act() {
    if (this.busy || this.stopped) return;
    const ctrl = this.ctrl;
    const g = ctrl.game;
    const d = pendingDecision(g, ctrl.uid);
    if (!d || d.kind === 'bombApply') return; // ボンバーの反映は RoomController が自動で行う
    if (!ctrl.synced()) return this.kick(300); // 受け取ったカードの取り込み待ち
    this.busy = true;
    const seq = g.seq;
    const hand = [...ctrl.hand];
    const t0 = Date.now();
    let action = null;
    try {
      action = await this.decideAsync(g, ctrl.uid, hand, this.opts);
    } catch (e) {
      this.log('判断でエラー、ルールで打ちます: ' + e.message);
    }
    if (!action) action = d.kind === 'turn' ? heuristicTurn(g, ctrl.uid, hand) : heuristicChoice(g, ctrl.uid, hand, d);
    const took = Date.now() - t0;
    // ゲームの最初の1手は、配る演出と「スタート」の表示を見終わるまで待つ
    const opening = d.kind === 'turn' && !g.field?.length && !(g.seen || []).length;
    await sleep(Math.max(0, (opening ? OPENING_DELAY : this.minDelay) - took) + Math.random() * 600);
    try {
      if (this.stopped || ctrl.game?.seq !== seq) return; // 考えている間に状態が変わった → やり直し
      const done = await this.perform(action, d, g, hand);
      if (done) this.log(`${describeAction(done)}(考慮 ${took}ms)`);
    } finally {
      this.busy = false;
      this.kick(150);
    }
  }

  // 出せなかったら安全網(ルール → パス)で必ず進める
  async perform(action, d, g, hand) {
    const ctrl = this.ctrl;
    const tries = [action];
    if (d.kind === 'turn') tries.push(heuristicTurn(g, ctrl.uid, hand), { type: 'pass' });
    else tries.push(heuristicChoice(g, ctrl.uid, hand, d));
    for (const a of tries) {
      try {
        await ctrl.perform(a);
        return a;
      } catch (e) {
        if (e.conflict) return null; // ほかの操作と重なった → 次の更新でやり直す
        this.log(`「${describeAction(a)}」は出せません(${e.message})`);
      }
    }
    return null;
  }
}
