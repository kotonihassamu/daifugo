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
  bgmNode = null;
  ctx.onstatechange = () => {
    if (ctx && ctx.state === 'running') {
      check = { wall: performance.now(), audio: ctx.currentTime };
      // 止まっていた間に曲の位置がずれるので、ほかの端末と同じ位置からやり直す
      bgmSync();
    }
  };
  loadFiles();
  if (bgmState.want) bgmSync();
  return true;
}

// ---------- BGM ----------
// ゲーム開始の時刻(サーバー時刻)からの経過で再生位置を決めるので、どの端末でもだいたい同じところが流れる
const BGM = {
  url: new URL('../../sounds/bgm.m4a', import.meta.url).href,
  gain: 0.32,
};
const bgmState = { want: false, startedAt: 0, enabled: true, clock: () => Date.now() };
let bgmBuf = null; // ストリーミング用の HTMLAudioElement
let bgmNode = null;
let bgmSource = null;
let bgmContext = null;

function loadBgm() {
  if (bgmBuf || !ctx) return;
  const audio = new Audio(BGM.url);
  audio.preload = 'metadata';
  audio.loop = true;
  audio.addEventListener('loadedmetadata', () => bgmSync());
  bgmBuf = audio;
}

function bgmFadeOut(sec = 0.6) {
  const n = bgmNode;
  bgmNode = null;
  if (!n || !ctx) return;
  try {
    const t = ctx.currentTime;
    n.gain.gain.cancelScheduledValues(t);
    n.gain.gain.setValueAtTime(n.gain.gain.value, t);
    n.gain.gain.linearRampToValueAtTime(0, t + sec);
    n.src.stop(t + sec + 0.05);
  } catch {}
}

function bgmSync() {
  if (!bgmState.want || !bgmState.enabled || !ctx) return bgmFadeOut();
  if (!bgmBuf) loadBgm();
  if (ctx.state !== 'running' || !Number.isFinite(bgmBuf.duration) || bgmBuf.duration <= 0) return;
  bgmFadeOut(0.25);
  // 長い曲も全体をデコードせず、ブラウザの音声ストリーミングで再生する。
  // AudioContext を作り直した場合はメディア要素も作り直す。
  if (bgmContext !== ctx) {
    if (bgmContext) {
      bgmBuf.pause();
      bgmBuf.removeAttribute('src');
      bgmBuf.load();
      bgmBuf = null;
      loadBgm();
      bgmContext = null;
      return;
    }
    bgmSource = ctx.createMediaElementSource(bgmBuf);
    bgmContext = ctx;
  }
  const elapsed = Math.max(0, (bgmState.clock() - bgmState.startedAt) / 1000);
  bgmBuf.currentTime = elapsed % bgmBuf.duration;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(BGM.gain, t + (elapsed < 0.5 ? 0.05 : 0.8));
  bgmSource.connect(gain).connect(ctx.destination);
  const audio = bgmBuf;
  const source = bgmSource;
  const node = { gain, src: { stop(at) {
    setTimeout(() => {
      try { source.disconnect(gain); gain.disconnect(); } catch {}
      if (!bgmNode || bgmNode === node) audio.pause();
    }, Math.max(0, (at - ctx.currentTime) * 1000));
  } } };
  bgmNode = node;
  audio.play().catch(() => {
    if (bgmNode === node) bgmFadeOut(0);
  });
}

export const bgm = {
  get enabled() { return bgmState.enabled; },
  set enabled(on) {
    bgmState.enabled = !!on;
    try { bgmSync(); } catch {}
  },
  // サーバー時刻を返す関数(端末の時計のずれを直すため)
  setClock(fn) { bgmState.clock = fn; },
  // ゲーム開始の時刻から流す(同じ時刻なら何もしない)
  play(startedAt) {
    if (bgmState.want && bgmState.startedAt === startedAt) return;
    bgmState.want = true;
    bgmState.startedAt = startedAt;
    try {
      if (!ctx) create();
      else bgmSync();
    } catch {}
  },
  stop(fade = 1.2) {
    if (!bgmState.want) return;
    bgmState.want = false;
    try { bgmFadeOut(fade); } catch {}
  },
};

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
    bgmNode = null;
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
    return { ctx, state: ctx?.state, files: Object.keys(buffers), bgm: !!bgmNode, bgmLoaded: !!bgmBuf, bgmWant: bgmState.want, bgmEnabled: bgmState.enabled };
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
    try {
      if (document.visibilityState === 'visible') {
        // 裏に回っている間は時計が止まるので、戻ったら確認をやり直し、BGM も今の位置から
        if (ctx?.state === 'running') check = { wall: performance.now(), audio: ctx.currentTime };
        bgmSync();
      } else {
        // 裏に回ったら BGM は止める(Android などで鳴り続けないように)
        bgmFadeOut(0.2);
      }
    } catch {}
  });
}
