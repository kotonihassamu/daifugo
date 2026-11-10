// 起動・画面遷移(トップ / 待合室 / ゲーム)
import { firebaseConfig } from './config.js';
import { RoomController } from './room.js';
import { TITLES } from './engine.js';
import { SVG_DEFS, cardSvg } from './ui/card-svg.js';
import { GameView } from './ui/game-view.js';
import { sound } from './ui/sound.js';
import { esc, toast, openModal, closeModal } from './ui/dom.js';
import { RULES_HTML } from './ui/rules-text.js';
import { cardLabel } from './cards.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');
const SETTINGS_KEY = 'daifugo-settings';
const NAME_KEY = 'daifugo-name';

const settings = Object.assign({ sort: 'strength', hint: false, sound: false, vibrate: true }, readJson(SETTINGS_KEY));
sound.enabled = settings.sound;

function readJson(k) {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  sound.enabled = settings.sound;
}
const savedName = () => {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
};
const saveName = (n) => {
  try { localStorage.setItem(NAME_KEY, n); } catch {}
};

let ctrl = null;
let view = null;
let screen = null;
let localMode = false;

document.body.insertAdjacentHTML('afterbegin', SVG_DEFS);

async function boot() {
  const configured = !!(firebaseConfig.apiKey && firebaseConfig.databaseURL);
  localMode = params.get('local') === '1' || !configured;
  app.innerHTML = '<div class="loading">読み込み中…</div>';
  let backend;
  try {
    if (localMode) {
      const { createLocalBackend } = await import('./backend-local.js');
      backend = createLocalBackend();
    } else {
      const { createFirebaseBackend } = await import('./backend-firebase.js');
      backend = await createFirebaseBackend(firebaseConfig);
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="loading">接続できませんでした。<br><small>${esc(e.message || e)}</small><br><button class="btn" onclick="location.reload()">再読み込み</button></div>`;
    return;
  }
  ctrl = new RoomController(backend);
  window.__daifugo = { ctrl, get view() { return view; } }; // デバッグ用
  wire();
  ctrl.cleanupOldRooms();
  const rid = params.get('r');
  if (rid) {
    const rec = await ctrl.memberRecord(rid);
    if (rec) {
      try {
        await ctrl.join(rid, rec.name || savedName() || 'ゲスト');
        return;
      } catch (e) {
        toast(e.message);
      }
    }
    showJoin(rid);
    return;
  }
  showTop();
}

function wire() {
  ctrl.addEventListener('room', (e) => {
    const g = ctrl.game;
    const want = g && g.status !== 'lobby' ? 'game' : 'lobby';
    if (screen !== want) {
      if (want === 'game') showGame();
      else showLobby();
    }
    if (screen === 'game') view.onRoom(e.detail);
    else renderLobby();
    keepAwake();
  });
  ctrl.addEventListener('hand', () => view?.onHand());
  ctrl.addEventListener('received', (e) => {
    const { cards } = e.detail;
    const g = ctrl.game;
    if (cards.length && g?.status === 'playing') toast(`${cards.map(cardLabel).join('・')} を受け取りました`);
    view?.onHand();
    if (g) view?.render(g);
  });
  ctrl.addEventListener('closed', () => {
    toast('部屋がなくなりました');
    goTop();
  });
  ctrl.addEventListener('kicked', () => {
    goTop();
  });
}

function setUrl(rid) {
  const u = new URL(location.href);
  if (rid) u.searchParams.set('r', rid);
  else u.searchParams.delete('r');
  if (localMode && !(firebaseConfig.apiKey && firebaseConfig.databaseURL)) u.searchParams.delete('local');
  history.replaceState(null, '', u);
}

function inviteUrl() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('r', ctrl.roomId);
  if (params.get('local') === '1') u.searchParams.set('local', '1');
  return u.toString();
}

function demoNote() {
  return localMode
    ? `<div class="demo-note">デモモード:Firebase未設定のため、<b>この端末のタブ同士</b>で遊べます。タブを増やすと別のプレイヤーになります。</div>`
    : '';
}

// ---------- トップ ----------
function showTop() {
  view?.destroy();
  view = null;
  screen = 'top';
  setUrl(null);
  releaseWake();
  const fan = ['SA', 'HK', 'JK1', 'DQ', 'C2'].map((c, i) => `<div class="card" style="--i:${i - 2}">${cardSvg(c)}</div>`).join('');
  app.innerHTML = `
    <div class="top">
      <div class="logo-fan">${fan}</div>
      <h1 class="logo">大富豪</h1>
      <p class="sub">友達とスマホで遊ぶオンライン大富豪</p>
      <div class="top-buttons">
        <button class="btn primary big" data-act="create">部屋を作る</button>
        <button class="btn big" data-act="code">コードで参加</button>
      </div>
      ${demoNote()}
    </div>`;
  app.querySelector('[data-act=create]').onclick = () => askName('部屋を作る', async (name) => {
    await ctrl.createRoom(name);
  });
  app.querySelector('[data-act=code]').onclick = () => askCode();
}

function goTop() {
  closeModal(true);
  showTop();
}

function nameField() {
  return `<label class="field-label">名前(8文字まで)<input class="input" name="name" maxlength="8" autocomplete="nickname" value="${esc(savedName())}" required></label>`;
}

function askName(title, onOk) {
  const body = document.createElement('form');
  body.className = 'form';
  body.innerHTML = `<h2>${esc(title)}</h2>${nameField()}<button class="btn primary wide" type="submit">OK</button>`;
  body.onsubmit = async (e) => {
    e.preventDefault();
    const name = body.name.value.trim().slice(0, 8);
    if (!name) return;
    saveName(name);
    const b = body.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await onOk(name);
      closeModal(true);
    } catch (err) {
      toast(err.message || String(err));
      b.disabled = false;
    }
  };
  openModal(body);
  setTimeout(() => body.name.focus(), 50);
}

function askCode() {
  const body = document.createElement('form');
  body.className = 'form';
  body.innerHTML = `<h2>コードで参加</h2>
    <label class="field-label">部屋コード(4桁)<input class="input code-input" name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label>
    ${nameField()}
    <button class="btn primary wide" type="submit">参加する</button>`;
  body.onsubmit = async (e) => {
    e.preventDefault();
    const code = body.code.value.trim();
    const name = body.name.value.trim().slice(0, 8);
    if (!/^\d{4}$/.test(code) || !name) return;
    saveName(name);
    try {
      const rid = await ctrl.findByCode(code);
      if (!rid) throw new Error('その番号の部屋はありません');
      await ctrl.join(rid, name);
      closeModal(true);
    } catch (err) {
      toast(err.message || String(err));
    }
  };
  openModal(body);
  setTimeout(() => body.code.focus(), 50);
}

function showJoin(rid) {
  screen = 'join';
  app.innerHTML = `<div class="top"><h1 class="logo small">大富豪</h1><p class="sub">部屋に招待されました</p>${demoNote()}</div>`;
  const form = document.createElement('form');
  form.className = 'form card-panel';
  form.innerHTML = `${nameField()}<button class="btn primary wide" type="submit">参加する</button><button class="btn ghost wide" type="button" data-top>トップへ</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim().slice(0, 8);
    if (!name) return;
    saveName(name);
    try {
      await ctrl.join(rid, name);
    } catch (err) {
      toast(err.message);
    }
  };
  form.querySelector('[data-top]').onclick = goTop;
  app.querySelector('.top').appendChild(form);
}

// ---------- 待合室 ----------
function showLobby() {
  view?.destroy();
  view = null;
  screen = 'lobby';
  setUrl(ctrl.roomId);
  app.innerHTML = '<div class="lobby"></div>';
  renderLobby();
}

function renderLobby() {
  const el = app.querySelector('.lobby');
  if (!el || !ctrl.room) return;
  const meta = ctrl.room.meta;
  const players = ctrl.players;
  const host = ctrl.player(meta.hostUid);
  const hostAway = !host || host.online === false;
  const seated = ctrl.seatedForNextGame().length;
  el.innerHTML = `
    <header class="lobby-head">
      <div><div class="muted">部屋コード</div><div class="room-code">${esc(meta.code)}</div></div>
      <button class="btn small ghost" data-act="rules">ルール</button>
    </header>
    ${demoNote()}
    <section class="panel">
      <h2>参加者 <span class="muted">${players.length}人(最大8人・2人から)</span></h2>
      <ol class="player-list">
        ${players
          .map(
            (p, i) => `<li class="${p.online === false ? 'offline' : ''}">
              <span class="seat-no">${i + 1}</span>
              <span class="dot ${p.online === false ? '' : 'on'}"></span>
              <span class="pname">${esc(p.name)}${p.uid === ctrl.uid ? '<span class="muted">(あなた)</span>' : ''}</span>
              ${p.uid === meta.hostUid ? '<span class="host-mark">★ホスト</span>' : ''}
              ${p.title ? `<span class="tag t-${p.title}">${TITLES[p.title]}</span>` : ''}
              <span class="pts">${(p.points || 0) > 0 ? '+' : ''}${p.points || 0}pt</span>
            </li>`,
          )
          .join('')}
      </ol>
      <p class="muted small">並び順が席順(時計回り)です。切断中の人は次のゲームに入りません。</p>
    </section>
    <section class="panel invite">
      <button class="btn wide" data-act="share">招待URLを送る</button>
    </section>
    <div class="lobby-actions">
      ${ctrl.isHost
        ? `<button class="btn primary big wide" data-act="start" ${seated < 2 ? 'disabled' : ''}>ゲーム開始(${seated}人)</button>`
        : `<p class="muted center-text">ホスト(${esc(host?.name || '?')})の開始を待っています…</p>`}
      ${!ctrl.isHost && hostAway ? '<button class="btn wide" data-act="takeHost">ホストを引き継ぐ</button>' : ''}
      <button class="btn ghost wide" data-act="leave">部屋を出る</button>
    </div>`;
  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    sound.unlock();
    try {
      if (act === 'rules') openRules();
      if (act === 'share') share();
      if (act === 'start') await ctrl.startGame();
      if (act === 'takeHost') await ctrl.takeHost();
      if (act === 'leave') {
        await ctrl.leave();
        goTop();
      }
    } catch (err) {
      toast(err.message || String(err));
    }
  };
}

async function share() {
  const url = inviteUrl();
  const text = `大富豪しよう!部屋コード ${ctrl.room?.meta?.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '大富豪', text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('招待URLをコピーしました');
  } catch {
    openModal(`<h2>招待URL</h2><input class="input" readonly value="${esc(url)}" onclick="this.select()">`);
  }
}

// ---------- ゲーム ----------
function showGame() {
  screen = 'game';
  setUrl(ctrl.roomId);
  app.innerHTML = '<div class="game-root"></div>';
  view = new GameView(app.querySelector('.game-root'), ctrl, settings, {
    openRules, openMenu, saveSettings, showResult,
    startNext: async () => {
      try {
        closeModal(true);
        await ctrl.startGame();
      } catch (e) {
        toast(e.message);
      }
    },
  });
}

function showResult() {
  const g = ctrl.game;
  if (!g?.result) return;
  const { ranking, titles, delta } = g.result;
  const body = document.createElement('div');
  body.innerHTML = `<h2>第${g.gameNo}ゲームの結果</h2>
    <ol class="result-list">
      ${ranking
        .map((u, i) => {
          const p = ctrl.player(u);
          const d = delta[u] || 0;
          return `<li class="${u === ctrl.uid ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="pname">${esc(p?.name || '(退出)')}</span>
            <span class="tag t-${titles[u]}">${TITLES[titles[u]]}${g.ochi === u ? '(都落ち)' : ''}</span>
            <span class="delta ${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${d}</span>
            <span class="pts">累計 ${p?.points ?? 0}pt</span></li>`;
        })
        .join('')}
    </ol>
    ${ctrl.isHost
      ? `<p class="muted small">次のゲームの参加者:${ctrl.seatedForNextGame().map((p) => esc(p.name)).join('、')}</p>
         <button class="btn primary wide big" data-act="next">次のゲームへ</button>
         <button class="btn ghost wide" data-act="lobby">待合室に戻る</button>`
      : '<p class="muted center-text">ホストが次のゲームを始めるのを待っています</p>'}
    <button class="btn ghost wide" data-act="close">テーブルを見る</button>`;
  body.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'next') {
        closeModal(true);
        await ctrl.startGame();
      }
      if (act === 'lobby') {
        closeModal(true);
        await ctrl.backToLobby();
      }
      if (act === 'close') closeModal();
    } catch (err) {
      toast(err.message);
    }
  };
  openModal(body);
}

function openRules() {
  openModal(`<div class="rules">${RULES_HTML}</div>`);
}

function openMenu() {
  const host = ctrl.player(ctrl.hostUid);
  const hostAway = !host || host.online === false;
  const body = document.createElement('div');
  body.innerHTML = `<h2>メニュー</h2>
    <div class="settings">
      <label class="switch"><span>並び順</span>
        <select name="sort"><option value="strength">強さ順</option><option value="suit">マーク順</option></select></label>
      <label class="switch"><span>出せるカードのヒント</span><input type="checkbox" name="hint"></label>
      <label class="switch"><span>効果音</span><input type="checkbox" name="sound"></label>
      <label class="switch"><span>振動(対応端末のみ)</span><input type="checkbox" name="vibrate"></label>
    </div>
    <button class="btn wide" data-act="share">招待URLを送る</button>
    ${!ctrl.isHost && hostAway ? '<button class="btn wide" data-act="takeHost">ホストを引き継ぐ</button>' : ''}
    ${ctrl.isHost && ctrl.game?.status === 'result' ? '<button class="btn wide" data-act="lobby">待合室に戻る</button>' : ''}
    <button class="btn ghost wide" data-act="leave">部屋を出る</button>
    <p class="muted small">ゲーム中に部屋を出ても席は残ります。同じURLから戻れます。</p>`;
  body.querySelector('[name=sort]').value = settings.sort;
  for (const k of ['hint', 'sound', 'vibrate']) body.querySelector(`[name=${k}]`).checked = !!settings[k];
  body.onchange = (e) => {
    const t = e.target;
    settings[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    saveSettings();
    if (t.name === 'sound' && t.checked) {
      sound.unlock();
      sound.play('turn');
    }
    view?.renderHand();
    view?.renderControls(ctrl.game);
  };
  body.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'share') share();
      if (act === 'takeHost') {
        await ctrl.takeHost();
        closeModal();
      }
      if (act === 'lobby') {
        closeModal();
        await ctrl.backToLobby();
      }
      if (act === 'leave') {
        closeModal(true);
        await ctrl.leave();
        goTop();
      }
    } catch (err) {
      toast(err.message);
    }
  };
  openModal(body);
}

// ---------- 画面スリープ防止 ----------
let wakeLock = null;
let wakeWarned = false;
async function keepAwake() {
  if (screen !== 'game' && screen !== 'lobby') return;
  if (!('wakeLock' in navigator)) {
    if (!wakeWarned && screen === 'game') {
      wakeWarned = true;
      toast('この端末は画面スリープ防止に非対応です。画面ロックに注意してください', 4000);
    }
    return;
  }
  if (wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch { /* 省電力モードなど */ }
}
function releaseWake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

boot();
