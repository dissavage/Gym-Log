/* ════════════════════════════════════
   INSIGHTS — consistency, weekly volume, exercise progress, trends
   Sections above the range filter are fixed periods; everything below it follows the range.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo, schema } = HL;
  const { esc } = util;
  const RANGES = [['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['1y', '1Y'], ['all', 'All']];
  const HEATMAP_WEEKS = 26;
  const DEFAULT_TARGET = [10, 20];
  const PR_LABEL = { weight: 'Heaviest weight', e1rm: 'Est. 1RM', reps: 'Rep PR', volume: 'Session volume' };

  let range = '90d';
  let weekOffset = 0;
  let trendKey = null;

  const prefs = () => repo.getSettings().units;
  const shortDay = key => util.fmtDay(key, { month: 'short', day: 'numeric' });
  const fmtSets = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  /* ════════════════════════════════════
     RENDER
     ════════════════════════════════════ */
  function render(el) {
    HL.charts.destroyIn(el);
    const entries = repo.entries();
    const header = '<header class="page-head"><div><h1 class="page-title">Insights</h1><p class="page-sub">Are you progressing?</p></div></header>';
    if (!entries.length) {
      el.innerHTML = `${header}<div class="empty-state"><span class="empty-icon" aria-hidden="true">📈</span><strong>Nothing to chart yet</strong>
        Log workouts, weigh-ins or anything else for a few days and your trends, PRs and streaks will appear here.</div>`;
      return;
    }
    const today = util.dayKey();
    el.innerHTML = `
      ${header}
      ${activityHtml(entries, today)}
      ${weeklyHtml(today)}
      ${exercisesHtml()}
      <div class="range-row" role="radiogroup" aria-label="Time range for the charts below">
        <span class="section-label">Trends</span>
        <div class="seg">${RANGES.map(([v, l]) => `<label><input type="radio" name="range" value="${v}" ${range === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </div>
      ${bodyweightHtml(today)}
      ${trendHtml(today)}`;
    drawAll(el, today);
  }

  /* ── Consistency: streaks + heat map ── */
  function activityHtml(entries, today) {
    const counts = new Map();
    for (const e of entries) counts.set(e.dayKey, (counts.get(e.dayKey) || 0) + 1);
    const st = domain.streaks([...counts.keys()], today);
    const start = util.weekStartOf(util.addDays(today, -7 * (HEATMAP_WEEKS - 1)), repo.getSettings().weekStart);
    const total = util.daysBetween(start, today) + 1;
    let logged = 0;
    let cells = '';
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
      const key = util.addDays(start, i);
      if (key > today) { cells += '<span class="hm-c future"></span>'; continue; }
      const n = counts.get(key) || 0;
      if (n) logged++;
      cells += `<span class="hm-c l${domain.activityLevel(n)}" data-day="${key}" data-n="${n}"></span>`;
    }
    return `
      <section class="card" aria-labelledby="act-h">
        <div class="card-hdr"><h2 class="section-label" id="act-h">Consistency</h2></div>
        <div class="stat-grid three">
          <div class="stat"><span class="stat-lbl">Current streak</span><span class="stat-val">${st.current} <small>day${st.current === 1 ? '' : 's'}</small></span></div>
          <div class="stat"><span class="stat-lbl">Longest</span><span class="stat-val">${st.longest} <small>day${st.longest === 1 ? '' : 's'}</small></span></div>
          <div class="stat"><span class="stat-lbl">Days logged</span><span class="stat-val">${st.total}</span></div>
        </div>
        <div class="heatmap" aria-hidden="true">${cells}</div>
        <div class="hm-foot">
          <span id="hm-cap" aria-live="polite">Tap a day for its count</span>
          <span class="hm-legend" aria-hidden="true">Less <i class="hm-c l0"></i><i class="hm-c l1"></i><i class="hm-c l2"></i><i class="hm-c l3"></i><i class="hm-c l4"></i> More</span>
        </div>
        <p class="sr-only">You logged something on ${logged} of the last ${total} days.</p>
      </section>`;
  }

  /* ── Weekly working sets per muscle ── */
  function weeklyHtml(today) {
    const s = repo.getSettings();
    const workouts = repo.entries({ type: 'workout' });
    if (!workouts.length) {
      return `
        <section class="card" aria-labelledby="wk-h">
          <div class="card-hdr"><h2 class="section-label" id="wk-h">Weekly sets per muscle</h2></div>
          <div class="empty-state compact"><strong>No workouts yet</strong>Finish a workout and you'll see how many working sets each muscle got this week.</div>
        </section>`;
    }
    const exById = new Map(repo.all('exercises', { deleted: true }).map(e => [e.id, e]));
    const weeks = domain.weeklyMuscleSets(workouts, exById, { weekStart: s.weekStart });
    const wk = util.addDays(util.weekStartOf(today, s.weekStart), weekOffset * 7);
    const tally = weeks.get(wk) || {};
    // Keep rows stable week to week: every muscle trained in the last 8 weeks
    const shownMuscles = new Set(Object.keys(tally));
    for (let i = 1; i <= 8; i++) Object.keys(weeks.get(util.addDays(wk, -7 * i)) || {}).forEach(m => shownMuscles.add(m));
    const targets = s.muscleTargets || {};
    const muscles = schema.MUSCLES.filter(m => shownMuscles.has(m.id));
    const scaleMax = Math.max(...muscles.map(m => Math.max(tally[m.id] || 0, (targets[m.id] || DEFAULT_TARGET)[1]))) * 1.1;
    const pct = n => `${Math.min(100, (n / scaleMax) * 100).toFixed(1)}%`;
    const label = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${shortDay(wk)} – ${shortDay(util.addDays(wk, 6))}`;

    const rows = muscles.map(m => {
      const n = tally[m.id] || 0;
      const [lo, hi] = targets[m.id] || DEFAULT_TARGET;
      const state = n < lo ? 'under' : n > hi ? 'over' : 'in';
      const status = state === 'in' ? '✓ In range' : state === 'under' ? `▼ ${fmtSets(lo - n)} under` : `▲ ${fmtSets(n - hi)} over`;
      return `
        <li class="vol-row">
          <span class="vol-name">${esc(m.name)}</span>
          <span class="vol-track" aria-hidden="true">
            <span class="vol-band" style="left:${pct(lo)};width:calc(${pct(hi)} - ${pct(lo)})"></span>
            <span class="vol-bar ${state}" style="width:${pct(n)}"></span>
          </span>
          <span class="vol-val"><b>${fmtSets(n)}</b> <span class="vol-status ${state}">${status}</span></span>
          <span class="sr-only">${esc(m.name)}: ${fmtSets(n)} sets, target ${lo} to ${hi}. ${status}.</span>
        </li>`;
    }).join('');

    return `
      <section class="card" aria-labelledby="wk-h">
        <div class="card-hdr">
          <h2 class="section-label" id="wk-h">Weekly sets per muscle</h2>
          <button type="button" class="link-btn" data-act="targets">Targets</button>
        </div>
        <div class="week-nav">
          <button type="button" class="icon-btn" data-act="week-prev" aria-label="Previous week">‹</button>
          <span class="week-lbl">${esc(label)}</span>
          <button type="button" class="icon-btn" data-act="week-next" aria-label="Next week" ${weekOffset >= 0 ? 'disabled' : ''}>›</button>
        </div>
        <ul class="vol-list">${rows}</ul>
        <p class="field-hint">Working and failure sets count; warm-ups and drop sets don't. Secondary muscles count as half a set. Shaded band = your target range.</p>
      </section>`;
  }

  /* ── Exercises ── */
  function exerciseIndex() {
    return domain.exerciseIndex(repo.entries({ type: 'workout' }));
  }

  function exercisesHtml() {
    const idx = exerciseIndex();
    if (!idx.size) return '';
    const p = prefs();
    const items = [...idx.entries()]
      .map(([id, sessions]) => ({ id, sessions, ex: repo.get('exercises', id) }))
      .filter(x => x.ex)
      .sort((a, b) => (a.sessions.at(-1).timestamp < b.sessions.at(-1).timestamp ? 1 : -1));
    return `
      <section class="card" aria-labelledby="exs-h">
        <div class="card-hdr"><h2 class="section-label" id="exs-h">Exercises</h2></div>
        <ul class="log-list">${items.map(({ id, sessions, ex }) => {
          const b = domain.personalBests(sessions);
          const best = b.e1rm ? `Est. 1RM ${units.format('mass', b.e1rm, p, 0)}` : `Best ${Math.max(...b.pairs.map(x => x[1]))} reps`;
          return `
            <li><button type="button" class="log-row" data-exercise="${id}">
              <span class="log-main"><span class="log-name">${esc(ex.name)}</span>
                <span class="log-sum">${esc(best)} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}</span></span>
              <span class="log-time">${esc(shortDay(sessions.at(-1).dayKey))} ›</span>
            </button></li>`;
        }).join('')}</ul>
      </section>`;
  }

  /* ── Bodyweight ── */
  function bodyweightSeries(today) {
    const body = repo.tracker('body');
    const pts = domain.dailySeries(body, repo.entries({ type: 'body' }), 'weight');
    // Average over all points first so the first in-range day still has a full 7-day window
    const ma = domain.movingAverage(pts, 7);
    const from = domain.rangeStart(range, today);
    return from ? ma.filter(p => p.dayKey >= from) : ma;
  }

  function bodyweightHtml(today) {
    const series = bodyweightSeries(today);
    const p = prefs();
    const unit = units.label('mass', p);
    if (!series.length) {
      return `
        <section class="card" aria-labelledby="bw-h">
          <div class="card-hdr"><h2 class="section-label" id="bw-h">Bodyweight</h2></div>
          <div class="empty-state compact"><strong>No weigh-ins in this range</strong>Log your weight from the Body tile on Today — a 7-day average smooths out daily swings.</div>
        </section>`;
    }
    const first = series[0];
    const last = series.at(-1);
    const change = units.display('mass', last.avg, p) - units.display('mass', first.avg, p);
    const fmt = kg => `${util.fmtNum(units.display('mass', kg, p), 1)} ${unit}`;
    return `
      <section class="card" aria-labelledby="bw-h">
        <div class="card-hdr"><h2 class="section-label" id="bw-h">Bodyweight</h2></div>
        <div class="stat-grid">
          <div class="stat"><span class="stat-lbl">7-day average</span><span class="stat-val">${esc(fmt(last.avg))}</span></div>
          <div class="stat"><span class="stat-lbl">Change (${esc(RANGES.find(r => r[0] === range)[1])})</span>
            <span class="stat-val">${change > 0 ? '▲ +' : change < 0 ? '▼ −' : ''}${util.fmtNum(Math.abs(change), 1)} <small>${unit}</small></span></div>
        </div>
        <div class="chart-box" data-chart="bodyweight" role="img" aria-label="Bodyweight chart: 7-day average went from ${esc(fmt(first.avg))} on ${esc(shortDay(first.dayKey))} to ${esc(fmt(last.avg))} on ${esc(shortDay(last.dayKey))}.">
          <canvas></canvas><p class="chart-msg"></p>
        </div>
        ${HL.charts.legendHtml(bodyweightLegend())}
        ${HL.charts.tableHtml(['Date', `Weight (${unit})`, `7-day avg (${unit})`],
          [...series].reverse().map(x => [shortDay(x.dayKey), util.fmtNum(units.display('mass', x.value, p), 1), util.fmtNum(units.display('mass', x.avg, p), 1)]),
          'Bodyweight by day')}
      </section>`;
  }

  const bodyweightLegend = () => [
    { label: 'Daily weigh-in', color: HL.charts.token('--muted'), dots: true },
    { label: '7-day average', color: HL.charts.token('--accent') },
  ];

  /* ── Any numeric field ── */
  function trendOptions() {
    const opts = [];
    for (const t of repo.trackers()) {
      for (const f of t.fields) if (!f.hidden && (domain.isNumericField(f) || f.computed)) opts.push({ key: `${t.key}.${f.key}`, t, f });
    }
    return opts;
  }

  function displayValue(f, v, p) {
    return f.dim ? units.display(f.dim, v, p, 2) : v;
  }

  function formatterFor(f, p) {
    if (f.kind === 'duration') return v => util.fmtDuration(v);
    if (f.kind === 'scale') return v => util.fmtNum(v, 1);
    if (f.kind === 'bool') return v => `${Math.round(v * 100)}%`;
    const unit = f.dim ? ` ${units.label(f.dim, p)}` : f.unit ? (f.unit === '%' ? '%' : ` ${f.unit}`) : '';
    // Precision follows the field's step: kcal step 10 → whole numbers, body fat step 0.1 → one decimal
    const dp = f.dim ? 1 : typeof f.step === 'number' && String(f.step).includes('.') ? String(f.step).split('.')[1].length : 0;
    return v => `${util.fmtNum(v, dp)}${unit}`;
  }

  function trendSeries(opt, today) {
    const from = domain.rangeStart(range, today);
    const p = prefs();
    return domain.dailySeries(opt.t, repo.entries({ type: opt.t.key }), opt.f.key, from)
      .map(x => ({ dayKey: x.dayKey, value: displayValue(opt.f, x.value, p) }));
  }

  function trendHtml(today) {
    const opts = trendOptions();
    if (!trendKey || !opts.some(o => o.key === trendKey)) {
      const withData = opts.filter(o => repo.entries({ type: o.t.key }).length);
      const preferred = ['nutrition.calories', 'sleep.duration', 'hydration.amount', 'mood.mood'];
      trendKey = (preferred.map(k => withData.find(o => o.key === k)).find(Boolean)
        || withData.find(o => o.key !== 'body.weight') || withData[0] || opts[0]).key;
    }
    const opt = opts.find(o => o.key === trendKey);
    const series = trendSeries(opt, today);
    const fmt = formatterFor(opt.f, prefs());
    const vals = series.map(x => x.value);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const groups = repo.trackers().map(t => {
      const own = opts.filter(o => o.t === t);
      return own.length ? `<optgroup label="${esc(t.name)}">${own.map(o =>
        `<option value="${o.key}" ${o.key === trendKey ? 'selected' : ''}>${esc(`${t.name} · ${o.f.label}`)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const title = `${opt.t.name} · ${opt.f.label}`;
    return `
      <section class="card" aria-labelledby="tr-h">
        <div class="card-hdr"><h2 class="section-label" id="tr-h">Chart anything</h2></div>
        <div class="field">
          <label class="sr-only" for="trend-pick">Choose what to chart</label>
          <select class="input" id="trend-pick" name="trend">${groups}</select>
        </div>
        ${series.length ? `
          <div class="stat-grid three">
            <div class="stat"><span class="stat-lbl">Average</span><span class="stat-val">${esc(fmt(avg))}</span></div>
            <div class="stat"><span class="stat-lbl">Low</span><span class="stat-val">${esc(fmt(Math.min(...vals)))}</span></div>
            <div class="stat"><span class="stat-lbl">High</span><span class="stat-val">${esc(fmt(Math.max(...vals)))}</span></div>
          </div>
          <div class="chart-box" data-chart="trend" role="img" aria-label="${esc(title)} per day: average ${esc(fmt(avg))} over ${series.length} day${series.length === 1 ? '' : 's'}.">
            <canvas></canvas><p class="chart-msg"></p>
          </div>
          ${HL.charts.tableHtml(['Date', opt.f.label], [...series].reverse().map(x => [shortDay(x.dayKey), fmt(x.value)]), `${title} by day`)}` : `
          <div class="empty-state compact"><strong>No ${esc(opt.f.label.toLowerCase())} data in this range</strong>Pick another range or field, or log some ${esc(opt.t.name.toLowerCase())} first.</div>`}
      </section>`;
  }

  /* ── Drawing ── */
  // Axis spans the chosen range (or, for All, from the first point) through today
  const axis = (points, today) => ({ xMin: domain.rangeStart(range, today) || points[0]?.dayKey, xMax: today });

  function drawAll(el, today) {
    const accent = HL.charts.token('--accent');
    const bwBox = el.querySelector('[data-chart="bodyweight"]');
    if (bwBox) {
      const s = bodyweightSeries(today);
      const p = prefs();
      const [raw, avg] = bodyweightLegend();
      HL.charts.draw(bwBox, {
        series: [
          { ...raw, points: s.map(x => ({ dayKey: x.dayKey, value: units.display('mass', x.value, p, 2) })) },
          { ...avg, points: s.map(x => ({ dayKey: x.dayKey, value: units.display('mass', x.avg, p, 2) })) },
        ],
        formatY: v => `${util.fmtNum(v, 1)}`,
        ...axis(s, today),
      });
    }
    const trBox = el.querySelector('[data-chart="trend"]');
    if (trBox) {
      const opt = trendOptions().find(o => o.key === trendKey);
      const points = trendSeries(opt, today);
      HL.charts.draw(trBox, {
        series: [{ label: opt.f.label, color: accent, fill: true, points }],
        formatY: formatterFor(opt.f, prefs()),
        ...axis(points, today),
      });
    }
  }

  /* ════════════════════════════════════
     EXERCISE DETAIL
     ════════════════════════════════════ */
  function openExercise(id) {
    const ex = repo.get('exercises', id);
    const sessions = exerciseIndex().get(id) || [];
    if (!ex || !sessions.length) return;
    const p = prefs();
    const today = util.dayKey();
    const b = domain.personalBests(sessions);
    const from = domain.rangeStart(range, today);
    // Weighted lifts chart est. 1RM; bodyweight-only ones chart best reps
    const hasE1rm = b.e1rm > 0;
    const inRange = sessions.filter(s => !from || s.dayKey >= from);
    const progress = domain.exerciseProgress(inRange);
    const points = inRange.map((s, i) => ({
      dayKey: s.dayKey,
      value: hasE1rm
        ? (progress[i].e1rm ? units.display('mass', progress[i].e1rm, p, 1) : null)
        : Math.max(0, ...s.sets.filter(domain.countsForPR).map(x => x.reps)) || null,
    })).filter(x => x.value != null);
    // PRs grouped by session, newest first
    const log = [];
    for (const pr of domain.prLog(sessions).reverse()) {
      if (log.at(-1)?.dayKey !== pr.dayKey) log.push({ dayKey: pr.dayKey, prs: [] });
      log.at(-1).prs.push(pr);
    }
    log.splice(12);
    const prText = pr => pr.type === 'volume' ? units.format('mass', pr.value, p, 0)
      : pr.type === 'e1rm' ? `${units.format('mass', domain.e1rm(pr.set.weightKg, pr.set.reps), p, 0)} (${domain.formatSet(pr.set, p)})`
      : domain.formatSet(pr.set, p);
    const unit = units.label('mass', p);

    const body = `
      <p class="muted small block-gap">${esc(HL.exercises.muscleNames(ex.primary))}${ex.secondary.length ? ` · also ${esc(HL.exercises.muscleNames(ex.secondary))}` : ''}</p>
      <div class="stat-grid">
        <div class="stat"><span class="stat-lbl">Est. 1RM <abbr title="Estimated with the Epley formula from sets of 12 reps or fewer">ⓘ</abbr></span>
          <span class="stat-val">${b.e1rm ? esc(units.format('mass', b.e1rm, p, 0)) : '—'}</span></div>
        <div class="stat"><span class="stat-lbl">Heaviest set</span><span class="stat-val">${b.weight ? esc(units.format('mass', b.weight, p)) : 'Bodyweight'}</span></div>
        <div class="stat"><span class="stat-lbl">Best session volume</span><span class="stat-val">${esc(units.format('mass', b.volume, p, 0))}</span></div>
        <div class="stat"><span class="stat-lbl">Sessions</span><span class="stat-val">${sessions.length}</span></div>
      </div>
      <p class="field-hint block-gap">1RM is an estimate (Epley formula) — not a tested max.</p>
      <h3 class="section-label section-gap">${hasE1rm ? 'Est. 1RM per session' : 'Best reps per session'} · ${esc(RANGES.find(r => r[0] === range)[1])}</h3>
      ${points.length ? `
        <div class="chart-box" data-chart="exercise" role="img" aria-label="${esc(ex.name)} ${hasE1rm ? 'estimated 1RM' : 'best reps'} over ${points.length} sessions, latest ${points.at(-1).value}${hasE1rm ? ` ${unit}` : ' reps'}.">
          <canvas></canvas><p class="chart-msg"></p>
        </div>
        ${HL.charts.tableHtml(['Date', hasE1rm ? `Est. 1RM (${unit})` : 'Best reps'], [...points].reverse().map(x => [shortDay(x.dayKey), String(x.value)]), `${ex.name} progress`)}`
        : '<p class="muted small block-gap">No sessions in this range — change the range on the Insights tab.</p>'}
      <h3 class="section-label section-gap block-top">PR log</h3>
      ${log.length ? `<ul class="pr-list">${log.map(g => `
        <li><span class="pr-day">🏆 ${esc(shortDay(g.dayKey))}</span>
          ${g.prs.map(pr => `<span class="pr-item"><b>${PR_LABEL[pr.type]}</b> ${esc(prText(pr))}</span>`).join('')}</li>`).join('')}</ul>`
        : '<p class="muted small block-gap">No PRs yet — your first session is the baseline. Beat it next time.</p>'}
      <h3 class="section-label section-gap">Recent sessions</h3>
      <ul class="sess-list">${sessions.slice(-10).reverse().map(s => `
        <li><span class="sess-day">${esc(shortDay(s.dayKey))}</span>
          <span class="sess-sets">${esc(s.sets.filter(x => x.setType !== 'warmup').map(x => domain.formatSet(x, p)).join(', ') || s.sets.map(x => domain.formatSet(x, p)).join(', '))}</span></li>`).join('')}</ul>`;

    let sheetEl = null;
    HL.sheet.open({
      title: ex.name, icon: '🏋️', body,
      onMount: api => {
        sheetEl = api.el;
        const box = api.body.querySelector('[data-chart="exercise"]');
        const draw = () => HL.charts.draw(box, {
          series: [{ label: hasE1rm ? 'Est. 1RM' : 'Best reps', color: HL.charts.token('--accent'), fill: true, points }],
          formatY: v => (hasE1rm ? `${util.fmtNum(v, 0)} ${unit}` : `${v} reps`),
          ...axis(points, today),
        });
        if (box) draw();
        api.body.addEventListener('click', e => { if (e.target.closest('[data-chart-retry]')) draw(); });
      },
      onClose: () => HL.charts.destroyIn(sheetEl),
    });
  }

  /* ════════════════════════════════════
     TARGETS
     ════════════════════════════════════ */
  function openTargets() {
    const targets = repo.getSettings().muscleTargets || {};
    const body = `
      <p class="field-hint block-gap">Working sets per week. A common guide is 10–20 for muscles you're focusing on.</p>
      ${schema.MUSCLES.map(m => {
        const [lo, hi] = targets[m.id] || DEFAULT_TARGET;
        return `
          <div class="target-row">
            <span class="grow">${esc(m.name)}</span>
            <label class="sr-only" for="t-${m.id}-lo">${esc(m.name)} minimum</label>
            <input class="input tpl-rep" id="t-${m.id}-lo" name="${m.id}-lo" inputmode="numeric" value="${lo}">
            <span class="muted">–</span>
            <label class="sr-only" for="t-${m.id}-hi">${esc(m.name)} maximum</label>
            <input class="input tpl-rep" id="t-${m.id}-hi" name="${m.id}-hi" inputmode="numeric" value="${hi}">
          </div>`;
      }).join('')}
      <p class="field-hint" id="tg-err" role="alert"></p>`;
    HL.sheet.open({
      title: 'Weekly set targets', icon: '🎯', body,
      footer: '<button type="submit" class="btn btn-primary">Save targets</button>',
      onSubmit: (form, api) => {
        const next = {};
        for (const m of schema.MUSCLES) {
          const lo = util.parseNum(form.elements[`${m.id}-lo`].value);
          const hi = util.parseNum(form.elements[`${m.id}-hi`].value);
          if (lo == null || hi == null || lo < 0 || hi < lo) {
            form.querySelector('#tg-err').textContent = `Check ${m.name}: the minimum must be 0 or more and not above the maximum.`;
            return;
          }
          next[m.id] = [lo, hi];
        }
        repo.setSettings({ muscleTargets: next });
        api.close();
        HL.toast('Targets saved');
      },
    });
  }

  /* ════════════════════════════════════
     EVENTS
     ════════════════════════════════════ */
  const view = () => document.getElementById('view-insights');

  function onClick(e) {
    const cell = e.target.closest('.hm-c[data-day]');
    if (cell) {
      const n = Number(cell.dataset.n);
      view().querySelector('#hm-cap').textContent = `${util.fmtDay(cell.dataset.day, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n} log${n === 1 ? '' : 's'}`;
      return;
    }
    if (e.target.closest('[data-chart-retry]')) { render(view()); return; }
    const exBtn = e.target.closest('[data-exercise]');
    if (exBtn) { openExercise(exBtn.dataset.exercise); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'week-prev') { weekOffset--; render(view()); }
    if (act === 'week-next' && weekOffset < 0) { weekOffset++; render(view()); }
    if (act === 'targets') openTargets();
  }

  function onChange(e) {
    if (e.target.name === 'range') { range = e.target.value; render(view()); }
    if (e.target.name === 'trend') { trendKey = e.target.value; render(view()); }
  }

  HL.views = HL.views || {};
  HL.views.insights = { title: 'Insights', stores: ['entries', 'trackers', 'exercises'], render, onClick, onChange };
})(globalThis.HL = globalThis.HL || {});
