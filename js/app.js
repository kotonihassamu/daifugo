// 起動・画面遷移(トップ / 待合室 / ゲーム)
import { firebaseConfig } from './config.js';
import { RoomController } from './room.js';
import { CpuManager } from './cpu/manager.js';
import { TITLES } from './engine.js';
import { SVG_DEFS, cardSvg } from './ui/card-svg.js';
import { GameView } from './ui/game-view.js';
import { sound, bgm } from './ui/sound.js';
import { esc, toast, openModal, closeModal } from './ui/dom.js';
import { rulesHtml } from './ui/rules-text.js';
import { cardLabel } from './cards.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');
const SETTINGS_KEY = 'daifugo-settings';
const NAME_KEY = 'daifugo-name';

const settings = Object.assign({ sort: 'strength', hint: false, sound: true, bgm: true, vibrate: true }, readJson(SETTINGS_KEY));
// 効果音を作り直したので、以前の「初期OFF」で保存された設定は一度だけONに戻す
if (!settings.sfx2) {
  settings.sound = true;
  settings.sfx2 = true;
}
sound.enabled = settings.sound;
bgm.enabled = settings.bgm;

function readJson(k) {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  sound.enabled = settings.sound;
  bgm.enabled = settings.bgm;
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
let cpus = null; // この端末で動かす CPU
let cpuRestoredFor = null;
let toLobbyTimer = null;

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
      cpus = new CpuManager(async (name) => createLocalBackend({ name }));
    } else {
      const { createFirebaseBackend } = await import('./backend-firebase.js');
      backend = await createFirebaseBackend(firebaseConfig);
      cpus = new CpuManager((name) => createFirebaseBackend(firebaseConfig, { name }));
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="loading">接続できませんでした。<br><small>${esc(e.message || e)}</small><br><button class="btn" onclick="location.reload()">再読み込み</button></div>`;
    return;
  }
  ctrl = new RoomController(backend);
  bgm.setClock(() => Date.now() + (backend.serverOffset?.() || 0));
  window.__daifugo = { ctrl, cpus, get view() { return view; } }; // デバッグ用
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
  cpus?.addEventListener('change', () => {
    if (screen === 'lobby') renderLobby();
  });
  ctrl.addEventListener('room', (e) => {
    // この端末で動かしていた CPU を再開(再読み込みのあとなど)
    if (cpus && ctrl.roomId && cpuRestoredFor !== ctrl.roomId) {
      cpuRestoredFor = ctrl.roomId;
      cpus.restore(ctrl.roomId).catch(() => {});
    }
    const g = ctrl.game;
    // BGM:ゲーム開始とともに流し、結果・待合室では止める
    if (g && (g.status === 'playing' || g.status === 'exchange') && typeof g.startedAt === 'number' && ctrl.roomId) bgm.play(g.startedAt, { fresh: screen === 'lobby', roomId: ctrl.roomId });
    else bgm.stop();
    if (ctrl.inGame) {
      clearTimeout(toLobbyTimer);
      toLobbyTimer = null;
      let fresh = false;
      if (screen !== 'game') {
        // 待合室から開始したとき(再読み込みでの途中参加ではない)
        fresh = screen === 'lobby';
        closeModal(true);
        showGame();
      }
      view.onRoom({ ...e.detail, fresh });
    } else if (screen === 'game' && g?.status === 'result' && e.detail.prev && e.detail.prev.status !== 'result') {
      // 最後の一手を見せてから待合室へ
      view.onRoom(e.detail);
      clearTimeout(toLobbyTimer);
      toLobbyTimer = setTimeout(() => {
        toLobbyTimer = null;
        showLobby();
        if (!document.querySelector('.modal-wrap')) showResult();
      }, 2600);
    } else if (!toLobbyTimer) {
      if (screen !== 'lobby') showLobby();
      else renderLobby();
    }
    keepAwake();
  });
  ctrl.addEventListener('hand', () => view?.onHand());
  ctrl.addEventListener('received', (e) => {
    const { cards } = e.detail;
    const g = ctrl.game;
    if (cards.length && g?.status === 'playing') toast(`${cards.map(cardLabel).join('・')} を受け取りました`, 5000);
    view?.onHand();
    if (g) view?.render(g);
  });
  ctrl.addEventListener('closed', () => {
    toast('部屋がなくなりました');
    cpus?.stopAll(null, { leave: false });
    goTop();
  });
  ctrl.addEventListener('kicked', () => {
    toast('部屋から外れました。招待URLからもう一度参加できます', 4000);
    cpus?.stopAll(null, { leave: false });
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
  bgm.stop();
  setUrl(null);
  releaseWake();
  const fan = ['SA', 'HK', 'JK1', 'DQ', 'C2'].map((c, i) => `<div class="card" style="--i:${i - 2}">${cardSvg(c)}</div>`).join('');
  app.innerHTML = `
    <div class="top">
      <div class="logo-fan">${fan}</div>
      <h1 class="logo">16組大富豪<span class="logo-sub">オンライン</span></h1>
      <p class="sub">みんなのスマホで遊ぶ大富豪</p>
      <div class="top-buttons">
        <button class="btn primary big" data-act="create">部屋を作る</button>
        <button class="btn big" data-act="code">コードで参加</button>
      </div>
      ${demoNote()}
    </div>`;
  app.querySelector('[data-act=create]').onclick = () => askName('部屋を作る', async (name, form) => {
    await ctrl.createRoom(name, { carryover: !!form.carryover?.checked });
  }, `<label class="check-row"><input type="checkbox" name="carryover">
      <span><b>前の部屋の続きから始める</b><br><small class="muted">部屋を作り直すとき用。待合室で席順・称号・最初の親・ポイントを入力できます。ふつうは全員平民・0ptから</small></span></label>`);
  app.querySelector('[data-act=code]').onclick = () => askCode();
}

function goTop() {
  closeModal(true);
  showTop();
}

function nameField() {
  return `<label class="field-label">名前(8文字まで)<input class="input" name="name" maxlength="8" autocomplete="nickname" value="${esc(savedName())}" required></label>`;
}

function askName(title, onOk, extraHtml = '') {
  const body = document.createElement('form');
  body.className = 'form';
  body.innerHTML = `<h2>${esc(title)}</h2>${nameField()}${extraHtml}<button class="btn primary wide" type="submit">OK</button>`;
  body.onsubmit = async (e) => {
    e.preventDefault();
    const name = body.name.value.trim().slice(0, 8);
    if (!name) return;
    saveName(name);
    const b = body.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await onOk(name, body);
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
  app.innerHTML = `<div class="top"><h1 class="logo small">16組大富豪<span class="logo-sub">オンライン</span></h1><p class="sub">部屋に招待されました</p>${demoNote()}</div>`;
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
  const seated = ctrl.seatedForNextGame();
  const seatedSet = new Set(seated.map((p) => p.uid));
  const meReady = ctrl.isReady();
  const g = ctrl.game;
  const last = g?.status === 'result' && g.result ? g : null;
  el.innerHTML = `
    <header class="lobby-head">
      <div><div class="muted">16組大富豪オンライン・部屋コード</div><div class="room-code">${esc(meta.code)}</div></div>
      <button class="btn small ghost" data-act="rules">ルール</button>
    </header>
    ${demoNote()}
    ${last ? `<section class="panel last-result">
      <h2>第${last.gameNo}ゲームの結果 <button class="btn small ghost" data-act="result">詳しく</button></h2>
      <ol class="mini-result">${last.result.ranking.map((u) => `<li>${esc(ctrl.player(u)?.name || '(退出)')} <span class="tag t-${last.result.titles[u]}">${TITLES[last.result.titles[u]]}</span></li>`).join('')}</ol>
    </section>` : ''}
    <section class="panel">
      <h2>待合室 <span class="muted">次のゲーム ${seated.length}人 / 部屋に${players.length}人</span></h2>
      <ol class="player-list">
        ${players
          .map((p) => {
            const off = p.online === false;
            const isHost = p.uid === meta.hostUid;
            const joins = seatedSet.has(p.uid);
            const state = off ? '<span class="tag off">切断中</span>' : joins ? '<span class="tag ok">参加</span>' : p.watch ? '<span class="tag">観戦</span>' : '<span class="tag">満席のため観戦</span>';
            return `<li class="${off ? 'offline' : ''}">
              <span class="dot ${off ? '' : 'on'}"></span>
              <span class="pname">${esc(p.name)}${p.uid === ctrl.uid ? '<span class="muted">(あなた)</span>' : ''}</span>
              ${isHost ? '<span class="host-mark">★ホスト</span>' : ''}
              ${p.cpu ? '<span class="tag cpu">🤖CPU</span>' : ''}
              ${state}
              <span class="pts">${(p.points || 0) > 0 ? '+' : ''}${p.points || 0}pt</span>
              ${ctrl.isHost && (off || p.cpu) && p.uid !== ctrl.uid ? `<button class="btn small ghost kick" data-act="kick" data-uid="${esc(p.uid)}">外す</button>` : ''}
            </li>`;
          })
          .join('')}
      </ol>
      <p class="muted small">部屋にいる人は全員参加します(参加順=席順・最大8人)。見るだけの人は「観戦にする」を押してください。切断中の人は入りません。</p>
    </section>
    ${carryPanel(seated)}
    <section class="panel settings-panel">
      <h2>ルール設定 <span class="muted">${ctrl.isHost ? 'ホストが変更できます・次のゲームから' : 'ホストが決めます'}</span></h2>
      <div class="setting-row">
        <span class="setting-name">ジョーカー</span>
        ${ctrl.isHost
          ? `<div class="seg">${[0, 1, 2].map((n) => `<button class="${ctrl.settings.jokers === n ? 'on' : ''}" data-act="jokers" data-n="${n}">${n}枚</button>`).join('')}</div>`
          : `<b>${ctrl.settings.jokers}枚</b>`}
      </div>
      <div class="setting-row">
        <span class="setting-name">数字縛り</span>
        ${ctrl.isHost
          ? `<div class="seg">${[[true, 'あり'], [false, 'なし']].map(([v, l]) => `<button class="${ctrl.settings.numberLock === v ? 'on' : ''}" data-act="numberLock" data-v="${v}">${l}</button>`).join('')}</div>`
          : `<b>${ctrl.settings.numberLock ? 'あり' : 'なし'}</b>`}
      </div>
      <p class="muted small">そのほかのルールは「ルール」ボタンで確認できます。</p>
    </section>
    <section class="panel settings-panel">
      <h2>この端末の設定</h2>
      ${[['bgm', 'BGM'], ['sound', '効果音']].map(([k, l]) => `<div class="setting-row">
        <span class="setting-name">${l}</span>
        <div class="seg">${[[true, 'オン'], [false, 'オフ']].map(([v, t]) => `<button class="${!!settings[k] === v ? 'on' : ''}" data-act="pref" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div>
      </div>`).join('')}
      <p class="muted small">BGM はゲームが始まると流れます。設定はこの端末だけに適用されます。ゲーム中もメニュー(≡)から切り替えられます。</p>
    </section>
    <div class="lobby-actions">
      ${ctrl.isHost
        ? `<button class="btn primary big wide" data-act="start" ${seated.length < 2 ? 'disabled' : ''}>ゲーム開始(${seated.length}人)</button>
           ${seated.length < 2 ? '<p class="muted center-text small">参加者が2人以上になると開始できます</p>' : ''}`
        : `<p class="muted center-text">${meReady ? `参加します。ホスト(${esc(host?.name || '?')})の開始を待っています…` : '観戦します。次のゲームには入りません'}</p>
           <button class="btn ${meReady ? 'ghost' : 'primary big'} wide" data-act="ready">${meReady ? '観戦にする(見るだけ)' : '参加に戻す'}</button>`}
      ${ctrl.isHost && cpus ? `<button class="btn wide" data-act="addCpu" ${players.length >= 8 ? 'disabled' : ''}>🤖 CPUを追加</button>
        ${cpus.countFor(ctrl.roomId) ? `<p class="muted center-text small">この端末で CPU ${cpus.countFor(ctrl.roomId)}人が動いています。この画面を開いている間だけ動きます</p>` : ''}` : ''}
      <button class="btn wide" data-act="share">招待URLを送る</button>
      ${!ctrl.isHost && hostAway ? '<button class="btn wide" data-act="takeHost">ホストを引き継ぐ</button>' : ''}
      <button class="btn ghost wide" data-act="leave">部屋を出る</button>
    </div>`;
  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act) return;
    sound.unlock();
    try {
      if (act === 'rules') openRules();
      if (act === 'share') share();
      if (act === 'result') showResult();
      if (act === 'ready') await ctrl.setReady(!meReady);
      if (act === 'kick') await ctrl.removePlayer(btn.dataset.uid);
      if (act === 'addCpu') {
        btn.disabled = true;
        await cpus.add(ctrl.roomId, nextCpuName());
      }
      if (act === 'jokers') await ctrl.setRule('jokers', Number(btn.dataset.n));
      if (act === 'numberLock') await ctrl.setRule('numberLock', btn.dataset.v === 'true');
      if (act === 'carry') openCarryEditor();
      if (act === 'pref') {
        settings[btn.dataset.k] = btn.dataset.v === 'true';
        saveSettings();
        if (btn.dataset.k === 'sound' && settings.sound) sound.play('turn');
        renderLobby();
      }
      if (act === 'start') await ctrl.startGame();
      if (act === 'takeHost') await ctrl.takeHost();
      if (act === 'leave') {
        await cpus?.stopAll(ctrl.roomId);
        await ctrl.leave();
        goTop();
      }
    } catch (err) {
      toast(err.message || String(err));
      renderLobby();
    }
  };
}

// 空いている「CPU1」「CPU2」…の名前
function nextCpuName() {
  const names = new Set(ctrl.players.map((p) => p.name));
  for (let i = 1; i <= 8; i++) if (!names.has(`CPU${i}`)) return `CPU${i}`;
  return 'CPU';
}

async function share() {
  const url = inviteUrl();
  const text = `16組大富豪オンラインで遊ぼう!部屋コード ${ctrl.room?.meta?.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '16組大富豪オンライン', text, url });
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

// ---------- 部屋の作り直し(引き継ぎ) ----------
function carryPanel(seated) {
  const c = ctrl.carry;
  if (!c) return '';
  const set = Object.keys(c.titles).length > 0 || c.order.length > 0 || c.first;
  const rows = seated
    .map((p, i) => {
      const t = c.titles[p.uid];
      return `<li><span class="seat-no">${i + 1}</span><span class="pname">${esc(p.name)}</span>
        ${t ? `<span class="tag t-${t}">${TITLES[t]}</span>` : '<span class="tag">平民</span>'}
        ${c.first === p.uid ? '<span class="tag ok">最初の親</span>' : ''}
        <span class="pts">${(p.points || 0) > 0 ? '+' : ''}${p.points || 0}pt</span></li>`;
    })
    .join('');
  return `<section class="panel carry-panel">
    <h2>前の部屋からの引き継ぎ <span class="muted">最初のゲームだけ</span></h2>
    <ol class="carry-list">${rows}</ol>
    <p class="muted small">${set ? 'この席順・称号で始めます。称号があればカード交換・都落ちもあります。' : 'まだ入力されていません(このままなら全員平民・0pt、席順は参加順)。'}${c.first ? '' : ' 最初の親は大貧民、いなければダイヤの3を持つ人です。'}</p>
    ${ctrl.isHost ? '<button class="btn wide" data-act="carry">席順・称号・ポイントを入力する</button>' : '<p class="muted small">ホストが入力します。</p>'}
  </section>`;
}

function openCarryEditor() {
  const c = ctrl.carry;
  if (!c) return;
  let list = ctrl.seatedForNextGame().map((p) => ({ uid: p.uid, name: p.name, title: c.titles[p.uid] || 'heimin', points: p.points || 0 }));
  let first = c.first || '';
  const body = document.createElement('div');
  const titleOpts = (sel) => Object.entries(TITLES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const draw = () => {
    body.innerHTML = `<h2>前の部屋からの引き継ぎ</h2>
      <p class="muted small">上から席順(時計回り)です。▲▼で並べ替えます。参加している人だけが出ます。</p>
      <ol class="carry-edit">${list
        .map((p, i) => `<li data-i="${i}">
          <span class="move"><button class="btn small ghost" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button><button class="btn small ghost" data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button></span>
          <div class="ce-main"><span class="pname">${i + 1}. ${esc(p.name)}</span>
            <div class="ce-fields"><select class="input" data-f="title" aria-label="${esc(p.name)}の称号">${titleOpts(p.title)}</select>
            <label class="pt-in"><input class="input" data-f="points" type="number" inputmode="numeric" step="1" value="${p.points}" aria-label="${esc(p.name)}のポイント">pt</label></div></div>
        </li>`)
        .join('')}</ol>
      <label class="field-label">最初の親
        <select class="input" name="first"><option value="">自動(大貧民。いなければダイヤの3を持つ人)</option>${list.map((p) => `<option value="${esc(p.uid)}" ${first === p.uid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <button class="btn primary wide" data-act="save">保存する</button>`;
  };
  draw();
  body.addEventListener('change', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) {
      const p = list[Number(li.dataset.i)];
      if (e.target.dataset.f === 'title') p.title = e.target.value;
      if (e.target.dataset.f === 'points') p.points = Math.round(Number(e.target.value) || 0);
    }
    if (e.target.name === 'first') first = e.target.value;
  });
  body.addEventListener('click', async (e) => {
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const i = Number(mv.closest('li').dataset.i), j = i + Number(mv.dataset.mv);
      [list[i], list[j]] = [list[j], list[i]];
      draw();
      return;
    }
    if (!e.target.closest('[data-act=save]')) return;
    // 大富豪・富豪・貧民・大貧民は1人ずつまで
    for (const t of ['daifugo', 'fugo', 'hinmin', 'daihinmin']) {
      if (list.filter((p) => p.title === t).length > 1) return toast(`${TITLES[t]}は1人だけにしてください`);
    }
    const titles = {}, points = {};
    for (const p of list) {
      if (p.title !== 'heimin') titles[p.uid] = p.title;
      points[p.uid] = p.points;
    }
    try {
      await ctrl.setCarry({ order: list.map((p) => p.uid), titles, first: first || null, points });
      closeModal();
      toast('保存しました');
    } catch (err) {
      toast(err.message || String(err));
    }
  });
  openModal(body);
}

// ---------- ゲーム ----------
function showGame() {
  screen = 'game';
  setUrl(ctrl.roomId);
  app.innerHTML = '<div class="game-root"></div>';
  view = new GameView(app.querySelector('.game-root'), ctrl, settings, {
    openRules, openMenu, saveSettings, showResult,
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
    <p class="muted small">次のゲームは、待合室にいる人(観戦を選んだ人を除く)で始めます。</p>
    <button class="btn primary wide big" data-act="close">待合室へ</button>`;
  body.onclick = (e) => {
    if (e.target.closest('[data-act=close]')) closeModal();
  };
  openModal(body);
}

function openRules() {
  const modal = openModal(`<div class="rules">${rulesHtml(ctrl.activeRules)}</div>`);
  modal.addEventListener('click', (e) => {
    const id = e.target.closest('[data-jump]')?.dataset.jump;
    if (!id) return;
    const sec = modal.querySelector('#' + id);
    sec?.querySelector('details')?.setAttribute('open', '');
    sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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
      <label class="switch"><span>BGM</span><input type="checkbox" name="bgm"></label>
      <label class="switch"><span>効果音</span><input type="checkbox" name="sound"></label>
      <label class="switch"><span>振動(対応端末のみ)</span><input type="checkbox" name="vibrate"></label>
    </div>
    <button class="btn wide" data-act="share">招待URLを送る</button>
    ${!ctrl.isHost && hostAway ? '<button class="btn wide" data-act="takeHost">ホストを引き継ぐ</button>' : ''}
    ${ctrl.isHost && ctrl.inGame ? '<button class="btn wide" data-act="abort">ゲームを中止して待合室へ</button>' : ''}
    <button class="btn ghost wide" data-act="leave">部屋を出る</button>
    <p class="muted small">ゲーム中に部屋を出ても席は残ります。同じURLから戻れます。</p>`;
  body.querySelector('[name=sort]').value = settings.sort;
  for (const k of ['hint', 'bgm', 'sound', 'vibrate']) body.querySelector(`[name=${k}]`).checked = !!settings[k];
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
      if (act === 'abort') {
        if (!confirm('このゲームを中止して待合室に戻りますか?(ポイントは付きません)')) return;
        closeModal();
        await ctrl.backToLobby();
      }
      if (act === 'leave') {
        closeModal(true);
        await cpus?.stopAll(ctrl.roomId);
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

// ---------- 新しいバージョンのお知らせ ----------
// 公開時に index.html へ版を埋め込む(scripts/stamp-version.mjs)。開いたままの画面でも更新に気づけるようにする
const APP_VERSION = document.querySelector('meta[name=app-version]')?.content || null;
let updateShown = false;
async function checkUpdate() {
  if (!APP_VERSION || updateShown) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== APP_VERSION) {
      updateShown = true;
      const bar = document.createElement('div');
      bar.className = 'update-bar';
      bar.innerHTML = '<span>新しいバージョンがあります</span><button class="btn small">再読み込み</button>';
      bar.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(bar);
    }
  } catch { /* オフラインなど */ }
}
if (APP_VERSION) {
  setInterval(checkUpdate, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkUpdate();
  });
}

boot();
