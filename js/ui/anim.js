// 演出(CSS transform 中心。視差効果を減らす設定なら控えめに)
import { cardEl } from './card-svg.js';

export const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function layer() {
  return document.getElementById('fx-layer');
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// 要素を from の位置から現在の位置へ滑らせる
export function flyFrom(el, fromRect, { duration = 360, delay = 0, rotate = 0 } = {}) {
  if (!fromRect || reduceMotion()) return Promise.resolve();
  const to = el.getBoundingClientRect();
  const a = center(fromRect), b = center(to);
  const s = Math.max(0.3, Math.min(2, fromRect.width / Math.max(1, to.width)));
  const anim = el.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${s}) rotate(${rotate}deg)`, opacity: 0.6 },
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
    ],
    { duration, delay, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' },
  );
  return anim.finished.catch(() => {});
}

// カード(表 or 裏)を一時的に作って fromRect → toRect へ飛ばす
export function flyCard(code, fromRect, toRect, { duration = 450, delay = 0, width = 40, fade = false, spin = 0 } = {}) {
  if (!fromRect || !toRect || reduceMotion()) return Promise.resolve();
  const el = cardEl(code, 'fly');
  el.style.width = width + 'px';
  const a = center(fromRect), b = center(toRect);
  el.style.left = a.x - width / 2 + 'px';
  el.style.top = a.y - (width * 88) / 63 / 2 + 'px';
  layer().appendChild(el);
  const anim = el.animate(
    [
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) rotate(${spin}deg)`, opacity: fade ? 0 : 1 },
    ],
    { duration, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
  );
  return anim.finished.catch(() => {}).then(() => el.remove());
}

// 場の中央に短い文字演出
export async function banner(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'banner ' + cls;
  el.textContent = text;
  layer().appendChild(el);
  const d = reduceMotion() ? 500 : 900;
  const anim = el.animate(
    reduceMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' },
          { opacity: 1, transform: 'translate(-50%,-50%) scale(1.08)', offset: 0.25 },
          { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.75 },
          { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2)' },
        ],
    { duration: d, easing: 'ease-out', fill: 'both' },
  );
  await anim.finished.catch(() => {});
  el.remove();
}

// 革命:画面全体を一瞬反転
export async function revolutionFlash() {
  if (reduceMotion()) return;
  const el = document.createElement('div');
  el.className = 'invert-flash';
  document.body.appendChild(el);
  await el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 650 }).finished.catch(() => {});
  el.remove();
}

// 席に吹き出し
export function bubble(seatEl, text, cls = '') {
  if (!seatEl) return;
  const r = seatEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'bubble ' + cls;
  el.textContent = text;
  el.style.left = r.left + r.width / 2 + 'px';
  el.style.top = r.top + 'px';
  layer().appendChild(el);
  el.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -60%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -110%) scale(1)', offset: 0.2 },
      { opacity: 1, transform: 'translate(-50%, -110%) scale(1)', offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%, -130%) scale(1)' },
    ],
    { duration: 1100, fill: 'both' },
  ).finished.catch(() => {}).then(() => el.remove());
}

// 場の山を横へ片付ける
export async function sweep(fieldEl, special = false) {
  if (!fieldEl || !fieldEl.children.length) return;
  const r = fieldEl.getBoundingClientRect();
  const clone = fieldEl.cloneNode(true);
  clone.classList.add('sweep-clone');
  Object.assign(clone.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0 });
  layer().appendChild(clone);
  fieldEl.innerHTML = '';
  if (reduceMotion()) {
    await clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'both' }).finished.catch(() => {});
  } else {
    const frames = special
      ? [
          { transform: 'translate(0,0) rotate(0)', opacity: 1, filter: 'brightness(1)' },
          { transform: 'translate(0,0) rotate(-3deg) scale(1.05)', opacity: 1, filter: 'brightness(1.6)', offset: 0.25 },
          { transform: `translate(${window.innerWidth}px, -40px) rotate(18deg)`, opacity: 0, filter: 'brightness(1)' },
        ]
      : [
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: `translate(${window.innerWidth * 0.8}px, 10px) rotate(8deg)`, opacity: 0 },
        ];
    await clone.animate(frames, { duration: special ? 650 : 480, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'both' }).finished.catch(() => {});
  }
  clone.remove();
}

// 上がりの順位バッジ
export function dropBadge(seatEl, text) {
  if (!seatEl || reduceMotion()) return;
  const b = seatEl.querySelector('.place-badge');
  b?.animate(
    [
      { transform: 'translateY(-60px) scale(1.6)', opacity: 0 },
      { transform: 'translateY(4px) scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(0) scale(1)', opacity: 1 },
    ],
    { duration: 600, easing: 'cubic-bezier(.3,1.4,.5,1)' },
  );
}
