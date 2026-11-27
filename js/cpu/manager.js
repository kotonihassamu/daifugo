// ホストの端末で CPU を動かす(待合室の「CPUを追加」)。
// CPU ごとに別のログイン(別ID)で、人と同じように部屋へ参加する。手札は CPU ごとに分かれていて、ホストにも見えない。
// 端末に「この部屋で動かしている CPU」を覚えておき、再読み込みしても同じ席で動き続ける。
import { RoomController } from '../room.js';
import { CpuPlayer } from './player.js';
import { decide } from './search.js';

const STORE = 'daifugo-cpus';

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function writeStore(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch {}
}

// 先読みは Worker で計算する。使えない環境ではその場で計算する
function makeDecider() {
  let worker = null;
  try {
    const url = new URL('./worker.js' + new URL(import.meta.url).search, import.meta.url);
    worker = new Worker(url, { type: 'module' });
  } catch {
    worker = null;
  }
  let seq = 0;
  const waiting = new Map();
  worker?.addEventListener('message', (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error) w.reject(new Error(e.data.error));
    else w.resolve(e.data.action);
  });
  worker?.addEventListener('error', () => {
    worker = null;
    for (const w of waiting.values()) w.reject(new Error('worker'));
    waiting.clear();
  });
  return (game, uid, hand, opts) => {
    if (!worker) return Promise.resolve(decide(game, uid, hand, opts));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, game: JSON.parse(JSON.stringify(game)), uid, hand, opts });
      // 念のため:返事がなければその場で計算
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        try { resolve(decide(game, uid, hand, { ...opts, timeMs: 300 })); } catch (e) { reject(e); }
      }, (opts.timeMs || 1200) + 4000);
    });
  };
}

export class CpuManager extends EventTarget {
  // makeBackend(name) → Promise<backend>(Firebase なら別アプリ名、デモなら別ID)
  constructor(makeBackend) {
    super();
    this.makeBackend = makeBackend;
    this.running = new Map(); // key → CpuPlayer
    this.decideAsync = null;
    this.logs = [];
  }

  log(msg) {
    this.logs.push(msg);
    if (this.logs.length > 50) this.logs.shift();
    this.dispatchEvent(new CustomEvent('log', { detail: msg }));
  }

  // この部屋で、この端末が動かしている CPU の数
  countFor(roomId) {
    return [...this.running.values()].filter((p) => p.roomId === roomId && !p.stopped).length;
  }

  async add(roomId, name) {
    const store = readStore();
    const list = store[roomId] || [];
    const key = `cpu-${roomId}-${Date.now().toString(36)}`;
    list.push({ key, name });
    store[roomId] = list;
    writeStore(store);
    await this.start(roomId, key, name);
  }

  async start(roomId, key, name) {
    if (this.running.has(key)) return;
    this.decideAsync ||= makeDecider();
    const backend = await this.makeBackend(key);
    const ctrl = new RoomController(backend);
    await ctrl.join(roomId, name, { cpu: true });
    const p = new CpuPlayer(name, ctrl, { decideAsync: this.decideAsync, log: (m) => this.log(m) });
    p.roomId = roomId;
    p.key = key;
    p.onStop = () => {
      this.running.delete(key);
      this.forget(roomId, key);
      this.dispatchEvent(new Event('change'));
    };
    this.running.set(key, p);
    p.start();
    this.log(`[${name}] 参加しました`);
    this.dispatchEvent(new Event('change'));
  }

  forget(roomId, key) {
    const store = readStore();
    store[roomId] = (store[roomId] || []).filter((x) => x.key !== key);
    if (!store[roomId].length) delete store[roomId];
    writeStore(store);
  }

  // 再読み込みのあと、この端末で動かしていた CPU を同じ席で再開する
  async restore(roomId) {
    const list = readStore()[roomId] || [];
    for (const { key, name } of list) {
      try {
        await this.start(roomId, key, name);
      } catch (e) {
        this.forget(roomId, key);
      }
    }
  }

  // 部屋を出るとき:CPU も退出させる
  async stopAll(roomId, { leave = true } = {}) {
    for (const p of [...this.running.values()]) {
      if (roomId && p.roomId !== roomId) continue;
      p.stopped = true;
      if (leave) await p.ctrl.leave().catch(() => {});
      else p.ctrl.unsubscribe();
      this.running.delete(p.key);
      if (leave) this.forget(p.roomId, p.key);
    }
    this.dispatchEvent(new Event('change'));
  }
}
