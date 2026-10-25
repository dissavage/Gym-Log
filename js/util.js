/* ════════════════════════════════════
   UTIL — shared helpers (no app state)
   Classic scripts on one HL namespace so the app also runs from file://
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // crypto.randomUUID needs a secure context; fall back for odd file:// setups
  function uuid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /* ── Dates ── timestamps keep the local offset so the day a log belongs to never shifts */
  function localISO(d = new Date()) {
    const off = -d.getTimezoneOffset();
    const a = Math.abs(off);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
      `T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}` +
      `${off >= 0 ? '+' : '-'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  }

  function dayKey(d = new Date()) {
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }

  // Offset-carrying timestamps already hold their local date; UTC ('Z') ones are converted
  function dayKeyOf(iso) {
    if (/[+-]\d\d:\d\d$/.test(iso)) return iso.slice(0, 10);
    return dayKey(new Date(iso));
  }

  function parseDayKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(key, n) {
    const d = parseDayKey(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  function daysBetween(a, b) {
    return Math.round((parseDayKey(b) - parseDayKey(a)) / 86400000);
  }

  // First day of the week containing `key`; weekStart 0 = Sunday, 1 = Monday
  function weekStartOf(key, weekStart = 1) {
    const dow = parseDayKey(key).getDay();
    return addDays(key, -((dow - weekStart + 7) % 7));
  }

  function tzName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  }

  function fmtDay(key, opts = { weekday: 'long', month: 'short', day: 'numeric' }) {
    return parseDayKey(key).toLocaleDateString(undefined, opts);
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // 'HH:MM' → locale clock string
  function fmtClock(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function fmtDuration(min) {
    if (min == null || isNaN(min)) return '';
    const m = Math.round(min);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${p2(m % 60)}m`;
  }

  // Rest-style durations in seconds ↔ 'm:ss' (fmtDuration above is for workout lengths in minutes).
  // '1:30' → 90, '90' → 90, '1:5' → 65, '0:90' → 150; anything else → null. No range clamping here.
  function parseDuration(str) {
    const m = /^(?:(\d+):)?(\d+)$/.exec(String(str ?? '').trim());
    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
  }

  function formatDuration(sec) {
    if (sec == null || isNaN(sec)) return '';
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${p2(s % 60)}`;
  }

  // datetime-local input value ↔ Date
  function toInputDateTime(iso) {
    const d = new Date(iso);
    return `${dayKey(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  /* ── Numbers ── */
  function round(n, dp = 0) {
    const f = 10 ** dp;
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function fmtNum(n, dp = 0) {
    if (n == null || isNaN(n)) return '';
    return round(n, dp).toLocaleString(undefined, { maximumFractionDigits: dp });
  }

  function parseNum(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /* ── Icons ── inline stroke SVGs (currentColor), decorative: callers provide the accessible name */
  const ICONS = {
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    workout: '<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>',
    history: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    insights: '<path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16v-3"/>',
    more: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    body: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a4 4 0 0 1 8 0M12 10l1.5-2"/>',
    nutrition: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10"/>',
    hydration: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
    cardio: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    mood: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 9.5h.01M15 9.5h.01"/>',
    supplements: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12l5 5 9-10" stroke-width="3"/>',
    'chev-right': '<path d="M9 6l6 6-6 6"/>',
    'chev-left': '<path d="M15 6l-6 6 6 6"/>',
    'chev-down': '<path d="M6 9l6 6 6-6"/>',
    'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
    'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    repeat: '<path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6"/>',
    upload: '<path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    alert: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 10a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3M7.5 15h9"/>',
    play: '<path d="M7 5v14l11-7z" fill="currentColor"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    dots: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  };
  const TRACKER_ICONS = new Set(['workout', 'body', 'nutrition', 'hydration', 'cardio', 'sleep', 'mood', 'supplements']);

  function icon(name, size = 22) {
    return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  // Built-in trackers get their SVG; custom trackers keep the emoji the person chose
  function trackerIcon(tracker, size = 22) {
    if (tracker.builtIn && TRACKER_ICONS.has(tracker.key)) return icon(tracker.key, size);
    return `<span class="ico-emoji" style="font-size:${Math.round(size * 0.9)}px" aria-hidden="true">${esc(tracker.icon || '•')}</span>`;
  }

  /* ── DOM ── */
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  HL.util = {
    esc, uuid, localISO, dayKey, dayKeyOf, parseDayKey, addDays, daysBetween, weekStartOf, tzName,
    fmtDay, fmtTime, fmtClock, fmtDuration, parseDuration, formatDuration, toInputDateTime,
    round, fmtNum, parseNum, $$, debounce, icon, trackerIcon,
  };
})(globalThis.HL = globalThis.HL || {});
