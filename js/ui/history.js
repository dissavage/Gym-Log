/* ════════════════════════════════════
   HISTORY — every log in one feed, grouped by day, rendered a page at a time
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo } = HL;
  const { esc } = util;
  const PAGE = 50;

  let filter = '';
  let rows = [];
  let shown = 0;
  let observer = null;

  function render(el) {
    const trackers = repo.trackers({ archived: true });
    const all = repo.entries();
    const used = new Set(all.map(e => e.type));
    rows = filter ? all.filter(e => e.type === filter) : all;
    shown = 0;
    observer?.disconnect();

    el.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">History</h1>
        <p class="page-sub">${all.length ? `${all.length.toLocaleString()} log${all.length === 1 ? '' : 's'}` : 'Everything you log shows up here'}</p></div></header>
      ${used.size ? `
        <div class="filter-row" role="group" aria-label="Filter by tracker">
          <button type="button" class="chip" data-filter="" aria-pressed="${!filter}">All</button>
          ${trackers.filter(t => used.has(t.key)).map(t =>
            `<button type="button" class="chip" data-filter="${esc(t.key)}" aria-pressed="${filter === t.key}"><span aria-hidden="true">${t.icon}</span> ${esc(t.name)}</button>`).join('')}
        </div>` : ''}
      <div id="hist-feed"></div>
      <div id="hist-more" class="hist-more" aria-hidden="true"></div>`;

    const feed = el.querySelector('#hist-feed');
    if (!rows.length) {
      feed.innerHTML = `<div class="empty-state"><strong>${all.length ? 'Nothing logged for this tracker yet' : 'No logs yet'}</strong>
        ${all.length ? 'Pick another filter, or log one from Today.' : 'Head to Today and tap a tile — your first log will appear here.'}</div>`;
      return;
    }
    appendPage(feed);
    const sentinel = el.querySelector('#hist-more');
    observer = new IntersectionObserver(obs => { if (obs[0].isIntersecting) appendPage(feed); }, { root: el, rootMargin: '400px' });
    observer.observe(sentinel);
  }

  // Append the next page without touching what's already rendered
  function appendPage(feed) {
    if (shown >= rows.length) return;
    const prefs = repo.getSettings().units;
    const page = rows.slice(shown, shown + PAGE);
    // A day split across pages keeps filling the list already on screen
    let list = feed.lastElementChild?.tagName === 'UL' ? feed.lastElementChild : null;
    let day = shown ? rows[shown - 1].dayKey : null;
    for (const e of page) {
      if (!list || e.dayKey !== day) {
        feed.insertAdjacentHTML('beforeend', `<h2 class="day-hdr">${esc(dayLabel(e.dayKey))}</h2><ul class="log-list card"></ul>`);
        list = feed.lastElementChild;
        day = e.dayKey;
      }
      list.insertAdjacentHTML('beforeend', rowHtml(e, prefs));
    }
    shown += page.length;
  }

  function dayLabel(key) {
    const today = util.dayKey();
    if (key === today) return 'Today';
    if (key === util.addDays(today, -1)) return 'Yesterday';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (key.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
    return util.fmtDay(key, opts);
  }

  function rowHtml(e, prefs) {
    const t = repo.tracker(e.type);
    if (!t) return '';
    let title = t.name;
    let sum = domain.summarizeEntry(t, e, prefs);
    if (t.kind === 'workout') {
      const s = domain.workoutSummary(e.values);
      title = e.values.name || 'Workout';
      sum = [`${s.exercises} exercise${s.exercises === 1 ? '' : 's'}`, `${s.workingSets} sets`,
        e.values.durationMin ? util.fmtDuration(e.values.durationMin) : '', s.volume ? units.format('mass', s.volume, prefs, 0) : '']
        .filter(Boolean).join(' · ');
    }
    return `
      <li><button type="button" class="log-row" data-edit="${e.id}">
        <span class="log-icon" aria-hidden="true">${t.icon}</span>
        <span class="log-main"><span class="log-name">${esc(title)}</span>
          <span class="log-sum">${esc(sum || 'No values')}</span></span>
        <span class="log-time">${esc(util.fmtTime(e.timestamp))}</span>
      </button></li>`;
  }

  function onClick(e) {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; render(document.getElementById('view-history')); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const entry = repo.get('entries', edit.dataset.edit);
      if (entry) HL.entry.open(entry.type, { entry });
    }
  }

  HL.views = HL.views || {};
  HL.views.history = { stores: ['entries', 'trackers', 'exercises'], render, onClick };
})(globalThis.HL = globalThis.HL || {});
