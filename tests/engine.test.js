import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, dealGame, normalizeGame, serializeGame, activePlayers, RuleError } from '../js/engine.js';
import { legalPlays, interpretations } from '../js/rules.js';
import { makeDeck } from '../js/cards.js';

// テスト用:全員の手札を持つ「神の視点」ハーネス
function sim(order, hands, over = {}) {
  const game = normalizeGame({
    seq: 1, status: 'playing', gameNo: 1, order, first: order[0], turn: order[0],
    handCount: Object.fromEntries(order.map((u) => [u, hands[u].length])),
    effects: {}, ...over,
  });
  return { game, hands: structuredClone(hands), events: [] };
}
function act(s, uid, action, opts) {
  const out = applyAction(s.game, uid, action, s.hands[uid], opts);
  // Firebaseを通した往復を再現
  s.game = normalizeGame(JSON.parse(JSON.stringify(serializeGame(out.game))));
  if (out.hand) s.hands[uid] = out.hand;
  for (const { to, item } of out.inbox) if (item.kind === 'cards') s.hands[to] = [...s.hands[to], ...item.cards];
  s.events.push(...s.game.events);
  return s;
}
function autoBomb(s) {
  while (s.game.bombApply) {
    const u = Object.keys(s.game.bombApply.waiting)[0];
    act(s, u, { type: 'bombApply' });
  }
}
const fill = (n, base = ['S4', 'H4', 'D4', 'C4', 'S6', 'H6', 'D6', 'C6', 'S9', 'H9']) => base.slice(0, n);

test('パスが1周すると場が流れ、最後に出した人から', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S3', 'SK'], b: ['H4', 'D4'], c: ['C4', 'C6'] });
  act(s, 'a', { type: 'play', cards: ['S3'] });
  assert.equal(s.game.turn, 'b');
  act(s, 'b', { type: 'pass' });
  act(s, 'c', { type: 'pass' });
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'a');
});

test('パスした人も次の手番では出せる', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S3', 'S9'], b: ['H4', 'DK'], c: ['C5', 'C6'] });
  act(s, 'a', { type: 'play', cards: ['S3'] });
  act(s, 'b', { type: 'pass' });
  act(s, 'c', { type: 'play', cards: ['C5'] }); // 5スキップで a を飛ばす
  assert.equal(s.game.turn, 'b');
  act(s, 'b', { type: 'play', cards: ['DK'] });
  assert.equal(s.game.turn, 'c');
});

test('パスは何回でもできる', () => {
  const s = sim(['a', 'b'], { a: ['S3', 'S4', 'S5', 'S6', 'S9'], b: ['HK', 'HQ'] });
  for (let i = 0; i < 6; i++) {
    s.game.turn = 'b';
    s.game.field = [{ by: 'a', cards: ['S3'], type: 'single', size: 1, low: 3, jr: null }];
    s.game.lastBy = 'a';
    act(s, 'b', { type: 'pass' }); // 出せるカードがあってもパスできる
    assert.equal(s.game.turn, 'a');
  }
  // 親はパスできない
  assert.throws(() => act(s, 'a', { type: 'pass' }), RuleError);
});

test('階段の革命は同じマークの4枚以上だけ', () => {
  const s = sim(['a', 'b'], { a: ['S3', 'S4', 'H5', 'S6', 'C9'], b: ['HK'] });
  act(s, 'a', { type: 'play', cards: ['S3', 'S4', 'H5', 'S6'] });
  assert.equal(s.game.effects.revolution, false);
  const t = sim(['a', 'b'], { a: ['S3', 'S4', 'JK1', 'S6', 'C9'], b: ['HK'] });
  act(t, 'a', { type: 'play', cards: ['S3', 'S4', 'JK1', 'S6'] });
  assert.equal(t.game.effects.revolution, true); // ジョーカーはそのマークの代わり
});

test('最後に出した人が上がっていたら次の人から', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S3'], b: ['H4', 'D4'], c: ['C4', 'C6'] });
  act(s, 'a', { type: 'play', cards: ['S3'] });
  assert.deepEqual(s.game.finished, ['a']);
  act(s, 'b', { type: 'pass' });
  act(s, 'c', { type: 'pass' });
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'b');
});

test('8切りは場が流れて本人から(5スキップは起きない)', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S6', 'S7', 'S8', 'H3'], b: fill(3), c: fill(3) });
  act(s, 'a', { type: 'play', cards: ['S6', 'S7', 'S8'] });
  // 7渡しが先
  assert.equal(s.game.pending.type, 'seven');
  assert.equal(s.game.pending.to, 'b');
  act(s, 'a', { type: 'seven', cards: ['H3'] });
  assert.ok(s.hands.b.includes('H3'));
  assert.equal(s.game.handCount.b, 4);
  // a の手札が0 → 上がり、8切りで流れて次の人から
  assert.deepEqual(s.game.finished, ['a']);
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'b');
});

test('5スキップ:上がった人は数えず、パスした人は数える', () => {
  const s = sim(['a', 'b', 'c', 'd'], { a: ['S5', 'H5', 'SK'], b: fill(3), c: fill(3), d: fill(3) });
  act(s, 'a', { type: 'play', cards: ['S5', 'H5'] });
  // 2人飛ばし → d
  assert.equal(s.game.turn, 'd');
  // 一周して自分に戻るなら場が流れる
  const t = sim(['a', 'b', 'c'], { a: ['S5', 'H5', 'SK'], b: fill(3), c: fill(3) });
  act(t, 'a', { type: 'play', cards: ['S5', 'H5'] });
  assert.equal(t.game.field.length, 0);
  assert.equal(t.game.turn, 'a');
  // 上がった人は数えない
  const u = sim(['a', 'b', 'c', 'd'], { a: ['S5', 'SK'], b: fill(3), c: fill(3), d: fill(3) }, { finished: ['b'] });
  act(u, 'a', { type: 'play', cards: ['S5'] });
  assert.equal(u.game.turn, 'd');
});

test('革命と革命返し、場が流れても革命は続く', () => {
  const s = sim(['a', 'b'], { a: ['S9', 'ST', 'SJ', 'SQ', 'H3', 'H4', 'H5'], b: ['D8', 'D9', 'DT', 'DJ', 'C4'] });
  act(s, 'a', { type: 'play', cards: ['S9', 'ST', 'SJ', 'SQ'] });
  assert.equal(s.game.effects.revolution, true);
  // 10捨て → ボンバーの順
  assert.equal(s.game.pending.type, 'ten');
  act(s, 'a', { type: 'ten', cards: ['H5'] });
  assert.equal(s.game.pending.type, 'bomb');
  act(s, 'a', { type: 'bomb', ranks: ['K'] });
  autoBomb(s);
  assert.equal(s.game.elevenBack, undefined);
  assert.equal(s.game.effects.elevenBack, false);
  assert.equal(s.game.turn, 'b');
  act(s, 'b', { type: 'play', cards: ['D8', 'D9', 'DT', 'DJ'] });
  assert.equal(s.game.effects.revolution, false);
});

test('11バックは場が流れると戻る。革命中は打ち消し合う', () => {
  const s = sim(['a', 'b'], { a: ['SJ', 'S3', 'S4'], b: ['H3', 'HK', 'HA'] });
  act(s, 'a', { type: 'play', cards: ['SJ'] });
  assert.equal(s.game.effects.elevenBack, true);
  // 逆転中なので3が出せる
  act(s, 'b', { type: 'play', cards: ['H3'] });
  act(s, 'a', { type: 'pass' });
  assert.equal(s.game.effects.elevenBack, false);
  assert.equal(s.game.turn, 'b');
});

test('数字縛りと次がないときの自動流れ', () => {
  const s = sim(['a', 'b', 'c'], { a: ['SA', 'S5'], b: ['H2', 'H6'], c: ['C3', 'C7'] });
  s.game.field = [{ by: 'c', cards: ['CK'], type: 'single', size: 1, low: 13, jr: null }];
  s.game.lastBy = 'c';
  act(s, 'a', { type: 'play', cards: ['SA'] });
  assert.equal(s.game.effects.numberLock, true);
  act(s, 'b', { type: 'play', cards: ['H2'] });
  // 2の次はない → 流れて b から
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'b');
});

test('マーク縛りは場が流れたら解除', () => {
  const s = sim(['a', 'b'], { a: ['HA', 'SA', 'H3'], b: ['H2', 'S2', 'D2', 'C2', 'DK'] });
  s.game.field = [{ by: 'b', cards: ['HK', 'SK'], type: 'group', size: 2, low: 13, jr: null }];
  s.game.lastBy = 'b';
  act(s, 'a', { type: 'play', cards: ['HA', 'SA'] });
  assert.deepEqual(s.game.effects.suitLock, ['H', 'S']);
  assert.equal(s.game.effects.numberLock, true);
  assert.throws(() => act(s, 'b', { type: 'play', cards: ['D2', 'C2'] }), RuleError);
  act(s, 'b', { type: 'play', cards: ['H2', 'S2'] });
  // 2の次の数字はないので自動で流れる
  assert.equal(s.game.effects.suitLock, null);
  assert.equal(s.game.turn, 'b');
});

test('12ボンバー:複数人同時に上がったら出した人から順位', () => {
  const s = sim(['a', 'b', 'c', 'd'], { a: ['SQ', 'S9'], b: ['H3', 'H4'], c: ['C3'], d: ['D3', 'D9'] });
  s.game.turn = 'a';
  act(s, 'a', { type: 'play', cards: ['SQ'] });
  assert.equal(s.game.pending.type, 'bomb');
  act(s, 'a', { type: 'bomb', ranks: ['3'] });
  // a は適用済み、b,c,d を待つ
  assert.deepEqual(Object.keys(s.game.bombApply.waiting).sort(), ['b', 'c', 'd']);
  act(s, 'd', { type: 'bombApply' });
  act(s, 'c', { type: 'bombApply' });
  act(s, 'b', { type: 'bombApply' });
  assert.equal(s.game.bombApply, null);
  assert.deepEqual(s.game.finished, ['c']);
  assert.equal(s.game.handCount.b, 1);
  assert.equal(s.game.turn, 'b');
  // 2つ指定で b と d が同時に上がる
  const t = sim(['a', 'b', 'c', 'd'], { a: ['SQ', 'HQ', 'S9'], b: ['H3', 'H4'], c: ['CK'], d: ['D3', 'D4'] }, { turn: 'c' });
  t.game.turn = 'a';
  act(t, 'a', { type: 'play', cards: ['SQ', 'HQ'] });
  act(t, 'a', { type: 'bomb', ranks: ['3', '4'] });
  autoBomb(t);
  assert.deepEqual(t.game.finished, ['b', 'd']);
});

test('ボンバーで自分の数字を消して上がることもある', () => {
  const s = sim(['a', 'b', 'c'], { a: ['SQ', 'S9'], b: ['H3', 'H4'], c: ['C3', 'C5'] });
  act(s, 'a', { type: 'play', cards: ['SQ'] });
  act(s, 'a', { type: 'bomb', ranks: ['9'] });
  autoBomb(s);
  assert.deepEqual(s.game.finished, ['a']);
  assert.equal(s.game.turn, 'b');
});

test('都落ち', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S3', 'S4'], b: ['H5'], c: ['C6', 'C7'] }, { prevDaifugo: 'a', turn: 'b' });
  act(s, 'b', { type: 'play', cards: ['H5'] });
  assert.equal(s.game.ochi, 'a');
  assert.equal(s.game.status, 'result');
  assert.deepEqual(s.game.result.ranking, ['b', 'c', 'a']);
  assert.equal(s.game.result.titles.a, 'daihinmin');
  assert.equal(s.game.result.delta.b, 2);
});

test('スペ3返しの後は場が流れる', () => {
  const s = sim(['a', 'b'], { a: ['JK1', 'S4'], b: ['S3', 'H9'] });
  act(s, 'a', { type: 'play', cards: ['JK1'] });
  act(s, 'b', { type: 'play', cards: ['S3'] });
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'b');
});

test('7渡しの相手が上がっていたら次の人', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S7', 'S9'], b: [], c: ['C4', 'C6'] }, { finished: ['b'] });
  act(s, 'a', { type: 'play', cards: ['S7'] });
  assert.equal(s.game.pending.to, 'c');
});

test('配札の枚数とダイヤの3', () => {
  for (let n = 2; n <= 8; n++) {
    const order = Array.from({ length: n }, (_, i) => 'p' + i);
    const { game, hands } = dealGame({ order });
    const counts = order.map((u) => hands[u].length);
    const total = counts.reduce((a, b) => a + b, 0);
    assert.equal(total, n === 2 ? 40 : 53);
    if (n >= 3) {
      assert.ok(hands[game.first].includes('D3'));
      assert.equal(hands[game.first].length, Math.max(...counts));
    }
    const all = order.flatMap((u) => hands[u]);
    assert.equal(new Set(all).size, all.length);
  }
});

test('2ゲーム目:大貧民から、カード交換', () => {
  const order = ['a', 'b', 'c', 'd'];
  const prevTitles = { a: 'daifugo', b: 'fugo', c: 'hinmin', d: 'daihinmin' };
  const { game, hands, inbox } = dealGame({ order, gameNo: 2, prevTitles });
  assert.equal(game.status, 'exchange');
  assert.equal(game.first, 'd');
  assert.equal(inbox.a[0].cards.length, 2);
  assert.equal(inbox.b[0].cards.length, 1);
  const s = { game: normalizeGame(game), hands: structuredClone(hands), events: [] };
  for (const it of inbox.a) if (it.kind === 'cards') s.hands.a.push(...it.cards);
  for (const it of inbox.b) if (it.kind === 'cards') s.hands.b.push(...it.cards);
  assert.equal(s.game.handCount.a, s.hands.a.length);
  act(s, 'a', { type: 'exchangeReturn', cards: s.hands.a.slice(0, 2) });
  assert.equal(s.game.status, 'exchange');
  act(s, 'b', { type: 'exchangeReturn', cards: s.hands.b.slice(0, 1) });
  assert.equal(s.game.status, 'playing');
  assert.equal(s.game.turn, 'd');
  for (const u of order) assert.equal(s.game.handCount[u], s.hands[u].length);
});

// ランダムに最後まで遊ばせて不変条件を確かめる
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function randomGame(n, seed, gameNo = 1, prevTitles = {}) {
  const r = rng(seed);
  const order = Array.from({ length: n }, (_, i) => 'p' + i);
  const d = dealGame({ order, rng: r, gameNo, prevTitles });
  const s = { game: normalizeGame(d.game), hands: d.hands, events: [] };
  for (const u of order) for (const it of d.inbox[u] || []) if (it.kind === 'cards') s.hands[u].push(...it.cards);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let guard = 0;
  while (s.game.status !== 'result') {
    if (++guard > 5000) throw new Error('終わらない');
    const g = s.game;
    for (const u of order) assert.equal(g.handCount[u], s.hands[u].length, `count ${u}`);
    if (g.status === 'exchange') {
      const [u, it] = Object.entries(g.exchange).find(([, x]) => !x.done);
      act(s, u, { type: 'exchangeReturn', cards: s.hands[u].slice(0, it.count) });
      continue;
    }
    if (g.bombApply) {
      act(s, Object.keys(g.bombApply.waiting)[0], { type: 'bombApply' });
      continue;
    }
    if (g.pending) {
      const p = g.pending;
      if (p.type === 'bomb') {
        const ranks = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2', 'JK'].sort(() => r() - 0.5).slice(0, p.count);
        act(s, p.uid, { type: 'bomb', ranks });
      } else act(s, p.uid, { type: p.type, cards: s.hands[p.uid].slice(0, p.count) });
      continue;
    }
    const u = g.turn;
    const top = g.field[g.field.length - 1] || null;
    const lp = legalPlays(s.hands[u], top, g.effects);
    if (lp.any && (r() < 0.8 || g.field.length === 0)) {
      const cards = pick(lp.plays);
      const opts = interpretations(cards);
      act(s, u, { type: 'play', cards, interp: pick(opts).key });
    } else {
      act(s, u, { type: 'pass' });
    }
  }
  const res = s.game.result;
  assert.equal(res.ranking.length, n);
  assert.equal(new Set(res.ranking).size, n);
  return s;
}

test('ランダム対戦(2〜8人 × 多数)', () => {
  let seed = 1;
  for (let n = 2; n <= 8; n++) {
    for (let k = 0; k < 40; k++) {
      const s = randomGame(n, seed++);
      const titles = s.game.result.titles;
      randomGame(n, seed++, 2, titles);
    }
  }
});

test('Firebaseの往復で状態が壊れない', () => {
  const d = dealGame({ order: ['a', 'b', 'c'] });
  const g = normalizeGame(JSON.parse(JSON.stringify(d.game)));
  assert.deepEqual(g.field, []);
  assert.equal(activePlayers(g).length, 3);
  assert.equal(makeDeck().length, 53);
});
