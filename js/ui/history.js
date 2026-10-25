/* ════════════════════════════════════
   HISTORY — every log in one feed, grouped by day, rendered a page at a time
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, domain, repo } = HL;
  const { esc } = util;
  const PAGE = 50;
  const WORKOUT = 'workout';

  let filter = '';
  let tpl = '';          // second filter, workouts only: a template id, 'other' (no or deleted template), or ''
  let rows = [];
  let shown = 0;
  let observer = null;

  function render(el) {
    const trackers = repo.trackers({ archived: true });
    const all = repo.entries();
    const used = new Set(all.map(e => e.type));
    const templates = repo.all('templates').sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const live = new Set(templates.map(t => t.id));
    const groupOf = e => (live.has(e.values.templateId) ? e.values.templateId : 'other');
    const groups = new Set(all.filter(e => e.type === WORKOUT).map(groupOf));
    if (!groups.has(tpl)) tpl = '';
    const tplChips = [
      ...templates.filter(t => groups.has(t.id)).map(t =>
        `<button type="button" class="chip c-${esc(t.color || 'orange')}" data-tpl="${t.id}" aria-pressed="${tpl === t.id}"><span class="tpl-dot" aria-hidden="true"></span><span>${esc(t.name)}</span></button>`),
      ...(groups.has('other') ? [`<button type="button" class="chip" data-tpl="other" aria-pressed="${tpl === 'other'}">Other</button>`] : []),
    ];
    rows = all.filter(e => (!filter || e.type === filter) && (!tpl || (e.type === WORKOUT && groupOf(e) === tpl)));
    shown = 0;
    observer?.disconnect();

    el.innerHTML = `
      <header class="page-head"><div>
        <p class="page-kicker">${all.length ? `${all.length.toLocaleString()} log${all.length === 1 ? '' : 's'}` : 'Everything you log shows up here'}</p><h1 class="page-title">History</h1></div></header>
      ${used.size ? `
        <div class="filter-row" role="group" aria-label="Filter by tracker">
          <button type="button" class="chip" data-filter="" aria-pressed="${!filter}">All</button>
          ${trackers.filter(t => used.has(t.key)).map(t =>
            `<button type="button" class="chip" data-filter="${esc(t.key)}" aria-pressed="${filter === t.key}">${util.trackerIcon(t, 16)}<span>${esc(t.name)}</span></button>`).join('')}
        </div>` : ''}
      ${tplChips.length > 1 && (!filter || filter === WORKOUT) ? `
        <div class="filter-row" role="group" aria-label="Filter workouts by template">${tplChips.join('')}</div>` : ''}
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
        feed.insertAdjacentHTML('beforeend', `<h2 class="day-hdr section-label">${esc(dayLabel(e.dayKey))}</h2><ul class="log-list card"></ul>`);
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
    const wo = t.kind === 'workout';
    if (wo) {
      const s = domain.workoutSummary(e.values);
      title = e.values.name || 'Workout';
      sum = [`${s.exercises} exercise${s.exercises === 1 ? '' : 's'}`, `${s.workingSets} sets`,
        e.values.durationMin ? util.fmtDuration(e.values.durationMin) : '']
        .filter(Boolean).join(' · ');
    }
    return `
      <li><button type="button" class="log-row${wo ? ' is-workout' : ''}" data-edit="${e.id}">
        <span class="icon-sq" aria-hidden="true">${util.trackerIcon(t, 18)}</span>
        <span class="log-main"><span class="log-name">${esc(title)}</span>
          <span class="log-sum">${esc(sum || 'No values')}</span>
          ${wo && e.notes ? `<span class="log-note">${esc(e.notes.split('\n')[0])}</span>` : ''}</span>
        <span class="log-time">${esc(util.fmtTime(e.timestamp))}</span>
      </button></li>`;
  }

  function onClick(e) {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; tpl = ''; render(document.getElementById('view-history')); return; }
    // A template chip narrows to workouts; tapping it again clears it
    const t = e.target.closest('[data-tpl]');
    if (t) {
      tpl = tpl === t.dataset.tpl ? '' : t.dataset.tpl;
      if (tpl) filter = WORKOUT;
      render(document.getElementById('view-history'));
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const entry = repo.get('entries', edit.dataset.edit);
      if (entry) HL.entry.open(entry.type, { entry });
    }
  }

  HL.views = HL.views || {};
  HL.views.history = { stores: ['entries', 'trackers', 'exercises', 'templates'], render, onClick };
})(globalThis.HL = globalThis.HL || {});
