// CPU同士をゲームを使わずに対戦させて強さを比べる(PC上で実行)
// 使い方: node tools/cpu-arena.mjs [ゲーム数] [人数] [先読み時間ms]
import { dealGame, normalizeGame, applyAction } from '../js/engine.js';
import { heuristicTurn, heuristicChoice, pendingDecision, candidatePlays } from '../js/cpu/policy.js';
import { searchTurn } from '../js/cpu/search.js';

const GAMES = Number(process.argv[2] || 40);
const N = Number(process.argv[3] || 4);
const MS = Number(process.argv[4] || 200);

const brains = {
  random: (g, u, h) => {
    const c = candidatePlays(g, h);
    if (!c.length) return { type: 'pass' };
    const p = c[Math.floor(Math.random() * c.length)];
    return { type: 'play', cards: p.cards, interp: p.combo.key };
  },
  rule: (g, u, h) => heuristicTurn(g, u, h),
  search: (g, u, h) => searchTurn(g, u, h, { timeMs: MS }).action,
};

function play(seatBrains, prevTitles = {}, gameNo = 1) {
  const order = seatBrains.map((_, i) => 'p' + i);
  const d = dealGame({ order, gameNo, prevTitles });
  let g = normalizeGame(d.game);
  const hands = d.hands;
  for (const u of order) for (const it of d.inbox[u] || []) if (it.kind === 'cards') hands[u].push(...it.cards);
  let steps = 0, slowest = 0;
  while (g.status !== 'result' && steps++ < 2000) {
    let actor, action;
    for (const u of order) {
      const dd = pendingDecision(g, u);
      if (!dd) continue;
      actor = u;
      const t0 = Date.now();
      action = dd.kind === 'turn' ? brains[seatBrains[order.indexOf(u)]](g, u, hands[u]) : heuristicChoice(g, u, hands[u], dd);
      slowest = Math.max(slowest, Date.now() - t0);
      break;
    }
    const out = applyAction(g, actor, action, hands[actor]);
    g = out.game;
    if (out.hand) hands[actor] = out.hand;
    for (const { to, item } of out.inbox) if (item.kind === 'cards') hands[to] = [...hands[to], ...item.cards];
  }
  if (g.status !== 'result') throw new Error('終わらない');
  return { ranking: g.result.ranking.map((u) => order.indexOf(u)), titles: g.result.titles, slowest };
}

function match(label, seats) {
  const sum = seats.map(() => 0);
  let titles = {}, slow = 0;
  for (let i = 0; i < GAMES; i++) {
    // 席をずらして公平に
    const rot = i % seats.length;
    const rs = seats.map((_, k) => seats[(k + rot) % seats.length]);
    const r = play(rs, i % 2 ? titles : {}, i % 2 ? 2 : 1);
    titles = Object.fromEntries(Object.entries(r.titles));
    slow = Math.max(slow, r.slowest);
    r.ranking.forEach((seat, place) => { sum[(seat - rot + seats.length) % seats.length] += place + 1; });
  }
  console.log(label, seats.map((b, i) => `${b}:平均${(sum[i] / GAMES).toFixed(2)}位`).join('  '), `(最長の考慮 ${slow}ms)`);
}

const t0 = Date.now();
match('ルール vs ランダム   ', ['rule', 'random', 'random', 'random'].slice(0, N));
match('先読み vs ルール     ', ['search', 'rule', 'rule', 'rule'].slice(0, N));
console.log('所要', Math.round((Date.now() - t0) / 1000), '秒');
