// Firebase Realtime Database + 匿名認証のバックエンド
const V = '10.14.1';
const base = `https://www.gstatic.com/firebasejs/${V}`;

// mods: テストなどでSDKを差し替えるとき用 { app, auth, db, setup(auth, db) }
export async function createFirebaseBackend(config, mods = null) {
  const [{ initializeApp }, authMod, dbMod] = mods
    ? [mods.app, mods.auth, mods.db]
    : await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-database.js`),
      ]);
  const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  const {
    getDatabase, ref, onValue, update, get, runTransaction, push, serverTimestamp, increment,
    onDisconnect, set, query, orderByChild, endAt, limitToFirst,
  } = dbMod;
  const app = initializeApp(config, mods?.name);
  const auth = getAuth(app);
  const db = getDatabase(app);
  mods?.setup?.(auth, db);

  const uid = await new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (user) => {
      if (user) { off(); resolve(user.uid); }
    });
    signInAnonymously(auth).catch(reject);
  });

  let presenceOff = null;
  return {
    kind: 'firebase',
    uid,
    serverTime: () => serverTimestamp(),
    increment: (n) => increment(n),
    newKey: () => push(ref(db, 'keys')).key,
    on(path, cb, onError) {
      return onValue(ref(db, path), (snap) => cb(snap.val()), (e) => onError?.(e));
    },
    async get(path) {
      return (await get(ref(db, path))).val();
    },
    update(paths) {
      return update(ref(db), paths);
    },
    async createIfAbsent(path, value) {
      const r = await runTransaction(ref(db, path), (cur) => (cur === null ? value : undefined), { applyLocally: false });
      return r.committed;
    },
    // 在室管理:接続中は online=true、切断で false
    presence(path) {
      presenceOff?.();
      const conn = ref(db, '.info/connected');
      presenceOff = onValue(conn, async (snap) => {
        if (snap.val() !== true) return;
        try {
          await onDisconnect(ref(db, path)).set(false);
          await set(ref(db, path), true);
        } catch (e) { /* 退出済みなど */ }
      });
    },
    async clearPresence(path) {
      presenceOff?.();
      presenceOff = null;
      if (path) await onDisconnect(ref(db, path)).cancel().catch(() => {});
    },
    async queryOlder(path, child, before, limit) {
      const q = query(ref(db, path), orderByChild(child), endAt(before), limitToFirst(limit));
      return (await get(q)).val() || {};
    },
  };
}
