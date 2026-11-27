import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBgmPlayer } from '../js/ui/bgm.js';

function setup() {
  let now = 10000;
  const audios = [];
  const gains = [];
  const makeContext = () => ({
    state: 'running', currentTime: 0, destination: {},
    createMediaElementSource() { return { connect(node) { return node; }, disconnect() {} }; },
    createGain() {
      const node = { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} };
      gains.push(node);
      return node;
    },
  });
  let context = makeContext();
  const player = createBgmPlayer({
    url: 'bgm.m4a', getContext: () => context, ensureContext() {},
    makeAudio() {
      const listeners = new Map();
      const audio = {
        duration: NaN, currentTime: 0, paused: true, plays: [],
        addEventListener(name, fn) { listeners.set(name, fn); },
        removeEventListener(name) { listeners.delete(name); },
        play() { this.plays.push(this.currentTime); this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        removeAttribute() {}, load() {},
        ready() { this.duration = 1800; listeners.get('loadedmetadata')?.(); },
      };
      audios.push(audio);
      return audio;
    },
  });
  player.setClock(() => now);
  return { player, audios, gains, tick(value) { now += value; }, replaceContext() { context = makeContext(); } };
}

test('待合室からの開始は読み込みに時間がかかっても冒頭から再生する', async () => {
  const { player, audios, tick } = setup();
  player.play(10000, { fresh: true, roomId: 'a' });
  tick(8000);
  audios[0].ready();
  await Promise.resolve();
  assert.deepEqual(audios[0].plays, [0]);
  audios[0].currentTime = 12;
  player.sync();
  player.play(10000, { fresh: true, roomId: 'a' });
  assert.equal(audios[0].currentTime, 12);
  assert.equal(audios[0].plays.length, 1);
});

test('別の部屋・次のゲームでは前の音を即座に止めて冒頭に戻す', async () => {
  const { player, audios, gains } = setup();
  player.play(10000, { fresh: true, roomId: 'a' });
  audios[0].ready();
  await Promise.resolve();
  audios[0].currentTime = 80;
  player.stop();
  assert.equal(audios[0].paused, true);
  assert.equal(gains[0].gain.value, 0);
  player.play(10000, { fresh: true, roomId: 'b' });
  assert.deepEqual(audios[0].plays, [0, 0]);
  assert.equal(gains.length, 1);
  await Promise.resolve();
  audios[0].currentTime = 40;
  player.play(11000, { fresh: true, roomId: 'b' });
  assert.deepEqual(audios[0].plays, [0, 0, 0]);
});

test('オン・オフと画面復帰はその端末の再生位置を保持し、他端末に影響しない', async () => {
  const a = setup();
  const b = setup();
  for (const item of [a, b]) {
    item.player.play(10000, { fresh: true });
    item.audios[0].ready();
  }
  await Promise.resolve();
  a.audios[0].currentTime = 27;
  a.player.enabled = false;
  assert.equal(a.audios[0].paused, true);
  assert.equal(b.audios[0].paused, false);
  a.player.enabled = true;
  assert.equal(a.audios[0].plays.at(-1), 27);
  await Promise.resolve();
  a.player.suspend();
  a.player.sync();
  assert.equal(a.audios[0].plays.at(-1), 27);
});

test('途中参加時は開始時刻に対応した位置から再生し、音声復旧でも位置を保持する', async () => {
  const { player, audios, replaceContext } = setup();
  player.play(3000, { roomId: 'a' });
  audios[0].ready();
  assert.deepEqual(audios[0].plays, [7]);
  await Promise.resolve();
  audios[0].currentTime = 19;
  replaceContext();
  player.sync();
  assert.equal(audios[0].paused, true);
  audios[1].ready();
  assert.deepEqual(audios[1].plays, [19]);
});

test('古い再生要求の失敗が次のゲームを停止しない', async () => {
  const { player, audios } = setup();
  player.unlock();
  await Promise.resolve();
  let rejectOld;
  audios[0].play = function () {
    this.paused = false;
    return new Promise((resolve, reject) => { rejectOld = reject; });
  };
  player.play(10000, { fresh: true });
  audios[0].ready();
  const oldReject = rejectOld;
  player.stop();
  audios[0].play = function () { this.paused = false; return Promise.resolve(); };
  player.play(11000, { fresh: true });
  oldReject(new Error('古い再生が中断された'));
  await Promise.resolve();
  assert.equal(audios[0].paused, false);
});
