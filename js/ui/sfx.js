// 効果音の候補(音声ファイルを使わず Web Audio で合成)。
// 種類ごとに A/B/C の3パターン。比較ページ(sfx-compare)とゲーム本体で同じコードを使う。
// このファイルは import を持たない(比較ページにそのまま埋め込むため)。

// ---------- 部品 ----------
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const len = ctx.sampleRate * 2;
  b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, b);
  return b;
}

function impulse(ctx, sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

// 出力のまとまり(コンプレッサー+残響)。ctx ごとに1つ作って使い回す
export function makeBus(ctx, volume = 0.9) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = volume;
  comp.connect(master).connect(ctx.destination);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 1.8, 2.6);
  const rev = ctx.createGain();
  rev.connect(conv).connect(comp);
  return { ctx, out: comp, rev, master };
}

function route(b, node, rev = 0) {
  node.connect(b.out);
  if (rev > 0) {
    const s = b.ctx.createGain();
    s.gain.value = rev;
    node.connect(s).connect(b.rev);
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

// 配る音の回数と間隔。cards(1人に配る枚数)があれば、手札が飛んでくる時間(1枚45ms)に合わせて増減する
export function dealPace(cards, gap, n) {
  if (!cards) return { n, gap };
  const span = Math.max(0, cards - 1) * 0.045;
  return { n: Math.max(3, Math.min(14, Math.round(span / gap) + 1)), gap };
}

// フィルターをかけたノイズの短い音(シュッ・パサッ・カチッ)
function burst(b, { t, dur, type = 'bandpass', freq = 3000, freqEnd, q = 1, gain = 0.4, attack = 0.004, rev = 0 }) {
  const { ctx } = b;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  route(b, g, rev);
  src.start(t, rnd(0, 1.5));
  src.stop(t + dur + 0.05);
}

// 単純な音程のある音
function tone(b, { t, freq, freqEnd, dur, type = 'sine', gain = 0.2, attack = 0.005, rev = 0, lowpass }) {
  const { ctx } = b;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let last = o;
  if (lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    last = last.connect(f);
  }
  last.connect(g);
  route(b, g, rev);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// 金管(ラッパ)風:のこぎり波2本+開いていくフィルター+ビブラート
function brass(b, { t, freq, dur, gain = 0.1, rev = 0.25, bright = 6 }) {
  const { ctx } = b;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 1.5;
  f.frequency.setValueAtTime(freq * 1.2, t);
  f.frequency.linearRampToValueAtTime(freq * bright, t + 0.05);
  f.frequency.exponentialRampToValueAtTime(freq * bright * 0.55, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.035);
  g.gain.linearRampToValueAtTime(gain * 0.8, t + 0.12);
  g.gain.setValueAtTime(gain * 0.8, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(dur > 0.3 ? freq * 0.007 : 0, t + Math.min(dur, 0.4));
  lfo.connect(lg);
  for (const det of [-8, 8]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    lg.connect(o.frequency);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
  f.connect(g);
  route(b, g, rev);
  lfo.start(t);
  lfo.stop(t + dur + 0.2);
}

// 鐘・チャイム(倍音をずらしたサイン波)
function bell(b, { t, freq, dur = 1, gain = 0.12, rev = 0.35, partials }) {
  const ps = partials || [[1, 1, 1], [2.01, 0.45, 0.6], [3.0, 0.18, 0.45], [4.17, 0.16, 0.3], [5.43, 0.08, 0.22]];
  for (const [ratio, amp, life] of ps) tone(b, { t, freq: freq * ratio, dur: dur * life, gain: gain * amp, attack: 0.003, rev });
}

// オルゴール
function musicBox(b, { t, freq, dur = 1.3, gain = 0.14, rev = 0.3 }) {
  bell(b, { t, freq, dur, gain, rev, partials: [[1, 1, 1], [2, 0.3, 0.5], [3.98, 0.12, 0.2], [6.3, 0.05, 0.08]] });
  burst(b, { t, dur: 0.012, type: 'highpass', freq: 6000, gain: 0.05 });
}

const cymbal = (b, t, gain = 0.14, dur = 1.3) => burst(b, { t, dur, type: 'highpass', freq: 5500, gain, attack: 0.002, rev: 0.3 });
const boom = (b, t, gain = 0.5) => {
  tone(b, { t, freq: 95, freqEnd: 48, dur: 0.7, gain });
  burst(b, { t, dur: 0.09, type: 'lowpass', freq: 400, gain: gain * 0.6 });
};

// 音名 → 周波数
const N = { C4: 261.63, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Ab3: 207.65, B4: 493.88, C5: 523.25, Eb5: 622.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02, G7: 3135.96, C3: 130.81, G3: 196, Eb4: 311.13 };

// ---------- 候補 ----------
// len はおおよその長さ(秒)。続けて聴くときの間隔に使う
export const SFX = {
  deal: {
    label: 'カードを配る',
    when: 'ゲーム開始で手札が配られるとき',
    items: {
      A: {
        name: 'シュシュシュッ(軽快)',
        desc: '高めのシュッを14回すばやく。テンポよく配る感じ',
        len: 0.85,
        play(b, t, o = {}) {
          const { n, gap } = dealPace(o.cards, 0.055, 14);
          for (let i = 0; i < n; i++) burst(b, { t: t + i * gap + rnd(0, 0.008), dur: 0.065, freq: 2200, freqEnd: 5200, q: 1.4, gain: rnd(0.4, 0.55), attack: 0.02 });
        },
      },
      B: {
        name: 'ジャラララッ(シャッフル)',
        desc: 'トランプを切るリフル音のあとにシュッ',
        len: 0.75,
        play(b, t) {
          const n = 26;
          for (let i = 0; i < n; i++) {
            const env = Math.sin((Math.PI * (i + 1)) / (n + 1));
            burst(b, { t: t + i * 0.018 + rnd(0, 0.006), dur: 0.014, type: 'highpass', freq: 2600, gain: 0.12 + 0.28 * env, attack: 0.001 });
          }
          burst(b, { t: t + n * 0.018 + 0.02, dur: 0.16, freq: 1500, freqEnd: 4200, q: 0.9, gain: 0.35, attack: 0.06 });
        },
      },
      C: {
        name: 'シャッ・トッ(1枚ずつ)',
        desc: '低めのシャッ+着地のトッを6回。ゆったり配る感じ',
        len: 0.9,
        play(b, t, o = {}) {
          const { n, gap } = dealPace(o.cards, o.cards ? 0.11 : 0.13, 6);
          for (let i = 0; i < n; i++) {
            const s = t + i * gap;
            burst(b, { t: s, dur: 0.09, freq: 900, freqEnd: 3600, q: 0.9, gain: 0.4, attack: 0.03 });
            burst(b, { t: s + 0.085, dur: 0.03, type: 'lowpass', freq: 1500, gain: 0.3, attack: 0.002 });
          }
        },
      },
    },
  },
  select: {
    label: 'カードを選ぶ',
    when: '手札のカードをタップして持ち上げるとき',
    items: {
      A: {
        name: 'シュッ(小)',
        desc: '高く上がるかすれ音。いちばん控えめ',
        len: 0.25,
        play(b, t) {
          burst(b, { t, dur: 0.06, freq: 3000, freqEnd: 7000, q: 2, gain: 0.48, attack: 0.015 });
        },
      },
      B: {
        name: 'カチッ',
        desc: '短いクリック+小さな電子音。ボタンを押した感じ',
        len: 0.25,
        play(b, t) {
          burst(b, { t, dur: 0.014, type: 'highpass', freq: 4500, gain: 0.45, attack: 0.001 });
          tone(b, { t, freq: 2200, dur: 0.04, gain: 0.1, attack: 0.002 });
        },
      },
      C: {
        name: 'ぷいっ(上がる音)',
        desc: '音程が上がるやわらかい音。かわいい系',
        len: 0.25,
        play(b, t) {
          tone(b, { t, freq: 700, freqEnd: 1400, dur: 0.07, gain: 0.13, attack: 0.008 });
        },
      },
    },
  },
  deselect: {
    label: '選択をやめる',
    when: '持ち上げたカードを手札に戻すとき',
    items: {
      A: {
        name: 'スッ(下がる)',
        desc: '選ぶAの逆向き。下がるかすれ音',
        len: 0.25,
        play(b, t) {
          burst(b, { t, dur: 0.06, freq: 6000, freqEnd: 2500, q: 2, gain: 0.42, attack: 0.012 });
        },
      },
      B: {
        name: 'コッ',
        desc: '低めの短いクリック。選ぶBと対になる音',
        len: 0.25,
        play(b, t) {
          burst(b, { t, dur: 0.028, type: 'lowpass', freq: 1400, gain: 0.75, attack: 0.001 });
          tone(b, { t, freq: 900, dur: 0.03, gain: 0.08, attack: 0.002 });
        },
      },
      C: {
        name: 'ぷゅっ(下がる音)',
        desc: '音程が下がるやわらかい音。選ぶCと対',
        len: 0.25,
        play(b, t) {
          tone(b, { t, freq: 1100, freqEnd: 600, dur: 0.07, gain: 0.12, attack: 0.008 });
        },
      },
    },
  },
  place: {
    label: 'カードを場に出す',
    when: '自分や相手がカードを出したとき',
    items: {
      A: {
        name: 'パシッ(スナップ)',
        desc: 'はじくような音+低いトン。キレがある',
        len: 0.35,
        play(b, t) {
          burst(b, { t, dur: 0.045, freq: 2600, q: 0.8, gain: 0.8, attack: 0.002 });
          tone(b, { t, freq: 140, freqEnd: 90, dur: 0.09, gain: 0.45, attack: 0.003 });
        },
      },
      B: {
        name: 'ペラッ',
        desc: '紙がめくれる細かい音のあとにパサッ。本物のカードに近い',
        len: 0.35,
        play(b, t) {
          for (let i = 0; i < 4; i++) burst(b, { t: t + i * 0.022, dur: 0.02, freq: 2000 + i * 400, q: 1.2, gain: 0.1 + i * 0.06, attack: 0.002 });
          burst(b, { t: t + 0.09, dur: 0.05, type: 'highpass', freq: 1800, gain: 0.4, attack: 0.002 });
          tone(b, { t: t + 0.09, freq: 170, freqEnd: 110, dur: 0.06, gain: 0.15 });
        },
      },
      C: {
        name: 'スーッ・トン',
        desc: 'テーブルの上をすべらせて置く。落ち着いた音',
        len: 0.4,
        play(b, t) {
          burst(b, { t, dur: 0.13, type: 'lowpass', freq: 700, freqEnd: 3500, gain: 0.2, attack: 0.06 });
          tone(b, { t: t + 0.12, freq: 190, freqEnd: 120, dur: 0.1, gain: 0.25, attack: 0.003 });
          burst(b, { t: t + 0.12, dur: 0.02, freq: 1500, gain: 0.18, attack: 0.001 });
        },
      },
    },
  },
  flow: {
    label: '場が流れる',
    when: '全員パスや8切りで場のカードが片付けられるとき',
    items: {
      A: {
        name: 'サーッ',
        desc: 'カードを払いのけるやわらかいかすれ音。控えめ',
        len: 0.5,
        play(b, t) {
          burst(b, { t, dur: 0.34, freq: 2600, freqEnd: 700, q: 0.8, gain: 0.25, attack: 0.12 });
        },
      },
      B: {
        name: 'シャラララ',
        desc: '場のカードをまとめて集める細かい音',
        len: 0.5,
        play(b, t) {
          for (let i = 0; i < 5; i++) burst(b, { t: t + i * 0.042, dur: 0.05, freq: 4200 - i * 500, q: 1.1, gain: 0.5 - i * 0.06, attack: 0.008 });
          burst(b, { t: t + 0.22, dur: 0.035, type: 'lowpass', freq: 1300, gain: 0.45, attack: 0.002 });
        },
      },
      C: {
        name: 'ポロン',
        desc: '下がる2音のやさしいチャイム。「仕切り直し」の合図',
        len: 0.8,
        play(b, t) {
          bell(b, { t, freq: N.E6, dur: 0.6, gain: 0.05, rev: 0.25 });
          bell(b, { t: t + 0.11, freq: N.B5, dur: 0.7, gain: 0.05, rev: 0.25 });
        },
      },
    },
  },
  revolution: {
    label: '革命',
    when: '革命・革命返しが起きたとき',
    items: {
      A: {
        name: 'パパパ・パーン!(ラッパ)',
        desc: '金管のファンファーレ。王道で分かりやすい',
        len: 1.5,
        play(b, t) {
          for (let i = 0; i < 3; i++) brass(b, { t: t + i * 0.12, freq: N.G4, dur: 0.08, gain: 0.11 });
          const s = t + 0.36;
          brass(b, { t: s, freq: N.C5, dur: 0.8, gain: 0.12 });
          brass(b, { t: s, freq: N.G4, dur: 0.8, gain: 0.07 });
          brass(b, { t: s, freq: N.E4, dur: 0.8, gain: 0.07 });
          brass(b, { t: s, freq: N.C4, dur: 0.8, gain: 0.06, bright: 4 });
          cymbal(b, s, 0.1, 1.1);
          boom(b, s, 0.35);
        },
      },
      B: {
        name: 'ジャン、ジャーン!(オーケストラ)',
        desc: '短調の重い和音を2回+ティンパニ。ドラマチック',
        len: 1.6,
        play(b, t) {
          const hit = (s, dur, g) => {
            for (const f of [N.C3, N.G3, N.C4, N.Eb4, N.G4, N.C5]) brass(b, { t: s, freq: f, dur, gain: g, rev: 0.45, bright: 8 });
            burst(b, { t: s, dur: 0.15, freq: 1800, q: 0.6, gain: 0.35, attack: 0.002, rev: 0.4 });
            boom(b, s, 0.55);
          };
          hit(t, 0.1, 0.05);
          hit(t + 0.22, 0.9, 0.06);
        },
      },
      C: {
        name: 'ギュイーン→ジャーン(上昇)',
        desc: '一気に盛り上がってから明るい和音とシンバル。派手',
        len: 1.8,
        play(b, t) {
          const { ctx } = b;
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(150, t);
          o.frequency.exponentialRampToValueAtTime(1200, t + 0.55);
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(400, t);
          f.frequency.exponentialRampToValueAtTime(5000, t + 0.55);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          o.connect(f).connect(g);
          route(b, g, 0.2);
          o.start(t);
          o.stop(t + 0.65);
          burst(b, { t, dur: 0.58, type: 'highpass', freq: 500, freqEnd: 8000, gain: 0.12, attack: 0.5 });
          const s = t + 0.55;
          for (const fq of [N.C5, N.E5, N.G5, N.C6]) brass(b, { t: s, freq: fq, dur: 0.9, gain: 0.07, rev: 0.35 });
          brass(b, { t: s, freq: N.C4, dur: 0.9, gain: 0.07, bright: 4 });
          cymbal(b, s, 0.2, 1.4);
          boom(b, s, 0.45);
        },
      },
    },
  },
  finish: {
    label: 'あがり',
    when: 'だれかが手札を出し切ったとき',
    items: {
      A: {
        name: 'キラリン(チャイム)',
        desc: 'ドミソドと上がるきれいなチャイム',
        len: 1.3,
        play(b, t) {
          [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(b, { t: t + i * 0.08, freq: f, dur: 1.0, gain: 0.1 }));
        },
      },
      B: {
        name: 'ピロリロリン(ゲーム機風)',
        desc: '8ビット風の速いアルペジオ。レトロゲームっぽい',
        len: 0.9,
        play(b, t) {
          const ns = [N.G5, N.C6, N.E6, N.G6, N.C7];
          ns.forEach((f, i) => tone(b, { t: t + i * 0.055, freq: f, dur: i === ns.length - 1 ? 0.45 : 0.06, type: 'square', gain: 0.1, attack: 0.003, lowpass: 6000 }));
          tone(b, { t: t + 4 * 0.055, freq: N.E7, dur: 0.4, type: 'square', gain: 0.04, lowpass: 6000 });
        },
      },
      C: {
        name: 'チャリーン(コイン)',
        desc: '2音のベル+キラキラ。お金がもらえた感じ',
        len: 1.2,
        play(b, t) {
          bell(b, { t, freq: N.B5, dur: 0.15, gain: 0.12, rev: 0.2 });
          bell(b, { t: t + 0.07, freq: N.E6, dur: 1.0, gain: 0.14, rev: 0.3 });
          burst(b, { t: t + 0.07, dur: 0.6, type: 'highpass', freq: 7000, gain: 0.05, attack: 0.002, rev: 0.3 });
          bell(b, { t: t + 0.16, freq: N.B6, dur: 0.4, gain: 0.03 });
          bell(b, { t: t + 0.24, freq: N.E7, dur: 0.4, gain: 0.025 });
        },
      },
    },
  },
  end: {
    label: 'ゲーム終了',
    when: '全員の順位が決まったとき',
    items: {
      A: {
        name: 'パーパーパーン(ファンファーレ)',
        desc: '金管で「ファ→ソ→ド」と解決。表彰式っぽい',
        len: 2.3,
        play(b, t) {
          const chord = (s, fs, dur) => fs.forEach((f, i) => brass(b, { t: s, freq: f, dur, gain: i === fs.length - 1 ? 0.09 : 0.06, rev: 0.3 }));
          chord(t, [N.F4, N.A4, N.C5], 0.26);
          chord(t + 0.32, [N.G4, N.B4, N.D5], 0.26);
          const s = t + 0.66;
          chord(s, [N.C4, N.E4, N.G4, N.C5, N.E5], 1.2);
          cymbal(b, s, 0.12, 1.5);
          for (let i = 0; i < 10; i++) tone(b, { t: t + 0.1 + i * 0.055, freq: 90, freqEnd: 70, dur: 0.12, gain: 0.08 + i * 0.025 });
          boom(b, s, 0.5);
        },
      },
      B: {
        name: 'ドミソミド〜(オルゴール)',
        desc: 'やさしいオルゴールのメロディ。しっとり終わる',
        len: 2.4,
        play(b, t) {
          const mel = [[N.C6, 0], [N.E6, 0.22], [N.G6, 0.44], [N.E6, 0.66], [N.C7, 0.88]];
          for (const [f, s] of mel) musicBox(b, { t: t + s, freq: f, dur: s === 0.88 ? 1.6 : 1.0 });
          musicBox(b, { t, freq: N.C5, dur: 1.4, gain: 0.08 });
          musicBox(b, { t: t + 0.88, freq: N.G5, dur: 1.6, gain: 0.07 });
          musicBox(b, { t: t + 0.88, freq: N.E6, dur: 1.6, gain: 0.05 });
        },
      },
      C: {
        name: '拍手+チャイム',
        desc: 'パチパチパチ…という拍手と明るいチャイム',
        len: 2.6,
        play(b, t) {
          const span = 2.4;
          for (let i = 0; i < 150; i++) {
            const x = Math.random();
            const env = Math.min(1, x / 0.12) * (x > 0.55 ? Math.pow(1 - (x - 0.55) / 0.45, 1.5) : 1);
            if (env < 0.03) continue;
            burst(b, { t: t + x * span, dur: rnd(0.025, 0.05), freq: rnd(800, 2600), q: rnd(0.7, 1.6), gain: 0.35 * env * rnd(0.6, 1), attack: 0.002, rev: 0.12 });
          }
          [N.C6, N.E6, N.G6].forEach((f) => bell(b, { t, freq: f, dur: 1.4, gain: 0.09 }));
          bell(b, { t: t + 0.15, freq: N.C7, dur: 1.4, gain: 0.09 });
        },
      },
    },
  },
};

export const SFX_KINDS = Object.keys(SFX);

// 鳴らす。戻り値は長さ(秒)。鳴らせなければ 0。opts は種類ごとの追加情報(配る:{cards})
export function playSfx(bus, kind, variant, delay = 0, opts = {}) {
  const item = SFX[kind]?.items?.[variant];
  if (!item || !bus) return 0;
  item.play(bus, bus.ctx.currentTime + 0.02 + delay, opts);
  return item.len;
}

// 自分の番のお知らせ(小さな2音)
export function playTurn(bus) {
  const t = bus.ctx.currentTime + 0.02;
  tone(bus, { t, freq: 660, dur: 0.16, gain: 0.09, attack: 0.01 });
  tone(bus, { t: t + 0.09, freq: 880, dur: 0.2, gain: 0.09, attack: 0.01 });
}

// 一時的なまとまり(途中で止められる)。stop() で素早く消す
export function subBus(bus) {
  const { ctx } = bus;
  const out = ctx.createGain();
  const rev = ctx.createGain();
  out.connect(bus.out);
  rev.connect(bus.rev);
  return {
    bus: { ctx, out, rev, master: bus.master },
    stop() {
      const t = ctx.currentTime;
      for (const g of [out, rev]) {
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.08);
      }
      setTimeout(() => { out.disconnect(); rev.disconnect(); }, 200);
    },
  };
}
