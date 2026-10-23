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
      if (hidden.has(f.key)) continue;
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

  HL.domain = {
    COMPUTED, withComputed, isNumericField, fieldNumber, aggregate, goalProgress,
    formatField, summarizeEntry,
    E1RM_MAX_REPS, e1rm, countsForPR, isWorkingSet, sessionVolume, exerciseIndex,
    personalBests, addToBests, setPRs, sessionPRs, matchingSet, formatSet, workoutSummary,
  };
})(globalThis.HL = globalThis.HL || {});
