// ルール判定(通信とは独立した純粋関数)
// 手(combo)の表現:
//   { type: 'single'|'group'|'seq', size, low, jr, eff: [{code, rank, suit, joker}], key }
//   low  … 単体・グループはその数字、階段は一番小さい数字。単体ジョーカーは 16
//   jr   … ジョーカーを代わりに使った数字(使っていなければ null)
// 場の手(field entry): { by, cards, type, size, low, jr }
import { parseCard, JOKER_RANK, rankLabel, SUIT_SYMBOL } from './cards.js';

export function direction(effects) {
  // 革命と11バックは打ち消し合う
  return !!effects?.revolution !== !!effects?.elevenBack ? -1 : 1;
}

function mk(type, eff, low, jr) {
  const size = eff.length;
  return { type, size, low, jr, eff, key: `${type}:${size}:${low}:${jr ?? '-'}` };
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
    out.push(mk('single', [{ ...c }], c.joker ? JOKER_RANK : c.rank, null));
    return out;
  }
  // 同じ数字 2〜4 枚
  if (n <= 4 && normals.length >= 1 && normals.every((c) => c.rank === normals[0].rank)) {
    const r = normals[0].rank;
    const eff = cs.map((c) => (c.joker ? { ...c, rank: r } : { ...c }));
    out.push(mk('group', eff, r, jokers.length ? r : null));
  }
  // 階段 3 枚以上(3〜2、一周なし)
  if (n >= 3) {
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
        out.push(mk('seq', eff, low, missing.length ? missing[0] : null));
      }
    }
  }
  return out;
}

export function isJokerSingle(x) {
  return x && x.type === 'single' && x.low === JOKER_RANK;
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
  if (isJokerSingle(prev) || isJokerSingle(cur)) return null;
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
  return lock ? [...lock].sort() : null;
}

// 数字縛り:直前の手の「1つ強い」数字か
export function isNumberStep(prev, cur, dir) {
  if (isJokerSingle(prev) || isJokerSingle(cur)) return false;
  return cur.low === prev.low + dir;
}

// 数字縛り中で「次に出せる数字」が存在しないか
export function noNextNumber(top, effects) {
  if (!effects?.numberLock || !top || isJokerSingle(top)) return false;
  const next = top.low + direction(effects);
  if (top.type === 'seq') return next < 3 || next + top.size - 1 > 15;
  return next < 3 || next > 15;
}

export function requiredNumber(top, effects) {
  if (!effects?.numberLock || !top || isJokerSingle(top)) return null;
  const next = top.low + direction(effects);
  if (noNextNumber(top, effects)) return null;
  return next;
}

// 場(top)に対してこの手が出せるか
export function canPlay(combo, top, effects) {
  if (!top) return true;
  if (combo.type !== top.type || combo.size !== top.size) return false;
  if (isJokerSingle(top)) {
    // スペ3返し(縛り中でも可)
    const e = combo.eff[0];
    return combo.type === 'single' && !e.joker && e.suit === 'S' && e.rank === 3;
  }
  if (isJokerSingle(combo)) return true; // 単体ジョーカーは常に最強
  const dir = direction(effects);
  if (dir > 0 ? combo.low <= top.low : combo.low >= top.low) return false;
  if (effects?.numberLock && combo.low !== top.low + dir) return false;
  if (effects?.suitLock && !suitsMatchLock(combo, effects.suitLock)) return false;
  return true;
}

// 手に含まれる効果
export function effectsOf(combo) {
  const fx = { revolution: false, jack: false, sevens: 0, tens: 0, queens: 0, fives: 0, eight: false };
  if (isJokerSingle(combo)) return fx;
  for (const e of combo.eff) {
    if (e.rank === 7) fx.sevens++;
    if (e.rank === 10) fx.tens++;
    if (e.rank === 12) fx.queens++;
    if (e.rank === 5) fx.fives++;
    if (e.rank === 8) fx.eight = true;
    if (e.rank === 11 && combo.type !== 'seq') fx.jack = true;
  }
  fx.revolution = (combo.type === 'group' && combo.size === 4) || (combo.type === 'seq' && combo.size >= 4);
  return fx;
}

export function comboFromEntry(entry) {
  // 場の手を判定用の形に戻す
  const eff = entry.cards.map((code) => {
    const c = parseCard(code);
    if (c.joker && entry.type !== 'single') return { ...c, rank: entry.jr };
    return c;
  });
  return { type: entry.type, size: entry.size, low: entry.low, jr: entry.jr ?? null, eff };
}

export function describeCombo(combo) {
  const jk = combo.eff.find((e) => e.joker);
  if (combo.type === 'single') return jk ? 'ジョーカー' : '1枚';
  if (combo.type === 'group') return `${rankLabel(combo.low)}の${combo.size}枚` + (jk ? '(ジョーカー入り)' : '');
  const seq = combo.eff.map((e) => rankLabel(e.rank)).join('-');
  return jk ? `${seq}(ジョーカーを${rankLabel(jk.rank)}として)` : seq;
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

// 手札から場に出せる手を列挙する(ヒント表示と「出せるカードがあるか」の判定に使う)
// 戻り値: { any, cards:Set<code>, plays: [codes[]] }
export function legalPlays(hand, top, effects, limit = 400) {
  const result = { any: false, cards: new Set(), plays: [] };
  if (!hand || hand.length === 0) return result;
  const add = (codes, combo) => {
    if (!canPlay(combo, top, effects)) return;
    result.any = true;
    for (const c of codes) result.cards.add(c);
    if (result.plays.length < limit) result.plays.push(codes);
  };
  if (!top) {
    // 親は何でも出せる(単体で十分)
    result.any = true;
    for (const c of hand) result.cards.add(c);
    for (const c of hand) result.plays.push([c]);
    return result;
  }
  const joker = hand.find((c) => parseCard(c).joker);
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
      for (const cmb of combinations(L, size)) for (const cb of interpretations(cmb)) if (cb.type === 'group') add(cmb, cb);
      if (joker && size - 1 >= 1)
        for (const cmb of combinations(L, size - 1)) {
          const codes = [...cmb, joker];
          for (const cb of interpretations(codes)) if (cb.type === 'group') add(codes, cb);
        }
    }
    return result;
  }
  // 階段
  for (let low = 3; low + size - 1 <= 15; low++) {
    const window = [];
    for (let r = low; r < low + size; r++) window.push(r);
    const missing = window.filter((r) => !byRank[r]);
    if (missing.length > 1 || (missing.length === 1 && !joker)) continue;
    // ジョーカーの位置の候補(足りない数字を埋める or 既にある数字の代わり)
    const jokerSlots = missing.length === 1 ? [missing[0]] : joker ? [null, ...window] : [null];
    for (const js of jokerSlots) {
      const probe = { type: 'seq', size, low, jr: js, eff: [] };
      // 強さと数字縛りだけを先に確認(マークは後で)
      if (!canPlay({ ...probe, eff: window.map((r) => ({ rank: r, suit: null, joker: true })) }, top, { ...effects, suitLock: null })) continue;
      const slots = window.map((r) => (r === js ? [joker] : byRank[r]));
      if (!effects?.suitLock) {
        const codes = slots.map((s) => s[0]);
        for (const cb of interpretations(codes)) if (cb.type === 'seq' && cb.low === low) add(codes, cb);
        for (const s of slots) for (const c of s) result.cards.add(c);
        continue;
      }
      // マーク縛り中は組み合わせを探索
      const lock = effects.suitLock;
      const counts = {};
      for (const s of lock) counts[s] = (counts[s] || 0) + 1;
      const acc = [];
      let found = 0;
      const rec = (i) => {
        if (found > 50) return;
        if (i === slots.length) {
          const codes = [...acc];
          for (const cb of interpretations(codes)) if (cb.type === 'seq' && cb.low === low) add(codes, cb);
          found++;
          return;
        }
        for (const code of slots[i]) {
          const c = parseCard(code);
          if (c.joker) {
            acc.push(code);
            rec(i + 1);
            acc.pop();
          } else if (counts[c.suit] > 0) {
            counts[c.suit]--;
            acc.push(code);
            rec(i + 1);
            acc.pop();
            counts[c.suit]++;
          }
        }
      };
      rec(0);
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
