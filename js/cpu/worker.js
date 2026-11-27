// CPU の先読みを画面とは別のスレッドで計算する(ホストの画面が固まらないように)
import { decide } from './search.js';

self.onmessage = (e) => {
  const { id, game, uid, hand, opts } = e.data;
  let action = null, error = null;
  try {
    action = decide(game, uid, hand, opts);
  } catch (err) {
    error = err.message || String(err);
  }
  self.postMessage({ id, action, error });
};
