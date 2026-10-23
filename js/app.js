/* ════════════════════════════════════
   APP — boot, tab router, targeted re-rendering, write-failure banner
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, repo } = HL;
  const VIEWS = ['today', 'workout', 'history', 'insights', 'more'];
  const PLACEHOLDERS = {
    workout:  ['🏋️', 'Workout mode', 'Templates, set logging and the rest timer arrive in Phase 2.'],
    history:  ['📋', 'History', 'A searchable feed of everything you log arrives in Phase 3.'],
    insights: ['📈', 'Insights', 'PRs, weekly volume and trend charts arrive in Phase 3.'],
  };

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
    for (const attr of a.getAttributeNames()) if (attr.startsWith('data-')) return `[${attr}="${CSS.escape(a.getAttribute(attr))}"]`;
    return a.id ? `#${CSS.escape(a.id)}` : null;
  }

  function renderView(name) {
    const el = viewEl(name);
    const view = HL.views[name];
    const key = focusKey(el);
    if (view) {
      view.render(el);
    } else {
      const [icon, title, msg] = PLACEHOLDERS[name];
      el.innerHTML = `
        <header class="page-head"><div><h1 class="page-title">${title}</h1></div></header>
        <div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><strong>Coming soon</strong>${msg}</div>`;
    }
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
    repo.on('settings', () => markDirty(null));
    repo.on('writestatus', showWriteBanner);
    repo.on('error', ({ message }) => HL.toast(message, { kind: 'error' }));

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
    show('today');
  }

  HL.app = { show, start, markDirty };
  start();
})(globalThis.HL = globalThis.HL || {});
