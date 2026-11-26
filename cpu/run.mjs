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
import { heuristicTurn, heuristicChoice, pendingDecision } from '../js/cpu/policy.js';
import { cardLabel } from '../js/cards.js';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = emulator
  ? { apiKey: 'demo-key', projectId: 'demo-daifugo', databaseURL: 'http://127.0.0.1:9000?ns=demo-daifugo-default-rtdb' }
  : firebaseConfig;

function describe(action) {
  if (!action) return '-';
  if (action.type === 'play') return `出す ${action.cards.map(cardLabel).join(' ')}`;
  if (action.type === 'pass') return 'パス';
  if (action.cards) return `${{ seven: '7渡し', ten: '10捨て', exchangeReturn: '交換で返す' }[action.type] || action.type} ${action.cards.map(cardLabel).join(' ')}`;
  if (action.ranks) return `ボンバー ${action.ranks.join('・')}`;
  return action.type;
}

class CpuPlayer {
  constructor(name, ctrl) {
    this.name = name;
    this.ctrl = ctrl;
    this.busy = false;
    this.timer = null;
    this.stopped = false;
  }

  log(...m) {
    console.log(`[${this.name}]`, ...m);
  }

  start() {
    const kick = () => this.kick();
    this.ctrl.addEventListener('room', kick);
    this.ctrl.addEventListener('hand', kick);
    this.ctrl.addEventListener('kicked', () => { this.log('部屋から外されました'); this.stopped = true; });
    this.ctrl.addEventListener('closed', () => { this.log('部屋がなくなりました'); this.stopped = true; });
  }

  kick(delay = 80) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.act().catch((e) => this.log('エラー', e.message)), delay);
  }

  async act() {
    if (this.busy || this.stopped) return;
    const ctrl = this.ctrl;
    const g = ctrl.game;
    const d = pendingDecision(g, ctrl.uid);
    if (!d || d.kind === 'bombApply') return; // ボンバーの反映は RoomController が自動で行う
    if (!ctrl.synced()) return this.kick(300); // 受け取ったカードの取り込み待ち
    this.busy = true;
    const seq = g.seq;
    const hand = [...ctrl.hand];
    const t0 = Date.now();
    let action;
    try {
      action = decide(g, ctrl.uid, hand, { level, timeMs: thinkMs });
    } catch (e) {
      this.log('判断でエラー、ルールで打ちます:', e.message);
      action = null;
    }
    if (!action) action = d.kind === 'turn' ? heuristicTurn(g, ctrl.uid, hand) : heuristicChoice(g, ctrl.uid, hand, d);
    const took = Date.now() - t0;
    await sleep(Math.max(0, minDelay - took) + Math.random() * 600);
    try {
      if (ctrl.game?.seq !== seq) return; // 考えている間に状態が変わった → やり直し
      await this.perform(action, d, g, hand);
      this.log(`${describe(action)}(考慮 ${took}ms)`);
    } finally {
      this.busy = false;
      this.kick(150);
    }
  }

  // 出せなかったら安全網(ルール → パス)で必ず進める
  async perform(action, d, g, hand) {
    const ctrl = this.ctrl;
    const tries = [action];
    if (d.kind === 'turn') tries.push(heuristicTurn(g, ctrl.uid, hand), { type: 'pass' });
    else tries.push(heuristicChoice(g, ctrl.uid, hand, d));
    for (const a of tries) {
      try {
        await ctrl.perform(a);
        return;
      } catch (e) {
        if (e.conflict) return; // ほかの操作と重なった → 次の更新でやり直す
        this.log(`「${describe(a)}」は出せません(${e.message})`);
      }
    }
  }
}

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
    const p = new CpuPlayer(name, ctrl);
    p.start();
    p.kick();
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
