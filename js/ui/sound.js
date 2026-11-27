// 効果音(音声ファイルを使わず Web Audio で合成)。音そのものは sfx.js
import { makeBus, playSfx, playTurn, subBus } from './sfx.js';

// 使う音(比較ページで選んだパターン)。null は鳴らさない
export const CHOSEN = {
  deal: 'C',
  select: 'A',
  deselect: 'A',
  place: 'A',
  flow: 'A',
  revolution: 'A',
  finish: 'A',
  end: null,
};

// 全体の音量(控えめ)
const VOLUME = 0.5;

let ctx = null;
let bus = null;
function ready() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus = makeBus(ctx, VOLUME);
    // 古い iOS は最初のタップで無音を鳴らしておかないと、その後も鳴らない
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start(0);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return bus;
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
      const v = CHOSEN[kind];
      if (!v) return NOOP;
      // なぞって何枚も選ぶときに鳴りすぎないように
      if (kind === 'select' || kind === 'deselect') {
        const now = performance.now();
        if (now - lastUi < 45) return NOOP;
        lastUi = now;
      }
      const sb = subBus(b);
      const len = playSfx(sb.bus, kind, v, opts.delay || 0, opts) + (opts.delay || 0);
      setTimeout(() => sb.stop(), (len + 2.5) * 1000);
      return sb;
    } catch {
      return NOOP;
    }
  },
  // iOS では最初のタップで音声を有効化する必要がある
  unlock() {
    try { ready(); } catch {}
  },
};
