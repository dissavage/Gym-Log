/* ════════════════════════════════════
   SCHEMA — pure definitions: stores, built-in trackers, migrations
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DB_NAME = 'healthlog';
  const DB_VERSION = 1;

  // IndexedDB layout. Indexes are created on upgrade if missing.
  const STORES = {
    meta:           { keyPath: 'key', indexes: [] },
    trackers:       { keyPath: 'id',  indexes: [['key', 'key', { unique: true }]] },
    entries:        { keyPath: 'id',  indexes: [['type', 'type'], ['dayKey', 'dayKey'], ['timestamp', 'timestamp'], ['type_day', ['type', 'dayKey']]] },
    exercises:      { keyPath: 'id',  indexes: [['nameLower', 'nameLower']] },
    templates:      { keyPath: 'id',  indexes: [] },
    presets:        { keyPath: 'id',  indexes: [['trackerType', 'trackerType']] },
    checklistItems: { keyPath: 'id',  indexes: [['trackerType', 'trackerType']] },
    drafts:         { keyPath: 'id',  indexes: [] },
  };

  // Stores whose records carry the base fields and travel in exports
  const DATA_STORES = ['trackers', 'entries', 'exercises', 'templates', 'presets', 'checklistItems', 'drafts'];

  /* ── Built-in trackers ──
     Built-ins are plain definitions on the generic engine. Their ids are fixed so a
     wipe → re-import can't create duplicates of the seeded records. */
  const num = (key, label, extra = {}) => ({ key, label, kind: 'number', agg: 'last', goal: null, ...extra });
  const scale = (key, label, scaleLabels, extra = {}) => ({ key, label, kind: 'scale', min: 1, max: 5, agg: 'avg', scaleLabels, goal: null, ...extra });

  const BUILTIN_TRACKERS = [
    {
      key: 'workout', name: 'Workout', icon: '🏋️', kind: 'workout',
      fields: [
        { key: 'durationMin', label: 'Duration', kind: 'duration', agg: 'sum', goal: null },
        num('volume', 'Volume', { dim: 'mass', agg: 'sum', computed: 'workoutVolume' }),
        num('workingSets', 'Working sets', { agg: 'sum', computed: 'workoutSets' }),
      ],
      quick: {},
    },
    {
      key: 'body', name: 'Body', icon: '⚖️', kind: 'entry',
      fields: [
        num('weight', 'Bodyweight', { dim: 'mass', step: { lb: 0.2, kg: 0.1 }, min: 0, primary: true }),
        num('bodyFat', 'Body fat', { unit: '%', step: 0.1, min: 0, max: 100 }),
        ...['waist', 'chest', 'arms', 'thighs', 'hips', 'neck'].map(k =>
          num(k, k[0].toUpperCase() + k.slice(1), { dim: 'length', step: { in: 0.25, cm: 0.5 }, min: 0, group: 'Measurements' })),
      ],
      quick: { prefill: 'last' },
    },
    {
      key: 'nutrition', name: 'Food', icon: '🍽️', kind: 'entry',
      fields: [
        { key: 'food', label: 'Food', kind: 'text', agg: 'last', goal: null },
        num('calories', 'Calories', { unit: 'kcal', step: 10, min: 0, agg: 'sum', primary: true, goal: { target: 2000, dir: 'atMost' } }),
        num('protein', 'Protein', { unit: 'g', step: 1, min: 0, agg: 'sum', goal: { target: 150, dir: 'atLeast' } }),
        num('carbs', 'Carbs', { unit: 'g', step: 1, min: 0, agg: 'sum', goal: { target: 200, dir: 'target' } }),
        num('fat', 'Fat', { unit: 'g', step: 1, min: 0, agg: 'sum', goal: { target: 65, dir: 'target' } }),
      ],
      quick: { prefill: 'none', presets: true },
    },
    {
      key: 'hydration', name: 'Water', icon: '💧', kind: 'entry',
      fields: [
        num('amount', 'Amount', { dim: 'volume', step: { floz: 4, ml: 100 }, min: 0, agg: 'sum', primary: true, goal: { target: 2500, dir: 'atLeast' } }),
      ],
      quick: { prefill: 'none', chips: { floz: [8, 16, 24], ml: [250, 500, 750] } },
    },
    {
      key: 'cardio', name: 'Cardio', icon: '🏃', kind: 'entry',
      fields: [
        { key: 'activity', label: 'Activity', kind: 'text', agg: 'last', goal: null, options: ['Run', 'Walk', 'Cycle', 'Row', 'Elliptical', 'Stairs', 'Swim'] },
        { key: 'duration', label: 'Duration', kind: 'duration', step: 5, min: 0, agg: 'sum', primary: true, goal: null },
        num('distance', 'Distance', { dim: 'distance', step: { mi: 0.1, km: 0.1 }, min: 0, agg: 'sum' }),
        num('avgHr', 'Avg heart rate', { unit: 'bpm', step: 1, min: 0, agg: 'avg' }),
        num('calories', 'Calories', { unit: 'kcal', step: 10, min: 0, agg: 'sum' }),
      ],
      quick: { prefill: 'last' },
    },
    {
      key: 'sleep', name: 'Sleep', icon: '😴', kind: 'entry',
      fields: [
        { key: 'bedTime', label: 'Bed time', kind: 'time', agg: 'last', goal: null },
        { key: 'wakeTime', label: 'Wake time', kind: 'time', agg: 'last', goal: null },
        { key: 'duration', label: 'Sleep', kind: 'duration', agg: 'sum', computed: 'sleepDuration', primary: true, goal: { target: 480, dir: 'atLeast' } },
        scale('quality', 'Quality', ['Poor', 'Great']),
      ],
      quick: { prefill: 'last' },
    },
    {
      key: 'mood', name: 'Mood', icon: '🙂', kind: 'entry',
      fields: [
        scale('mood', 'Mood', ['Awful', 'Great'], { primary: true }),
        scale('energy', 'Energy', ['Drained', 'Energized']),
        scale('soreness', 'Soreness', ['None', 'Very sore'], { invert: true }),
      ],
      quick: { prefill: 'none' },
    },
    {
      key: 'supplements', name: 'Supplements', icon: '💊', kind: 'checklist',
      fields: [
        { key: 'item', label: 'Item', kind: 'text', agg: 'last', goal: null, primary: true },
        num('dose', 'Dose', { step: 1, min: 0, agg: 'sum' }),
        { key: 'unit', label: 'Unit', kind: 'text', agg: 'last', goal: null },
      ],
      quick: {},
    },
  ].map((t, i) => ({ ...t, id: `tracker-${t.key}`, type: 'tracker', builtIn: true, archived: false, order: i }));

  /* ── Migrations ──
     A snapshot is { schemaVersion, stores: { storeName: [records] } }.
     Each step is pure: it receives a deep copy and returns the next snapshot. */
  const MIGRATIONS = [];

  function runMigrations(snapshot, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
    const from = snapshot.schemaVersion || 1;
    if (from > target) throw new Error(`Data is from a newer version (v${from}); this app understands up to v${target}.`);
    let s = JSON.parse(JSON.stringify(snapshot));
    s.schemaVersion = from;
    for (const m of [...migrations].sort((a, b) => a.to - b.to)) {
      if (m.to <= s.schemaVersion || m.to > target) continue;
      if (m.to !== s.schemaVersion + 1) throw new Error(`Missing migration to v${s.schemaVersion + 1}`);
      s = m.up(s);
      s.schemaVersion = m.to;
    }
    if (s.schemaVersion !== target) throw new Error(`Missing migration to v${s.schemaVersion + 1}`);
    return s;
  }

  HL.schema = { SCHEMA_VERSION, DB_NAME, DB_VERSION, STORES, DATA_STORES, BUILTIN_TRACKERS, MIGRATIONS, runMigrations };
})(globalThis.HL = globalThis.HL || {});
