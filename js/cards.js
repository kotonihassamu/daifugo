// カードの表記・強さ・並び替え(UIとエンジンで共有)
export const SUITS = ['S', 'H', 'D', 'C'];
export const RANK_CHARS = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'];
export const JOKER_RANK = 16;
export const MAX_PASS = 3;

// 同じ数字の中での並び(弱い順)。ダイヤの3を「一番弱いカード」にするための順序
export const SUIT_ORDER = { D: 0, C: 1, H: 2, S: 3 };
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME = { S: 'スペード', H: 'ハート', D: 'ダイヤ', C: 'クラブ' };

export function isJoker(code) {
  return typeof code === 'string' && code.startsWith('JK');
}

export function parseCard(code) {
  if (isJoker(code)) return { code, joker: true, suit: null, rank: JOKER_RANK };
  const rank = RANK_CHARS.indexOf(code[1]) + 3;
  if (rank < 3 || !SUIT_ORDER.hasOwnProperty(code[0])) throw new Error('bad card ' + code);
  return { code, joker: false, suit: code[0], rank };
}

export function rankOf(code) {
  return parseCard(code).rank;
}

// 数字(3..15)→表示ラベル
export function rankLabel(rank) {
  if (rank === JOKER_RANK) return 'JOKER';
  if (rank <= 10) return String(rank);
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }[rank];
}

// 数字(3..15, 16)→ボンバー指定などに使う文字('3'..'2', 'JK')
export function rankChar(rank) {
  return rank === JOKER_RANK ? 'JK' : RANK_CHARS[rank - 3];
}

export function rankFromChar(ch) {
  return ch === 'JK' ? JOKER_RANK : RANK_CHARS.indexOf(ch) + 3;
}

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANK_CHARS) deck.push(s + r);
  deck.push('JK1');
  return deck;
}

// 通常の強さでの比較キー(ジョーカーが最強)
export function strengthKey(code) {
  const c = parseCard(code);
  return c.joker ? 1000 : c.rank * 4 + SUIT_ORDER[c.suit];
}

export function strongest(cards, n) {
  return [...cards].sort((a, b) => strengthKey(b) - strengthKey(a)).slice(0, n);
}

// 並び替え。mode: 'strength' | 'suit'。reversed: 革命などで強さが逆転中
export function sortCards(cards, mode = 'strength', reversed = false) {
  const list = [...cards];
  if (mode === 'suit') {
    const so = { S: 0, H: 1, D: 2, C: 3 };
    return list.sort((a, b) => {
      const ca = parseCard(a), cb = parseCard(b);
      if (ca.joker !== cb.joker) return ca.joker ? 1 : -1;
      if (ca.joker) return 0;
      return so[ca.suit] - so[cb.suit] || ca.rank - cb.rank;
    });
  }
  return list.sort((a, b) => {
    const ca = parseCard(a), cb = parseCard(b);
    if (ca.joker !== cb.joker) return ca.joker ? 1 : -1;
    if (ca.joker) return 0;
    const d = ca.rank - cb.rank;
    return (reversed ? -d : d) || SUIT_ORDER[ca.suit] - SUIT_ORDER[cb.suit];
  });
}

export function cardLabel(code) {
  const c = parseCard(code);
  if (c.joker) return 'ジョーカー';
  return SUIT_SYMBOL[c.suit] + rankLabel(c.rank);
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
