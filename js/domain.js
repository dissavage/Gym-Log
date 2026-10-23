/* ════════════════════════════════════
   DOMAIN — pure calculations, no DOM, no storage
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { units, util } = HL;

  /* ════════════════════════════════════
     COMPUTED FIELDS
     ════════════════════════════════════ */
  const clockMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  const COMPUTED = {
    sleepDuration: v => {
      if (!v.bedTime || !v.wakeTime) return null;
      return (clockMin(v.wakeTime) - clockMin(v.bedTime) + 1440) % 1440;
    },
    workoutVolume: v => sessionVolume((v.exercises || []).flatMap(ex => ex.sets || [])),
    workoutSets: v => (v.exercises || []).flatMap(ex => ex.sets || []).filter(isWorkingSet).length,
  };

  // Inputs that a computed field already summarizes, so lists don't repeat them
  const COMPUTED_INPUTS = { sleepDuration: ['bedTime', 'wakeTime'] };

  function withComputed(tracker, values) {
    const out = { ...values };
    for (const f of tracker.fields) {
      if (f.computed && COMPUTED[f.computed]) out[f.key] = COMPUTED[f.computed](values);
    }
    return out;
  }

  /* ════════════════════════════════════
     AGGREGATES & GOALS
     ════════════════════════════════════ */
  const isNumericField = f => ['number', 'scale', 'duration', 'bool'].includes(f.kind);

  function fieldNumber(field, value) {
    if (value == null || value === '') return null;
    if (field.kind === 'bool') return value ? 1 : 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  // entries: one day's (or any period's) non-deleted entries of this tracker
  function aggregate(tracker, entries, fieldKey) {
    const field = tracker.fields.find(f => f.key === fieldKey);
    if (!field) return null;
    const sorted = [...entries].sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
    const vals = sorted
      .map(e => fieldNumber(field, withComputed(tracker, e.values)[fieldKey]))
      .filter(v => v != null);
    if (!vals.length) return null;
    switch (field.agg) {
      case 'sum': return vals.reduce((a, b) => a + b, 0);
      case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
      case 'max': return Math.max(...vals);
      default:    return vals[vals.length - 1];
    }
  }

  // 'target' goals count as met within ±10%
  function goalProgress(value, goal) {
    const v = value || 0;
    const t = goal.target;
    const pct = t > 0 ? v / t : 0;
    let state;
    if (goal.dir === 'atLeast') state = v >= t ? 'met' : 'under';
    else if (goal.dir === 'atMost') state = v > t ? 'over' : (v >= t * 0.9 ? 'met' : 'under');
    else state = v > t * 1.1 ? 'over' : (v >= t * 0.9 ? 'met' : 'under');
    return { pct, state, delta: t - v };
  }

  /* ════════════════════════════════════
     FORMATTING
     ════════════════════════════════════ */
  const stepDp = step => {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  };

  function plainDp(field) {
    if (typeof field.step === 'number') return stepDp(field.step);
    return 1;
  }

  function formatField(field, value, prefs) {
    if (value == null || value === '') return '';
    switch (field.kind) {
      case 'number':
        if (field.dim) return units.format(field.dim, value, prefs);
        if (!field.unit) return util.fmtNum(value, plainDp(field));
        return `${util.fmtNum(value, plainDp(field))}${field.unit === '%' ? '%' : ` ${field.unit}`}`;
      case 'duration': return util.fmtDuration(value);
      case 'scale':    return `${value}/${field.max || 5}`;
      case 'bool':     return value ? 'Yes' : 'No';
      case 'time':     return util.fmtClock(value);
      default:         return String(value);
    }
  }

  // "Chicken bowl · 650 kcal · 45 g protein" — names first, then the primary value
  function summarizeEntry(tracker, entry, prefs, max = 3) {
    const values = withComputed(tracker, entry.values || {});
    const hidden = new Set();
    for (const f of tracker.fields) {
      if (f.computed && values[f.key] != null) (COMPUTED_INPUTS[f.computed] || []).forEach(k => hidden.add(k));
    }
    const rank = f => (f.kind === 'text' ? 0 : f.primary ? 1 : 2);
    const ordered = [...tracker.fields].sort((a, b) => rank(a) - rank(b));
    const parts = [];
    for (const f of ordered) {
      if (hidden.has(f.key) || f.hidden) continue;
      const v = values[f.key];
      if (v == null || v === '' || (f.computed === 'workoutVolume' && !v)) continue;
      const text = formatField(f, v, prefs);
      if (!text) continue;
      const labelled = f.primary || f.kind === 'text' ? text
        : f.kind === 'scale' ? `${f.label} ${text}`
        : `${text} ${f.label.toLowerCase()}`;
      parts.push(labelled);
      if (parts.length >= max) break;
    }
    return parts.join(' · ');
  }

  // Quick-add buttons for a tracker's primary field, in the user's display unit
  function quickChips(tracker, prefs) {
    const chips = tracker.quick?.chips;
    if (!chips) return null;
    const field = tracker.fields.find(f => f.primary && !f.hidden) || tracker.fields.find(f => !f.hidden);
    if (!field) return null;
    const key = field.dim ? units.unitFor(field.dim, prefs) : '_';
    const values = chips[key] || [];
    if (!values.length) return null;
    return { field, values, unit: field.dim ? units.label(field.dim, prefs) : (field.unit || '') };
  }

  /* ════════════════════════════════════
     TRACKER BUILDER — defaults, keys, validation for custom trackers
     ════════════════════════════════════ */
  const FIELD_KINDS = [
    ['number', 'Number'], ['scale', '1–5 scale'], ['bool', 'Yes / No'],
    ['duration', 'Duration'], ['text', 'Text'], ['time', 'Time of day'],
  ];

  const DIM_STEPS = { mass: { lb: 1, kg: 0.5 }, volume: { floz: 1, ml: 50 }, distance: { mi: 0.1, km: 0.1 }, length: { in: 0.25, cm: 0.5 } };

  // Sensible defaults per kind; "agg" is how several logs in one day combine
  function fieldDefaults(kind) {
    const base = { kind, dim: null, unit: null, goal: null, hidden: false };
    switch (kind) {
      case 'number':   return { ...base, step: 1, min: 0, agg: 'sum' };
      case 'scale':    return { ...base, min: 1, max: 5, agg: 'avg', scaleLabels: ['Low', 'High'] };
      case 'bool':     return { ...base, agg: 'max' };
      case 'duration': return { ...base, step: 5, min: 0, agg: 'sum' };
      default:         return { ...base, agg: 'last' };
    }
  }

  const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'field';

  // Keys are fixed at creation so renaming a field never orphans its data
  function uniqueKey(label, taken, prefix = '') {
    const base = prefix + slugify(label);
    let key = base;
    for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
    return key;
  }

  // Returns a list of human-readable problems; empty means valid
  function validateTracker(def, others = []) {
    const errors = [];
    const name = (def.name || '').trim();
    if (!name) errors.push('Give the tracker a name.');
    if (name && others.some(t => t.id !== def.id && !t.deletedAt && t.name.trim().toLowerCase() === name.toLowerCase())) {
      errors.push(`You already have a tracker called “${name}”.`);
    }
    const visible = (def.fields || []).filter(f => !f.hidden);
    if (!visible.length) errors.push('Add at least one field.');
    const labels = new Set();
    for (const f of def.fields || []) {
      const label = (f.label || '').trim();
      if (!label) { errors.push('Every field needs a label.'); continue; }
      if (labels.has(label.toLowerCase())) errors.push(`Two fields are called “${label}”.`);
      labels.add(label.toLowerCase());
      if (f.goal && !(f.goal.target > 0)) errors.push(`The goal for “${label}” must be above 0.`);
    }
    return errors;
  }

  /* ════════════════════════════════════
     STRENGTH — e1RM, history, PRs
     ════════════════════════════════════ */
  const E1RM_MAX_REPS = 12;
  const EPS = 0.01;

  // Epley. Only an estimate, and unreliable past ~12 reps, so those return null.
  function e1rm(weight, reps) {
    if (!(weight > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  const countsForPR = s => !!s.done && s.setType !== 'warmup' && s.reps > 0;
  const isWorkingSet = s => !!s.done && (s.setType === 'working' || s.setType === 'failure');
  const sessionVolume = sets => sets.filter(countsForPR).reduce((a, s) => a + (s.weightKg || 0) * s.reps, 0);

  // exerciseId → [{ entryId, timestamp, dayKey, sets }] oldest first (done sets only)
  function exerciseIndex(workoutEntries) {
    const idx = new Map();
    const sorted = [...workoutEntries].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    for (const e of sorted) for (const ex of e.values?.exercises || []) {
      const sets = (ex.sets || []).filter(s => s.done);
      if (!sets.length) continue;
      if (!idx.has(ex.exerciseId)) idx.set(ex.exerciseId, []);
      const list = idx.get(ex.exerciseId);
      const prev = list[list.length - 1];
      if (prev && prev.entryId === e.id) prev.sets = prev.sets.concat(sets);
      else list.push({ entryId: e.id, timestamp: e.timestamp, dayKey: e.dayKey, sets });
    }
    return idx;
  }

  function personalBests(sessions) {
    let b = { weight: 0, e1rm: 0, volume: 0, pairs: [] };
    for (const s of sessions) {
      for (const set of s.sets) if (countsForPR(set)) b = addToBests(b, set);
      b.volume = Math.max(b.volume, sessionVolume(s.sets));
    }
    return b;
  }

  function addToBests(b, set) {
    if (!countsForPR(set)) return b;
    const w = set.weightKg || 0;
    return {
      ...b,
      weight: Math.max(b.weight, w),
      e1rm: Math.max(b.e1rm, e1rm(w, set.reps) || 0),
      pairs: b.pairs.concat([[w, set.reps]]),
    };
  }

  // PR types this set beats: 'weight' | 'e1rm' | 'reps' (most reps at this weight or heavier).
  // A first-ever session sets a baseline rather than PRs.
  function setPRs(bests, set) {
    if (!countsForPR(set) || !bests.pairs.length) return [];
    const w = set.weightKg || 0;
    const prs = [];
    if (w > bests.weight + EPS) prs.push('weight');
    const est = e1rm(w, set.reps);
    if (est && est > bests.e1rm + EPS) prs.push('e1rm');
    if (!prs.includes('weight')) {
      const heavier = bests.pairs.filter(([pw]) => pw >= w - EPS);
      if (heavier.length && set.reps > Math.max(...heavier.map(p => p[1]))) prs.push('reps');
    }
    return prs;
  }

  // All PRs in one session of an exercise; later sets are compared against earlier ones too,
  // so only the best of each type is reported.
  function sessionPRs(history, sets) {
    const base = personalBests(history);
    if (!base.pairs.length) return [];
    const found = new Map();
    let running = base;
    for (const s of sets) {
      for (const type of setPRs(running, s)) found.set(type, { type, set: s });
      running = addToBests(running, s);
    }
    const vol = sessionVolume(sets);
    if (vol > base.volume + EPS) found.set('volume', { type: 'volume', value: vol });
    return [...found.values()];
  }

  // The set at the same position among sets of the same type last time ("last time: 185×8")
  function matchingSet(lastSets, setType, ordinal) {
    return (lastSets || []).filter(s => s.setType === setType)[ordinal] || null;
  }

  function formatSet(set, prefs) {
    if (!set) return '';
    const w = set.weightKg ? units.display('mass', set.weightKg, prefs) : 'BW';
    return `${typeof w === 'number' ? w.toLocaleString(undefined, { maximumFractionDigits: 2 }) : w}×${set.reps ?? '—'}`;
  }

  function workoutSummary(values) {
    const all = (values.exercises || []).flatMap(ex => ex.sets || []);
    return {
      exercises: (values.exercises || []).filter(ex => (ex.sets || []).some(s => s.done)).length,
      workingSets: all.filter(isWorkingSet).length,
      doneSets: all.filter(s => s.done).length,
      volume: sessionVolume(all),
    };
  }

  // Per-session progress points for an exercise chart: best est. 1RM, top weight, volume
  function exerciseProgress(sessions) {
    return sessions.map(s => {
      const counted = s.sets.filter(countsForPR);
      const best = Math.max(0, ...counted.map(x => e1rm(x.weightKg || 0, x.reps) || 0));
      return {
        dayKey: s.dayKey, e1rm: best || null,
        topWeight: Math.max(0, ...counted.map(x => x.weightKg || 0)) || null,
        volume: sessionVolume(s.sets),
      };
    });
  }

  // Chronological PR events; the first session is the baseline
  function prLog(sessions) {
    const log = [];
    for (let i = 1; i < sessions.length; i++) {
      for (const p of sessionPRs(sessions.slice(0, i), sessions[i].sets)) log.push({ dayKey: sessions[i].dayKey, ...p });
    }
    return log;
  }

  /* ════════════════════════════════════
     TRENDS — series, moving average, weekly volume, streaks
     ════════════════════════════════════ */
  const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

  // First day included in a range ending today; null = all time
  const rangeStart = (range, today) => (RANGE_DAYS[range] ? util.addDays(today, -(RANGE_DAYS[range] - 1)) : null);

  // One point per day: the field's daily aggregate, oldest first
  function dailySeries(tracker, entries, fieldKey, fromDay = null) {
    const byDay = new Map();
    for (const e of entries) {
      if (e.deletedAt || (fromDay && e.dayKey < fromDay)) continue;
      if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
      byDay.get(e.dayKey).push(e);
    }
    return [...byDay.keys()].sort()
      .map(dayKey => ({ dayKey, value: aggregate(tracker, byDay.get(dayKey), fieldKey) }))
      .filter(p => p.value != null);
  }

  // Trailing average over the previous `days` calendar days (not the previous N points),
  // so gaps in logging don't stretch the window.
  function movingAverage(points, days = 7) {
    const out = [];
    let start = 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      sum += points[i].value;
      while (util.daysBetween(points[start].dayKey, points[i].dayKey) >= days) sum -= points[start++].value;
      out.push({ dayKey: points[i].dayKey, value: points[i].value, avg: sum / (i - start + 1) });
    }
    return out;
  }

  /**
   * Working sets per muscle per week. Working + failure sets count; warm-ups and drops don't.
   * Each primary muscle gets 1, each secondary gets `secondaryWeight` (default ½).
   * Returns Map weekStartDayKey → { muscleId: sets }.
   */
  function weeklyMuscleSets(workoutEntries, exercisesById, { weekStart = 1, secondaryWeight = 0.5 } = {}) {
    const weeks = new Map();
    for (const e of workoutEntries) {
      if (e.deletedAt) continue;
      const wk = util.weekStartOf(e.dayKey, weekStart);
      if (!weeks.has(wk)) weeks.set(wk, {});
      const tally = weeks.get(wk);
      for (const ex of e.values?.exercises || []) {
        const def = exercisesById.get(ex.exerciseId);
        if (!def) continue;
        const n = (ex.sets || []).filter(isWorkingSet).length;
        if (!n) continue;
        for (const m of def.primary) tally[m] = (tally[m] || 0) + n;
        for (const m of def.secondary || []) tally[m] = (tally[m] || 0) + n * secondaryWeight;
      }
    }
    return weeks;
  }

  // Current streak counts back from today — or from yesterday while today is still empty
  function streaks(dayKeys, today) {
    const days = new Set(dayKeys);
    let current = 0;
    let d = days.has(today) ? today : util.addDays(today, -1);
    while (days.has(d)) { current++; d = util.addDays(d, -1); }
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of [...days].sort()) {
      run = prev && util.daysBetween(prev, k) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = k;
    }
    return { current, longest, total: days.size };
  }

  // Heat-map intensity 0–4 from a day's log count
  const activityLevel = n => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4);

  HL.domain = {
    COMPUTED, withComputed, isNumericField, fieldNumber, aggregate, goalProgress,
    formatField, summarizeEntry, quickChips,
    FIELD_KINDS, DIM_STEPS, fieldDefaults, slugify, uniqueKey, validateTracker,
    E1RM_MAX_REPS, e1rm, countsForPR, isWorkingSet, sessionVolume, exerciseIndex,
    personalBests, addToBests, setPRs, sessionPRs, matchingSet, formatSet, workoutSummary,
    exerciseProgress, prLog,
    RANGE_DAYS, rangeStart, dailySeries, movingAverage, weeklyMuscleSets, streaks, activityLevel,
  };
})(globalThis.HL = globalThis.HL || {});
