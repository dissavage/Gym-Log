/* ════════════════════════════════════
   TOAST — one at a time; kind is shown by icon + text, not color alone
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const ICONS = { ok: '✓', error: '⚠', info: 'ℹ' };
  let timer = null;

  function toast(msg, { kind = 'ok', action = null, duration } = {}) {
    const root = document.getElementById('toast-root');
    clearTimeout(timer);
    root.innerHTML = '';
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    // #toast-root is already a polite live region; errors interrupt as alerts
    if (kind === 'error') el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${ICONS[kind] || ''}</span>
      <span class="toast-msg">${kind === 'error' ? '<span class="sr-only">Error: </span>' : ''}${HL.util.esc(msg)}</span>
      ${action ? `<button type="button" class="toast-action">${HL.util.esc(action.label)}</button>` : ''}`;
    const dismiss = () => { clearTimeout(timer); el.remove(); };
    if (action) {
      el.querySelector('.toast-action').addEventListener('click', () => { dismiss(); action.fn(); });
    }
    root.appendChild(el);
    timer = setTimeout(dismiss, duration ?? (action ? 6000 : kind === 'error' ? 5000 : 2600));
    return { dismiss };
  }

  // Standard "Deleted · Undo" toast for soft deletes
  function undoToast(msg, undo) {
    return toast(msg, { kind: 'info', action: { label: 'Undo', fn: undo } });
  }

  HL.toast = toast;
  HL.undoToast = undoToast;
})(globalThis.HL = globalThis.HL || {});
