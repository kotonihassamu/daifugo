import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, dealGame, normalizeGame, serializeGame, activePlayers, RuleError, exchangeChoice } from '../js/engine.js';
import { legalPlays, interpretations, canPlay, forbiddenFinish } from '../js/rules.js';
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

test('階段は同じマークの3枚以上、4枚以上なら革命', () => {
  const s = sim(['a', 'b'], { a: ['S3', 'S4', 'H5', 'S6', 'C9'], b: ['HK'] });
  assert.throws(() => act(s, 'a', { type: 'play', cards: ['S3', 'S4', 'H5', 'S6'] }), RuleError); // マークが混ざった階段は出せない
  const u = sim(['a', 'b'], { a: ['S3', 'S4', 'S5', 'C9'], b: ['HK'] });
  act(u, 'a', { type: 'play', cards: ['S3', 'S4', 'S5'] });
  assert.equal(u.game.effects.revolution, false); // 3枚は革命なし
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
  const s = sim(['a', 'b'], { a: ['S9', 'ST', 'SJ', 'SQ', 'H3', 'H4', 'H5'], b: ['D8', 'D9', 'DT', 'DJ', 'C4', 'C6'] });
  act(s, 'a', { type: 'play', cards: ['S9', 'ST', 'SJ', 'SQ'] });
  assert.equal(s.game.effects.revolution, true);
  // 10捨て → ボンバーの順
  assert.equal(s.game.pending.type, 'ten');
  act(s, 'a', { type: 'ten', cards: ['H5'] });
  assert.equal(s.game.pending.type, 'bomb');
  act(s, 'a', { type: 'bomb', ranks: ['K'] });
  autoBomb(s);
  // ボンバーの数字は場が流れるまでメモとして残る
  assert.deepEqual(s.game.bombNotes, [{ by: 'a', ranks: ['K'] }]);
  assert.equal(s.game.elevenBack, undefined);
  assert.equal(s.game.effects.elevenBack, false);
  assert.equal(s.game.turn, 'b');
  act(s, 'b', { type: 'play', cards: ['D8', 'D9', 'DT', 'DJ'] });
  assert.equal(s.game.effects.revolution, false);
  // 10捨てのあと8切りで流れたらメモも消える
  assert.equal(s.game.pending.type, 'ten');
  assert.equal(s.game.bombNotes.length, 1);
  act(s, 'b', { type: 'ten', cards: ['C4'] });
  assert.equal(s.game.field.length, 0);
  assert.deepEqual(s.game.bombNotes, []);
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

test('数字縛りで次の数字がなくても、ジョーカーは出せる(すぐには流れない)', () => {
  const s = sim(['a', 'b', 'c'], { a: ['SA', 'S5'], b: ['H2', 'H6'], c: ['JK1', 'C7'] });
  s.game.field = [{ by: 'c', cards: ['CK'], type: 'single', size: 1, low: 13, jr: [] }];
  s.game.lastBy = 'c';
  act(s, 'a', { type: 'play', cards: ['SA'] });
  assert.equal(s.game.effects.numberLock, true);
  act(s, 'b', { type: 'play', cards: ['H2'] });
  // 以前はここで場が流れてしまい、ジョーカーを持つ c に番が来なかった
  assert.equal(s.game.field.length, 3);
  assert.equal(s.game.turn, 'c');
  act(s, 'c', { type: 'play', cards: ['JK1'] });
  assert.equal(s.game.turn, 'a');
  // 出せない人がパスして一周すれば流れる
  act(s, 'a', { type: 'pass' });
  act(s, 'b', { type: 'pass' });
  assert.equal(s.game.field.length, 0);
  assert.equal(s.game.turn, 'c');
});

test('禁止上がり:最後の1手に 2・ジョーカー・8・スペ3返し は出せない', () => {
  const field = (cards, type = 'single', low) => [{ by: 'x', cards, type, size: cards.length, low, jr: [] }];
  const blocked = (hand, play, over = {}) => {
    const s = sim(['a', 'b'], { a: hand, b: ['C4', 'C9'] }, over);
    assert.throws(() => act(s, 'a', { type: 'play', cards: play }), /禁止上がり/);
  };
  blocked(['H2'], ['H2']);
  blocked(['S2', 'H2'], ['S2', 'H2']);
  blocked(['JK1'], ['JK1']);
  blocked(['H5', 'JK1'], ['H5', 'JK1']); // ペアの中のジョーカーも
  blocked(['S8'], ['S8']);
  blocked(['S6', 'S7', 'S8'], ['S6', 'S7', 'S8']); // 階段の中の8も
  blocked(['S3'], ['S3'], { field: field(['JK1'], 'single', 16), lastBy: 'b' }); // スペ3返し
  blocked(['H3'], ['H3'], { effects: { revolution: true } }); // 革命中は3
  // 上がれる例
  const ok = (hand, play, over = {}) => {
    const s = sim(['a', 'b'], { a: hand, b: ['C4', 'C9'] }, over);
    act(s, 'a', { type: 'play', cards: play });
    assert.deepEqual(s.game.finished.slice(0, 1), ['a']);
  };
  ok(['H2'], ['H2'], { effects: { revolution: true } }); // 革命中の2はOK
  ok(['H3'], ['H3'], { effects: { elevenBack: true } }); // 11バック中の3はOK
  ok(['S3'], ['S3']); // 親で♠3を出して上がるのはOK
  // 最後の1手でなければ出せる
  const s = sim(['a', 'b'], { a: ['H2', 'H5'], b: ['C4', 'C9'] });
  act(s, 'a', { type: 'play', cards: ['H2'] });
  assert.equal(s.game.handCount.a, 1);
});

test('禁止上がり:7渡し・10捨て・ボンバーで手札がなくなるのは普通の上がり', () => {
  const s = sim(['a', 'b', 'c'], { a: ['S7', 'H2'], b: ['C4', 'C9'], c: ['D4', 'D9'] });
  act(s, 'a', { type: 'play', cards: ['S7'] });
  act(s, 'a', { type: 'seven', cards: ['H2'] });
  assert.deepEqual(s.game.finished, ['a']);
});

test('禁止カードしか残っていない親はパスでき、親が次の人に移る', () => {
  const s = sim(['a', 'b', 'c'], { a: ['H2'], b: ['C4', 'C9'], c: ['D4', 'D9'] });
  assert.equal(legalPlays(['H2'], null, {}).any, false);
  act(s, 'a', { type: 'pass' });
  assert.equal(s.game.turn, 'b');
  assert.equal(s.game.field.length, 0);
  // 出せる手がある親はパスできない
  assert.throws(() => act(s, 'b', { type: 'pass' }), RuleError);
});

test('残った全員が禁止カードしかないときは、そこで終了(席順)', () => {
  // 2枚以上あれば上がらない1枚が出せるので、詰むのは最後の1枚が禁止カードのときだけ
  const s = sim(['a', 'b', 'c'], { a: ['H2'], b: ['JK1'], c: [] }, { finished: ['c'] });
  act(s, 'a', { type: 'pass' });
  assert.equal(s.game.status, 'playing');
  act(s, 'b', { type: 'pass' });
  assert.equal(s.game.status, 'result');
  assert.deepEqual(s.game.result.ranking, ['c', 'a', 'b']);
});

test('数字縛りなしの部屋では、1つ強い数字を出しても縛りにならない', () => {
  const s = sim(['a', 'b', 'c'], { a: ['SA', 'S5'], b: ['H2', 'H6'], c: ['C3', 'C7'] }, { rules: { numberLock: false } });
  s.game.field = [{ by: 'c', cards: ['CK'], type: 'single', size: 1, low: 13, jr: [] }];
  s.game.lastBy = 'c';
  act(s, 'a', { type: 'play', cards: ['SA'] });
  assert.equal(s.game.effects.numberLock, false);
  // 縛りがないので2以外も出せる(Aより強い2)
  act(s, 'b', { type: 'play', cards: ['H2'] });
  assert.equal(s.game.effects.numberLock, false);
  const d = dealGame({ order: ['a', 'b'], numberLock: false });
  assert.equal(d.game.rules.numberLock, false);
  assert.equal(dealGame({ order: ['a', 'b'] }).game.rules.numberLock, true);
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
  act(s, 'a', { type: 'pass' }); // 出せないのでパス → 一周して流れる
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
    const jokers = n % 3; // 0〜2枚を順に試す
    const { game, hands } = dealGame({ order, jokers });
    const counts = order.map((u) => hands[u].length);
    const total = counts.reduce((a, b) => a + b, 0);
    assert.equal(total, n === 2 ? 40 : 52 + jokers);
    assert.equal(game.rules.jokers, jokers);
    if (n >= 3) {
      assert.ok(hands[game.first].includes('D3'));
      assert.equal(hands[game.first].length, Math.max(...counts));
    }
    const all = order.flatMap((u) => hands[u]);
    assert.equal(new Set(all).size, all.length);
  }
});

test('カード交換で渡すカード:強い数字から。境目の数字はマークを選べる', () => {
  // 2が2枚、1枚渡す → どちらの2か選ぶ
  assert.deepEqual(exchangeChoice(['S2', 'H2', 'SA', 'D3'], 1), { forced: [], options: ['S2', 'H2'], pick: 1 });
  // ジョーカーとAが2枚、2枚渡す → ジョーカーは必ず、Aはどちらか
  assert.deepEqual(exchangeChoice(['JK1', 'SA', 'HA', 'D3'], 2), { forced: ['JK1'], options: ['SA', 'HA'], pick: 1 });
  // 選ぶ余地がなければ全部 forced
  assert.deepEqual(exchangeChoice(['S2', 'HA', 'D3'], 2), { forced: ['S2', 'HA'], options: [], pick: 0 });
  assert.deepEqual(exchangeChoice(['S2', 'H2', 'D3'], 2), { forced: ['S2', 'H2'], options: [], pick: 0 });
  // ジョーカー2枚から1枚(どちらでもよい)
  assert.equal(exchangeChoice(['JK1', 'JK2', 'S3'], 1).pick, 1);
  // ルール外のカードは渡せない
  const g = normalizeGame({
    seq: 1, status: 'exchange', gameNo: 2, order: ['a', 'b'], first: 'b', turn: null, handCount: { a: 3, b: 4 }, effects: {},
    exchange: { b: { give: true, to: 'a', count: 1, forced: [], options: ['S2', 'H2'], pick: 1, done: false }, a: { to: 'b', count: 1, done: false, waitGive: true } },
  });
  assert.throws(() => applyAction(g, 'b', { type: 'exchangeGive', cards: ['SA'] }, ['S2', 'H2', 'SA', 'D3']), /強いカード/);
  const out = applyAction(g, 'b', { type: 'exchangeGive', cards: ['H2'] }, ['S2', 'H2', 'SA', 'D3']);
  assert.deepEqual(out.hand, ['S2', 'SA', 'D3']);
  assert.equal(out.game.exchange.a.waitGive, false);
  assert.deepEqual(out.inbox.find((x) => x.to === 'a').item.cards, ['H2']);
});

test('2ゲーム目:大貧民から、カード交換', () => {
  const order = ['a', 'b', 'c', 'd'];
  const prevTitles = { a: 'daifugo', b: 'fugo', c: 'hinmin', d: 'daihinmin' };
  const { game, hands, inbox } = dealGame({ order, gameNo: 2, prevTitles });
  assert.equal(game.status, 'exchange');
  assert.equal(game.first, 'd');
  const s = { game: normalizeGame(game), hands: structuredClone(hands), events: [] };
  for (const u of ['a', 'b']) for (const it of inbox[u] || []) if (it.kind === 'cards') s.hands[u].push(...it.cards);
  // マークを選べるときは、貧しい側が先に渡す
  for (const [poor, rich, k] of [['d', 'a', 2], ['c', 'b', 1]]) {
    const it = s.game.exchange[poor];
    if (it?.give) {
      assert.equal(s.game.exchange[rich].waitGive, true);
      assert.throws(() => applyAction(s.game, rich, { type: 'exchangeReturn', cards: s.hands[rich].slice(0, k) }, s.hands[rich]), /選んでいます/);
      act(s, poor, { type: 'exchangeGive', cards: [...it.forced, ...it.options.slice(0, it.pick)] });
    }
    assert.equal(s.hands[rich].length, s.game.handCount[rich]);
  }
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
function randomGame(n, seed, gameNo = 1, prevTitles = {}, jokers = 2) {
  const r = rng(seed);
  const order = Array.from({ length: n }, (_, i) => 'p' + i);
  const d = dealGame({ order, rng: r, gameNo, prevTitles, jokers });
  const s = { game: normalizeGame(d.game), hands: d.hands, events: [] };
  for (const u of order) for (const it of d.inbox[u] || []) if (it.kind === 'cards') s.hands[u].push(...it.cards);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let guard = 0;
  while (s.game.status !== 'result') {
    if (++guard > 5000) throw new Error('終わらない');
    const g = s.game;
    for (const u of order) assert.equal(g.handCount[u], s.hands[u].length, `count ${u}`);
    if (g.status === 'exchange') {
      // 渡す側(マークを選ぶ)が先、返す側はそのあと
      const [u, it] = Object.entries(g.exchange).find(([, x]) => !x.done && !x.waitGive);
      if (it.give) act(s, u, { type: 'exchangeGive', cards: [...it.forced, ...pick([it.options, [...it.options].reverse()]).slice(0, it.pick)] });
      else act(s, u, { type: 'exchangeReturn', cards: s.hands[u].slice(0, it.count) });
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
      const fin = cards.length === s.hands[u].length;
      const opts = interpretations(cards).filter((o) => canPlay(o, top, g.effects) && !(fin && forbiddenFinish(o, top, g.effects)));
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
      const jokers = k % 3;
      const s = randomGame(n, seed++, 1, {}, jokers);
      const titles = s.game.result.titles;
      randomGame(n, seed++, 2, titles, jokers);
    }
  }
});

test('Firebaseの往復で状態が壊れない', () => {
  const d = dealGame({ order: ['a', 'b', 'c'] });
  const g = normalizeGame(JSON.parse(JSON.stringify(d.game)));
  assert.deepEqual(g.field, []);
  assert.equal(activePlayers(g).length, 3);
  assert.equal(makeDeck().length, 54);
  assert.equal(makeDeck(0).length, 52);
  assert.equal(makeDeck(1).length, 53);
});

test('部屋の作り直し:1ゲーム目から称号を引き継いで交換・都落ちあり、最初の親も指定できる', () => {
  const order = ['a', 'b', 'c', 'd'];
  const prevTitles = { a: 'daifugo', b: 'fugo', c: 'hinmin', d: 'daihinmin' };
  // 引き継ぎなしの1ゲーム目は交換なし
  assert.equal(dealGame({ order, gameNo: 1, prevTitles }).game.status, 'playing');
  const { game, inbox } = dealGame({ order, gameNo: 1, prevTitles, carried: true });
  assert.equal(game.gameNo, 1);
  assert.equal(game.status, 'exchange');
  assert.equal(game.first, 'd');
  assert.equal(game.prevDaifugo, 'a');
  // 大貧民 d → 大富豪 a に2枚(マークを選べるときは d が選ぶまで待つ)
  assert.ok(game.exchange.d?.give ? game.exchange.d.count === 2 : inbox.a[0].cards.length === 2);
  // 最初の親を指定
  assert.equal(dealGame({ order, gameNo: 1, prevTitles, carried: true, firstUid: 'b' }).game.first, 'b');
  assert.equal(dealGame({ order, gameNo: 1, firstUid: 'c' }).game.first, 'c');
  assert.equal(dealGame({ order: ['a', 'b'], gameNo: 1, firstUid: 'b' }).game.first, 'b');
});
