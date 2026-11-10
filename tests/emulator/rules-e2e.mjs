// Firebaseエミュレータ上で、本物のSDK+セキュリティルールで4人対戦を回す
import * as appMod from 'firebase/app';
import * as authMod from 'firebase/auth';
import * as dbMod from 'firebase/database';
import { createFirebaseBackend } from '../../js/backend-firebase.js';
import { RoomController } from '../../js/room.js';
import { legalPlays, interpretations } from '../../js/rules.js';

const config = { apiKey: 'demo-key', projectId: 'demo-daifugo', databaseURL: 'http://127.0.0.1:9000?ns=demo-daifugo-default-rtdb' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ng = 0;
const check = (cond, msg) => { if (cond) ok++; else { ng++; console.log('FAIL', msg); } };
const denied = async (p, msg) => { try { await p; check(false, msg + ' (should be denied)'); } catch (e) { check(/permission|denied/i.test(e.message || e.code), msg + ' -> ' + e.message); } };

async function client(i) {
  const b = await createFirebaseBackend(config, {
    app: appMod, auth: authMod, db: dbMod, name: 'c' + i,
    setup: (auth, db) => {
      authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      dbMod.connectDatabaseEmulator(db, '127.0.0.1', 9000);
    },
  });
  return { b, c: new RoomController(b) };
}

const cs = [];
for (let i = 0; i < 5; i++) cs.push(await client(i));
const [A, B, C, D, X] = cs;
const rid = await A.c.createRoom('あ');
await sleep(300);
const code = A.c.room.meta.code;
check(/^\d{4}$/.test(code), 'room code');
check((await B.c.findByCode(code)) === rid, 'find by code');
await B.c.join(rid, 'い');
await C.c.join(rid, 'う');
await D.c.join(rid, 'え');
await sleep(500);
check(A.c.players.length === 4, 'players 4: ' + A.c.players.length);

// 権限のチェック
await denied(X.b.get(`rooms/${rid}`), '非参加者は部屋を読めない');
await denied(B.b.update({ [`rooms/${rid}/meta/hostUid`]: X.b.uid }), '存在しない人をホストにできない');
await denied(B.b.update({ [`roomCodes/${code}`]: 'zzz' }), '部屋コードは上書き不可');
await denied(B.b.update({ [`rooms/${rid}/game`]: { seq: 1, actor: B.b.uid, status: 'playing' } }), 'ホスト以外は開始できない');

await A.c.startGame();
await sleep(800);
for (const p of cs.slice(0, 4)) check(p.c.game?.status === 'playing', 'started for ' + p.c.uid);
await denied(B.b.get(`hands/${rid}/${A.b.uid}`), '他人の手札は読めない');
await denied(A.b.get(`hands/${rid}/${B.b.uid}`), 'ホストも他人の手札は読めない');
check(A.c.hand.length + B.c.hand.length + C.c.hand.length + D.c.hand.length === 53, 'all 53 dealt');

// 手番でない人の書き込みは拒否される
const turnUid = A.c.game.turn;
const notTurn = cs.slice(0, 4).find((p) => p.c.uid !== turnUid && p.c.uid !== A.c.uid);
{
  const g = notTurn.c.game;
  await denied(notTurn.b.update({ [`rooms/${rid}/game`]: { ...JSON.parse(JSON.stringify(g)), seq: g.seq + 1, actor: notTurn.b.uid } }), '手番以外は場を書き換えられない');
  await denied(notTurn.b.update({ [`rooms/${rid}/game`]: { ...JSON.parse(JSON.stringify(g)), seq: g.seq + 1, actor: A.b.uid } }), 'actorの偽装は不可');
}
// 同じseqの二重書き込みは片方だけ通る
{
  const t = cs.find((p) => p.c.uid === turnUid);
  const g = t.c.game;
  const body = { ...JSON.parse(JSON.stringify(g)), seq: g.seq + 1, actor: t.b.uid };
  await t.b.update({ [`rooms/${rid}/game`]: body });
  await denied(t.b.update({ [`rooms/${rid}/game`]: body }), '同じseqの二重書き込み');
  await sleep(300);
}

// 自動で最後まで遊ぶ(2ゲーム)
async function playGame() {
  const players = cs.slice(0, 4);
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const g = A.c.game;
    if (g.status === 'result' && players.every((p) => p.c.game.status === 'result')) return g;
    for (const p of players) {
      const c = p.c, gg = c.game, me = c.uid;
      if (!gg || !c.synced()) continue;
      try {
        if (gg.status === 'exchange' && gg.exchange?.[me] && !gg.exchange[me].done) await c.perform({ type: 'exchangeReturn', cards: c.hand.slice(0, gg.exchange[me].count) });
        else if (gg.status !== 'playing') continue;
        else if (gg.pending?.uid === me) {
          if (gg.pending.type === 'bomb') await c.perform({ type: 'bomb', ranks: ['3', '9', 'K', 'JK'].slice(0, gg.pending.count) });
          else await c.perform({ type: gg.pending.type, cards: c.hand.slice(0, gg.pending.count) });
        } else if (gg.turn === me && !gg.pending && !gg.bombApply) {
          const top = gg.field[gg.field.length - 1] || null;
          const lp = legalPlays(c.hand, top, gg.effects);
          if (lp.any && (Math.random() < 0.8 || !top || (gg.passesUsed[me] || 0) >= 3)) {
            const cards = lp.plays[Math.floor(Math.random() * lp.plays.length)];
            await c.perform({ type: 'play', cards, interp: interpretations(cards)[0].key });
          } else await c.perform({ type: 'pass' });
        }
      } catch (e) {
        if (!e.conflict && !/同期/.test(e.message)) console.log('action error', e.message);
      }
      await sleep(15);
    }
  }
  throw new Error('timeout');
}
const r1 = await playGame();
check(r1.result.ranking.length === 4, 'game1 finished');
await sleep(500);
check(Object.values(A.c.room.players).every((p) => p.title), 'titles written');
check(Object.values(A.c.room.players).reduce((s, p) => s + p.points, 0) === 0, 'points sum 0');
await A.c.startGame();
await sleep(800);
console.log('game2 status', A.c.game.status, 'first', A.c.game.first);
const r2 = await playGame();
check(r2.result.ranking.length === 4, 'game2 finished');
console.log('game2 ochi', r2.ochi, 'events seq', r2.seq);
for (const p of cs.slice(0, 4)) check(p.c.hand.length === (p.c.game.handCount[p.c.uid] || 0), 'hand/count consistent ' + p.c.uid);

// 待合室に戻ってホストが抜ける → ホスト交代
await A.c.backToLobby();
await sleep(400);
await A.c.leave();
await sleep(500);
check(B.c.room.meta.hostUid !== A.b.uid && B.c.players.length === 3, 'host transferred on leave');

// 古い部屋の掃除(最終操作を過去にしてから、無関係な人が掃除する)
await B.b.update({ [`rooms/${rid}/meta/updatedAt`]: 1, [`roomIndex/${rid}/updatedAt`]: 1 });
for (const p of [B, C, D]) p.c.unsubscribe();
await X.c.cleanupOldRooms();
await sleep(400);
check((await X.b.get(`roomCodes/${code}`)) === null, 'room code cleaned');
check((await X.b.get(`roomIndex/${rid}`)) === null, 'room index cleaned');

console.log(`ok ${ok} / ng ${ng}`);
process.exit(ng ? 1 : 0);
