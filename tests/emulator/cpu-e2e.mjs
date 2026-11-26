// CPU プログラム(cpu/run.mjs)をエミュレータ上で動かし、人1人+CPU3人で遊ぶ通し試験
// 途中で CPU のプログラムを強制終了し、ホストの画面が代わりに進めてゲームが最後まで終わることも確かめる
import { spawn } from 'node:child_process';
import * as appMod from 'firebase/app';
import * as authMod from 'firebase/auth';
import * as dbMod from 'firebase/database';
import { createFirebaseBackend } from '../../js/backend-firebase.js';
import { RoomController } from '../../js/room.js';
import { heuristicTurn, heuristicChoice, pendingDecision } from '../../js/cpu/policy.js';

const config = { apiKey: 'demo-key', projectId: 'demo-daifugo', databaseURL: 'http://127.0.0.1:9000?ns=demo-daifugo-default-rtdb' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ng = 0;
const check = (c, m) => { if (c) ok++; else { ng++; console.log('FAIL', m); } };

const b = await createFirebaseBackend(config, {
  app: appMod, auth: authMod, db: dbMod, name: 'host',
  setup: (auth, db) => { authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); dbMod.connectDatabaseEmulator(db, '127.0.0.1', 9000); },
});
const host = new RoomController(b);
await host.createRoom('ホスト');
await sleep(300);
const code = host.room.meta.code;

const cpu = spawn(process.execPath, ['cpu/run.mjs', code, '3', '--emulator', '--delay=50', '--think=250'], { stdio: ['ignore', 'pipe', 'pipe'] });
let cpuLog = '';
cpu.stdout.on('data', (d) => (cpuLog += d));
cpu.stderr.on('data', (d) => (cpuLog += d));

for (let i = 0; i < 100 && host.players.length < 4; i++) await sleep(100);
check(host.players.length === 4, 'CPU が3人参加: ' + host.players.length);
check(host.players.filter((p) => p.cpu).length === 3, 'CPU の印');

// ホスト(人の代わり)はルールで打つ
async function hostLoop(untilStatus = 'result', timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const g = host.game;
    if (g?.status === untilStatus) return true;
    const d = pendingDecision(g, host.uid);
    if (d && d.kind !== 'bombApply' && host.synced()) {
      const a = d.kind === 'turn' ? heuristicTurn(g, host.uid, host.hand) : heuristicChoice(g, host.uid, host.hand, d);
      try { await host.perform(a); } catch { /* 重なり */ }
    }
    await sleep(60);
  }
  return false;
}

for (let n = 1; n <= 2; n++) {
  await host.startGame();
  await sleep(300);
  const done = await hostLoop();
  check(done, `第${n}ゲームが最後まで終わる`);
  console.log(`第${n}ゲーム:`, host.game.result?.ranking.map((u) => host.player(u)?.name).join(' > '));
  await sleep(500);
}

// 第3ゲームの途中で CPU のプログラムを止める(PC が落ちた想定)
await host.startGame();
await sleep(1500);
cpu.kill('SIGKILL');
console.log('CPU のプログラムを強制終了しました');
const done3 = await hostLoop('result', 180000);
check(done3, '第3ゲームも CPU 切断後にホストの代理で最後まで終わる');
check(host.players.filter((p) => p.cpu && p.online === false).length === 3, 'CPU は切断中と表示される');

console.log('--- CPU のログ(抜粋) ---\n' + cpuLog.split('\n').slice(0, 14).join('\n'));
console.log(`ok ${ok} / ng ${ng}`);
process.exit(ng ? 1 : 0);
