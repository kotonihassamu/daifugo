// CPU の先読み(モンテカルロ法)。
// 見えていない相手の手札を「公開情報と矛盾しない形」でランダムに配り、候補の手ごとに最後まで試し打ちして平均順位で選ぶ。
// 試し打ちの中では全員が policy.js の判断で打つ。使うのは自分の手札と公開された情報だけ。
import { makeDeck, shuffle } from '../cards.js';
import { applyAction, activePlayers, canPassNow } from '../engine.js';
import { candidatePlays, heuristicTurn, heuristicChoice, pendingDecision } from './policy.js';

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// 見えていないカード(山の残り)= 全カード − 自分の手札 − 公開済み
export function unknownCards(game, myHand) {
  const known = new Set([...myHand, ...(game.seen || [])]);
  return makeDeck(game.rules?.jokers ?? 2).filter((c) => !known.has(c));
}

// 相手の手札をランダムに配った「仮の世界」を作る
function sampleWorld(game, uid, myHand, pool, rng) {
  const hands = { [uid]: [...myHand] };
  const deck = shuffle(pool, rng);
  let p = 0;
  for (const u of game.order) {
    if (u === uid) continue;
    const n = game.handCount[u] || 0;
    if (p + n > deck.length) return null;
    hands[u] = deck.slice(p, p + n);
    p += n;
  }
  return hands;
}

// 仮の世界で最後まで打つ。戻り値は uid の点数(1位=1, 最下位=0)
function rollout(game0, hands, uid, rng, maxSteps = 400) {
  let g = game0;
  for (let step = 0; step < maxSteps; step++) {
    if (g.status === 'result') break;
    // 次に動く人を決める
    let actor = null, action = null;
    for (const u of g.order) {
      const d = pendingDecision(g, u);
      if (!d) continue;
      actor = u;
      action = d.kind === 'turn' ? heuristicTurn(g, u, hands[u], rng, 0.08) : heuristicChoice(g, u, hands[u], d);
      break;
    }
    if (!actor) break;
    let out;
    try {
      out = applyAction(g, actor, action, hands[actor]);
    } catch {
      try {
        out = applyAction(g, actor, { type: 'pass' }, hands[actor]);
      } catch {
        break;
      }
    }
    g = out.game;
    if (out.hand) hands[actor] = out.hand;
    for (const { to, item } of out.inbox) if (item.kind === 'cards') hands[to] = [...(hands[to] || []), ...item.cards];
  }
  return scoreOf(g, uid);
}

function scoreOf(g, uid) {
  const n = g.order.length;
  let ranking = g.result?.ranking;
  if (!ranking) {
    // 時間切れ:上がった順+残り枚数の少ない順で見積もる
    const rest = activePlayers(g).sort((a, b) => g.handCount[a] - g.handCount[b]);
    ranking = [...g.finished, ...rest, ...(g.ochi ? [g.ochi] : [])];
  }
  const place = ranking.indexOf(uid);
  return place < 0 ? 0.5 : (n - 1 - place) / Math.max(1, n - 1);
}

// 手番の手を先読みで選ぶ。timeMs の間だけ試し打ちする
export function searchTurn(game, uid, myHand, { timeMs = 1200, rng = Math.random, maxCandidates = 16 } = {}) {
  const plays = candidatePlays(game, myHand);
  const cp = canPassNow(game, uid, myHand);
  const cands = plays.map((p) => ({ action: { type: 'play', cards: p.cards, interp: p.combo.key }, n: 0, sum: 0 }));
  if (cp.ok) cands.push({ action: { type: 'pass' }, n: 0, sum: 0 });
  if (cands.length === 0) return { action: { type: 'pass' }, stats: [] };
  if (cands.length === 1) return { action: cands[0].action, stats: [] };
  // 候補が多すぎるときは、ルールの判断が良いと見る順に絞る(出し切れる手と決め打ちの手は必ず残す)
  const base = heuristicTurn(game, uid, myHand, rng, 0);
  let list = cands;
  if (cands.length > maxCandidates) {
    const keep = cands.filter((c) => c.action.type === 'pass' || c.action.cards.length === myHand.length || sameAction(c.action, base));
    const rest = cands.filter((c) => !keep.includes(c)).sort((a, b) => b.action.cards.length - a.action.cards.length);
    list = [...keep, ...shuffle(rest, rng).slice(0, maxCandidates - keep.length)];
  }
  const pool = unknownCards(game, myHand);
  const deadline = now() + timeMs;
  let rounds = 0;
  while (now() < deadline && rounds < 400) {
    rounds++;
    const world = sampleWorld(game, uid, myHand, pool, rng);
    if (!world) break; // 情報が食い違うときは先読みしない
    for (const c of list) {
      let g1, hands = Object.fromEntries(Object.entries(world).map(([u, h]) => [u, [...h]]));
      try {
        const out = applyAction(game, uid, c.action, hands[uid]);
        g1 = out.game;
        if (out.hand) hands[uid] = out.hand;
        for (const { to, item } of out.inbox) if (item.kind === 'cards') hands[to] = [...(hands[to] || []), ...item.cards];
      } catch {
        c.n++;
        continue; // この手は出せない(点数0)
      }
      c.sum += rollout(g1, hands, uid, rng);
      c.n++;
    }
    if (now() >= deadline) break;
  }
  if (rounds === 0 || list.every((c) => c.n === 0)) return { action: base, stats: [], rounds: 0 };
  let best = list[0];
  for (const c of list) if (c.n && c.sum / c.n > (best.n ? best.sum / best.n : -1)) best = c;
  return {
    action: best.action,
    rounds,
    stats: list.map((c) => ({ action: c.action, avg: c.n ? c.sum / c.n : 0, n: c.n })),
  };
}

function sameAction(a, b) {
  if (a.type !== b.type) return false;
  if (a.type !== 'play') return true;
  return [...a.cards].sort().join() === [...b.cards].sort().join();
}

// CPU の判断の入口。手番は先読み、それ以外の選択はルールで決める
export function decide(game, uid, myHand, opts = {}) {
  const d = pendingDecision(game, uid);
  if (!d) return null;
  if (d.kind === 'turn') {
    if (opts.level === 'easy') return heuristicTurn(game, uid, myHand, opts.rng || Math.random, 0);
    return searchTurn(game, uid, myHand, opts).action;
  }
  return heuristicChoice(game, uid, myHand, d);
}
