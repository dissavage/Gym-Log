/* ════════════════════════════════════
   SHEET — bottom sheet dialog used for every entry form
   Background is made inert while open; Esc, backdrop tap and drag-down close it.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { esc, icon: svg } = HL.util;
  const stack = [];
  let seq = 0;

  function setBackgroundInert() {
    const top = stack[stack.length - 1];
    for (const el of document.querySelectorAll('body > :not(script):not(#toast-root)')) {
      el.inert = stack.length > 0 && el !== top?.backdrop;
    }
  }

  /**
   * open({ title, icon, body, footer, cancel, onSubmit(form, api), onMount(api), onClose() })
   * icon is trusted HTML (util.icon / util.trackerIcon); body/footer are HTML strings, and footer
   * buttons live inside the form so type="submit" works. A footer without its own ghost button
   * gets one that closes the sheet: `cancel` is its label, false leaves it out.
   */
  function open({ title, icon = '', body = '', footer = '', cancel = 'Cancel', onSubmit, onMount, onClose }) {
    const id = `sheet-title-${++seq}`;
    const opener = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    const ftr = footer && cancel !== false && !footer.includes('btn-ghost')
      ? `<button type="button" class="btn btn-ghost" data-sheet-cancel>${esc(cancel)}</button>${footer}` : footer;
    backdrop.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-hdr">
          ${icon ? `<span class="sheet-ico" aria-hidden="true">${icon}</span>` : ''}
          <h2 class="sheet-title" id="${id}">${esc(title)}</h2>
          <button type="button" class="icon-btn sheet-close" aria-label="Close">${svg('close', 20)}</button>
        </div>
        <form class="sheet-form" novalidate autocomplete="off">
          <div class="sheet-body">${body}</div>
          ${ftr ? `<div class="sheet-ftr">${ftr}</div>` : ''}
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const sheet = backdrop.querySelector('.sheet');
    const form = backdrop.querySelector('form');
    let closed = false;

    const api = {
      el: sheet, form, body: backdrop.querySelector('.sheet-body'),
      close() {
        if (closed) return;
        closed = true;
        stack.splice(stack.indexOf(entry), 1);
        backdrop.remove();
        setBackgroundInert();
        onClose?.();
        if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      },
    };
    const entry = { backdrop, api };
    stack.push(entry);
    setBackgroundInert();

    backdrop.addEventListener('click', e => { if (e.target === backdrop) api.close(); });
    backdrop.querySelector('.sheet-close').addEventListener('click', api.close);
    backdrop.querySelector('[data-sheet-cancel]')?.addEventListener('click', api.close);
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
    form.addEventListener('submit', e => { e.preventDefault(); onSubmit?.(form, api); });
    enableDragToClose(backdrop.querySelector('.sheet-handle'), sheet, api.close);

    onMount?.(api);
    const auto = sheet.querySelector('[autofocus]');
    (auto || backdrop.querySelector('.sheet-close')).focus({ preventScroll: true });
    return api;
  }

  function enableDragToClose(handle, sheet, close) {
    let startY = null;
    handle.addEventListener('pointerdown', e => {
      startY = e.clientY;
      try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
      sheet.style.transition = 'none';
    });
    handle.addEventListener('pointermove', e => {
      if (startY == null) return;
      const dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    const end = e => {
      if (startY == null) return;
      const dy = e.clientY - startY;
      startY = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 90) close();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  HL.sheet = { open };
})(globalThis.HL = globalThis.HL || {});
