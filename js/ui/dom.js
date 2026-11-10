export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

let onCloseCb = null;
export function openModal(content, onClose) {
  const root = document.getElementById('modal-root');
  closeModal(true);
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="閉じる">×</button></div>';
  const modal = wrap.firstChild;
  if (typeof content === 'string') modal.insertAdjacentHTML('beforeend', content);
  else modal.appendChild(content);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.modal-x')) closeModal();
  });
  root.appendChild(wrap);
  onCloseCb = onClose || null;
  requestAnimationFrame(() => wrap.classList.add('show'));
  return modal;
}

export function closeModal(silent = false) {
  const root = document.getElementById('modal-root');
  const cb = onCloseCb;
  onCloseCb = null;
  root.innerHTML = '';
  if (!silent) cb?.();
}
