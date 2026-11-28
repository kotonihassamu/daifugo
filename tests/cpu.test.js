import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealGame, normalizeGame, applyAction } from '../js/engine.js';
import { heuristicTurn, heuristicChoice, pendingDecision, candidatePlays, leadPlays } from '../js/cpu/policy.js';
import { searchTurn, decide, unknownCards } from '../js/cpu/search.js';

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// 全員 CPU で最後まで遊ばせる。p0 だけ先読み(短い時間)
function playOut(n, seed, jokers, numberLock = true) {
  const r = rng(seed);
  const order = Array.from({ length: n }, (_, i) => 'p' + i);
  const d = dealGame({ order, rng: r, jokers, numberLock });
  let g = normalizeGame(d.game);
  const hands = d.hands;
  for (let step = 0; g.status !== 'result'; step++) {
    assert.ok(step < 3000, '終わらない');
    let actor, action;
    for (const u of order) {
      const dd = pendingDecision(g, u);
      if (!dd) continue;
      actor = u;
      if (dd.kind === 'turn') action = u === 'p0' ? searchTurn(g, u, hands[u], { timeMs: 5, rng: r }).action : heuristicTurn(g, u, hands[u], r, 0.05);
      else action = heuristicChoice(g, u, hands[u], dd);
      break;
    }
    // CPU の選んだ手は必ずルール上出せる(例外が出ない)
    const out = applyAction(g, actor, action, hands[actor]);
    g = out.game;
    if (out.hand) hands[actor] = out.hand;
    for (const { to, item } of out.inbox) if (item.kind === 'cards') hands[to] = [...hands[to], ...item.cards];
  }
  return g;
}

test('CPU だけで最後まで遊べる(2〜6人・ジョーカー0〜2枚・数字縛りあり/なし)', () => {
  let seed = 11;
  for (let n = 2; n <= 6; n++) for (let j = 0; j <= 2; j++) {
    const g = playOut(n, seed++, j, seed % 2 === 0);
    assert.equal(g.result.ranking.length, n);
  }
});

test('公開済みのカードを記録し、見えていないカードを正しく数える', () => {
  const g = normalizeGame(dealGame({ order: ['a', 'b', 'c'], jokers: 2 }).game);
  g.seen = ['S3', 'H3'];
  const unknown = unknownCards(g, ['D3', 'C3', 'JK1']);
  assert.equal(unknown.length, 54 - 5);
  assert.ok(!unknown.includes('S3') && !unknown.includes('JK1') && unknown.includes('JK2'));
});

test('親のときは複数枚の手も候補に入り、禁止上がりの手は選ばない', () => {
  const plays = leadPlays(['S5', 'H5', 'S6', 'S7', 'JK1'], {});
  assert.ok(plays.some((p) => p.length === 2));
  assert.ok(plays.some((p) => p.length >= 3));
  const g = normalizeGame({ seq: 1, status: 'playing', order: ['a', 'b'], turn: 'a', handCount: { a: 1, b: 3 }, effects: {} });
  assert.deepEqual(candidatePlays(g, ['H2']), []); // 最後の1枚が2 → 出せない
  assert.deepEqual(decide(g, 'a', ['H2'], { timeMs: 5 }), { type: 'pass' });
});

test('12ボンバー:もう残っていない数字(出たジョーカーなど)は選ばない', async () => {
  const { bombRanks } = await import('../js/cpu/policy.js');
  const g = { rules: { jokers: 2 }, effects: { revolution: false }, seen: [] };
  assert.deepEqual(bombRanks(['S3'], 1, g), ['JK']);
  // ジョーカー2枚とも出ていたら次に強い2
  assert.deepEqual(bombRanks(['S3'], 1, { ...g, seen: ['JK1', 'JK2'] }), ['2']);
  // 2も4枚とも出ていたら A
  assert.deepEqual(bombRanks(['S3'], 2, { ...g, seen: ['JK1', 'JK2', 'S2', 'H2', 'D2', 'C2'] }), ['A', 'K']);
  // 自分が持っている数字は避ける
  assert.deepEqual(bombRanks(['JK1', 'S2'], 1, g), ['A']);
  // ジョーカーなしの部屋
  assert.deepEqual(bombRanks(['S3'], 1, { ...g, rules: { jokers: 0 } }), ['2']);
  // 革命中は小さい数字が強い
  assert.deepEqual(bombRanks(['S9'], 2, { ...g, seen: ['JK1', 'JK2'], effects: { revolution: true } }), ['3', '4']);
});
