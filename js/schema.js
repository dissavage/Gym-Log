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

  /* ── Exercise library ──
     Fixed ids (ex-<slug>) so seeded exercises survive wipe → re-import without duplicates. */
  const MUSCLES = [
    ['chest', 'Chest'], ['front_delts', 'Front delts'], ['side_delts', 'Side delts'], ['rear_delts', 'Rear delts'],
    ['lats', 'Lats'], ['upper_back', 'Upper back'], ['traps', 'Traps'], ['lower_back', 'Lower back'],
    ['biceps', 'Biceps'], ['triceps', 'Triceps'], ['forearms', 'Forearms'],
    ['abs', 'Abs'], ['obliques', 'Obliques'],
    ['quads', 'Quads'], ['hamstrings', 'Hamstrings'], ['glutes', 'Glutes'],
    ['adductors', 'Adductors'], ['abductors', 'Abductors'], ['calves', 'Calves'],
  ].map(([id, name]) => ({ id, name }));

  const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'smith', 'bodyweight', 'kettlebell', 'band', 'other'];

  // [name, primary, secondary, equipment, category: c = compound / i = isolation]
  const EXERCISE_SEED = [
    ['Barbell Bench Press', 'chest', 'front_delts triceps', 'barbell', 'c'],
    ['Incline Barbell Bench Press', 'chest', 'front_delts triceps', 'barbell', 'c'],
    ['Decline Barbell Bench Press', 'chest', 'triceps', 'barbell', 'c'],
    ['Dumbbell Bench Press', 'chest', 'front_delts triceps', 'dumbbell', 'c'],
    ['Incline Dumbbell Press', 'chest', 'front_delts triceps', 'dumbbell', 'c'],
    ['Machine Chest Press', 'chest', 'front_delts triceps', 'machine', 'c'],
    ['Smith Machine Incline Press', 'chest', 'front_delts triceps', 'smith', 'c'],
    ['Cable Fly', 'chest', 'front_delts', 'cable', 'i'],
    ['Pec Deck', 'chest', '', 'machine', 'i'],
    ['Dumbbell Fly', 'chest', '', 'dumbbell', 'i'],
    ['Push-up', 'chest', 'front_delts triceps', 'bodyweight', 'c'],
    ['Dips', 'chest', 'triceps front_delts', 'bodyweight', 'c'],
    ['Overhead Press', 'front_delts', 'side_delts triceps', 'barbell', 'c'],
    ['Seated Dumbbell Shoulder Press', 'front_delts', 'side_delts triceps', 'dumbbell', 'c'],
    ['Machine Shoulder Press', 'front_delts', 'side_delts triceps', 'machine', 'c'],
    ['Arnold Press', 'front_delts', 'side_delts triceps', 'dumbbell', 'c'],
    ['Dumbbell Lateral Raise', 'side_delts', '', 'dumbbell', 'i'],
    ['Cable Lateral Raise', 'side_delts', '', 'cable', 'i'],
    ['Machine Lateral Raise', 'side_delts', '', 'machine', 'i'],
    ['Front Raise', 'front_delts', '', 'dumbbell', 'i'],
    ['Upright Row', 'side_delts', 'traps', 'barbell', 'c'],
    ['Face Pull', 'rear_delts', 'upper_back traps', 'cable', 'i'],
    ['Reverse Pec Deck', 'rear_delts', 'upper_back', 'machine', 'i'],
    ['Rear Delt Dumbbell Fly', 'rear_delts', 'upper_back', 'dumbbell', 'i'],
    ['Pull-up', 'lats', 'biceps upper_back', 'bodyweight', 'c'],
    ['Chin-up', 'lats', 'biceps', 'bodyweight', 'c'],
    ['Assisted Pull-up', 'lats', 'biceps upper_back', 'machine', 'c'],
    ['Lat Pulldown', 'lats', 'biceps upper_back', 'cable', 'c'],
    ['Close-Grip Lat Pulldown', 'lats', 'biceps', 'cable', 'c'],
    ['Straight-Arm Pulldown', 'lats', '', 'cable', 'i'],
    ['Barbell Row', 'upper_back', 'lats biceps rear_delts lower_back', 'barbell', 'c'],
    ['One-Arm Dumbbell Row', 'lats', 'upper_back biceps', 'dumbbell', 'c'],
    ['Seated Cable Row', 'upper_back', 'lats biceps', 'cable', 'c'],
    ['T-Bar Row', 'upper_back', 'lats biceps', 'barbell', 'c'],
    ['Chest-Supported Row', 'upper_back', 'lats biceps rear_delts', 'machine', 'c'],
    ['Deadlift', 'glutes hamstrings lower_back', 'upper_back traps quads forearms', 'barbell', 'c'],
    ['Rack Pull', 'lower_back upper_back', 'glutes traps', 'barbell', 'c'],
    ['Back Extension', 'lower_back', 'glutes hamstrings', 'bodyweight', 'i'],
    ['Barbell Shrug', 'traps', '', 'barbell', 'i'],
    ['Dumbbell Shrug', 'traps', '', 'dumbbell', 'i'],
    ['Barbell Curl', 'biceps', 'forearms', 'barbell', 'i'],
    ['EZ-Bar Curl', 'biceps', 'forearms', 'barbell', 'i'],
    ['Dumbbell Curl', 'biceps', 'forearms', 'dumbbell', 'i'],
    ['Hammer Curl', 'biceps', 'forearms', 'dumbbell', 'i'],
    ['Incline Dumbbell Curl', 'biceps', '', 'dumbbell', 'i'],
    ['Preacher Curl', 'biceps', '', 'barbell', 'i'],
    ['Cable Curl', 'biceps', 'forearms', 'cable', 'i'],
    ['Concentration Curl', 'biceps', '', 'dumbbell', 'i'],
    ['Close-Grip Bench Press', 'triceps', 'chest front_delts', 'barbell', 'c'],
    ['Triceps Pushdown (Rope)', 'triceps', '', 'cable', 'i'],
    ['Triceps Pushdown (Bar)', 'triceps', '', 'cable', 'i'],
    ['Overhead Cable Triceps Extension', 'triceps', '', 'cable', 'i'],
    ['Overhead Dumbbell Triceps Extension', 'triceps', '', 'dumbbell', 'i'],
    ['Skull Crusher', 'triceps', '', 'barbell', 'i'],
    ['Triceps Dip Machine', 'triceps', 'chest', 'machine', 'c'],
    ['Wrist Curl', 'forearms', '', 'dumbbell', 'i'],
    ['Reverse Curl', 'forearms', 'biceps', 'barbell', 'i'],
    ['Back Squat', 'quads glutes', 'adductors lower_back', 'barbell', 'c'],
    ['Front Squat', 'quads', 'glutes abs', 'barbell', 'c'],
    ['Hack Squat', 'quads', 'glutes', 'machine', 'c'],
    ['Smith Machine Squat', 'quads', 'glutes', 'smith', 'c'],
    ['Leg Press', 'quads glutes', 'adductors', 'machine', 'c'],
    ['Goblet Squat', 'quads', 'glutes', 'dumbbell', 'c'],
    ['Bulgarian Split Squat', 'quads glutes', 'adductors', 'dumbbell', 'c'],
    ['Walking Lunge', 'quads glutes', 'adductors', 'dumbbell', 'c'],
    ['Step-up', 'quads glutes', '', 'dumbbell', 'c'],
    ['Leg Extension', 'quads', '', 'machine', 'i'],
    ['Romanian Deadlift', 'hamstrings', 'glutes lower_back', 'barbell', 'c'],
    ['Stiff-Leg Deadlift', 'hamstrings', 'glutes lower_back', 'barbell', 'c'],
    ['Sumo Deadlift', 'glutes quads adductors', 'hamstrings lower_back', 'barbell', 'c'],
    ['Good Morning', 'hamstrings lower_back', 'glutes', 'barbell', 'c'],
    ['Lying Leg Curl', 'hamstrings', '', 'machine', 'i'],
    ['Seated Leg Curl', 'hamstrings', '', 'machine', 'i'],
    ['Nordic Curl', 'hamstrings', '', 'bodyweight', 'i'],
    ['Hip Thrust', 'glutes', 'hamstrings', 'barbell', 'c'],
    ['Glute Bridge', 'glutes', 'hamstrings', 'barbell', 'c'],
    ['Cable Kickback', 'glutes', '', 'cable', 'i'],
    ['Hip Abduction Machine', 'abductors', 'glutes', 'machine', 'i'],
    ['Hip Adduction Machine', 'adductors', '', 'machine', 'i'],
    ['Standing Calf Raise', 'calves', '', 'machine', 'i'],
    ['Seated Calf Raise', 'calves', '', 'machine', 'i'],
    ['Leg Press Calf Raise', 'calves', '', 'machine', 'i'],
    ['Cable Crunch', 'abs', '', 'cable', 'i'],
    ['Machine Crunch', 'abs', '', 'machine', 'i'],
    ['Hanging Leg Raise', 'abs', 'obliques', 'bodyweight', 'i'],
    ['Ab Wheel Rollout', 'abs', '', 'other', 'i'],
    ['Decline Sit-up', 'abs', '', 'bodyweight', 'i'],
    ['Russian Twist', 'obliques', 'abs', 'bodyweight', 'i'],
    ['Cable Woodchop', 'obliques', 'abs', 'cable', 'i'],
  ];

  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const split = s => (s ? s.split(' ') : []);

  const BUILTIN_EXERCISES = EXERCISE_SEED.map(([name, primary, secondary, equipment, cat]) => ({
    id: `ex-${slug(name)}`, type: 'exercise', name, nameLower: name.toLowerCase(),
    primary: split(primary), secondary: split(secondary), equipment,
    category: cat === 'c' ? 'compound' : 'isolation', builtIn: true, archived: false,
    restSec: null, repMin: null, repMax: null,
  }));

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

  HL.schema = {
    SCHEMA_VERSION, DB_NAME, DB_VERSION, STORES, DATA_STORES, BUILTIN_TRACKERS,
    MUSCLES, EQUIPMENT, BUILTIN_EXERCISES, MIGRATIONS, runMigrations,
  };
})(globalThis.HL = globalThis.HL || {});
