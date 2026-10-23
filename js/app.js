/* ════════════════════════════════════
   APP — boot, tab router, targeted re-rendering, write-failure banner
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  // A script that failed to download (e.g. a CDN 503 mid-deploy) would otherwise leave
  // buttons that silently do nothing — stop and offer a reload instead.
  const REQUIRED = ['util', 'units', 'schema', 'domain', 'db', 'repo', 'toast', 'sheet', 'entry', 'rest', 'exercises', 'workout', 'charts', 'trackers', 'backup', 'data', 'legacy', 'legacyImport', 'demo', 'views'];
  const VIEWS = ['today', 'workout', 'history', 'insights', 'more'];
  const missing = REQUIRED.filter(k => !HL[k]).concat(VIEWS.filter(v => !HL.views?.[v]));
  if (missing.length) {
    document.querySelector('main').innerHTML = `
      <div class="view"><div class="empty-state" role="alert">
        <span class="empty-icon" aria-hidden="true">⚠</span>
        <strong>Part of the app didn't download</strong>
        Usually a brief network or server hiccup. Your data is safe — reload to fix it.
        <p class="block-top"><button type="button" class="btn btn-primary" id="fatal-retry">Reload</button></p>
      </div></div>`;
    document.getElementById('fatal-retry').addEventListener('click', () => location.reload());
    return;
  }

  const { util, repo } = HL;

  let active = 'today';
  let currentDay = util.dayKey();
  let rafId = null;
  const dirty = new Set(VIEWS);
  const viewEl = name => document.getElementById(`view-${name}`);

  /* ════════════════════════════════════
     RENDERING — only the visible view re-renders; others are marked dirty
     ════════════════════════════════════ */
  // Keep keyboard / VoiceOver focus on the same control across a re-render
  function focusKey(el) {
    const a = document.activeElement;
    if (!a || !el.contains(a)) return null;
    if (a.id) return `#${CSS.escape(a.id)}`;
    const sel = a.getAttributeNames().filter(n => n.startsWith('data-')).map(n => `[${n}="${CSS.escape(a.getAttribute(n))}"]`).join('');
    return sel || null;
  }

  function renderView(name) {
    const el = viewEl(name);
    const key = focusKey(el);
    HL.views[name].render(el);
    dirty.delete(name);
    if (key) el.querySelector(key)?.focus({ preventScroll: true });
  }

  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (dirty.has(active)) renderView(active);
    });
  }

  function markDirty(store) {
    for (const name of VIEWS) {
      const stores = HL.views[name]?.stores;
      if (!store || !stores || stores.includes(store)) dirty.add(name);
    }
    scheduleRender();
  }

  function show(name) {
    if (!VIEWS.includes(name)) return;
    active = name;
    for (const v of VIEWS) viewEl(v).hidden = v !== name;
    for (const b of util.$$('.tab-btn')) {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (dirty.has(name)) renderView(name);
    HL.views[name]?.onShow?.(viewEl(name));
  }

  /* ════════════════════════════════════
     BANNERS
     ════════════════════════════════════ */
  function showWriteBanner({ ok, pending }) {
    const root = document.getElementById('banners');
    root.querySelector('[data-banner="write"]')?.remove();
    if (ok) { HL.toast('All changes saved'); return; }
    root.insertAdjacentHTML('afterbegin', `
      <div class="banner error" data-banner="write" role="alert">
        <span aria-hidden="true">⚠</span>
        <span class="banner-msg">${pending} change${pending === 1 ? '' : 's'} not saved to storage yet. Kept in memory — retrying.</span>
        <button type="button" class="btn btn-ghost btn-sm" data-banner-act="retry">Retry</button>
      </div>`);
  }

  function showFatal(err) {
    document.querySelector('main').innerHTML = `
      <div class="view"><div class="empty-state" role="alert">
        <span class="empty-icon" aria-hidden="true">⚠</span>
        <strong>Health Log couldn't open its storage</strong>${util.esc(err.message || String(err))}
        <p class="block-top"><button type="button" class="btn btn-primary" id="fatal-retry">Try again</button></p>
      </div></div>`;
    document.getElementById('fatal-retry').addEventListener('click', () => location.reload());
  }

  /* ════════════════════════════════════
     THEME — dark by default; "auto" follows the phone
     ════════════════════════════════════ */
  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

  function applyTheme() {
    const pref = repo.getSettings().theme;
    const theme = pref === 'auto' ? (lightQuery.matches ? 'light' : 'dark') : pref;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f5f4f1' : '#0f0f0f';
  }

  /* ════════════════════════════════════
     OFFLINE / UPDATES — a new version waits for a tap instead of silently swapping code
     ════════════════════════════════════ */
  function showUpdateBanner(worker) {
    const root = document.getElementById('banners');
    if (root.querySelector('[data-banner="update"]')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="banner" data-banner="update" role="status">
        <span aria-hidden="true">✨</span>
        <span class="banner-msg">A new version of Health Log is ready.</span>
        <button type="button" class="btn btn-primary btn-sm" data-banner-act="update">Refresh</button>
      </div>`);
    root.querySelector('[data-banner-act="update"]').addEventListener('click', async () => {
      await repo.flushNow().catch(() => {});
      worker.postMessage('SKIP_WAITING');
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const watch = w => w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(w);
      });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      // A home-screen app can stay open for days: look for updates whenever it comes back
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      (await navigator.serviceWorker.ready).active?.postMessage('ENSURE_CACHE');
    } catch (err) {
      HL.toast(`Offline mode couldn’t start: ${err.message}`, { kind: 'error' });
    }
  }

  /* ════════════════════════════════════
     BOOT
     ════════════════════════════════════ */
  function wire() {
    document.querySelector('.tabbar').addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (btn) show(btn.dataset.view);
    });
    for (const name of VIEWS) {
      const el = viewEl(name);
      el.addEventListener('click', e => HL.views[name]?.onClick?.(e));
      el.addEventListener('change', e => HL.views[name]?.onChange?.(e));
      el.addEventListener('input', e => HL.views[name]?.onInput?.(e));
    }
    document.getElementById('banners').addEventListener('click', e => {
      if (e.target.closest('[data-banner-act="retry"]')) repo.flush();
    });

    repo.on('change', ({ store }) => markDirty(store));
    repo.on('settings', () => { applyTheme(); markDirty(null); });
    lightQuery.addEventListener('change', () => { applyTheme(); markDirty(null); });
    repo.on('writestatus', showWriteBanner);
    repo.on('error', ({ message }) => HL.toast(message, { kind: 'error' }));

    // Never fail silently: surface unexpected errors (data already saved stays saved)
    const report = err => HL.toast(`Something went wrong: ${err?.message || err}. Try again or reload.`, { kind: 'error', duration: 8000 });
    window.addEventListener('error', e => report(e.error || e.message));
    window.addEventListener('unhandledrejection', e => report(e.reason));

    // Get queued writes to disk before iOS suspends or kills the page
    const flushIfHidden = () => { if (document.visibilityState === 'hidden') repo.flush(); };
    document.addEventListener('visibilitychange', () => { flushIfHidden(); checkDayRollover(); });
    window.addEventListener('pagehide', () => repo.flush());
    setInterval(checkDayRollover, 60000);
  }

  function checkDayRollover() {
    const today = util.dayKey();
    if (today === currentDay) return;
    currentDay = today;
    markDirty(null);
  }

  async function start() {
    try {
      await repo.boot();
    } catch (err) {
      showFatal(err);
      return;
    }
    wire();
    applyTheme();
    for (const name of VIEWS) HL.views[name]?.init?.();
    show('today');
    registerServiceWorker();
    HL.data.requestPersist();
  }

  HL.app = { show, start, markDirty };
  start();
})(globalThis.HL = globalThis.HL || {});
