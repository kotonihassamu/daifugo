// 効果音(Web Audio)。合成音は sfx.js、録音した音は sounds/ フォルダ
import { makeBus, playSfx, playTurn, subBus } from './sfx.js';

// 使う音(比較ページで選んだパターン)。null は鳴らさない、'file' は FILES の録音を使う
export const CHOSEN = {
  deal: 'C',
  select: 'A',
  deselect: 'A',
  place: 'A',
  pass: 'A',
  flow: 'A',
  revolution: 'file',
  finish: 'A',
  end: null,
};

// 録音した音。読み込めないうちは FALLBACK の合成音を鳴らす
const FILES = {
  revolution: { url: new URL('../../sounds/revolution.mp3', import.meta.url).href, gain: 0.8, len: 3.4 },
};
const FALLBACK = { revolution: 'A' };

// 全体の音量(控えめ)
const VOLUME = 0.5;
// 種類ごとの音量(1 = そのまま)。手札を触る音は何度も鳴るので小さめ
const LEVEL = { select: 0.45, deselect: 0.45 };

let ctx = null;
let bus = null;
let buffers = {};
let check = null; // 音の時計が進んでいるかの確認用

function create() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  // iPhone:ほかのアプリの音と混ぜる・消音スイッチに従う
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
  ctx = new AC();
  bus = makeBus(ctx, VOLUME);
  buffers = {};
  check = null;
  ctx.onstatechange = () => {
    if (ctx && ctx.state === 'running') check = { wall: performance.now(), audio: ctx.currentTime };
  };
  loadFiles();
  return true;
}

function loadFiles() {
  const c = ctx;
  for (const [kind, f] of Object.entries(FILES)) {
    fetch(f.url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      // 古い Safari は Promise 版がないのでコールバック版で
      .then((ab) => new Promise((ok, ng) => c.decodeAudioData(ab, ok, ng)))
      .then((buf) => { if (ctx === c) buffers[kind] = buf; })
      .catch(() => {});
  }
}

// 無音を一瞬鳴らす(iPhone はタップの中で実際に音を出さないと有効にならない)
function blip() {
  try {
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start(0);
  } catch {}
}

// 止まった/壊れた音声を作り直す。タップなどの操作の中で呼ぶ
function revive() {
  if (!ctx) {
    if (create()) blip();
    return;
  }
  const st = ctx.state;
  // iPhone で電話・ほかのアプリ・画面ロックのあとに 'interrupted' や 'closed' になり、戻らないことがある
  let stuck = st === 'closed' || st === 'interrupted';
  // 'running' と言いながら時計が止まっていることもある
  if (!stuck && st === 'running' && check) {
    const wall = (performance.now() - check.wall) / 1000;
    if (wall > 1 && ctx.currentTime - check.audio < 0.05) stuck = true;
  }
  if (stuck) {
    try { if (st !== 'closed') ctx.close().catch(() => {}); } catch {}
    ctx = null;
    create();
    blip();
    return;
  }
  if (st !== 'running') {
    blip();
    ctx.resume().catch(() => {});
  }
  if (ctx.state === 'running') check = { wall: performance.now(), audio: ctx.currentTime };
}

function ready() {
  if (!ctx && !create()) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return bus;
}

function playFile(b, kind, opts) {
  const f = FILES[kind];
  const buf = buffers[kind];
  if (!buf) return -1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = f.gain;
  src.connect(g).connect(b.out);
  src.start(ctx.currentTime + 0.02 + (opts.delay || 0));
  return f.len;
}

let lastUi = 0;
const NOOP = { stop() {} };

export const sound = {
  enabled: true,
  // 鳴らす。戻り値の stop() で途中で止められる(配る音で使う)
  play(kind, opts = {}) {
    if (!this.enabled) return NOOP;
    try {
      const b = ready();
      if (!b) return NOOP;
      if (kind === 'turn') {
        playTurn(b);
        return NOOP;
      }
      let v = CHOSEN[kind];
      if (!v) return NOOP;
      // なぞって何枚も選ぶときに鳴りすぎないように
      if (kind === 'select' || kind === 'deselect') {
        const now = performance.now();
        if (now - lastUi < 45) return NOOP;
        lastUi = now;
      }
      const sb = subBus(b);
      if (LEVEL[kind]) {
        sb.bus.out.gain.value = LEVEL[kind];
        sb.bus.rev.gain.value = LEVEL[kind];
      }
      let len = -1;
      if (v === 'file') {
        len = playFile(sb.bus, kind, opts);
        v = FALLBACK[kind];
      }
      if (len < 0) len = playSfx(sb.bus, kind, v, opts.delay || 0, opts);
      len += opts.delay || 0;
      setTimeout(() => sb.stop(), (len + 2.5) * 1000);
      return sb;
    } catch {
      return NOOP;
    }
  },
  // 動作確認用
  _debug() {
    return { ctx, state: ctx?.state, files: Object.keys(buffers) };
  },
  // 画面のどこかを触ったときに呼ぶ(iPhone では操作の中でないと音声を再開できない)
  unlock() {
    try { revive(); } catch {}
  },
};

// どの画面でも、触ったら音声を起こす(待合室やメニューでの操作も含む)
if (typeof document !== 'undefined') {
  for (const ev of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    // 裏に回っている間は時計が止まるので、戻ったら確認をやり直す
    if (document.visibilityState === 'visible' && ctx?.state === 'running') check = { wall: performance.now(), audio: ctx.currentTime };
  });
}
