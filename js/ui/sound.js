// 効果音(音声ファイルを使わずWeb Audioで合成)。初期OFF
let ctx = null;
export const sound = {
  enabled: false,
  play(kind) {
    if (!this.enabled) return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      if (kind === 'place') {
        // カードを置く:短いノイズ
        const len = 0.06;
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.value = 0.6;
        src.connect(f).connect(g).connect(ctx.destination);
        src.start(t);
      } else {
        const notes = kind === 'turn' ? [660, 880] : [520, 390, 260];
        notes.forEach((hz, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = hz;
          const s = t + i * 0.09;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.exponentialRampToValueAtTime(0.18, s + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
          o.connect(g).connect(ctx.destination);
          o.start(s);
          o.stop(s + 0.2);
        });
      }
    } catch { /* 音は鳴らなくてもよい */ }
  },
  // iOSでは最初のタップで音声を有効化する必要がある
  unlock() {
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {}
  },
};
