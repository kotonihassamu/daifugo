// SVGでカードを描く(画像ファイルを使わない)。サイズ比は実物のトランプと同じ 63:88
import { parseCard, rankLabel } from '../cards.js';

const RED = '#c4262e';
const BLACK = '#1d1f24';

// 共通の定義(マーク・模様)。ページに一度だけ挿入する
export const SVG_DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="s-H" viewBox="0 0 100 100"><path d="M50 92C22 68 2 50 2 30 2 14 14 4 28 4c10 0 18 6 22 15C54 10 62 4 72 4c14 0 26 10 26 26 0 20-20 38-48 62Z"/></symbol>
    <symbol id="s-D" viewBox="0 0 100 100"><path d="M50 2 88 50 50 98 12 50Z"/></symbol>
    <symbol id="s-S" viewBox="0 0 100 100"><path d="M50 3C62 24 97 40 97 63c0 15-11 25-24 25-9 0-16-5-20-12 2 9 6 16 14 22H33c8-6 12-13 14-22-4 7-11 12-20 12C14 88 3 78 3 63 3 40 38 24 50 3Z"/></symbol>
    <symbol id="s-C" viewBox="0 0 100 100"><circle cx="50" cy="27" r="21"/><circle cx="26" cy="58" r="21"/><circle cx="74" cy="58" r="21"/><path d="M45 52c0 22-5 34-13 44h36c-8-10-13-22-13-44Z"/><rect x="42" y="40" width="16" height="22"/></symbol>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f4efe3"/>
    </linearGradient>
    <pattern id="back-pat" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0H7M0 0V7" stroke="rgba(255,255,255,.22)" stroke-width="1.2"/>
      <circle cx="3.5" cy="3.5" r=".9" fill="rgba(255,255,255,.28)"/>
    </pattern>
    <pattern id="face-pat-r" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0V5" stroke="rgba(196,38,46,.10)" stroke-width="2"/>
    </pattern>
    <pattern id="face-pat-b" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0V5" stroke="rgba(29,31,36,.09)" stroke-width="2"/>
    </pattern>
    <radialGradient id="jk-glow" cx=".5" cy=".45" r=".6">
      <stop offset="0" stop-color="#fff6d6"/><stop offset="1" stop-color="#f6e7b8"/>
    </radialGradient>
  </defs>
</svg>`;

const pip = (suit, x, y, s, flip) =>
  `<use href="#s-${suit}" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;

// 数札のマーク配置(x: 左・中・右の列, y: 行)
const L = 20, M = 31.5, R = 43;
const PIPS = {
  2: [[M, 20], [M, 68]],
  3: [[M, 20], [M, 44], [M, 68]],
  4: [[L, 20], [R, 20], [L, 68], [R, 68]],
  5: [[L, 20], [R, 20], [M, 44], [L, 68], [R, 68]],
  6: [[L, 20], [R, 20], [L, 44], [R, 44], [L, 68], [R, 68]],
  7: [[L, 20], [R, 20], [M, 32], [L, 44], [R, 44], [L, 68], [R, 68]],
  8: [[L, 20], [R, 20], [M, 32], [L, 44], [R, 44], [M, 56], [L, 68], [R, 68]],
  9: [[L, 19], [R, 19], [L, 35], [R, 35], [M, 44], [L, 53], [R, 53], [L, 69], [R, 69]],
  10: [[L, 19], [R, 19], [M, 27], [L, 35], [R, 35], [L, 53], [R, 53], [M, 61], [L, 69], [R, 69]],
};

function corner(label, suit, color) {
  const wide = label.length > 1;
  const t = `<text x="7.2" y="14.2" text-anchor="middle" font-size="${wide ? 12.5 : 13.5}" ${wide ? 'textLength="12" lengthAdjust="spacingAndGlyphs"' : ''} font-weight="700" font-family="Georgia, 'Times New Roman', serif" fill="${color}">${label}</text>`;
  const s = suit ? `<use href="#s-${suit}" x="2.8" y="16.6" width="8.8" height="8.8" fill="${color}"/>` : '';
  return `<g>${t}${s}</g><g transform="rotate(180 31.5 44)">${t}${s}</g>`;
}

function faceArt(rank, suit, color) {
  const pat = color === RED ? 'face-pat-r' : 'face-pat-b';
  const letter = rankLabel(rank);
  let crown = '';
  if (rank === 13) crown = `<path d="M21 31 24 21 28 27 31.5 18 35 27 39 21 42 31Z" fill="${color}" opacity=".9"/><rect x="21" y="31" width="21" height="3" rx="1" fill="${color}"/>`;
  if (rank === 12) crown = `<path d="M22 32Q31.5 18 41 32" fill="none" stroke="${color}" stroke-width="2.2"/><circle cx="31.5" cy="21" r="2.4" fill="${color}"/><circle cx="25" cy="26" r="1.6" fill="${color}"/><circle cx="38" cy="26" r="1.6" fill="${color}"/>`;
  if (rank === 11) crown = `<path d="M23 32 31.5 19 40 32Z" fill="none" stroke="${color}" stroke-width="2"/><path d="M31.5 19 37 14" stroke="${color}" stroke-width="1.6"/><circle cx="37.5" cy="13.5" r="1.7" fill="${color}"/>`;
  return `
    <rect x="13" y="11" width="37" height="66" rx="3" fill="url(#${pat})" stroke="${color}" stroke-width=".8" opacity=".95"/>
    <rect x="15.5" y="13.5" width="32" height="61" rx="2" fill="none" stroke="${color}" stroke-width=".4" opacity=".6"/>
    ${crown}
    <text x="31.5" y="56" text-anchor="middle" font-size="24" font-weight="700" font-family="Georgia, 'Times New Roman', serif" fill="${color}">${letter}</text>
    <g fill="${color}">${pip(suit, 31.5, 66, 8)}</g>`;
}

function jokerSvg() {
  const letters = 'JOKER'.split('').map((ch, i) => `<text x="7" y="${11 + i * 7.2}" text-anchor="middle" font-size="7" font-weight="700" font-family="Georgia, serif">${ch}</text>`).join('');
  return `
    <rect x="9" y="9" width="45" height="70" rx="4" fill="url(#jk-glow)"/>
    <g fill="#7b1fa2">${letters}</g>
    <g fill="#7b1fa2" transform="rotate(180 31.5 44)">${letters}</g>
    <g transform="translate(31.5 46)">
      <path d="M-17 4Q-15 -13 -23 -20Q-7 -17 -1 -3Z" fill="${RED}"/>
      <path d="M17 4Q15 -13 23 -20Q7 -17 1 -3Z" fill="#1e5bb8"/>
      <path d="M-8 3Q-5 -20 0 -25Q5 -20 8 3Z" fill="#2e7d32"/>
      <circle cx="-23" cy="-20" r="3" fill="#f2b705"/><circle cx="23" cy="-20" r="3" fill="#f2b705"/><circle cx="0" cy="-25" r="3" fill="#f2b705"/>
      <rect x="-18" y="2" width="36" height="5.5" rx="2.5" fill="#f2b705"/>
      <circle cx="0" cy="16" r="10.5" fill="#fff" stroke="#7b1fa2" stroke-width="1"/>
      <circle cx="-3.8" cy="13.5" r="1.3" fill="#222"/><circle cx="3.8" cy="13.5" r="1.3" fill="#222"/>
      <path d="M-5 18.5Q0 23.5 5 18.5" fill="none" stroke="#c4262e" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M-17 30 0 27 17 30" fill="none" stroke="#7b1fa2" stroke-width="1.2"/>
    </g>`;
}

const cache = new Map();

export function cardSvg(code) {
  if (cache.has(code)) return cache.get(code);
  const c = parseCard(code);
  let inner;
  if (c.joker) {
    inner = jokerSvg();
  } else {
    const color = c.suit === 'H' || c.suit === 'D' ? RED : BLACK;
    const label = rankLabel(c.rank);
    let center;
    if (c.rank === 14) center = `<g fill="${color}">${pip(c.suit, 31.5, 44, c.suit === 'S' ? 30 : 24)}</g>`;
    else if (c.rank >= 11 && c.rank <= 13) center = faceArt(c.rank, c.suit, color);
    else {
      const n = c.rank === 15 ? 2 : c.rank;
      center = `<g fill="${color}">${PIPS[n].map(([x, y]) => pip(c.suit, x, y, n >= 9 ? 10.5 : 11.5, y > 46)).join('')}</g>`;
    }
    inner = corner(label, c.suit, color) + center;
  }
  const svg = `<svg class="card-svg" viewBox="0 0 63 88" aria-hidden="true"><rect x=".5" y=".5" width="62" height="87" rx="5" fill="url(#paper)" stroke="#cdc4b0" stroke-width=".8"/>${inner}</svg>`;
  cache.set(code, svg);
  return svg;
}

export function backSvg() {
  return `<svg class="card-svg" viewBox="0 0 63 88" aria-hidden="true"><rect x=".5" y=".5" width="62" height="87" rx="5" class="back-fill" stroke="#fff" stroke-width="1"/><rect x="4" y="4" width="55" height="80" rx="3" fill="url(#back-pat)" stroke="rgba(255,255,255,.55)" stroke-width=".7"/><circle cx="31.5" cy="44" r="10" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1"/><path d="M31.5 36 37 44 31.5 52 26 44Z" fill="rgba(255,255,255,.55)"/></svg>`;
}

// 小さく手早く使うための要素
export function cardEl(code, cls = '') {
  const d = document.createElement('div');
  d.className = 'card ' + cls;
  d.dataset.code = code;
  d.innerHTML = code ? cardSvg(code) : backSvg();
  return d;
}
