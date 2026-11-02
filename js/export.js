/* ════════════════════════════════════
   EXPORT — pure: one month of logs → a report object for a Claude chat
   No DOM, no storage: the caller passes everything in `deps`, so tests.html can use fixtures.
   Every number in the report is already in the person's display units; missing values are null.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, schema } = HL;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Same default as the weekly-sets card in ui/insights.js
  const DEFAULT_TARGET = [10, 20];
  // Built-ins shown as one row per day (totals / averages); every other entry tracker lists each entry
  const DAILY_TRACKERS = new Set(['nutrition', 'hydration', 'sleep', 'mood']);

  const p2 = n => String(n).padStart(2, '0');
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const has = v => v != null && v !== '';
  const rnd = (v, dp = 0) => (fin(v) ? util.round(v, dp) : null);
  const sum = list => list.reduce((a, b) => a + b, 0);
  const mean = list => (list.length ? sum(list) / list.length : null);
  const byTime = (a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : 1);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));

  /* ════════════════════════════════════
     MONTHS — local day keys, never UTC
     ════════════════════════════════════ */
  function monthBounds(monthKey) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error(`Not a month: ${monthKey}`);
    const [y, m] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return { monthKey, first: `${monthKey}-01`, last: `${monthKey}-${p2(daysInMonth)}`, daysInMonth, label: `${MONTHS[m - 1]} ${y}` };
  }

  function shiftMonth(monthKey, n) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
  }

  const inBounds = (b, dayKey) => dayKey >= b.first && dayKey <= b.last;

  // Days of the month that have happened: all of them for a past month, up to today for this one
  function daysElapsed(b, today) {
    if (today < b.first) return 0;
    if (today > b.last) return b.daysInMonth;
    return util.daysBetween(b.first, today) + 1;
  }

  // The clock time the log was made, as the person saw it (offset-carrying timestamps hold it already)
  const clockOf = ts => (/[+-]\d\d:\d\d$/.test(ts) ? ts.slice(11, 16) : util.toInputDateTime(ts).slice(11));

  /* ════════════════════════════════════
     FIELDS — display values and column units
     ════════════════════════════════════ */
  const plainDp = field => (typeof field.step === 'number' && String(field.step).includes('.') ? String(field.step).split('.')[1].length : typeof field.step === 'number' ? 0 : 1);

  function shown(field, v, prefs) {
    if (!has(v)) return null;
    switch (field.kind) {
      case 'number':   return fin(v) ? (field.dim ? units.display(field.dim, v, prefs) : rnd(v, plainDp(field))) : null;
      case 'duration': return rnd(v, 0);
      case 'scale':    return rnd(v, 1);
      case 'bool':     return !!v;
      case 'time':
      case 'text':     return String(v);
      default:         return typeof v === 'number' ? rnd(v, 2) : String(v);
    }
  }

  function unitOf(field, prefs) {
    if (field.kind === 'duration') return 'min';
    if (field.dim) return units.label(field.dim, prefs);
    if (field.kind === 'scale') return `${field.min || 1}–${field.max || 5}`;
    return field.unit || null;
  }

  const goalTarget = (field, prefs) => (field.dim ? units.display(field.dim, field.goal.target, prefs) : rnd(field.goal.target, 1));

  // 'atMost' goals are met by anything not over the limit
  function goalState(value, goal) {
    const { state } = domain.goalProgress(value, goal);
    return goal.dir === 'atMost' ? (state === 'over' ? 'over' : 'met') : state;
  }

  const hasGoal = f => !!f.goal && fin(f.goal.target) && f.goal.target > 0;
  const isBW = s => !(s.weightKg > 0);
  // Volume counts weighted working sets only; bodyweight sets have no load to multiply
  const setVolume = s => (domain.isWorkingSet(s) && !isBW(s) && s.reps > 0 ? s.weightKg * s.reps : 0);
  const bestE1rm = sets => Math.max(0, ...sets.filter(domain.countsForPR).map(s => domain.e1rm(s.weightKg || 0, s.reps) || 0)) || null;

  function workoutMinutes(v) {
    if (fin(v.durationMin) && v.durationMin > 0) return Math.round(v.durationMin);
    const ms = Date.parse(v.endedAt) - Date.parse(v.startedAt);
    return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : null;
  }

  /* ════════════════════════════════════
     BUILD
     ════════════════════════════════════ */
  /**
   * monthKey 'YYYY-MM'. deps: {
   *   entries, trackers, exercises, templates, checklistItems  — arrays (deleted rows are skipped;
   *     pass deleted exercises/templates too so old names still resolve)
   *   settings, today ('YYYY-MM-DD'), now (ISO), appVersion, timezone, isDemo(entry) }
   */
  function buildMonthReport(monthKey, deps = {}) {
    const b = monthBounds(monthKey);
    const settings = deps.settings || {};
    const prefs = settings.units || {};
    const weekStart = settings.weekStart ?? 1;
    const today = deps.today || util.dayKey();
    const isDemo = deps.isDemo || (() => false);
    const mass = (kg, dp) => (fin(kg) && kg > 0 ? units.display('mass', kg, prefs, dp) : null);

    const live = (deps.entries || []).filter(e => e && !e.deletedAt && typeof e.dayKey === 'string' && typeof e.timestamp === 'string' && !isDemo(e));
    const trackers = (deps.trackers || []).filter(t => t && !t.deletedAt).sort(byOrder);
    const trackerByKey = new Map(trackers.map(t => [t.key, t]));
    const exById = new Map((deps.exercises || []).map(x => [x.id, x]));
    const tplById = new Map((deps.templates || []).map(t => [t.id, t]));
    const exName = id => exById.get(id)?.name || 'Unknown exercise';
    const muscleName = id => schema.MUSCLES.find(m => m.id === id)?.name || id;

    const allWorkouts = live.filter(e => e.type === 'workout').sort(byTime);
    const idx = domain.exerciseIndex(allWorkouts);
    const ofMonth = (bounds, type) => live.filter(e => inBounds(bounds, e.dayKey) && (!type || e.type === type)).sort(byTime);
    const monthEntries = ofMonth(b);
    const monthWorkouts = monthEntries.filter(e => e.type === 'workout');
    const elapsed = daysElapsed(b, today);

    /* ── Workouts, every set, PRs marked ── */
    let prCount = 0;
    const prExercises = new Set();
    const prDone = new Set();
    const workouts = monthWorkouts.map(e => {
      const v = e.values || {};
      const exercises = (v.exercises || []).map(ex => {
        const sessions = idx.get(ex.exerciseId) || [];
        const pos = sessions.findIndex(s => s.entryId === e.id);
        const prs = pos > 0 ? domain.sessionPRs(sessions.slice(0, pos), sessions[pos].sets) : [];
        // The same exercise twice in one workout shares one session: report its PRs once
        const first = !prDone.has(`${e.id}|${ex.exerciseId}`);
        prDone.add(`${e.id}|${ex.exerciseId}`);
        if (first) prCount += prs.length;
        if (prs.length) prExercises.add(ex.exerciseId);
        const marks = new Map();
        for (const p of prs) if (p.set) marks.set(p.set, [...(marks.get(p.set) || []), p.type]);
        const volumePR = first ? prs.find(p => p.type === 'volume') : null;
        const def = exById.get(ex.exerciseId);
        return {
          name: exName(ex.exerciseId),
          primary: (def?.primary || []).map(muscleName),
          notes: (ex.notes || '').trim() || null,
          sets: (ex.sets || []).map((s, i) => ({
            n: i + 1,
            type: s.setType || 'working',
            weight: mass(s.weightKg),
            bodyweight: isBW(s),
            reps: fin(s.reps) ? s.reps : null,
            rpe: fin(s.rpe) ? s.rpe : null,
            rir: fin(s.rir) ? s.rir : null,
            done: s.done !== false,
            prs: marks.get(s) || [],
          })),
          volumePR: volumePR ? mass(volumePR.value, 0) : null,
        };
      });
      const sets = (v.exercises || []).flatMap(ex => ex.sets || []);
      return {
        dayKey: e.dayKey,
        time: clockOf(e.timestamp),
        name: (v.name || '').trim() || 'Workout',
        template: tplById.get(v.templateId)?.name || null,
        durationMin: workoutMinutes(v),
        notes: (e.notes || '').trim() || null,
        workingSets: sets.filter(domain.isWorkingSet).length,
        volume: mass(sum(sets.map(setVolume)), 0) ?? 0,
        exercises,
      };
    });

    /* ── Exercise progress: this month vs everything before it ── */
    const doneIds = [...new Set(monthWorkouts.flatMap(e => (e.values?.exercises || []).map(ex => ex.exerciseId)))];
    const exerciseProgress = doneIds.map(id => {
      const sessions = idx.get(id) || [];
      const month = sessions.filter(s => inBounds(b, s.dayKey));
      if (!month.length) return null;
      const sets = month.flatMap(s => s.sets);
      const before = sessions.filter(s => s.dayKey < b.first).flatMap(s => s.sets);
      const best = bestE1rm(sets);
      const prior = bestE1rm(before);
      const working = sets.filter(domain.isWorkingSet);
      const pool = working.length ? working : sets.filter(domain.countsForPR);
      // Heaviest set, more reps breaking ties; bodyweight-only lifts: most reps
      const top = pool.reduce((t, s) => (!t || (s.weightKg || 0) > (t.weightKg || 0) || ((s.weightKg || 0) === (t.weightKg || 0) && (s.reps || 0) > (t.reps || 0)) ? s : t), null);
      const bestShown = mass(best, 0);
      const priorShown = mass(prior, 0);
      return {
        name: exName(id),
        sessions: month.length,
        sessionsBefore: sessions.filter(s => s.dayKey < b.first).length,
        bestE1rm: bestShown,
        bestE1rmBefore: priorShown,
        change: bestShown != null && priorShown != null ? rnd(bestShown - priorShown, 0) : null,
        workingSets: working.length,
        volume: mass(sum(working.map(setVolume)), 0) ?? 0,
        topSet: top ? { weight: mass(top.weightKg), bodyweight: isBW(top), reps: fin(top.reps) ? top.reps : null } : null,
      };
    }).filter(Boolean).sort((a, b2) => a.name.localeCompare(b2.name));

    /* ── Weekly sets per muscle: every week touching the month, sets dated inside it only ── */
    let weeklySets = null;
    if (monthWorkouts.length) {
      const tallies = domain.weeklyMuscleSets(monthWorkouts, exById, { weekStart });
      const weeks = [];
      for (let wk = util.weekStartOf(b.first, weekStart); wk <= b.last; wk = util.addDays(wk, 7)) {
        const end = util.addDays(wk, 6);
        weeks.push({ start: wk, end, partial: wk < b.first || end > b.last });
      }
      const targets = settings.muscleTargets || {};
      const rows = schema.MUSCLES
        .map(m => ({ muscle: m.name, sets: weeks.map(w => rnd(tallies.get(w.start)?.[m.id] || 0, 1)), target: targets[m.id] || DEFAULT_TARGET }))
        .filter(r => r.sets.some(n => n > 0));
      if (rows.length) weeklySets = { weeks, rows };
    }

    /* ── Daily trackers (everything that isn't a workout or a checklist) ── */
    const dailyTrackers = [];
    for (const t of trackers) {
      if (t.kind !== 'entry') continue;
      const es = monthEntries.filter(e => e.type === t.key);
      if (!es.length) continue;
      const daily = !!t.builtIn && DAILY_TRACKERS.has(t.key);
      const fields = t.fields || [];
      let rows;
      if (daily) {
        const byDay = new Map();
        for (const e of es) byDay.set(e.dayKey, [...(byDay.get(e.dayKey) || []), e]);
        rows = [...byDay.entries()].map(([dayKey, list]) => {
          const values = {};
          const goals = {};
          for (const f of fields) {
            if (f.kind === 'text' || f.kind === 'time') {
              const texts = [...new Set(list.map(e => e.values?.[f.key]).filter(has).map(String))];
              if (texts.length) values[f.key] = f.kind === 'time' ? texts[texts.length - 1] : texts.join('; ');
              continue;
            }
            const raw = domain.aggregate(t, list.map(e => ({ ...e, values: e.values || {} })), f.key);
            const v = shown(f, raw, prefs);
            if (v == null) continue;
            values[f.key] = v;
            if (hasGoal(f)) goals[f.key] = goalState(raw, f.goal);
          }
          const notes = list.map(e => (e.notes || '').trim()).filter(Boolean).join('; ');
          return { dayKey, values, goals, notes: notes || null };
        });
      } else {
        rows = es.map(e => {
          const all = domain.withComputed(t, e.values || {});
          const values = {};
          for (const f of fields) {
            const v = shown(f, all[f.key], prefs);
            if (v != null) values[f.key] = v;
          }
          return { dayKey: e.dayKey, time: clockOf(e.timestamp), values, notes: (e.notes || '').trim() || null };
        });
      }
      rows = rows.filter(r => Object.keys(r.values).length || r.notes);
      if (!rows.length) continue;
      const columns = fields
        .filter(f => rows.some(r => r.values[f.key] != null))
        .map(f => ({
          key: f.key, label: f.label, kind: f.kind, unit: unitOf(f, prefs), primary: !!f.primary,
          goal: hasGoal(f) ? { target: goalTarget(f, prefs), dir: f.goal.dir } : null,
        }));
      dailyTrackers.push({ key: t.key, name: t.name, mode: daily ? 'daily' : 'entries', columns, rows });
    }

    /* ── Supplements and other checklists ── */
    const checklists = [];
    for (const t of trackers) {
      if (t.kind !== 'checklist') continue;
      const ticks = monthEntries.filter(e => e.type === t.key);
      if (!ticks.length) continue;
      const items = (deps.checklistItems || []).filter(i => i.trackerType === t.key);
      const itemById = new Map(items.map(i => [i.id, i]));
      const days = new Map();   // item key → Set of day keys
      const named = new Map();  // item key → { name, dose, unit, order }
      for (const e of ticks) {
        const v = e.values || {};
        const item = itemById.get(v.itemId);
        const key = item ? item.id : `name:${String(v.item || 'Unknown item').trim().toLowerCase()}`;
        if (!named.has(key)) named.set(key, item || { name: String(v.item || 'Unknown item').trim(), dose: v.dose, unit: v.unit, order: Infinity });
        days.set(key, (days.get(key) || new Set()).add(e.dayKey));
      }
      // Active items count even on a month they were never ticked: missing them is the point
      for (const i of items) if (!i.deletedAt && i.active !== false && !named.has(i.id)) named.set(i.id, i);
      const list = [...named.entries()].map(([key, i]) => ({
        name: i.name,
        dose: fin(i.dose) ? i.dose : null,
        unit: has(i.unit) ? String(i.unit) : null,
        daysTaken: days.get(key)?.size || 0,
        days: [...(days.get(key) || [])].sort(),
        order: i.order ?? Infinity,
      })).sort(byOrder).map(({ order, ...rest }) => rest);
      checklists.push({ key: t.key, name: t.name, daysCounted: elapsed, items: list });
    }

    /* ── Goals & split ── */
    const goals = [];
    for (const t of trackers) {
      if (t.archived) continue;
      for (const f of t.fields || []) {
        if (hasGoal(f)) goals.push({ tracker: t.name, field: f.label, target: goalTarget(f, prefs), unit: unitOf(f, prefs), dir: f.goal.dir || 'atLeast' });
      }
    }
    const liveTemplates = (deps.templates || []).filter(t => !t.deletedAt).sort(byOrder);
    const liveIds = new Set(liveTemplates.map(t => t.id));
    const otherCounts = new Map();
    for (const w of monthWorkouts) {
      if (liveIds.has(w.values?.templateId)) continue;
      const name = (w.values?.name || '').trim() || 'Workout';
      otherCounts.set(name, (otherCounts.get(name) || 0) + 1);
    }
    const split = {
      templates: liveTemplates.map(t => ({
        name: t.name,
        exercises: (t.exercises || []).map(x => exName(x.exerciseId)),
        sessions: monthWorkouts.filter(w => w.values?.templateId === t.id).length,
      })),
      other: [...otherCounts.entries()].map(([name, sessions]) => ({ name, sessions })).sort((a, b2) => b2.sessions - a.sessions || a.name.localeCompare(b2.name)),
    };

    /* ── Month stats, and the same for the month before ── */
    function headline(bounds) {
      const es = ofMonth(bounds);
      const wos = es.filter(e => e.type === 'workout');
      const sets = wos.flatMap(e => (e.values?.exercises || []).flatMap(ex => ex.sets || []));
      const mins = wos.map(e => workoutMinutes(e.values || {})).filter(fin);
      const days = daysElapsed(bounds, today);
      const dailyAvg = (key, field) => {
        const t = trackerByKey.get(key);
        if (!t) return null;
        return mean(domain.dailySeries(t, es.filter(e => e.type === key).map(e => ({ ...e, values: e.values || {} })), field).map(p => p.value));
      };
      const weighIns = es.filter(e => e.type === 'body' && fin(e.values?.weight) && e.values.weight > 0).map(e => e.values.weight);
      const cardio = es.filter(e => e.type === 'cardio');
      const water = dailyAvg('hydration', 'amount');
      const start = mass(weighIns[0], 1);
      const end = mass(weighIns[weighIns.length - 1], 1);
      return {
        daysLogged: new Set(es.map(e => e.dayKey)).size,
        workouts: wos.length,
        workingSets: sets.filter(domain.isWorkingSet).length,
        volume: mass(sum(sets.map(setVolume)), 0) ?? 0,
        avgSessionMin: rnd(mean(mins), 0),
        avgWeeklySessions: days ? rnd(wos.length / (days / 7), 1) : null,
        avgCalories: rnd(dailyAvg('nutrition', 'calories'), 0),
        avgProtein: rnd(dailyAvg('nutrition', 'protein'), 0),
        avgWater: water == null ? null : units.display('volume', water, prefs),
        avgSleepMin: rnd(dailyAvg('sleep', 'duration'), 0),
        cardioSessions: cardio.length,
        cardioMin: rnd(sum(cardio.map(e => e.values?.duration).filter(fin)), 0),
        bodyweight: weighIns.length ? {
          start, end,
          min: mass(Math.min(...weighIns), 1),
          max: mass(Math.max(...weighIns), 1),
          change: rnd(end - start, 1),
          weighIns: weighIns.length,
        } : null,
      };
    }

    const stats = headline(b);
    // Logging streak: running into the month's last day (today, for this month), and the longest inside it
    const ref = elapsed && elapsed < b.daysInMonth ? today : b.last;
    const everyDay = [...new Set(live.map(e => e.dayKey))].filter(d => d <= ref);
    stats.streakAtEnd = domain.streaks(everyDay, ref).current;
    stats.longestStreak = domain.streaks([...new Set(monthEntries.map(e => e.dayKey))], ref).longest;
    stats.prs = prCount;
    stats.prExercises = prExercises.size;
    stats.goalDays = [];
    for (const t of trackers) {
      if (t.kind !== 'entry') continue;
      for (const f of t.fields || []) {
        if (!hasGoal(f)) continue;
        const pts = domain.dailySeries(t, monthEntries.filter(e => e.type === t.key).map(e => ({ ...e, values: e.values || {} })), f.key);
        if (pts.length) stats.goalDays.push({ tracker: t.name, field: f.label, met: pts.filter(p => goalState(p.value, f.goal) === 'met').length, days: pts.length });
      }
    }

    let vsPrevious = null;
    const prevBounds = monthBounds(shiftMonth(monthKey, -1));
    const prev = headline(prevBounds);
    if (prev.daysLogged) {
      const DP = { avgWeeklySessions: 1, avgWater: units.unitFor('volume', prefs) === 'floz' ? 1 : 0 };
      const deltas = {};
      for (const k of Object.keys(prev)) {
        if (fin(stats[k]) && fin(prev[k])) deltas[k] = rnd(stats[k] - prev[k], DP[k] ?? 0);
      }
      if (stats.bodyweight && prev.bodyweight) deltas.bodyweightEnd = rnd(stats.bodyweight.end - prev.bodyweight.end, 1);
      vsPrevious = { month: prevBounds.monthKey, label: prevBounds.label, stats: prev, deltas };
    }

    return {
      empty: stats.daysLogged === 0,
      meta: {
        month: b.monthKey, label: b.label, first: b.first, last: b.last,
        daysInMonth: b.daysInMonth, daysElapsed: elapsed, inProgress: elapsed > 0 && elapsed < b.daysInMonth,
        daysLogged: stats.daysLogged,
        generatedAt: deps.now || util.localISO(),
        appVersion: deps.appVersion || null,
        timezone: deps.timezone || null,
        weekStart: DAY_NAMES[weekStart] || 'Monday',
        effort: settings.effort || 'rpe',
        units: Object.fromEntries(['mass', 'volume', 'distance', 'length'].map(d => [d, units.label(d, prefs)])),
      },
      userGoal: String(settings.exportGoal || '').trim() || null,
      goals,
      split: split.templates.length || split.other.length ? split : null,
      workouts,
      exerciseProgress,
      weeklySets,
      dailyTrackers,
      checklists,
      stats,
      vsPrevious,
    };
  }

  /* ════════════════════════════════════
     MARKDOWN — GitHub-flavoured tables, no HTML, no emoji
     Fixed English labels (not the phone's locale) so the file reads the same everywhere.
     ════════════════════════════════════ */
  const SIZE_WARN_BYTES = 250 * 1024;
  const SECTIONS = ['workouts', 'progress', 'weekly', 'daily', 'supplements', 'previous'];
  const SHORT_MONTHS = MONTHS.map(m => m.slice(0, 3));
  const SHORT_DAYS = DAY_NAMES.map(d => d.slice(0, 3));
  const DIR_WORDS = { atLeast: 'at least', atMost: 'at most', target: 'about' };
  const SET_TYPES = { warmup: 'warm-up', working: 'working', failure: 'failure', drop: 'drop' };
  const PR_WORDS = { weight: 'weight', e1rm: 'e1RM', reps: 'reps' };

  const num = (v, dp = 1) => (fin(v) ? v.toLocaleString('en-US', { maximumFractionDigits: dp }) : '');
  const signed = (v, dp = 1) => (!fin(v) ? '' : v > 0 ? `+${num(v, dp)}` : v < 0 ? `-${num(-v, dp)}` : '0');
  const hmm = min => (fin(min) ? `${Math.floor(Math.round(min) / 60)}:${p2(Math.round(min) % 60)}` : '');
  const dateOf = key => util.parseDayKey(key);
  const dayLabel = key => { const d = dateOf(key); return `${SHORT_DAYS[d.getDay()]} ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const shortDay = key => { const d = dateOf(key); return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const oneLine = s => String(s ?? '').replace(/\s*\r?\n\s*/g, ' / ').trim();
  const cell = s => oneLine(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const plural = (n, word) => `${num(n, 0)} ${word}${n === 1 ? '' : 's'}`;
  const byteSize = text => new TextEncoder().encode(text).length;

  function weekLabel(w) {
    const a = dateOf(w.start);
    const b = dateOf(w.end);
    const range = a.getMonth() === b.getMonth() ? `${shortDay(w.start)}–${b.getDate()}` : `${shortDay(w.start)}–${shortDay(w.end)}`;
    return w.partial ? `${range} (partial)` : range;
  }

  // Rows are arrays of strings; a column that's empty in every row is dropped (the first one never is)
  function table(headers, rows) {
    const used = headers.map((_, i) => i === 0 || rows.some(r => r[i] != null && r[i] !== ''));
    const pick = r => r.filter((_, i) => used[i]);
    const line = cells => `| ${cells.join(' | ')} |`;
    const head = pick(headers);
    return [line(head.map(cell)), line(head.map(() => '---')), ...rows.map(r => line(pick(r).map(x => cell(x ?? ''))))].join('\n');
  }

  function columnHeader(c) {
    if (c.kind === 'duration') return `${c.label} (h:mm)`;
    return c.unit ? `${c.label} (${c.unit})` : c.label;
  }

  function fieldText(c, v) {
    if (v == null) return '';
    switch (c.kind) {
      case 'duration': return hmm(v);
      case 'bool':     return v ? 'Yes' : 'No';
      case 'scale':    return num(v, 1);
      case 'number':   return num(v, 3);
      default:         return String(v);
    }
  }

  function goalText(g) {
    const target = g.unit === 'min' ? util.fmtDuration(g.target) : `${num(g.target, 1)}${g.unit ? (g.unit === '%' ? '%' : ` ${g.unit}`) : ''}`;
    return `${DIR_WORDS[g.dir] || 'at least'} ${target}`;
  }

  // "warm-up 60×10", "102.5×5 @RPE 8 [PR: weight, e1RM]", "BW×15 RIR 2" — the set's position is its order in the line
  function setText(s) {
    const parts = [];
    if (s.type !== 'working') parts.push(SET_TYPES[s.type] || s.type);
    parts.push(`${s.bodyweight ? 'BW' : num(s.weight)}×${s.reps ?? '?'}`);
    if (s.rpe != null) parts.push(`@RPE ${num(s.rpe, 1)}`);
    if (s.rir != null) parts.push(`RIR ${num(s.rir, 1)}`);
    if (s.prs.length) parts.push(`[PR: ${s.prs.map(p => PR_WORDS[p] || p).join(', ')}]`);
    if (!s.done) parts.push('(not ticked)');
    return parts.join(' ');
  }

  const stamp = iso => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso || '') ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : String(iso || ''));

  /**
   * report → Markdown string. options.sections: { workouts, progress, weekly, daily, supplements, previous }
   * — each on unless set to false. The header, summary and goals are always included.
   */
  function renderReportMarkdown(report, { sections = {} } = {}) {
    const on = key => sections[key] !== false;
    const { meta, stats } = report;
    const U = meta.units;
    const out = [];
    const block = (...lines) => out.push(...lines, '');
    const allSets = report.workouts.flatMap(w => w.exercises.flatMap(x => x.sets));
    const hasWorkouts = report.workouts.length > 0;
    const showWeekly = on('weekly') && report.weeklySets;
    const showDaily = on('daily') && report.dailyTrackers.length;
    const showChecklists = on('supplements') && report.checklists.length;

    // A tracker's only goal goes by the tracker's name ("Water"), several by field ("Calories"); clashes get both
    const goalFields = new Map();
    for (const g of [...report.goals, ...stats.goalDays]) goalFields.set(g.tracker, (goalFields.get(g.tracker) || new Set()).add(g.field));
    const shortGoal = (t, f) => (goalFields.get(t).size === 1 ? t : f);
    const shortUses = new Map();
    for (const [t, fields] of goalFields) for (const f of fields) shortUses.set(shortGoal(t, f), (shortUses.get(shortGoal(t, f)) || 0) + 1);
    const goalName = (t, f) => (shortUses.get(shortGoal(t, f)) > 1 ? `${t}: ${f}` : shortGoal(t, f));

    /* ── Header ── */
    block(`# Health Log report — ${meta.label}`);
    if (report.empty) {
      block(`No data was logged in ${meta.label}.`);
      return `${out.join('\n').trimEnd()}\n`;
    }
    block(`This is my personal training and health log for ${meta.label}, exported from my Health Log app. I logged something on ${meta.daysLogged} of ${meta.inProgress ? `the ${meta.daysElapsed} days so far` : `${meta.daysInMonth} days`}${meta.inProgress ? ' (the month is still in progress)' : ''}.`);
    block(`Units: weight ${U.mass}, water ${U.volume}, distance ${U.distance}, body measurements ${U.length}. Times are local${meta.timezone ? ` (${meta.timezone})` : ''}; weeks start on ${meta.weekStart}.`);
    const effort = [
      allSets.some(s => s.rpe != null) && 'RPE = rate of perceived exertion (10 = maximal effort)',
      allSets.some(s => s.rir != null) && 'RIR = reps in reserve (0 = taken to failure)',
    ].filter(Boolean);
    if (effort.length) block(`Effort per set: ${effort.join('; ')}.`);
    block('Please analyze my progress, point out what\'s working and what\'s lagging, and suggest specific changes for next month. Ask me questions if the data looks incomplete.');
    if (report.userGoal) block('## My goal', '', ...report.userGoal.split(/\r?\n/).map(l => `> ${l}`.trimEnd()));

    const howTo = [];
    if (hasWorkouts) {
      howTo.push(`Weights are per set, in ${U.mass}. "BW" = bodyweight set (no added weight); BW sets are not counted in volume.`);
      howTo.push('Volume = weight × reps over working and failure sets; warm-ups, drop sets and BW sets are excluded.');
      howTo.push('Est. 1RM (e1RM) uses the Epley formula and is only calculated for sets of 12 reps or fewer; "—" means no set qualified (all over 12 reps, or bodyweight only).');
      howTo.push('PR = personal record against every earlier session (heaviest weight, e1RM, most reps at that weight or heavier, or session volume). An exercise\'s first-ever session is a baseline, not a PR.');
    }
    if (showWeekly) howTo.push(`Weekly sets = working and failure sets per muscle; secondary muscles count as half a set. "partial" weeks overlap another month, so only their days in ${meta.label} are counted.`);
    if (report.goals.length) howTo.push('Goals: "met" for an "at most" goal means at or under the limit; "about" goals count as met within ±10%. In daily tables, "(under)" or "(over)" after a value means that day missed its goal; no mark means met.');
    if (showDaily && report.dailyTrackers.some(t => t.columns.some(c => c.kind === 'duration'))) howTo.push('Durations in tables are h:mm.');
    if (howTo.length) block('## How to read this', '', ...howTo.map(t => `- ${t}`));

    /* ── Summary ── */
    const summary = [];
    summary.push(`Days with a log: ${meta.daysLogged} of ${meta.inProgress ? `${meta.daysElapsed} so far` : meta.daysInMonth}`);
    if (stats.workouts) {
      summary.push(`Workouts: ${stats.workouts}${stats.avgWeeklySessions != null ? ` (${num(stats.avgWeeklySessions, 1)} per week)` : ''}${stats.avgSessionMin ? `, average ${util.fmtDuration(stats.avgSessionMin)}` : ''}`);
      summary.push(`Working sets: ${num(stats.workingSets, 0)}; volume ${num(stats.volume, 0)} ${U.mass}`);
      summary.push(`PRs: ${stats.prExercises ? plural(stats.prExercises, 'exercise') : 'none'}`);
    }
    summary.push(`Logging streak: longest ${plural(stats.longestStreak, 'day')} in the month; ${plural(stats.streakAtEnd, 'day')} running ${meta.inProgress ? 'as of today' : 'at month end'}`);
    const avgs = [
      stats.avgCalories != null && `${num(stats.avgCalories, 0)} kcal`,
      stats.avgProtein != null && `${num(stats.avgProtein, 0)} g protein`,
      stats.avgWater != null && `${num(stats.avgWater, 1)} ${U.volume} water`,
      stats.avgSleepMin != null && `${util.fmtDuration(stats.avgSleepMin)} sleep`,
    ].filter(Boolean);
    if (avgs.length) summary.push(`Daily averages (over the days each was logged): ${avgs.join(', ')}`);
    if (stats.cardioSessions) summary.push(`Cardio: ${plural(stats.cardioSessions, 'session')}${stats.cardioMin ? `, ${util.fmtDuration(stats.cardioMin)} total` : ''}`);
    const bw = stats.bodyweight;
    if (bw) {
      summary.push(bw.weighIns === 1 ? `Bodyweight: ${num(bw.end)} ${U.mass} (1 weigh-in)`
        : `Bodyweight: ${num(bw.start)} → ${num(bw.end)} ${U.mass} (${signed(bw.change)}), low ${num(bw.min)}, high ${num(bw.max)}, ${plural(bw.weighIns, 'weigh-in')}`);
    }
    if (stats.goalDays.length) summary.push(`Goals met (days met / days logged): ${stats.goalDays.map(g => `${goalName(g.tracker, g.field)} ${g.met}/${g.days}`).join(', ')}`);
    block('## Summary', '', ...summary.map(t => `- ${t}`));

    const prev = on('previous') && report.vsPrevious;
    if (prev) {
      const p = prev.stats;
      const rows = [
        ['Days with a log', stats.daysLogged, p.daysLogged, 'daysLogged', 0],
        ['Workouts', stats.workouts, p.workouts, 'workouts', 0],
        ['Workouts per week', stats.avgWeeklySessions, p.avgWeeklySessions, 'avgWeeklySessions', 1],
        ['Working sets', stats.workingSets, p.workingSets, 'workingSets', 0],
        [`Volume (${U.mass})`, stats.volume, p.volume, 'volume', 0],
        ['Average workout (min)', stats.avgSessionMin, p.avgSessionMin, 'avgSessionMin', 0],
        ['Average calories (kcal)', stats.avgCalories, p.avgCalories, 'avgCalories', 0],
        ['Average protein (g)', stats.avgProtein, p.avgProtein, 'avgProtein', 0],
        [`Average water (${U.volume})`, stats.avgWater, p.avgWater, 'avgWater', 1],
        ['Average sleep (min)', stats.avgSleepMin, p.avgSleepMin, 'avgSleepMin', 0],
        ['Cardio sessions', stats.cardioSessions, p.cardioSessions, 'cardioSessions', 0],
        ['Cardio (min)', stats.cardioMin, p.cardioMin, 'cardioMin', 0],
        [`Bodyweight at month end (${U.mass})`, bw?.end, p.bodyweight?.end, 'bodyweightEnd', 1],
        [`Bodyweight change in month (${U.mass})`, bw?.change, p.bodyweight?.change, null, 1],
      ].filter(([, a, b2]) => (a != null || b2 != null) && !(!a && !b2));
      const fmtV = (v, dp, isChange) => (v == null ? '' : isChange ? signed(v, dp) : num(v, dp));
      block(`### Compared with ${prev.label}`, '', table(['Metric', meta.label, prev.label, 'Change'],
        rows.map(([label, a, b2, key, dp]) => [label, fmtV(a, dp, !key), fmtV(b2, dp, !key), key ? signed(prev.deltas[key], dp) : ''])));
    }

    /* ── Goals & split ── */
    const split = report.split;
    if (report.goals.length || split) {
      block('## Goals & split');
      if (report.goals.length) block(table(['Daily goal', 'Target'], report.goals.map(g => [goalName(g.tracker, g.field), goalText(g)])));
      if (split && !split.templates.length) {
        block(table(['Workout (no template)', 'Sessions this month'], split.other.map(o => [o.name, String(o.sessions)])));
      } else if (split) {
        const rows = split.templates.map(t => [t.name, t.exercises.join(', '), String(t.sessions)])
          .concat(split.other.map(o => [o.name, '(no template)', String(o.sessions)]));
        block(table(['Workout', 'Exercises', 'Sessions this month'], rows));
      }
    }

    /* ── Exercise progress ── */
    if (on('progress') && report.exerciseProgress.length) {
      const m = U.mass;
      block('## Exercise progress', '', table(
        ['Exercise', 'Sessions', `Best e1RM (${m})`, `Best e1RM before this month (${m})`, `Change (${m})`, 'Working sets', `Volume (${m})`, `Top set (${m} × reps)`],
        report.exerciseProgress.map(x => [
          x.name, String(x.sessions),
          x.bestE1rm == null ? '—' : num(x.bestE1rm, 0),
          x.sessionsBefore === 0 ? 'first month' : x.bestE1rmBefore == null ? '—' : num(x.bestE1rmBefore, 0),
          signed(x.change, 0),
          String(x.workingSets),
          num(x.volume, 0),
          x.topSet ? `${x.topSet.bodyweight ? 'BW' : num(x.topSet.weight)} × ${x.topSet.reps ?? '?'}` : '',
        ])));
    }

    /* ── Weekly sets per muscle ── */
    if (showWeekly) {
      const w = report.weeklySets;
      const range = r => `${r.target[0]}–${r.target[1]}`;
      // One shared target becomes a sentence instead of a column repeating it on every row
      const shared = w.rows.every(r => range(r) === range(w.rows[0])) ? range(w.rows[0]) : null;
      block('## Weekly sets per muscle');
      if (shared) block(`Target for every muscle: ${shared} sets per week.`);
      block(table(
        ['Muscle', ...w.weeks.map(weekLabel), ...(shared ? [] : ['Target per week'])],
        w.rows.map(r => [r.muscle, ...r.sets.map(n => num(n, 1)), ...(shared ? [] : [range(r)])])));
    }

    /* ── Daily trackers ── */
    if (showDaily) {
      block('## Body & daily trackers');
      for (const t of report.dailyTrackers) {
        const daily = t.mode === 'daily';
        // Body: bodyweight (with the entry's notes) in one table, body fat and tape measurements in another
        const parts = t.key === 'body'
          ? [[t.name, t.columns.filter(c => c.primary), true], ['Measurements', t.columns.filter(c => !c.primary), false]]
          : [[t.name, t.columns, true]];
        for (const [name, cols, withNotes] of parts) {
          const rows = t.rows.filter(r => cols.some(c => r.values[c.key] != null) || (withNotes && r.notes));
          if (!rows.length) continue;
          const headers = ['Date', ...(daily ? [] : ['Time']), ...cols.map(columnHeader), ...(withNotes ? ['Notes'] : [])];
          block(`### ${name} (${daily ? 'daily totals' : 'every entry'})`, '', table(headers, rows.map(r => [
            dayLabel(r.dayKey), ...(daily ? [] : [r.time]),
            ...cols.map(c => {
              const text = fieldText(c, r.values[c.key]);
              const state = r.goals?.[c.key];
              return text && state && state !== 'met' ? `${text} (${state})` : text;
            }),
            ...(withNotes ? [r.notes || ''] : []),
          ])));
        }
      }
    }

    /* ── Supplements / checklists ── */
    if (showChecklists) {
      for (const c of report.checklists) {
        const n = c.daysCounted;
        const dayNums = keys => keys.map(k => String(Number(k.slice(8)))).join(', ');
        const rows = c.items.map(i => {
          const taken = new Set(i.days);
          const missed = Array.from({ length: n }, (_, k) => util.addDays(meta.first, k)).filter(k => !taken.has(k));
          const days = !i.daysTaken ? 'none' : !missed.length ? 'every day'
            : i.daysTaken >= n / 2 ? `missed ${dayNums(missed)}` : `taken ${dayNums(i.days)}`;
          return [i.name, [i.dose != null ? num(i.dose, 2) : '', i.unit || ''].join(' ').trim(), `${i.daysTaken} of ${n}${n ? ` (${Math.round((i.daysTaken / n) * 100)}%)` : ''}`, days];
        });
        block(`## ${c.name}`, '', `Days of ${meta.label} counted: ${n}. Day numbers are dates in ${meta.label}.`, '', table(['Item', 'Dose', 'Days taken', 'Which days'], rows));
      }
    }

    /* ── Every workout ── */
    if (on('workouts') && hasWorkouts) {
      block('## Every workout', '',
        `One line per exercise: primary muscles in brackets, then every set in order as weight×reps in ${U.mass}. Unlabelled sets are working sets; warm-up, drop and failure sets are labelled. "@RPE 8" and "RIR 2" are the logged effort; [PR: …] marks a set that set a personal record.`);
      for (const w of report.workouts) {
        block(`### ${dayLabel(w.dayKey)} — ${w.name}${w.durationMin ? ` (${util.fmtDuration(w.durationMin)})` : ''}`);
        const facts = [w.time, w.template && w.template !== w.name && `template: ${w.template}`,
          plural(w.workingSets, 'working set'), w.volume ? `volume ${num(w.volume, 0)} ${U.mass}` : ''].filter(Boolean);
        block(facts.join(' · '));
        if (w.notes) block(`Notes: ${oneLine(w.notes)}`);
        block(...w.exercises.map(x => {
          const extra = [x.notes && `Note: ${oneLine(x.notes)}.`, x.volumePR != null && `PR: session volume ${num(x.volumePR, 0)} ${U.mass}.`].filter(Boolean);
          return `- **${x.name}**${x.primary.length ? ` (${x.primary.join(', ')})` : ''}: ${x.sets.map(setText).join(', ') || 'no sets'}${extra.length ? ` — ${extra.join(' ')}` : ''}`;
        }));
      }
    }

    out.push('---', '', `Generated ${stamp(meta.generatedAt)}${meta.appVersion ? ` by Health Log ${meta.appVersion}` : ' by Health Log'}.`);
    return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }

  HL.monthReport = { MONTHS, DEFAULT_TARGET, SIZE_WARN_BYTES, SECTIONS, monthBounds, shiftMonth, buildMonthReport, renderReportMarkdown, byteSize };
})(globalThis.HL = globalThis.HL || {});
