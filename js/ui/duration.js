/* ════════════════════════════════════
   DURATION FIELD — a rest time shown as "1:30" with a Custom button that opens
   minutes/seconds fields and −15s / +15s steppers (range 0:05–15:00)
   The value lives in a hidden input (seconds; '' = use the default) that fires a bubbling
   'change' when it's committed: on a stepper, Done, Use default, or leaving the fields.
   Typing alone doesn't commit, so a view that re-renders on save never fights the keyboard.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { esc, parseDuration, formatDuration } = HL.util;
  const MIN = 5;
  const MAX = 15 * 60;
  const STEP = 15;
  const open = new Set();   // ids of fields whose Custom panel is open (UI only; survives re-renders)

  const clamp = sec => Math.min(MAX, Math.max(MIN, sec));
  const shown = (value, fallback) => (value == null ? `Default · ${formatDuration(fallback)}` : formatDuration(value));

  /**
   * html({ id, name, label, sub, value, fallback, labelClass })
   * value: seconds, or null for "use the default" (only when `fallback`, the default's seconds, is given)
   */
  function html({ id, name, label, sub = '', value, fallback = null, labelClass = 'settings-lbl' }) {
    const isOpen = open.has(id);
    const sec = value ?? fallback ?? 90;
    return `
      <div class="dur-field" data-dur="${esc(id)}" data-fallback="${fallback ?? ''}">
        <input type="hidden" name="${esc(name)}" value="${value ?? ''}">
        <div class="dur-row">
          <div class="grow"><div class="${labelClass}" id="${esc(id)}-lbl">${esc(label)}</div>${sub ? `<div class="settings-sub">${esc(sub)}</div>` : ''}</div>
          <span class="dur-value" data-dur-value>${esc(shown(value, fallback))}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-dur-act="toggle" aria-expanded="${isOpen}" aria-controls="${esc(id)}-panel">Custom</button>
        </div>
        <div class="dur-panel" id="${esc(id)}-panel" role="group" aria-labelledby="${esc(id)}-lbl" ${isOpen ? '' : 'hidden'}>
          <div class="dur-edit">
            <button type="button" class="btn btn-ghost btn-sm" data-dur-act="step" data-dur-step="-${STEP}" aria-label="15 seconds less">−15s</button>
            <input class="input dur-in" id="${esc(id)}-m" data-dur-part="m" inputmode="numeric" autocomplete="off" value="${Math.floor(sec / 60)}" aria-label="Minutes">
            <span class="dur-sep" aria-hidden="true">:</span>
            <input class="input dur-in" id="${esc(id)}-s" data-dur-part="s" inputmode="numeric" autocomplete="off" value="${String(sec % 60).padStart(2, '0')}" aria-label="Seconds">
            <button type="button" class="btn btn-ghost btn-sm" data-dur-act="step" data-dur-step="${STEP}" aria-label="15 seconds more">+15s</button>
          </div>
          <p class="field-hint">From 0:05 to 15:00</p>
          <div class="dur-actions">
            ${fallback != null ? '<button type="button" class="btn btn-ghost btn-sm" data-dur-act="default">Use default</button>' : ''}
            <button type="button" class="btn btn-primary btn-sm" data-dur-act="done">Done</button>
          </div>
        </div>
      </div>`;
  }

  const parts = field => [field.querySelector('[data-dur-part="m"]'), field.querySelector('[data-dur-part="s"]')];

  // What the fields say, normalised (0:90 → 1:30) and kept in range
  function read(field) {
    const [m, s] = parts(field);
    const sec = parseDuration(`${m.value.trim() || 0}:${s.value.trim() || 0}`);
    return sec == null ? null : clamp(sec);
  }

  function write(field, sec) {
    const [m, s] = parts(field);
    m.value = Math.floor(sec / 60);
    s.value = String(sec % 60).padStart(2, '0');
  }

  function commit(field, sec) {
    const hidden = field.querySelector('input[type="hidden"]');
    const fallback = field.dataset.fallback === '' ? null : Number(field.dataset.fallback);
    if (sec != null) write(field, sec);
    field.querySelector('[data-dur-value]').textContent = shown(sec, fallback);
    const next = sec == null ? '' : String(sec);
    if (hidden.value === next) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Commit what was typed, or put the saved value back if it doesn't parse
  function settle(field) {
    const sec = read(field);
    if (sec != null) { commit(field, sec); return; }
    const saved = field.querySelector('input[type="hidden"]').value;
    write(field, Number(saved || field.dataset.fallback) || 90);
  }

  function setOpen(field, on) {
    on ? open.add(field.dataset.dur) : open.delete(field.dataset.dur);
    const toggle = field.querySelector('[data-dur-act="toggle"]');
    const panel = field.querySelector('.dur-panel');
    if (!on && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });   // don't drop focus with the panel
    panel.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    // Low in a sheet the panel opens behind the footer: bring it up
    if (on) panel.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-dur-act]');
    const field = btn?.closest('[data-dur]');
    if (!field) return;
    const act = btn.dataset.durAct;
    if (act === 'toggle') setOpen(field, !open.has(field.dataset.dur));
    if (act === 'step') {
      const fallback = Number(field.dataset.fallback) || 90;
      commit(field, clamp((read(field) ?? fallback) + Number(btn.dataset.durStep)));
    }
    if (act === 'done') { settle(field); setOpen(field, false); }
    if (act === 'default') {
      write(field, Number(field.dataset.fallback));
      commit(field, null);
      setOpen(field, false);
    }
  });

  // Live preview while typing; the value commits when focus leaves the minutes/seconds pair
  document.addEventListener('input', e => {
    const field = e.target.dataset?.durPart && e.target.closest('[data-dur]');
    if (!field) return;
    const sec = read(field);
    if (sec != null) field.querySelector('[data-dur-value]').textContent = formatDuration(sec);
  });

  document.addEventListener('focusout', e => {
    const field = e.target.dataset?.durPart && e.target.closest('[data-dur]');
    if (!field || field.contains(e.relatedTarget) && e.relatedTarget?.dataset.durPart) return;
    settle(field);
  });

  // Enter commits (inside a sheet's form it would otherwise submit before the value is in)
  document.addEventListener('keydown', e => {
    const field = e.key === 'Enter' && e.target.dataset?.durPart && e.target.closest('[data-dur]');
    if (!field) return;
    e.preventDefault();
    settle(field);
  });

  HL.durationField = { html, MIN, MAX };
})(globalThis.HL = globalThis.HL || {});
