// ゲーム進行(状態遷移)。通信から独立した純粋関数。
// applyAction(game, uid, action, myHand) は「自分の手札」と公開状態だけから次の状態を作る。
// 他人の手札は読まない:7渡し・交換は受け箱(inbox)へ、12ボンバーは各自が自分の手札に適用する。
import { makeDeck, shuffle, strongest, strengthKey, parseCard, rankFromChar, rankChar, MAX_PASS, RANK_CHARS } from './cards.js';
import {
  interpretations, canPlay, effectsOf, direction, suitLockFormed, isNumberStep,
  noNextNumber, isJokerSingle, hasLegalPlay,
} from './rules.js';

export class RuleError extends Error {}
const err = (m) => { throw new RuleError(m); };

export const TITLES = {
  daifugo: '大富豪', fugo: '富豪', heimin: '平民', hinmin: '貧民', daihinmin: '大貧民',
};
export const TITLE_POINTS = { daifugo: 2, fugo: 1, heimin: 0, hinmin: -1, daihinmin: -2 };

export function titlesFor(n) {
  if (n <= 1) return ['daifugo'];
  if (n === 2) return ['daifugo', 'daihinmin'];
  if (n === 3) return ['daifugo', 'heimin', 'daihinmin'];
  const t = ['daifugo', 'fugo'];
  for (let i = 0; i < n - 4; i++) t.push('heimin');
  t.push('hinmin', 'daihinmin');
  return t;
}

// ---------- 正規化(Firebaseは空配列やnullを保存しないため) ----------
function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
}

export function normalizeGame(raw) {
  if (!raw) return null;
  const g = structuredClone(raw);
  g.seq = g.seq || 0;
  g.order = toArray(g.order);
  g.field = toArray(g.field).map((e) => ({ ...e, cards: toArray(e.cards), jr: e.jr ?? null }));
  g.lastBy = g.lastBy || null;
  g.turn = g.turn || null;
  g.passed = g.passed || {};
  g.passesUsed = g.passesUsed || {};
  g.handCount = g.handCount || {};
  for (const u of g.order) g.handCount[u] = g.handCount[u] || 0;
  const e = g.effects || {};
  g.effects = {
    revolution: !!e.revolution, elevenBack: !!e.elevenBack,
    suitLock: e.suitLock ? toArray(e.suitLock) : null, numberLock: !!e.numberLock,
  };
  g.pending = g.pending || null;
  g.bombApply = g.bombApply ? { ...g.bombApply, ranks: toArray(g.bombApply.ranks), waiting: g.bombApply.waiting || {} } : null;
  g.resolve = g.resolve
    ? { by: g.resolve.by, steps: toArray(g.resolve.steps), eight: !!g.resolve.eight, skip: g.resolve.skip || 0 }
    : null;
  g.finished = toArray(g.finished);
  g.ochi = g.ochi || null;
  g.prevTitles = g.prevTitles || {};
  g.prevDaifugo = g.prevDaifugo || null;
  g.exchange = g.exchange || null;
  g.events = toArray(g.events).map((ev) => ({ ...ev, cards: ev.cards ? toArray(ev.cards) : undefined, ranks: ev.ranks ? toArray(ev.ranks) : undefined, fx: ev.fx ? toArray(ev.fx) : undefined, skipped: ev.skipped ? toArray(ev.skipped) : undefined }));
  if (g.result) g.result = { ...g.result, ranking: toArray(g.result.ranking), titles: g.result.titles || {}, delta: g.result.delta || {} };
  else g.result = null;
  return g;
}

// Firebaseに書く形(undefinedを除く)
export function serializeGame(g) {
  return JSON.parse(JSON.stringify(g));
}

// ---------- 席・手番 ----------
export function isActive(g, u) {
  return g.order.includes(u) && !g.finished.includes(u) && g.ochi !== u;
}
export function activePlayers(g) {
  return g.order.filter((u) => isActive(g, u));
}
export function nextActiveFrom(g, u) {
  const n = g.order.length;
  const i = g.order.indexOf(u);
  for (let k = 1; k <= n; k++) {
    const v = g.order[(i + k) % n];
    if (isActive(g, v) && v !== u) return v;
  }
  return null;
}
function leaderAfter(g, u) {
  return isActive(g, u) ? u : nextActiveFrom(g, u);
}

// from の次から時計回りに進む。steps 人目の(上がっていない)人に着地。
// 途中で「最後に出した人」の席を通過したら場が流れる(=1周した)
function walk(g, from, steps) {
  const n = g.order.length;
  const i = g.order.indexOf(from);
  const passedOver = [];
  let count = 0;
  for (let k = 1; k <= n * 3; k++) {
    const u = g.order[(i + k) % n];
    if (g.lastBy && u === g.lastBy) return { flow: true, skipped: passedOver };
    if (!isActive(g, u)) continue;
    count++;
    if (count === steps) return { flow: false, landed: u, skipped: passedOver };
    passedOver.push(u);
  }
  return { flow: true, skipped: passedOver };
}

function flow(g, leader, reason) {
  g.field = [];
  g.lastBy = null;
  g.passed = {};
  g.effects.elevenBack = false;
  g.effects.suitLock = null;
  g.effects.numberLock = false;
  g.turn = leader;
  g.events.push({ t: 'flow', reason: reason || 'pass', leader });
}

function finish(g, u) {
  if (g.finished.includes(u) || g.ochi === u) return;
  g.finished.push(u);
  g.events.push({ t: 'finish', uid: u, place: g.finished.length });
  // 都落ち:大富豪が1位を逃したら即大貧民で抜ける
  if (g.finished.length === 1 && g.prevDaifugo && g.prevDaifugo !== u && isActive(g, g.prevDaifugo)) {
    g.ochi = g.prevDaifugo;
    g.events.push({ t: 'ochi', uid: g.ochi });
    if (g.bombApply) delete g.bombApply.waiting[g.ochi];
  }
}

function endGame(g) {
  const ranking = [...g.finished, ...activePlayers(g), ...(g.ochi ? [g.ochi] : [])];
  const t = titlesFor(ranking.length);
  const titles = {}, delta = {};
  ranking.forEach((u, i) => {
    titles[u] = t[i];
    delta[u] = TITLE_POINTS[t[i]];
  });
  g.status = 'result';
  g.turn = null;
  g.pending = null;
  g.bombApply = null;
  g.resolve = null;
  g.result = { ranking, titles, delta };
  g.events.push({ t: 'end' });
}

function top(g) {
  return g.field.length ? g.field[g.field.length - 1] : null;
}

function removeCards(hand, cards) {
  const h = [...hand];
  for (const c of cards) {
    const i = h.indexOf(c);
    if (i < 0) err('手札にないカードです');
    h.splice(i, 1);
  }
  return h;
}

// 効果の処理を進める。選択が必要なら pending を立てて止まる
function advance(g) {
  const r = g.resolve;
  if (!r) return;
  while (true) {
    if (activePlayers(g).length <= 1) return endGame(g);
    if (g.pending || g.bombApply) return;
    const step = r.steps.shift();
    if (!step) break;
    if (step.type === 'seven' || step.type === 'ten') {
      if (!isActive(g, r.by) || g.handCount[r.by] === 0) continue;
      const count = Math.min(step.count, g.handCount[r.by]);
      if (step.type === 'seven') {
        const to = nextActiveFrom(g, r.by);
        if (!to) continue;
        g.pending = { type: 'seven', uid: r.by, count, to };
      } else {
        g.pending = { type: 'ten', uid: r.by, count };
      }
      return;
    }
    if (step.type === 'bomb') {
      g.pending = { type: 'bomb', uid: r.by, count: step.count };
      return;
    }
  }
  // すべての選択が終わった:8切り → 数字縛りの行き止まり → 5スキップ → 通常
  g.resolve = null;
  const by = r.by;
  if (r.eight) return flow(g, leaderAfter(g, by), 'eight');
  if (noNextNumber(top(g), g.effects)) return flow(g, leaderAfter(g, g.lastBy || by), 'noNext');
  const w = walk(g, by, 1 + r.skip);
  if (r.skip > 0) g.events.push({ t: 'skip', uid: by, skipped: w.skipped });
  if (w.flow) return flow(g, leaderAfter(g, g.lastBy || by), 'round');
  g.turn = w.landed;
}

function completeBomb(g) {
  const b = g.bombApply;
  g.bombApply = null;
  const n = g.order.length;
  const start = g.order.indexOf(b.by);
  for (let k = 0; k < n; k++) {
    const u = g.order[(start + k) % n];
    if (isActive(g, u) && g.handCount[u] === 0) finish(g, u);
  }
  advance(g);
}

function applyBombToHand(g, uid, hand) {
  const ranks = g.bombApply.ranks.map(rankFromChar);
  const hit = hand.filter((c) => ranks.includes(parseCard(c).rank));
  const rest = hand.filter((c) => !ranks.includes(parseCard(c).rank));
  g.handCount[uid] = rest.length;
  delete g.bombApply.waiting[uid];
  g.events.push({ t: 'bombHit', uid, cards: hit });
  return rest;
}

function startPlay(g) {
  g.status = 'playing';
  g.turn = g.first;
  g.exchange = null;
  g.events.push({ t: 'start', uid: g.first });
}

// ---------- 配札 ----------
// order: 席順(時計回り)の uid 配列, prevTitles: { uid: 前ゲームの称号 }
export function dealGame({ order, gameNo = 1, prevTitles = {}, seq = 0, actor = null, rng = Math.random }) {
  const n = order.length;
  if (n < 2) err('2人以上必要です');
  const deck = shuffle(makeDeck(), rng);
  const total = n === 2 ? 40 : deck.length;
  const titleOf = (t) => order.find((u) => prevTitles[u] === t) || null;
  const daihinmin = gameNo > 1 ? titleOf('daihinmin') : null;
  let firstIdx = daihinmin ? order.indexOf(daihinmin) : Math.floor(rng() * n);
  const base = Math.floor(total / n), extra = total % n;
  const hands = {};
  let p = 0;
  for (let k = 0; k < n; k++) {
    const u = order[(firstIdx + k) % n];
    const cnt = base + (k < extra ? 1 : 0);
    hands[u] = deck.slice(p, p + cnt);
    p += cnt;
  }
  if (!daihinmin) {
    if (n >= 3) {
      // ダイヤの3を最初の人に(配る枚数の偏りを最初の人に合わせるため入れ替える)
      const first = order[firstIdx];
      if (!hands[first].includes('D3')) {
        const holder = order.find((u) => hands[u].includes('D3'));
        const j = Math.floor(rng() * hands[first].length);
        const swap = hands[first][j];
        hands[first][j] = 'D3';
        hands[holder][hands[holder].indexOf('D3')] = swap;
      }
    } else {
      // 2人:ダイヤの3がなければ一番弱いカードを持つ人
      let best = null;
      for (const u of order) for (const c of hands[u]) if (!best || strengthKey(c) < strengthKey(best.c)) best = { u, c };
      firstIdx = order.indexOf(best.u);
    }
  }
  const first = order[firstIdx];
  const handCount = {};
  for (const u of order) handCount[u] = hands[u].length;

  // カード交換:貧しい側の最強カードを自動で選んで富む側の受け箱へ
  const inbox = {};
  const exchange = {};
  if (gameNo > 1) {
    const pairs = [];
    const df = titleOf('daifugo'), dh = titleOf('daihinmin');
    if (df && dh) pairs.push([dh, df, 2]);
    const f = titleOf('fugo'), h = titleOf('hinmin');
    if (f && h) pairs.push([h, f, 1]);
    for (const [poor, rich, k] of pairs) {
      const give = strongest(hands[poor], k);
      hands[poor] = removeCards(hands[poor], give);
      handCount[poor] -= give.length;
      handCount[rich] += give.length;
      (inbox[rich] ||= []).push({ kind: 'cards', cards: give, from: poor, reason: 'exchange', gameNo });
      (inbox[poor] ||= []).push({ kind: 'notice', cards: give, to: rich, reason: 'exchangeGive', gameNo });
      exchange[rich] = { to: poor, count: give.length, done: false };
    }
  }
  const hasExchange = Object.keys(exchange).length > 0;
  const prevDaifugo = gameNo > 1 ? titleOf('daifugo') : null;
  const game = {
    seq: seq + 1, actor, status: hasExchange ? 'exchange' : 'playing', gameNo, order: [...order],
    first, turn: hasExchange ? null : first, field: [], lastBy: null, passed: {}, passesUsed: {}, handCount,
    effects: { revolution: false, elevenBack: false, suitLock: null, numberLock: false },
    pending: null, bombApply: null, resolve: null, finished: [], ochi: null,
    prevTitles: { ...prevTitles }, prevDaifugo, exchange: hasExchange ? exchange : null,
    events: [{ t: 'deal' }, ...(hasExchange ? [] : [{ t: 'start', uid: first }])], result: null,
  };
  return { game, hands, inbox };
}

// ---------- 行動 ----------
// action:
//  {type:'play', cards, interp?}  {type:'pass'}  {type:'seven', cards}  {type:'ten', cards}
//  {type:'bomb', ranks}  {type:'bombApply'}  {type:'exchangeReturn', cards}
//  ホスト用: {type:'forcePass'} {type:'skipPending'} {type:'skipBombWait'} {type:'skipExchange'}
// 戻り値: { game, hand (自分の新しい手札 or null), inbox: [{to, item}] }
export function applyAction(game0, uid, action, hand0, { isHost = false } = {}) {
  const g = structuredClone(game0);
  g.seq = (game0.seq || 0) + 1;
  g.actor = uid;
  g.events = [];
  let hand = hand0 ? [...hand0] : [];
  let handChanged = false;
  const inbox = [];
  const needMine = () => {
    if (g.handCount[uid] !== hand.length) err('手札を同期中です。少し待ってください');
  };

  switch (action.type) {
    case 'play': {
      if (g.status !== 'playing') err('ゲーム中ではありません');
      if (g.turn !== uid) err('あなたの番ではありません');
      if (g.pending || g.bombApply) err('効果の処理中です');
      needMine();
      const cards = action.cards || [];
      const t = top(g);
      const options = interpretations(cards).filter((c) => canPlay(c, t, g.effects));
      const combo = action.interp ? options.find((o) => o.key === action.interp) : options[0];
      if (!combo) err('その組み合わせは出せません');
      hand = removeCards(hand, cards);
      handChanged = true;
      g.handCount[uid] = hand.length;
      const dirBefore = direction(g.effects);
      const entry = { by: uid, cards: [...cards], type: combo.type, size: combo.size, low: combo.low, jr: combo.jr ?? null };
      const ev = { t: 'play', uid, cards: [...cards], type: combo.type, size: combo.size, low: combo.low, jr: combo.jr ?? null, fx: [] };
      const spe3 = !!t && isJokerSingle(t) && combo.type === 'single' && combo.low === 3;
      g.field.push(entry);
      g.lastBy = uid;
      delete g.passed[uid];
      const fx = effectsOf(combo);
      if (spe3) ev.fx.push('spe3');
      if (fx.revolution) {
        g.effects.revolution = !g.effects.revolution;
        ev.fx.push(g.effects.revolution ? 'revolution' : 'revolutionBack');
      }
      if (fx.jack) {
        g.effects.elevenBack = !g.effects.elevenBack;
        ev.fx.push('elevenBack');
      }
      if (t && !spe3) {
        if (!g.effects.suitLock) {
          const lock = suitLockFormed(t, combo);
          if (lock) { g.effects.suitLock = lock; ev.fx.push('suitLock'); }
        }
        if (!g.effects.numberLock && isNumberStep(t, combo, dirBefore)) {
          g.effects.numberLock = true;
          ev.fx.push('numberLock');
        }
      }
      if (fx.sevens) ev.fx.push('seven');
      if (fx.tens) ev.fx.push('ten');
      if (fx.queens) ev.fx.push('bomb');
      if (fx.eight) ev.fx.push('eight');
      else if (fx.fives) ev.fx.push('skip');
      g.events.push(ev);
      if (hand.length === 0) finish(g, uid);
      const steps = [];
      if (fx.sevens) steps.push({ type: 'seven', count: fx.sevens });
      if (fx.tens) steps.push({ type: 'ten', count: fx.tens });
      if (fx.queens) steps.push({ type: 'bomb', count: fx.queens });
      g.resolve = { by: uid, steps, eight: fx.eight || spe3, skip: fx.eight || spe3 ? 0 : fx.fives };
      advance(g);
      break;
    }
    case 'pass':
    case 'forcePass': {
      if (g.status !== 'playing') err('ゲーム中ではありません');
      if (g.pending || g.bombApply) err('効果の処理中です');
      const who = action.type === 'pass' ? uid : g.turn;
      if (action.type === 'pass' && g.turn !== uid) err('あなたの番ではありません');
      if (action.type === 'forcePass' && !isHost) err('ホストだけが操作できます');
      if (g.field.length === 0) {
        if (action.type === 'pass') err('親はパスできません');
        // 親が不在:次の人に親を移す
        g.events.push({ t: 'pass', uid: who, forced: true });
        g.turn = nextActiveFrom(g, who) || who;
        break;
      }
      let counted = false;
      if (action.type === 'pass') {
        needMine();
        counted = hasLegalPlay(hand, top(g), g.effects);
        if (counted && (g.passesUsed[uid] || 0) >= MAX_PASS) err('パスの回数を使い切りました。出せるカードを出してください');
        if (counted) g.passesUsed[uid] = (g.passesUsed[uid] || 0) + 1;
      }
      g.passed[who] = true;
      g.events.push({ t: 'pass', uid: who, counted, forced: action.type === 'forcePass' });
      const w = walk(g, who, 1);
      if (w.flow) flow(g, leaderAfter(g, g.lastBy), 'round');
      else g.turn = w.landed;
      break;
    }
    case 'seven':
    case 'ten': {
      const p = g.pending;
      if (!p || p.type !== action.type || p.uid !== uid) err('いまは選べません');
      needMine();
      const cards = action.cards || [];
      if (cards.length !== p.count) err(`${p.count}枚選んでください`);
      hand = removeCards(hand, cards);
      handChanged = true;
      g.handCount[uid] = hand.length;
      if (p.type === 'seven') {
        g.handCount[p.to] = (g.handCount[p.to] || 0) + cards.length;
        inbox.push({ to: p.to, item: { kind: 'cards', cards: [...cards], from: uid, reason: 'seven', gameNo: g.gameNo } });
        g.events.push({ t: 'give', uid, to: p.to, count: cards.length });
      } else {
        g.events.push({ t: 'discard', uid, cards: [...cards] });
      }
      g.pending = null;
      if (hand.length === 0) finish(g, uid);
      advance(g);
      break;
    }
    case 'bomb': {
      const p = g.pending;
      if (!p || p.type !== 'bomb' || p.uid !== uid) err('いまは選べません');
      const ranks = action.ranks || [];
      const valid = [...RANK_CHARS, 'JK'];
      if (ranks.length !== p.count || new Set(ranks).size !== ranks.length || !ranks.every((r) => valid.includes(r)))
        err(`数字を${p.count}つ選んでください`);
      g.pending = null;
      const waiting = {};
      for (const u of g.order) if (isActive(g, u) && g.handCount[u] > 0) waiting[u] = true;
      g.bombApply = { by: uid, ranks: [...ranks], waiting };
      g.events.push({ t: 'bomb', uid, ranks: [...ranks] });
      if (waiting[uid]) {
        needMine();
        hand = applyBombToHand(g, uid, hand);
        handChanged = true;
      }
      if (Object.keys(g.bombApply.waiting).length === 0) completeBomb(g);
      break;
    }
    case 'bombApply': {
      if (!g.bombApply || !g.bombApply.waiting[uid]) err('適用するボンバーはありません');
      needMine();
      hand = applyBombToHand(g, uid, hand);
      handChanged = true;
      if (Object.keys(g.bombApply.waiting).length === 0) completeBomb(g);
      break;
    }
    case 'skipPending': {
      if (!isHost) err('ホストだけが操作できます');
      if (!g.pending) err('選択待ちはありません');
      g.events.push({ t: 'skipPending', uid: g.pending.uid, type: g.pending.type });
      g.pending = null;
      advance(g);
      break;
    }
    case 'skipBombWait': {
      if (!isHost) err('ホストだけが操作できます');
      if (!g.bombApply) err('反映待ちはありません');
      g.events.push({ t: 'skipBombWait', uids: Object.keys(g.bombApply.waiting) });
      g.bombApply.waiting = {};
      completeBomb(g);
      break;
    }
    case 'exchangeReturn': {
      if (g.status !== 'exchange') err('カード交換中ではありません');
      const item = g.exchange?.[uid];
      if (!item || item.done) err('返すカードはありません');
      needMine();
      const cards = action.cards || [];
      if (cards.length !== item.count) err(`${item.count}枚選んでください`);
      hand = removeCards(hand, cards);
      handChanged = true;
      g.handCount[uid] = hand.length;
      g.handCount[item.to] = (g.handCount[item.to] || 0) + cards.length;
      inbox.push({ to: item.to, item: { kind: 'cards', cards: [...cards], from: uid, reason: 'exchange', gameNo: g.gameNo } });
      item.done = true;
      g.events.push({ t: 'exchangeReturn', uid, to: item.to, count: cards.length });
      if (Object.values(g.exchange).every((x) => x.done)) startPlay(g);
      break;
    }
    case 'skipExchange': {
      if (!isHost) err('ホストだけが操作できます');
      if (g.status !== 'exchange') err('カード交換中ではありません');
      g.events.push({ t: 'skipExchange' });
      startPlay(g);
      break;
    }
    default:
      err('不明な操作です');
  }
  return { game: g, hand: handChanged ? hand : null, inbox };
}

// ---------- UI向けの補助 ----------
export function fieldTop(g) {
  return g ? top(g) : null;
}

export function canPassNow(g, uid, hand) {
  if (!g || g.status !== 'playing' || g.turn !== uid || g.pending || g.bombApply) return { ok: false };
  if (g.field.length === 0) return { ok: false, reason: '親はパスできません' };
  const counted = hasLegalPlay(hand, top(g), g.effects);
  const left = MAX_PASS - (g.passesUsed[uid] || 0);
  if (counted && left <= 0) return { ok: false, reason: 'パスの回数を使い切りました', left, counted };
  return { ok: true, left, counted };
}

export { rankChar };
