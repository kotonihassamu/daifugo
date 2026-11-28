// ゲバ字(学生運動の立て看板の手描き文字)風の「革命!」「革命返し!」。
// 縦長の箱(幅100×高さ180)に直線で描き、筆で塗ったような揺らぎを足す
export const GEBA_GLYPHS = {
  '革': { w: 100, d: ['M8 22H92', 'M30 6V52', 'M70 6V52', 'M30 52H70', 'M20 72H80V112H20Z', 'M4 138H96', 'M50 52V176'] },
  '命': { w: 100, d: ['M50 4L4 62', 'M50 4L96 62', 'M30 58H70', 'M10 84H42V136H10Z', 'M58 84H90V140H76', 'M58 84V176'] },
  '返': { w: 100, d: ['M32 10H94', 'M36 10V70L24 108', 'M46 44H88L50 108', 'M56 62L94 108', 'M8 30L20 44', 'M6 74H22V140', 'M22 140L36 160L98 168'] },
  'し': { w: 70, d: ['M22 10V148L36 166L62 150L66 118'] },
  '!': { w: 44, d: ['M22 8V118', 'M22 150V170'] },
  '!': { w: 44, d: ['M22 8V118', 'M22 150V170'] },
};

// この文字列をゲバ字で描けるか
export const canGeba = (text) => [...text].every((ch) => GEBA_GLYPHS[ch]);

const FILTER_ID = 'geba-brush';
function ensureFilter() {
  if (typeof document === 'undefined' || document.getElementById(FILTER_ID)) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.05" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4"/></filter></svg>`,
  );
}

// 線の中身(<g>…</g>)と幅を返す
export function gebaPaths(text, stroke = '#fff', { filter = true, width = 15 } = {}) {
  let x = 0;
  let paths = '';
  const gap = 14;
  for (const ch of text) {
    const g = GEBA_GLYPHS[ch];
    if (!g) continue;
    paths += `<g transform="translate(${x} 0)">${g.d.map((d) => `<path d="${d}"/>`).join('')}</g>`;
    x += g.w + gap;
  }
  const w = Math.max(0, x - gap) + 16;
  const f = filter ? ` filter="url(#${FILTER_ID})"` : '';
  return { w, body: `<g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="miter"${f}>${paths}</g>` };
}

export function gebaSvg(text, { stroke = '#fff', cls = 'geba' } = {}) {
  ensureFilter();
  const { w, body } = gebaPaths(text, stroke);
  return `<svg class="${cls}" viewBox="-8 -8 ${w} 196" role="img" aria-label="${text}">${body}</svg>`;
}
