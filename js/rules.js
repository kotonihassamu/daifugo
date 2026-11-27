// ルール判定(通信とは独立した純粋関数)
// 手(combo)の表現:
//   { type: 'single'|'group'|'seq', size, low, jr, eff: [{code, rank, suit, joker}], key }
//   low  … 単体・グループはその数字、階段は一番小さい数字。ジョーカーだけの手(単体・2枚)は 16
//   jr   … ジョーカーを代わりに使った数字の配列(ジョーカーを使っていなければ空)
// 場の手(field entry): { by, cards, type, size, low, jr }
import { parseCard, JOKER_RANK, rankLabel, SUIT_SYMBOL } from './cards.js';

export function direction(effects) {
  // 革命と11バックは打ち消し合う
  return !!effects?.revolution !== !!effects?.elevenBack ? -1 : 1;
}

function mk(type, eff, low, jr = []) {
  const size = eff.length;
  return { type, size, low, jr, eff, key: `${type}:${size}:${low}:${jr.join('.') || '-'}` };
}

// 選んだカードを「出せる形」として解釈する。ジョーカー入りで複数の解釈があり得る
export function interpretations(codes) {
  if (!codes || codes.length === 0) return [];
  if (new Set(codes).size !== codes.length) return [];
  const cs = codes.map(parseCard);
  const jokers = cs.filter((c) => c.joker);
  const normals = cs.filter((c) => !c.joker);
  const n = cs.length;
  const out = [];

  if (n === 1) {
    const c = cs[0];
    out.push(mk('single', [{ ...c }], c.joker ? JOKER_RANK : c.rank));
    return out;
  }
  // ジョーカー2枚だけのペア:最強のペア
  if (normals.length === 0) {
    if (n === 2) out.push(mk('group', cs.map((c) => ({ ...c })), JOKER_RANK));
    return out;
  }
  // 同じ数字 2〜4 枚(ジョーカーはその数字の代わり)
  if (n <= 4 && normals.every((c) => c.rank === normals[0].rank)) {
    const r = normals[0].rank;
    const eff = cs.map((c) => (c.joker ? { ...c, rank: r } : { ...c }));
    out.push(mk('group', eff, r, jokers.map(() => r)));
  }
  // 階段:同じマークの連続した数字 3 枚以上(3〜2、一周なし)。ジョーカーはそのマークの代わり
  if (n >= 3 && new Set(normals.map((c) => c.suit)).size === 1) {
    const ranks = normals.map((c) => c.rank);
    if (new Set(ranks).size === ranks.length) {
      const minN = Math.min(...ranks), maxN = Math.max(...ranks);
      const lowFrom = Math.max(3, maxN - n + 1);
      const lowTo = Math.min(minN, 16 - n);
      for (let low = lowFrom; low <= lowTo; low++) {
        const missing = [];
        for (let r = low; r < low + n; r++) if (!ranks.includes(r)) missing.push(r);
        if (missing.length !== jokers.length) continue;
        const eff = [];
        let mi = 0;
        for (const c of cs) eff.push(c.joker ? { ...c, rank: missing[mi++] } : { ...c });
        eff.sort((a, b) => a.rank - b.rank);
        out.push(mk('seq', eff, low, missing));
      }
    }
  }
  return out;
}

// ジョーカーだけでできた手(単体ジョーカー・ジョーカー2枚のペア)
export function isAllJoker(x) {
  return !!x && x.low === JOKER_RANK;
}
export function isJokerSingle(x) {
  return !!x && x.type === 'single' && x.low === JOKER_RANK;
}

function concreteSuits(entryOrCombo) {
  if (entryOrCombo.eff) return entryOrCombo.eff.filter((e) => !e.joker).map((e) => e.suit);
  return entryOrCombo.cards.map(parseCard).filter((c) => !c.joker).map((c) => c.suit);
}

function isSubMultiset(a, b) {
  const m = {};
  for (const s of b) m[s] = (m[s] || 0) + 1;
  for (const s of a) {
    if (!m[s]) return false;
    m[s]--;
  }
  return true;
}

export function suitsMatchLock(combo, lock) {
  if (!lock) return true;
  if (combo.size !== lock.length) return false;
  return isSubMultiset(concreteSuits(combo), lock); // ジョーカーはどのマークにもなれる
}

// マーク縛りの成立判定。成立すれば縛るマーク(並べたもの)を返す
export function suitLockFormed(prev, cur) {
  if (isAllJoker(prev) || isAllJoker(cur)) return null;
  if (prev.size !== cur.size) return null;
  const ps = concreteSuits(prev), cs = concreteSuits(cur);
  const pj = prev.size - ps.length, cj = cur.size - cs.length;
  let lock = null;
  if (pj === 0 && cj === 0) {
    if (isSubMultiset(ps, cs) && isSubMultiset(cs, ps)) lock = ps;
  } else if (pj > 0 && cj === 0) {
    if (isSubMultiset(ps, cs)) lock = cs;
  } else if (cj > 0 && pj === 0) {
    if (isSubMultiset(cs, ps)) lock = ps;
  }
  // 両方にジョーカーが入っているときはマークが決まらないので縛らない
  return lock ? [...lock].sort() : null;
}

// 数字縛り:直前の手の「1つ強い」数字か
export function isNumberStep(prev, cur, dir) {
  if (isAllJoker(prev) || isAllJoker(cur)) return false;
  return cur.low === prev.low + dir;
}

// 数字縛り中で「次の数字」が存在しないか(このときはジョーカーだけの手しか出せない)
export function noNextNumber(top, effects) {
  if (!effects?.numberLock || !top || isAllJoker(top)) return false;
  const next = top.low + direction(effects);
  if (top.type === 'seq') return next < 3 || next + top.size - 1 > 15;
  return next < 3 || next > 15;
}

export function requiredNumber(top, effects) {
  if (!effects?.numberLock || !top || isAllJoker(top)) return null;
  if (noNextNumber(top, effects)) return null;
  return top.low + direction(effects);
}

// 場(top)に対してこの手が出せるか(禁止上がりは別に判定する)
export function canPlay(combo, top, effects) {
  if (!top) return true;
  if (combo.type !== top.type || combo.size !== top.size) return false;
  if (isAllJoker(top)) {
    if (top.type !== 'single') return false; // ジョーカー2枚のペアには何も出せない
    // スペ3返し(縛り中でも可)。ジョーカーにジョーカーは出せない
    const e = combo.eff[0];
    return !e.joker && e.suit === 'S' && e.rank === 3;
  }
  if (isAllJoker(combo)) return true; // ジョーカーだけの手は常に最強(縛りにも関係しない)
  const dir = direction(effects);
  if (dir > 0 ? combo.low <= top.low : combo.low >= top.low) return false;
  if (effects?.numberLock && combo.low !== top.low + dir) return false;
  if (effects?.suitLock && !suitsMatchLock(combo, effects.suitLock)) return false;
  return true;
}

// 禁止上がり:最後の1手に使えないカードが入っていれば理由を返す(なければ null)
//   2(革命中は3)・ジョーカー・8(8切り)・スペ3返し。判定は出す前の状態で行う。11バックでは変わらない
export function forbiddenFinish(combo, top, effects) {
  if (combo.eff.some((e) => e.joker)) return 'ジョーカー';
  const strongest = effects?.revolution ? 3 : 15;
  if (combo.eff.some((e) => e.rank === strongest)) return effects?.revolution ? '3(革命中)' : '2';
  if (combo.eff.some((e) => e.rank === 8)) return '8';
  if (isJokerSingle(top) && combo.type === 'single' && combo.low === 3) return 'スペ3返し';
  return null;
}

// 手に含まれる効果
export function effectsOf(combo) {
  const fx = { revolution: false, jack: false, sevens: 0, tens: 0, queens: 0, fives: 0, eight: false };
  if (isAllJoker(combo)) return fx;
  for (const e of combo.eff) {
    if (e.rank === 7) fx.sevens++;
    if (e.rank === 10) fx.tens++;
    if (e.rank === 12) fx.queens++;
    if (e.rank === 5) fx.fives++;
    if (e.rank === 8) fx.eight = true;
    if (e.rank === 11 && combo.type !== 'seq') fx.jack = true;
  }
  // 革命:同じ数字4枚、または4枚以上の階段(階段は同じマークのみなので、4枚以上なら必ず革命)
  fx.revolution = (combo.type === 'group' && combo.size === 4) || (combo.type === 'seq' && combo.size >= 4);
  return fx;
}

export function describeCombo(combo) {
  const jks = combo.eff.filter((e) => e.joker);
  if (isAllJoker(combo)) return combo.size === 1 ? 'ジョーカー' : 'ジョーカー2枚(最強のペア)';
  if (combo.type === 'single') return '1枚';
  if (combo.type === 'group') return `${rankLabel(combo.low)}の${combo.size}枚` + (jks.length ? '(ジョーカー入り)' : '');
  const seq = combo.eff.map((e) => rankLabel(e.rank)).join('-');
  return jks.length ? `${seq}(ジョーカーを${jks.map((e) => rankLabel(e.rank)).join('・')}として)` : seq;
}

function combinations(list, k) {
  const res = [];
  const rec = (start, acc) => {
    if (acc.length === k) return res.push([...acc]);
    for (let i = start; i < list.length; i++) {
      acc.push(list[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  if (k >= 0 && k <= list.length) rec(0, []);
  return res;
}

// 手札から場に出せる手を列挙する(ヒント表示と「出せる手があるか」の判定に使う)
// 手札を出し切る手は、禁止上がりになるなら除く
// 戻り値: { any, cards:Set<code>, plays: [codes[]] }
export function legalPlays(hand, top, effects, limit = 400) {
  const result = { any: false, cards: new Set(), plays: [] };
  if (!hand || hand.length === 0) return result;
  const finishes = (codes) => codes.length === hand.length;
  const add = (codes, combo) => {
    if (!canPlay(combo, top, effects)) return;
    if (finishes(codes) && forbiddenFinish(combo, top, effects)) return;
    result.any = true;
    for (const c of codes) result.cards.add(c);
    if (result.plays.length < limit) result.plays.push(codes);
  };
  if (!top) {
    // 親は単体ならどれでも出せる(最後の1枚だけは禁止上がりに注意)
    for (const c of hand) for (const cb of interpretations([c])) add([c], cb);
    return result;
  }
  const jokers = hand.filter((c) => parseCard(c).joker);
  const byRank = {};
  for (const code of hand) {
    const c = parseCard(code);
    if (c.joker) continue;
    (byRank[c.rank] ||= []).push(code);
  }
  const size = top.size;
  if (top.type === 'single') {
    for (const code of hand) for (const cb of interpretations([code])) add([code], cb);
    return result;
  }
  if (top.type === 'group') {
    for (const r of Object.keys(byRank)) {
      const L = byRank[r];
      for (let j = 0; j <= Math.min(jokers.length, size - 1); j++) {
        for (const cmb of combinations(L, size - j)) {
          const codes = [...cmb, ...jokers.slice(0, j)];
          for (const cb of interpretations(codes)) if (cb.type === 'group') add(codes, cb);
        }
      }
    }
    if (size === 2 && jokers.length >= 2) {
      const codes = jokers.slice(0, 2);
      for (const cb of interpretations(codes)) add(codes, cb);
    }
    return result;
  }
  // 階段:同じマークの連続した数字(ジョーカーは足りない数字の代わり)
  const bySuitRank = {};
  for (const code of hand) {
    const c = parseCard(code);
    if (!c.joker) (bySuitRank[c.suit] ||= {})[c.rank] = code;
  }
  for (const suit of Object.keys(bySuitRank)) {
    // マーク縛り中は縛りのマークだけ(階段の縛りは同じマークのみなので1種類)
    if (effects?.suitLock && !effects.suitLock.every((s) => s === suit)) continue;
    const have = bySuitRank[suit];
    for (let low = 3; low + size - 1 <= 15; low++) {
      const window = [];
      for (let r = low; r < low + size; r++) window.push(r);
      const missing = window.filter((r) => !have[r]);
      if (missing.length > jokers.length) continue;
      // ジョーカーを置く数字の組(足りない数字は必ず埋める。余ったジョーカーは既にある数字の代わりにもできる)
      const extra = window.filter((r) => have[r]);
      const placements = [missing];
      const spare = jokers.length - missing.length;
      if (spare >= 1) for (const r of extra) placements.push([...missing, r]);
      if (spare >= 2) for (const pr of combinations(extra, 2)) placements.push([...missing, ...pr]);
      for (const P of placements) {
        if (P.length >= size) continue;
        let ji = 0;
        const codes = window.map((r) => (P.includes(r) ? jokers[ji++] : have[r]));
        for (const cb of interpretations(codes)) if (cb.type === 'seq' && cb.low === low) add(codes, cb);
      }
    }
  }
  return result;
}

export function hasLegalPlay(hand, top, effects) {
  return legalPlays(hand, top, effects, 1).any;
}

export function lockLabel(lock) {
  return lock.map((s) => SUIT_SYMBOL[s]).join('');
}
