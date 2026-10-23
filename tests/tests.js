/* ════════════════════════════════════
   TEST HARNESS — tiny, no framework
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const suites = [];
  let current = null;

  const suite = (name, fn) => { current = { name, tests: [] }; suites.push(current); fn(); };
  const test = (name, fn) => current.tests.push({ name, fn });

  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  const assert = {
    eq(actual, expected, msg = '') {
      if (stable(actual) !== stable(expected)) throw new Error(`${msg}\n  expected ${stable(expected)}\n  actual   ${stable(actual)}`);
    },
    near(actual, expected, eps = 1e-6, msg = '') {
      if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) throw new Error(`${msg}\n  expected ≈${expected}\n  actual   ${actual}`);
    },
    ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); },
    throws(fn, re, msg = 'expected an error') {
      try { fn(); } catch (err) { if (re && !re.test(err.message)) throw new Error(`wrong error: ${err.message}`); return; }
      throw new Error(msg);
    },
  };

  const { units, util, domain, schema } = HL;
  const imperial = units.SYSTEMS.imperial;
  const metric = units.SYSTEMS.metric;
  const tracker = key => schema.BUILTIN_TRACKERS.find(t => t.key === key);
  const entry = (values, timestamp = '2026-10-22T09:00:00.000-07:00') => ({ values, timestamp });

  /* ════════════════════════════════════
     UNITS
     ════════════════════════════════════ */
  suite('Unit conversion', () => {
    test('lb → kg uses the exact definition', () => assert.near(units.toCanonical('mass', 1, 'lb'), 0.45359237));
    test('kg → lb', () => assert.near(units.fromCanonical('mass', 100, 'lb'), 220.462262, 1e-5));
    test('fl oz → ml', () => assert.near(units.toCanonical('volume', 8, 'floz'), 236.5882365));
    test('mi → km', () => assert.near(units.toCanonical('distance', 3.1, 'mi'), 4.9889664));
    test('in → cm', () => assert.near(units.toCanonical('length', 32, 'in'), 81.28));
    test('canonical unit is identity', () => assert.eq(units.toCanonical('mass', 82.5, 'kg'), 82.5));
    test('null and NaN pass through as null', () => {
      assert.eq(units.toCanonical('mass', null, 'lb'), null);
      assert.eq(units.fromCanonical('mass', NaN, 'lb'), null);
    });
    test('round-trip 185 lb displays as 185', () => {
      const kg = units.toCanonical('mass', 185, 'lb');
      assert.eq(units.display('mass', kg, imperial), 185);
    });
    test('round-trip survives many values without drift', () => {
      for (let lb = 45; lb <= 600; lb += 2.5) {
        assert.eq(units.display('mass', units.toCanonical('mass', lb, 'lb'), imperial), lb, `at ${lb} lb`);
      }
    });
    test('display rounds to unit precision', () => {
      assert.eq(units.display('mass', 83.91452, metric), 83.9);
      assert.eq(units.display('volume', 500, imperial), 16.9);
      assert.eq(units.display('volume', 500, metric), 500);
    });
    test('format adds the unit label', () => {
      assert.eq(units.format('mass', units.toCanonical('mass', 185, 'lb'), imperial), '185 lb');
      assert.eq(units.format('volume', 750, metric), '750 ml');
    });
    test('unitFor falls back to canonical', () => assert.eq(units.unitFor('mass', {}), 'kg'));
    test('unknown unit throws', () => assert.throws(() => units.toCanonical('mass', 1, 'stone'), /Unknown unit/));
    test('stepFor reads per-unit steps', () => {
      const f = { dim: 'mass', step: { lb: 5, kg: 2.5 } };
      assert.eq(units.stepFor(f, imperial), 5);
      assert.eq(units.stepFor(f, metric), 2.5);
      assert.eq(units.stepFor({ step: 10 }, imperial), 10);
    });
  });

  /* ════════════════════════════════════
     DATES
     ════════════════════════════════════ */
  suite('Local dates', () => {
    test('localISO round-trips to the same instant', () => {
      const d = new Date(2026, 9, 22, 23, 45, 12, 345);
      assert.eq(new Date(util.localISO(d)).getTime(), d.getTime());
    });
    test('localISO keeps the local calendar date (old app used UTC)', () => {
      const d = new Date(2026, 9, 22, 23, 30);
      assert.eq(util.localISO(d).slice(0, 10), '2026-10-22');
      assert.eq(util.dayKey(d), '2026-10-22');
    });
    test('dayKeyOf reads the date from an offset timestamp as-is', () =>
      assert.eq(util.dayKeyOf('2026-10-22T23:30:00.000-07:00'), '2026-10-22'));
    test('addDays crosses month and year boundaries', () => {
      assert.eq(util.addDays('2026-12-31', 1), '2027-01-01');
      assert.eq(util.addDays('2026-03-01', -1), '2026-02-28');
    });
    test('daysBetween', () => assert.eq(util.daysBetween('2026-10-01', '2026-10-22'), 21));
    test('parseNum accepts comma decimals and rejects junk', () => {
      assert.eq(util.parseNum('82,5'), 82.5);
      assert.eq(util.parseNum(' '), null);
      assert.eq(util.parseNum('abc'), null);
    });
  });

  /* ════════════════════════════════════
     MIGRATIONS
     ════════════════════════════════════ */
  suite('Migration runner', () => {
    const base = { schemaVersion: 1, stores: { entries: [{ id: 'a', type: 'body', values: { weight: 80 } }] } };
    const fixtures = [
      { to: 3, up: s => { s.stores.entries.forEach(e => { e.tagged = true; }); return s; } },
      { to: 2, up: s => { s.stores.entries.forEach(e => { e.values.weightKg = e.values.weight; delete e.values.weight; }); return s; } },
    ];
    test('no-op at current version', () => assert.eq(schema.runMigrations(base, [], 1), base));
    test('applies steps in order regardless of array order', () => {
      const out = schema.runMigrations(base, fixtures, 3);
      assert.eq(out.schemaVersion, 3);
      assert.eq(out.stores.entries[0], { id: 'a', type: 'body', values: { weightKg: 80 }, tagged: true });
    });
    test('starts from the snapshot version', () => {
      const v2 = { schemaVersion: 2, stores: { entries: [{ id: 'b', values: {} }] } };
      const out = schema.runMigrations(v2, fixtures, 3);
      assert.eq(out.stores.entries[0], { id: 'b', values: {}, tagged: true });
    });
    test('does not mutate the input snapshot', () => {
      schema.runMigrations(base, fixtures, 3);
      assert.eq(base.stores.entries[0].values, { weight: 80 });
    });
    test('refuses data from a newer version', () =>
      assert.throws(() => schema.runMigrations({ schemaVersion: 9, stores: {} }, [], 1), /newer version/));
    test('fails loudly when a step is missing', () =>
      assert.throws(() => schema.runMigrations(base, [fixtures[0]], 3), /Missing migration to v2/));
    test('real migration list reaches the current schema version', () =>
      assert.eq(schema.runMigrations({ schemaVersion: 1, stores: {} }).schemaVersion, schema.SCHEMA_VERSION));
  });

  /* ════════════════════════════════════
     TRACKER ENGINE
     ════════════════════════════════════ */
  suite('Tracker engine', () => {
    test('built-in ids are fixed and keys unique', () => {
      const keys = schema.BUILTIN_TRACKERS.map(t => t.key);
      assert.eq(new Set(keys).size, keys.length);
      assert.ok(schema.BUILTIN_TRACKERS.every(t => t.id === `tracker-${t.key}`));
    });
    test('sleep duration is computed across midnight', () => {
      assert.eq(domain.withComputed(tracker('sleep'), { bedTime: '23:15', wakeTime: '06:45' }).duration, 450);
      assert.eq(domain.withComputed(tracker('sleep'), { bedTime: '01:00', wakeTime: '08:30' }).duration, 450);
      assert.eq(domain.withComputed(tracker('sleep'), { bedTime: '23:00' }).duration, null);
    });
    test('sum aggregate (nutrition calories)', () => {
      const es = [entry({ calories: 500 }), entry({ calories: 650.5 }), entry({ protein: 30 })];
      assert.eq(domain.aggregate(tracker('nutrition'), es, 'calories'), 1150.5);
    });
    test('last aggregate takes the latest by timestamp, not array order', () => {
      const es = [entry({ weight: 81 }, '2026-10-22T18:00:00.000-07:00'), entry({ weight: 80 }, '2026-10-22T07:00:00.000-07:00')];
      assert.eq(domain.aggregate(tracker('body'), es, 'weight'), 81);
    });
    test('avg aggregate (mood scale)', () =>
      assert.eq(domain.aggregate(tracker('mood'), [entry({ mood: 2 }), entry({ mood: 5 })], 'mood'), 3.5));
    test('aggregate of computed field', () =>
      assert.eq(domain.aggregate(tracker('sleep'), [entry({ bedTime: '22:30', wakeTime: '06:30' })], 'duration'), 480));
    test('aggregate with no values is null', () =>
      assert.eq(domain.aggregate(tracker('nutrition'), [entry({ food: 'x' })], 'calories'), null));
    test('bool fields aggregate as 0/1', () => {
      const t = { fields: [{ key: 'stretched', kind: 'bool', agg: 'sum' }] };
      assert.eq(domain.aggregate(t, [entry({ stretched: true }), entry({ stretched: false }), entry({ stretched: true })], 'stretched'), 2);
    });
  });

  suite('Goals', () => {
    test('atLeast: under then met', () => {
      assert.eq(domain.goalProgress(100, { target: 150, dir: 'atLeast' }).state, 'under');
      assert.eq(domain.goalProgress(150, { target: 150, dir: 'atLeast' }).state, 'met');
    });
    test('atMost: over when exceeded', () => {
      const g = domain.goalProgress(2200, { target: 2000, dir: 'atMost' });
      assert.eq(g.state, 'over');
      assert.eq(g.delta, -200);
    });
    test('target: met within ±10%', () => {
      assert.eq(domain.goalProgress(185, { target: 200, dir: 'target' }).state, 'met');
      assert.eq(domain.goalProgress(230, { target: 200, dir: 'target' }).state, 'over');
      assert.eq(domain.goalProgress(150, { target: 200, dir: 'target' }).state, 'under');
    });
    test('null value counts as zero', () => assert.eq(domain.goalProgress(null, { target: 10, dir: 'atLeast' }).pct, 0));
  });

  suite('Formatting', () => {
    test('entry summary leads with the name, then the primary field', () => {
      const s = domain.summarizeEntry(tracker('nutrition'), { values: { food: 'Chicken bowl', calories: 650, protein: 45 } }, imperial);
      assert.eq(s, 'Chicken bowl · 650 kcal · 45 g protein');
    });
    test('summary respects the max part count', () => {
      const s = domain.summarizeEntry(tracker('nutrition'), { values: { calories: 650, protein: 45, carbs: 60 } }, imperial, 1);
      assert.eq(s, '650 kcal');
    });
    test('body summary converts units', () => {
      const s = domain.summarizeEntry(tracker('body'), { values: { weight: units.toCanonical('mass', 185, 'lb'), bodyFat: 15.5 } }, imperial);
      assert.eq(s, '185 lb · 15.5% body fat');
    });
    test('sleep summary shows duration, not raw times', () => {
      const s = domain.summarizeEntry(tracker('sleep'), { values: { bedTime: '23:00', wakeTime: '06:30', quality: 4 } }, imperial);
      assert.eq(s, '7h 30m · Quality 4/5');
    });
  });

  /* ════════════════════════════════════
     STRENGTH
     ════════════════════════════════════ */
  const S = (weightKg, reps, setType = 'working', done = true) => ({ weightKg, reps, setType, done });
  const session = (sets, timestamp = '2026-10-01T10:00:00.000-07:00') => ({ entryId: timestamp, timestamp, sets });

  suite('Estimated 1RM (Epley)', () => {
    test('1 rep is the weight itself', () => assert.eq(domain.e1rm(100, 1), 100));
    test('100 kg × 10 ≈ 133.3', () => assert.near(domain.e1rm(100, 10), 133.3333, 1e-3));
    test('100 × 5 = 116.67', () => assert.near(domain.e1rm(100, 5), 116.6667, 1e-3));
    test('more than 12 reps is too unreliable → null', () => assert.eq(domain.e1rm(60, 13), null));
    test('zero weight or reps → null', () => {
      assert.eq(domain.e1rm(0, 5), null);
      assert.eq(domain.e1rm(100, 0), null);
      assert.eq(domain.e1rm(null, 5), null);
    });
  });

  suite('PR detection', () => {
    const hist = [session([S(100, 5), S(100, 5), S(90, 8)])];
    const bests = domain.personalBests(hist);
    test('personal bests from history', () => {
      assert.eq(bests.weight, 100);
      assert.near(bests.e1rm, 116.6667, 1e-3);
      assert.eq(bests.volume, 1720);
    });
    test('heavier weight → weight PR (+ e1RM PR)', () => assert.eq(domain.setPRs(bests, S(102.5, 5)), ['weight', 'e1rm']));
    test('same weight, more reps → rep PR + e1RM PR', () => assert.eq(domain.setPRs(bests, S(100, 6)), ['e1rm', 'reps']));
    test('lighter weight, more reps than ever at ≥ that weight → rep PR', () => assert.eq(domain.setPRs(bests, S(85, 9)), ['reps']));
    test('lighter weight, reps already beaten at a heavier weight → no PR', () => assert.eq(domain.setPRs(bests, S(80, 5)), []));
    test('equal performance is not a PR', () => assert.eq(domain.setPRs(bests, S(100, 5)), []));
    test('warm-ups never count', () => assert.eq(domain.setPRs(bests, S(150, 5, 'warmup')), []));
    test('unticked sets never count', () => assert.eq(domain.setPRs(bests, S(150, 5, 'working', false)), []));
    test('first-ever session sets a baseline, not PRs', () => {
      assert.eq(domain.setPRs(domain.personalBests([]), S(100, 5)), []);
      assert.eq(domain.sessionPRs([], [S(100, 5)]), []);
    });
    test('bodyweight exercise: more reps → rep PR', () => {
      const b = domain.personalBests([session([S(null, 10), S(null, 8)])]);
      assert.eq(domain.setPRs(b, S(null, 12)), ['reps']);
    });
    test('session PRs keep only the best of each type, plus volume', () => {
      const prs = domain.sessionPRs(hist, [S(102.5, 3), S(105, 3), S(100, 5), S(100, 5), S(90, 8)]);
      const types = prs.map(p => p.type).sort();
      assert.eq(types, ['volume', 'weight']);
      assert.eq(prs.find(p => p.type === 'weight').set.weightKg, 105);
    });
    test('volume ignores warm-ups and unticked sets', () =>
      assert.eq(domain.sessionVolume([S(100, 5), S(60, 10, 'warmup'), S(100, 5, 'working', false)]), 500));
  });

  suite('Exercise history', () => {
    const wo = (id, timestamp, exercises) => ({ id, timestamp, dayKey: timestamp.slice(0, 10), values: { exercises } });
    const entries = [
      wo('b', '2026-10-05T10:00:00.000-07:00', [{ exerciseId: 'bench', sets: [S(100, 5)] }]),
      wo('a', '2026-10-01T10:00:00.000-07:00', [{ exerciseId: 'bench', sets: [S(95, 5), S(95, 5, 'working', false)] }, { exerciseId: 'row', sets: [S(80, 8)] }]),
      wo('c', '2026-10-08T10:00:00.000-07:00', [{ exerciseId: 'bench', sets: [S(60, 5, 'warmup')] }, { exerciseId: 'bench', sets: [S(102.5, 5)] }]),
    ];
    const idx = domain.exerciseIndex(entries);
    test('sessions are oldest first', () => assert.eq(idx.get('bench').map(s => s.entryId), ['a', 'b', 'c']));
    test('only ticked sets are kept', () => assert.eq(idx.get('bench')[0].sets.length, 1));
    test('same exercise twice in one workout merges into one session', () => assert.eq(idx.get('bench')[2].sets.length, 2));
    test('matchingSet pairs by type and position', () => {
      const last = [S(60, 10, 'warmup'), S(100, 8), S(100, 7), S(80, 10, 'drop')];
      assert.eq(domain.matchingSet(last, 'working', 1).reps, 7);
      assert.eq(domain.matchingSet(last, 'drop', 0).weightKg, 80);
      assert.eq(domain.matchingSet(last, 'working', 5), null);
    });
    test('formatSet uses display units', () => {
      assert.eq(domain.formatSet(S(units.toCanonical('mass', 185, 'lb'), 8), imperial), '185×8');
      assert.eq(domain.formatSet(S(null, 12), imperial), 'BW×12');
    });
    test('workout summary counts working + failure sets only', () => {
      const sum = domain.workoutSummary({ exercises: [{ sets: [S(60, 10, 'warmup'), S(100, 5), S(100, 4, 'failure'), S(80, 8, 'drop')] }, { sets: [S(50, 10, 'working', false)] }] });
      assert.eq(sum, { exercises: 1, workingSets: 2, doneSets: 4, volume: 1540 });
    });
    test('seeded exercise library has ~80 unique ids with known muscles', () => {
      const ids = schema.BUILTIN_EXERCISES.map(e => e.id);
      const muscles = new Set(schema.MUSCLES.map(m => m.id));
      assert.ok(ids.length >= 80, `only ${ids.length}`);
      assert.eq(new Set(ids).size, ids.length);
      assert.ok(schema.BUILTIN_EXERCISES.every(e => e.primary.length && [...e.primary, ...e.secondary].every(m => muscles.has(m))));
    });
  });

  /* ════════════════════════════════════
     TRENDS
     ════════════════════════════════════ */
  suite('Moving average & series', () => {
    const P = (dayKey, value) => ({ dayKey, value });
    test('7-day trailing average over consecutive days', () => {
      const pts = [1, 2, 3, 4, 5, 6, 7, 8].map((v, i) => P(util.addDays('2026-10-01', i), v));
      const ma = domain.movingAverage(pts, 7);
      assert.eq(ma[0].avg, 1);
      assert.near(ma[6].avg, 4);
      assert.near(ma[7].avg, 5, 1e-9, 'day 8 drops day 1');
    });
    test('window is calendar days, so a gap shrinks it instead of reaching back', () => {
      const ma = domain.movingAverage([P('2026-10-01', 80), P('2026-10-02', 82), P('2026-10-20', 90)], 7);
      assert.eq(ma[2].avg, 90);
      assert.eq(ma[1].avg, 81);
    });
    test('empty input', () => assert.eq(domain.movingAverage([], 7), []));
    test('dailySeries aggregates per day and skips deleted / out-of-range', () => {
      const t = tracker('nutrition');
      const es = [
        { dayKey: '2026-10-01', timestamp: '2026-10-01T08:00:00.000-07:00', values: { calories: 500 } },
        { dayKey: '2026-10-01', timestamp: '2026-10-01T19:00:00.000-07:00', values: { calories: 700 } },
        { dayKey: '2026-10-02', timestamp: '2026-10-02T08:00:00.000-07:00', values: { calories: 900 }, deletedAt: '2026-10-02T09:00:00Z' },
        { dayKey: '2026-09-20', timestamp: '2026-09-20T08:00:00.000-07:00', values: { calories: 300 } },
      ];
      assert.eq(domain.dailySeries(t, es, 'calories', '2026-09-25'), [{ dayKey: '2026-10-01', value: 1200 }]);
    });
    test('rangeStart counts today as day 1', () => {
      assert.eq(domain.rangeStart('7d', '2026-10-22'), '2026-10-16');
      assert.eq(domain.rangeStart('all', '2026-10-22'), null);
    });
  });

  suite('Weekly sets per muscle', () => {
    const exById = new Map([
      ['bench', { primary: ['chest'], secondary: ['triceps', 'front_delts'] }],
      ['dl', { primary: ['glutes', 'hamstrings'], secondary: [] }],
    ]);
    const wo = (dayKey, exercises) => ({ dayKey, values: { exercises } });
    const entries = [
      wo('2026-10-19', [{ exerciseId: 'bench', sets: [S(60, 10, 'warmup'), S(100, 5), S(100, 5), S(100, 4, 'failure'), S(80, 8, 'drop')] }]),
      wo('2026-10-25', [{ exerciseId: 'dl', sets: [S(140, 5), S(140, 5, 'working', false)] }]),
      wo('2026-10-26', [{ exerciseId: 'bench', sets: [S(100, 5)] }]),
    ];
    const weeks = domain.weeklyMuscleSets(entries, exById, { weekStart: 1 });
    test('weeks start on Monday', () => assert.eq([...weeks.keys()].sort(), ['2026-10-19', '2026-10-26']));
    test('working + failure count; warm-up, drop and unticked don\'t', () => assert.eq(weeks.get('2026-10-19').chest, 3));
    test('secondary muscles count half', () => assert.eq(weeks.get('2026-10-19').triceps, 1.5));
    test('multiple primaries each get the full count', () => {
      assert.eq(weeks.get('2026-10-19').glutes, 1);
      assert.eq(weeks.get('2026-10-19').hamstrings, 1);
    });
    test('Sunday start puts Sunday in the next week', () => {
      const sun = domain.weeklyMuscleSets(entries, exById, { weekStart: 0 });
      assert.ok(sun.has('2026-10-25'));
    });
    test('weekStartOf', () => {
      assert.eq(util.weekStartOf('2026-10-22', 1), '2026-10-19');
      assert.eq(util.weekStartOf('2026-10-19', 1), '2026-10-19');
      assert.eq(util.weekStartOf('2026-10-25', 1), '2026-10-19');
      assert.eq(util.weekStartOf('2026-10-22', 0), '2026-10-18');
    });
  });

  suite('Streaks & PR log', () => {
    test('current streak counts back from today', () =>
      assert.eq(domain.streaks(['2026-10-20', '2026-10-21', '2026-10-22'], '2026-10-22').current, 3));
    test('streak survives while today is still empty', () =>
      assert.eq(domain.streaks(['2026-10-20', '2026-10-21'], '2026-10-22').current, 2));
    test('a missed day breaks the streak', () =>
      assert.eq(domain.streaks(['2026-10-19', '2026-10-21'], '2026-10-23').current, 0));
    test('longest streak and total days', () => {
      const s = domain.streaks(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-10-22'], '2026-10-22');
      assert.eq([s.longest, s.total, s.current], [3, 5, 1]);
    });
    test('heat-map levels', () => assert.eq([0, 1, 2, 3, 4, 5, 9].map(domain.activityLevel), [0, 1, 2, 2, 3, 3, 4]));
    test('PR log skips the baseline session and is chronological', () => {
      const sessions = [
        { dayKey: '2026-10-01', sets: [S(100, 5)] },
        { dayKey: '2026-10-05', sets: [S(100, 5)] },
        { dayKey: '2026-10-08', sets: [S(105, 5)] },
      ];
      const log = domain.prLog(sessions);
      assert.eq(log.map(x => `${x.dayKey}:${x.type}`), ['2026-10-08:weight', '2026-10-08:e1rm', '2026-10-08:volume']);
    });
    test('exercise progress picks the best est. 1RM per session', () => {
      const prog = domain.exerciseProgress([{ dayKey: '2026-10-01', sets: [S(100, 5), S(90, 10), S(60, 12, 'warmup')] }]);
      assert.near(prog[0].e1rm, 120);
      assert.eq(prog[0].topWeight, 100);
    });
  });

  /* ════════════════════════════════════
     CUSTOM TRACKERS
     ════════════════════════════════════ */
  suite('Custom tracker builder', () => {
    const f = (label, kind = 'number', extra = {}) => ({ key: null, label, ...domain.fieldDefaults(kind), ...extra });
    test('valid definition passes', () => assert.eq(domain.validateTracker({ name: 'Steps', fields: [f('Steps')] }), []));
    test('needs a name and a visible field', () => {
      assert.eq(domain.validateTracker({ name: ' ', fields: [] }), ['Give the tracker a name.', 'Add at least one field.']);
      assert.eq(domain.validateTracker({ name: 'X', fields: [f('A', 'number', { hidden: true })] }), ['Add at least one field.']);
    });
    test('rejects duplicate field labels (case-insensitive) and blank labels', () => {
      assert.eq(domain.validateTracker({ name: 'BP', fields: [f('Sys'), f('sys')] }), ['Two fields are called “sys”.']);
      assert.eq(domain.validateTracker({ name: 'BP', fields: [f('')] }), ['Every field needs a label.']);
    });
    test('rejects a tracker name that already exists', () =>
      assert.eq(domain.validateTracker({ name: 'water', fields: [f('A')] }, [{ id: 'x', name: 'Water' }]), ['You already have a tracker called “water”.']));
    test('renaming a tracker to its own name is fine', () =>
      assert.eq(domain.validateTracker({ id: 'x', name: 'Water', fields: [f('A')] }, [{ id: 'x', name: 'Water' }]), []));
    test('goals must be positive', () =>
      assert.eq(domain.validateTracker({ name: 'X', fields: [f('A', 'number', { goal: { target: 0, dir: 'atLeast' } })] }), ['The goal for “A” must be above 0.']));
    test('field keys are slugged, unique, and stable', () => {
      const taken = new Set(['steps']);
      assert.eq(domain.uniqueKey('Steps', taken), 'steps_2');
      assert.eq(domain.uniqueKey('Blood Pressure (sys)', new Set()), 'blood_pressure_sys');
      assert.eq(domain.uniqueKey('Meditation', new Set(), 'c_'), 'c_meditation');
      assert.eq(domain.uniqueKey('😊', new Set()), 'field');
    });
    test('defaults per kind combine logs sensibly', () => {
      assert.eq(['number', 'scale', 'bool', 'duration', 'text', 'time'].map(k => domain.fieldDefaults(k).agg), ['sum', 'avg', 'max', 'sum', 'last', 'last']);
      assert.eq(domain.fieldDefaults('scale').max, 5);
    });
    test('a custom tracker aggregates and summarizes like a built-in', () => {
      const t = { fields: [f('Steps', 'number', { key: 'steps', unit: 'steps', primary: true }), f('Felt good', 'bool', { key: 'good' })] };
      assert.eq(domain.aggregate(t, [entry({ steps: 4000 }), entry({ steps: 6500, good: true })], 'steps'), 10500);
      assert.eq(domain.summarizeEntry(t, { values: { steps: 6500, good: true } }, imperial), '6,500 steps · Yes felt good');
    });
    test('hidden fields are left out of summaries', () => {
      const t = { fields: [f('A', 'number', { key: 'a', primary: true }), f('Old', 'number', { key: 'old', hidden: true })] };
      assert.eq(domain.summarizeEntry(t, { values: { a: 3, old: 9 } }, imperial), '3');
    });
    test('quick-add buttons: unit-less and per display unit', () => {
      const steps = { fields: [{ key: 'steps', kind: 'number', primary: true, unit: 'steps' }], quick: { chips: { _: [1000, 5000] } } };
      assert.eq(domain.quickChips(steps, imperial).values, [1000, 5000]);
      const water = tracker('hydration');
      assert.eq(domain.quickChips(water, imperial).values, [8, 16, 24]);
      assert.eq(domain.quickChips(water, metric).unit, 'ml');
      assert.eq(domain.quickChips({ fields: [], quick: {} }, imperial), null);
    });
    test('fieldToCanonical converts only fields with a dimension', () => {
      assert.near(units.fieldToCanonical({ dim: 'volume' }, 16, imperial), 473.176473);
      assert.eq(units.fieldToCanonical({ unit: 'steps' }, 1000, imperial), 1000);
    });
  });

  /* ════════════════════════════════════
     RUN
     ════════════════════════════════════ */
  const results = document.getElementById('results');
  let pass = 0, fail = 0;
  for (const s of suites) {
    const items = s.tests.map(t => {
      try { t.fn(); pass++; return `<li class="pass">✓ ${util.esc(t.name)}</li>`; }
      catch (err) { fail++; return `<li class="fail">✗ ${util.esc(t.name)}<pre>${util.esc(err.message)}</pre></li>`; }
    });
    results.insertAdjacentHTML('beforeend', `<h2>${util.esc(s.name)}</h2><ul>${items.join('')}</ul>`);
  }
  const summary = document.getElementById('summary');
  summary.textContent = `${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`;
  summary.className = fail ? 'fail' : 'pass';
  document.title = `${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} — Health Log tests`;
})(globalThis.HL);
