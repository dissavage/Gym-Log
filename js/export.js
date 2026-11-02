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
        .map(f => ({ key: f.key, label: f.label, kind: f.kind, unit: unitOf(f, prefs), goal: hasGoal(f) ? { target: goalTarget(f, prefs), dir: f.goal.dir } : null }));
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

  HL.monthReport = { MONTHS, DEFAULT_TARGET, monthBounds, shiftMonth, buildMonthReport };
})(globalThis.HL = globalThis.HL || {});
