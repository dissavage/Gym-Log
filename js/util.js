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

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /* ── DOM ── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  HL.util = {
    esc, uuid, localISO, dayKey, dayKeyOf, parseDayKey, addDays, daysBetween, tzName,
    fmtDay, fmtTime, fmtClock, fmtDuration, toInputDateTime,
    round, fmtNum, parseNum, clamp, $, $$, debounce,
  };
})(globalThis.HL = globalThis.HL || {});
