// デモ用ローカルバックエンド:同じブラウザのタブ同士で同期する(Firebase未設定でも遊べる)
// localStorage に全データを置き、BroadcastChannel で変更を通知する。タブごとに別のプレイヤーになる。
const KEY = 'daifugo-local-db';
const SV_TIME = { '.sv': 'timestamp' };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(tree) {
  localStorage.setItem(KEY, JSON.stringify(tree));
}
function split(path) {
  return path.split('/').filter(Boolean);
}
function getAt(tree, path) {
  let cur = tree;
  for (const k of split(path)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur ?? null;
}
// Firebaseと同じく null と空のオブジェクト/配列は保存しない
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(prune);
    if (a.every((x) => x === undefined)) return undefined;
    return a.map((x) => (x === undefined ? null : x));
  }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
function resolveValue(v, old) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v['.sv'] === 'timestamp') return Date.now();
    if (v['.inc'] !== undefined) return (typeof old === 'number' ? old : 0) + v['.inc'];
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = resolveValue(x, old?.[k]);
    return o;
  }
  if (Array.isArray(v)) return v.map((x, i) => resolveValue(x, old?.[i]));
  return v;
}
function setAt(tree, path, value) {
  const ks = split(path);
  let cur = tree;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  const last = ks[ks.length - 1];
  const v = prune(resolveValue(value, cur[last]));
  if (v === undefined) delete cur[last];
  else cur[last] = v;
}

export function createLocalBackend() {
  let uid = sessionStorage.getItem('daifugo-local-uid');
  if (!uid) {
    uid = 'L' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('daifugo-local-uid', uid);
  }
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel('daifugo-local') : null;
  const listeners = new Set();
  const notify = () => {
    const tree = load();
    for (const l of listeners) {
      const v = getAt(tree, l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) {
        l.last = s;
        try { l.cb(v == null ? null : JSON.parse(s)); } catch (e) { console.error(e); }
      }
    }
  };
  ch?.addEventListener('message', notify);
  window.addEventListener('storage', (e) => { if (e.key === KEY) notify(); });
  let presencePath = null;
  window.addEventListener('pagehide', () => {
    if (!presencePath) return;
    const tree = load();
    if (getAt(tree, presencePath.replace(/\/online$/, ''))) {
      setAt(tree, presencePath, false);
      save(tree);
      ch?.postMessage('x');
    }
  });

  const self = {
    kind: 'local',
    uid,
    serverTime: () => SV_TIME,
    increment: (n) => ({ '.inc': n }),
    newKey: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    on(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      setTimeout(notify, 0);
      return () => listeners.delete(l);
    },
    async get(path) {
      return getAt(load(), path);
    },
    async update(paths) {
      await new Promise((r) => setTimeout(r, 30)); // 通信の遅れを少しだけ再現
      const tree = load();
      // セキュリティルールの seq チェックを再現(同時操作の検出)
      for (const [p, v] of Object.entries(paths)) {
        const m = p.match(/^rooms\/[^/]+\/game$/);
        if (m && v) {
          const old = getAt(tree, p);
          const ok = old ? v.seq === old.seq + 1 : v.seq >= 1;
          if (!ok || v.actor !== uid) {
            const e = new Error('PERMISSION_DENIED');
            e.code = 'PERMISSION_DENIED';
            throw e;
          }
        }
      }
      for (const [p, v] of Object.entries(paths)) setAt(tree, p, v);
      save(tree);
      ch?.postMessage('x');
      notify();
    },
    async createIfAbsent(path, value) {
      const tree = load();
      if (getAt(tree, path) != null) return false;
      setAt(tree, path, value);
      save(tree);
      ch?.postMessage('x');
      return true;
    },
    presence(path) {
      presencePath = path;
      self.update({ [path]: true });
    },
    async clearPresence() {
      presencePath = null;
    },
    async queryOlder(path, child, before, limit) {
      const v = getAt(load(), path) || {};
      return Object.fromEntries(Object.entries(v).filter(([, x]) => (x?.[child] ?? 0) <= before).slice(0, limit));
    },
    reset() {
      localStorage.removeItem(KEY);
    },
  };
  return self;
}
