#!/usr/bin/env node
// 16組大富豪オンライン:PC で動く CPU プレイヤー
//
// 使い方(リポジトリのフォルダで):
//   npm install
//   npm run cpu -- 1234          … 部屋コード 1234 に CPU を1人参加させる
//   npm run cpu -- 1234 3        … 3人参加させる
//   npm run cpu -- 1234 2 --easy … 先読みしない弱めの CPU
// 止めるときは Ctrl+C(待合室なら退出、ゲーム中なら切断扱いになり、ホストの画面が代わりに進めます)
//
// CPU は人と同じように匿名ログインして参加し、自分の手札と公開された情報だけで打ちます。
// 1人ごとに別のログイン(別ID)なので、同じ PC の CPU どうしでも手札は見えません。
import * as appMod from 'firebase/app';
import * as authMod from 'firebase/auth';
import * as dbMod from 'firebase/database';
import { firebaseConfig } from '../js/config.js';
import { createFirebaseBackend } from '../js/backend-firebase.js';
import { RoomController } from '../js/room.js';
import { decide } from '../js/cpu/search.js';
import { CpuPlayer } from '../js/cpu/player.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};
const positional = args.filter((a) => !a.startsWith('--'));
const code = positional[0];
const count = Math.max(1, Math.min(7, Number(positional[1] || 1)));
const level = flag('easy') ? 'easy' : 'search';
const thinkMs = Number(option('think', 1200)); // 先読みに使う時間
const minDelay = Number(option('delay', 1500)); // 人らしく見せる最低の間
const prefix = option('name', 'CPU');
const emulator = flag('emulator'); // テスト用:Firebase エミュレータにつなぐ

if (!/^\d{4}$/.test(code || '')) {
  console.log('使い方: npm run cpu -- <部屋コード4桁> [人数] [--easy] [--think=1200] [--delay=1500]');
  process.exit(1);
}

const config = emulator
  ? { apiKey: 'demo-key', projectId: 'demo-daifugo', databaseURL: 'http://127.0.0.1:9000?ns=demo-daifugo-default-rtdb' }
  : firebaseConfig;

async function main() {
  console.log(`部屋 ${code} に ${prefix} を ${count} 人参加させます(${level === 'easy' ? 'かんたん' : '先読み'})`);
  const players = [];
  for (let i = 1; i <= count; i++) {
    const backend = await createFirebaseBackend(config, {
      app: appMod, auth: authMod, db: dbMod, name: `cpu-${i}-${Date.now()}`,
      setup: emulator
        ? (auth, db) => {
            authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            dbMod.connectDatabaseEmulator(db, '127.0.0.1', 9000);
          }
        : null,
    });
    const ctrl = new RoomController(backend);
    const roomId = await ctrl.findByCode(code);
    if (!roomId) {
      console.log('その部屋コードの部屋が見つかりません');
      process.exit(1);
    }
    const name = count === 1 && prefix !== 'CPU' ? prefix : `${prefix}${i}`;
    await ctrl.join(roomId, name.slice(0, 8), { cpu: true });
    const p = new CpuPlayer(name, ctrl, {
      decideAsync: async (g, uid, hand, opts) => decide(g, uid, hand, opts),
      level, thinkMs, minDelay, log: (m) => console.log(m),
    });
    p.start();
    players.push(p);
    console.log(`[${name}] 参加しました`);
  }
  const stop = async () => {
    console.log('\nCPU を退出させています…');
    for (const p of players) {
      p.stopped = true;
      await p.ctrl.leave().catch(() => {});
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error('起動できませんでした:', e.message);
  process.exit(1);
});
