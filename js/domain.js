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
    workoutVolume: v => {
      let total = 0;
      for (const ex of v.exercises || []) for (const s of ex.sets || []) {
        if (s.done && s.setType !== 'warmup' && s.weightKg != null && s.reps != null) total += s.weightKg * s.reps;
      }
      return total;
    },
    workoutSets: v => {
      let n = 0;
      for (const ex of v.exercises || []) for (const s of ex.sets || []) {
        if (s.done && (s.setType === 'working' || s.setType === 'failure')) n++;
      }
      return n;
    },
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

  HL.domain = {
    COMPUTED, withComputed, isNumericField, fieldNumber, aggregate, goalProgress,
    formatField, summarizeEntry,
  };
})(globalThis.HL = globalThis.HL || {});
