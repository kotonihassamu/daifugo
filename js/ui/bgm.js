// 端末ごとのBGM。ゲーム更新では再生位置を動かさず、同じメディアを再利用する。
export function createBgmPlayer({ url, getContext, ensureContext, makeAudio = (url) => new Audio(url) }) {
  let audio = null;
  let source = null;
  let gain = null;
  let context = null;
  let enabled = true;
  let want = false;
  let hidden = false;
  let session = null;
  let pendingPosition = null;
  let clock = () => Date.now();
  let attempt = null;
  let generation = 0;

  function prepare() {
    if (audio) return;
    audio = makeAudio(url);
    audio.preload = 'auto';
    audio.loop = true;
    audio.addEventListener('loadedmetadata', sync);
  }

  function pause() {
    generation++;
    attempt = null;
    audio?.pause();
    if (gain && context) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime);
    }
  }

  function sync() {
    if (!want || !enabled || hidden || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return pause();
    prepare();
    const nextContext = getContext();
    if (!nextContext || nextContext.state !== 'running') return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    if (context !== nextContext) {
      // MediaElementSourceは別のAudioContextへ付け替えられない。
      if (source) {
        const position = pendingPosition ?? audio.currentTime;
        pause();
        audio.removeEventListener('loadedmetadata', sync);
        audio.removeAttribute('src');
        audio.load();
        source.disconnect();
        gain.disconnect();
        audio = source = gain = context = null;
        pendingPosition = position;
        prepare();
        return;
      }
      context = nextContext;
      source = context.createMediaElementSource(audio);
      gain = context.createGain();
      source.connect(gain).connect(context.destination);
    }
    if (pendingPosition !== null) {
      // 読み込みを待った時間は加算しない。新しいゲームは必ず冒頭から。
      audio.currentTime = pendingPosition % audio.duration;
      pendingPosition = null;
    }
    if (attempt || !audio.paused) return;
    const token = ++generation;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(0.32, context.currentTime);
    const playingAudio = audio;
    attempt = Promise.resolve(playingAudio.play());
    attempt.then(() => {
      if (token !== generation) return;
      attempt = null;
    }, () => {
      if (token !== generation) return;
      attempt = null; // 次のタップで再試行する。
      playingAudio.pause();
      gain.gain.setValueAtTime(0, context.currentTime);
    });
  }

  return {
    get enabled() { return enabled; },
    set enabled(value) {
      enabled = !!value;
      sync();
    },
    setClock(fn) { clock = fn; },
    play(startedAt, { fresh = false, roomId = '' } = {}) {
      const key = `${roomId}:${startedAt}`;
      if (want && session === key) return;
      pause();
      session = key;
      want = true;
      pendingPosition = fresh ? 0 : Math.max(0, (clock() - startedAt) / 1000);
      ensureContext();
      sync();
    },
    stop() {
      want = false;
      session = null;
      pendingPosition = 0;
      pause();
    },
    suspend() { hidden = true; pause(); },
    sync() { hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'; sync(); },
    unlock() {
      prepare(); // 待合室で読み込みを始める。
      if (audio.paused && !attempt) {
        // iPhoneでもゲーム開始通知のあとに再生できるよう、操作中に許可を得る。
        audio.muted = true;
        Promise.resolve(audio.play()).catch(() => {});
        audio.pause();
        audio.muted = false;
      }
      if (want) sync();
    },
    debug() { return { bgm: !!audio && !audio.paused, bgmLoaded: !!audio && Number.isFinite(audio.duration), bgmWant: want, bgmEnabled: enabled }; },
  };
}
