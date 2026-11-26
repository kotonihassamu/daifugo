// CPU の決め打ちの判断(ルールベース)。
// 単独でも打てるが、主な役目は (1) 先読み(search.js)の中で全員を動かすこと (2) 何かあったときの安全網。
// すべて「自分の手札」と公開された状態だけで判断する。
import { parseCard, strengthKey, JOKER_RANK, RANK_CHARS, sortCards } from '../cards.js';
import { interpretations, canPlay, legalPlays, forbiddenFinish, direction, isAllJoker } from '../rules.js';
import { canPassNow, fieldTop } from '../engine.js';

const isJk = (c) => c.startsWith('JK');

// 判断の重み(tools/cpu-arena.mjs で調整)
export const W = { joker: 5, two: 2, eight: -2, multi: 5, breakSet: 1.5, passAt: 22, hurry: 10 };

// いまの強さの向きでの「強さ」(大きいほど強い。ジョーカーだけの手は常に最強)
function power(combo, effects) {
  if (isAllJoker(combo)) return 20;
  return direction(effects) > 0 ? combo.low : 18 - combo.low;
}

function rankCounts(hand) {
  const m = {};
  for (const c of hand) if (!isJk(c)) m[parseCard(c).rank] = (m[parseCard(c).rank] || 0) + 1;
  return m;
}

// 親のときに出せる手を列挙(数字ごと・長さごとに代表1つ)
export function leadPlays(hand, effects) {
  const out = [];
  const jokers = hand.filter(isJk);
  const byRank = {};
  for (const c of hand) if (!isJk(c)) (byRank[parseCard(c).rank] ||= []).push(c);
  for (const c of hand) out.push([c]);
  for (const r of Object.keys(byRank)) {
    const L = byRank[r];
    for (let k = 2; k <= Math.min(4, L.length + jokers.length); k++) {
      const real = L.slice(0, Math.min(L.length, k));
      const need = k - real.length;
      if (need > jokers.length || real.length === 0) continue;
      out.push([...real, ...jokers.slice(0, need)]);
    }
  }
  if (jokers.length >= 2) out.push(jokers.slice(0, 2));
  // 階段:同じマークでなくてよいので、数字ごとに1枚を使う
  for (let len = 3; len <= 13; len++) {
    for (let low = 3; low + len - 1 <= 15; low++) {
      const cards = [];
      let jk = 0;
      for (let r = low; r < low + len; r++) {
        if (byRank[r]) cards.push(byRank[r][0]);
        else if (jk < jokers.length) cards.push(jokers[jk++]);
        else { cards.length = 0; break; }
      }
      if (cards.length === len && cards.some((c) => !isJk(c))) out.push(cards);
    }
  }
  return out;
}

// いまの状態で出せる手を {cards, combo} の一覧で返す(禁止上がりは除く)
export function candidatePlays(game, hand) {
  const top = fieldTop(game);
  const raw = top ? legalPlays(hand, top, game.effects, 300).plays : leadPlays(hand, game.effects);
  const seen = new Set();
  const out = [];
  for (const cards of raw) {
    const key = [...cards].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const finishing = cards.length === hand.length;
    for (const combo of interpretations(cards)) {
      if (!canPlay(combo, top, game.effects)) continue;
      if (finishing && forbiddenFinish(combo, top, game.effects)) continue;
      out.push({ cards, combo });
      break;
    }
  }
  return out;
}

// 最後の1手に使えないカード(禁止上がり)か
function isBanned(c, effects) {
  if (isJk(c)) return true;
  const r = parseCard(c).rank;
  return r === 8 || r === (effects?.revolution ? 3 : 15);
}

// 手の「出しにくさ」。小さいほど今出したい
function playCost(p, hand, game) {
  const { cards, combo } = p;
  const fx = game.effects;
  let cost = power(combo, fx);
  const counts = rankCounts(hand);
  const banned = hand.filter((c) => isBanned(c, fx)).length;
  // 禁止カードが残り手札の多くを占めてきたら、詰まないうちに先に出す
  const hurry = hand.length - banned <= 2;
  for (const c of cards) {
    if (hurry && isBanned(c, fx)) cost -= W.hurry;
    else if (isJk(c)) cost += W.joker;
    else {
      const r = parseCard(c).rank;
      if (r === 15) cost += W.two;
      if (r === 8) cost += W.eight;
    }
  }
  // 一度にたくさん出せる手はうれしい
  cost -= (cards.length - 1) * W.multi;
  // ペアや3枚を崩す出し方は避ける
  const used = rankCounts(cards);
  for (const r of Object.keys(used)) if (counts[r] > used[r]) cost += W.breakSet;
  // 出し切れるなら最優先
  if (cards.length === hand.length) cost -= 100;
  return cost;
}

// 手番での判断。戻り値は engine の action
export function heuristicTurn(game, uid, hand, rng = Math.random, epsilon = 0) {
  const cands = candidatePlays(game, hand);
  const cp = canPassNow(game, uid, hand);
  if (!cands.length) return { type: 'pass' };
  if (epsilon && rng() < epsilon) {
    if (cp.ok && rng() < 0.3) return { type: 'pass' };
    const p = cands[Math.floor(rng() * cands.length)];
    return { type: 'play', cards: p.cards, interp: p.combo.key };
  }
  let best = null, bestCost = Infinity;
  for (const p of cands) {
    const c = playCost(p, hand, game);
    if (c < bestCost) { bestCost = c; best = p; }
  }
  // 場があるとき、強いカードしか出せず手札がまだ多いならパスして温存
  const top = fieldTop(game);
  const banned = hand.filter((c) => isBanned(c, game.effects)).length;
  if (top && cp.ok && hand.length - banned > 3 && bestCost >= W.passAt) return { type: 'pass' };
  return { type: 'play', cards: best.cards, interp: best.combo.key };
}

// 手放してよいカード(弱い順。ジョーカー・2・8・組になっているカードは後回し)
export function weakestCards(hand, n, game) {
  const counts = rankCounts(hand);
  const rev = game ? direction(game.effects) < 0 : false;
  const score = (c) => {
    if (isJk(c)) return 1000;
    const r = parseCard(c).rank;
    let s = rev ? 18 - r : r;
    if (r === 15 || r === 8) s += 20;
    if (counts[r] >= 2) s += 6;
    return s * 4 + (strengthKey(c) % 4);
  };
  return [...hand].sort((a, b) => score(a) - score(b)).slice(0, n);
}

// 12ボンバーで指定する数字:自分が持っていない強い数字から
export function bombRanks(hand, count, game) {
  const mine = new Set(hand.map((c) => (isJk(c) ? 'JK' : c[1])));
  const order = ['JK', '2', 'A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3'];
  const jokersInGame = game?.rules?.jokers ?? 2;
  const pick = order.filter((r) => !mine.has(r) && !(r === 'JK' && jokersInGame === 0));
  for (const r of order) if (pick.length < count && !pick.includes(r)) pick.push(r);
  return pick.slice(0, count);
}

// いま uid がすべき行動(なければ null)。手番・効果の選択・交換・ボンバーの反映をまとめて扱う
export function pendingDecision(game, uid) {
  if (!game) return null;
  if (game.status === 'exchange') {
    const it = game.exchange?.[uid];
    return it && !it.done ? { kind: 'exchange', count: it.count } : null;
  }
  if (game.status !== 'playing') return null;
  if (game.bombApply) return game.bombApply.waiting?.[uid] ? { kind: 'bombApply' } : null;
  const p = game.pending;
  if (p) return p.uid === uid ? { kind: p.type, count: p.count } : null;
  return game.turn === uid ? { kind: 'turn' } : null;
}

// 手番以外の選択(7渡し・10捨て・ボンバー・交換)をルールで決める
export function heuristicChoice(game, uid, hand, decision) {
  switch (decision.kind) {
    case 'seven': return { type: 'seven', cards: weakestCards(hand, decision.count, game) };
    case 'ten': return { type: 'ten', cards: weakestCards(hand, decision.count, game) };
    case 'exchange': return { type: 'exchangeReturn', cards: weakestCards(hand, decision.count, null) };
    case 'bomb': return { type: 'bomb', ranks: bombRanks(hand, decision.count, game) };
    case 'bombApply': return { type: 'bombApply' };
    default: return null;
  }
}

export { sortCards, JOKER_RANK, RANK_CHARS };
