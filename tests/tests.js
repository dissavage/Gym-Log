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

  suite('Rest durations', () => {
    test('m:ss parses to seconds', () => assert.eq(['1:30', '2:00', '0:05', '15:00'].map(util.parseDuration), [90, 120, 5, 900]));
    test('a bare number is seconds', () => assert.eq(util.parseDuration('90'), 90));
    test('one-digit seconds are allowed', () => assert.eq(util.parseDuration('1:5'), 65));
    test('zero parses (range is the picker’s job)', () => assert.eq(util.parseDuration('0:00'), 0));
    test('over the range still parses', () => assert.eq(util.parseDuration('15:01'), 901));
    test('seconds overflow normalises', () => assert.eq(util.formatDuration(util.parseDuration('0:90')), '1:30'));
    test('spaces are trimmed', () => assert.eq(util.parseDuration(' 2:00 '), 120));
    test('garbage is null', () =>
      assert.eq(['', 'abc', '1:xx', '-1:00', '1.5', '1:2:3', ':30', '1:', null, undefined].map(util.parseDuration), Array(10).fill(null)));
    test('formats as m:ss', () => assert.eq([90, 5, 0, 900, 65.4, 3600].map(util.formatDuration), ['1:30', '0:05', '0:00', '15:00', '1:05', '60:00']));
    test('format of nothing is empty; negatives clamp to 0:00', () => assert.eq([util.formatDuration(null), util.formatDuration(NaN), util.formatDuration(-5)], ['', '', '0:00']));
    test('round-trips', () => assert.ok([5, 59, 60, 61, 599, 900].every(s => util.parseDuration(util.formatDuration(s)) === s)));
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
    test('each session carries its exercise note; old data without one gives ""', () => {
      const withNotes = domain.exerciseIndex([
        wo('n', '2026-10-09T10:00:00.000-07:00', [{ exerciseId: 'bench', notes: 'Seat 4', sets: [S(100, 5)] }, { exerciseId: 'bench', notes: 'Grip wider', sets: [S(100, 5)] }]),
      ]);
      assert.eq(withNotes.get('bench')[0].notes, 'Seat 4\nGrip wider');
      assert.eq(idx.get('bench').map(s => s.notes), ['', '', '']);
    });
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

  suite('Workout session', () => {
    const ws = HL.session;   // ('session' above is the history-entry helper)
    // An old template: per-slot `sets` counts, one exercise with a rep target and no history
    const template = { name: 'Push', exercises: [
      { exerciseId: 'bench', sets: 4, repMin: 6, repMax: 8 },
      { exerciseId: 'dips', sets: 3, repMin: 10, repMax: 12 },
      { exerciseId: 'fly', sets: 3 },
    ] };
    const last = { bench: [S(60, 10, 'warmup'), S(100, 6), S(100, 5)], fly: [S(15, 20, 'warmup'), S(20, 15, 'drop'), S(25, 12, 'failure')] };
    const built = ws.fromTemplate(template, id => last[id]);
    const one = ex => ex.sets[0];

    test('a template start adds every exercise in order, one set each', () => {
      assert.eq(built.map(ex => ex.exerciseId), ['bench', 'dips', 'fly']);
      assert.eq(built.map(ex => ex.sets.length), [1, 1, 1]);
      assert.ok(built.every(ex => one(ex).setType === 'working' && !one(ex).done));
    });
    test('prefill uses the first working set, skipping warm-ups', () =>
      assert.eq([one(built[0]).weightKg, one(built[0]).reps], [100, 6]));
    test('no working set last time: first non-warm-up set', () => assert.eq([one(built[2]).weightKg, one(built[2]).reps], [20, 15]));
    test('no history: weight empty, reps from the template target', () => assert.eq([one(built[1]).weightKg, one(built[1]).reps], [null, 10]));
    test('no history and no target: both empty', () => assert.eq([ws.firstSet(undefined).weightKg, ws.firstSet([]).reps], [null, null]));
    test('history wins over the template target', () => assert.eq(ws.firstSet(last.bench, { repMin: 12 }).reps, 6));
    test('old templates with sets still load and are not changed', () => {
      assert.eq(template.exercises.map(s => s.sets), [4, 3, 3]);
      assert.eq([built[0].repMin, built[0].repMax], [6, 8]);
    });
    test('an exercise added from the picker gets one working set, from the first working set last time', () => {
      const slot = ws.exerciseSlot('bench', last.bench);
      assert.eq(slot.sets.map(s => [s.setType, s.weightKg, s.reps, s.done]), [['working', 100, 6, false]]);
      assert.eq(ws.exerciseSlot('new-one', undefined).sets.map(s => [s.weightKg, s.reps]), [[null, null]]);
    });
    test('missing exercises are skipped', () =>
      assert.eq(ws.fromTemplate(template, () => [], id => id !== 'dips').map(ex => ex.exerciseId), ['bench', 'fly']));

    test('only the first exercise is expanded on start', () => assert.eq(ws.focused(built, one(built[0]).id), built[0]));
    test('finishing an exercise expands the next unfinished one', () => {
      const exs = structuredClone(built);
      exs[0].sets[0].done = true;
      assert.eq(ws.focused(exs, exs[1].sets[0].id).key, exs[1].key);
      assert.eq(ws.focused(exs, null).key, exs[1].key);
    });
    test('an exercise expanded by hand holds while it has the active set', () => {
      assert.eq(ws.focused(built, one(built[2]).id, { key: built[2].key }), built[2]);
      assert.eq(ws.focused(built, one(built[0]).id, { key: built[2].key }), built[0]);
      assert.eq(ws.focused(built, one(built[0]).id, { key: null }), null);
    });

    test('skipped exercises are not saved', () => {
      const exs = structuredClone(built);
      exs[0].sets[0].done = true;
      exs[2].sets.push({ ...exs[2].sets[0], id: 'x', done: true });
      assert.eq(ws.skipped(exs).map(ex => ex.exerciseId), ['dips']);
      const saved = ws.toSave(exs);
      assert.eq(saved.map(ex => ex.exerciseId), ['bench', 'fly']);
      assert.eq(saved.map(ex => ex.sets.length), [1, 1]);
      assert.ok(saved.every(ex => !('key' in ex)), 'UI keys are not saved');
    });
    test('exercise notes are saved trimmed; old exercises without notes save ""', () => {
      const done = { id: 'd', setType: 'working', weightKg: 50, reps: 5, done: true };
      const saved = ws.toSave([{ exerciseId: 'a', notes: '  Seat 4 \n', sets: [done] }, { exerciseId: 'b', sets: [done] }]);
      assert.eq(saved.map(ex => ex.notes), ['Seat 4', '']);
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
     BACKUP & IMPORT
     ════════════════════════════════════ */
  suite('Backup, import dedupe & CSV', () => {
    const { backup } = HL;
    const rec = (id, updatedAt, extra = {}) => ({ id, type: 'body', updatedAt, timestamp: '2026-10-01T07:00:00.000-07:00', dayKey: '2026-10-01', values: { weight: 80 }, ...extra });
    const stores = { entries: [rec('a', '2026-10-01T00:00:00Z'), rec('b', '2026-10-02T00:00:00Z', { deletedAt: '2026-10-03T00:00:00Z' })], trackers: [] };
    const file = backup.buildBackup(stores, { restSec: 120 }, '2026-10-22T00:00:00Z');

    test('backup carries app tag, schema version, settings and every data store', () => {
      assert.eq([file.app, file.schemaVersion, file.settings.restSec], ['healthlog', schema.SCHEMA_VERSION, 120]);
      assert.eq(Object.keys(file.stores).sort(), [...schema.DATA_STORES].sort());
    });
    test('round trip: export → wipe → import restores everything, deleted rows included', () => {
      const v = backup.validateBackup(JSON.parse(JSON.stringify(file)));
      assert.eq(v.errors, []);
      const diff = backup.diffImport({}, v.snapshot.stores);
      assert.eq(diff.add.map(x => x.record.id).sort(), ['a', 'b']);
      assert.eq(diff.add.find(x => x.record.id === 'b').record.deletedAt, '2026-10-03T00:00:00Z');
    });
    test('workout and exercise notes round-trip through backup and restore', () => {
      const w = { id: 'w', type: 'workout', updatedAt: '2026-10-05T00:00:00Z', timestamp: '2026-10-05T18:00:00.000-07:00', dayKey: '2026-10-05',
        notes: 'Slept badly, still PR’d', values: { name: 'Push', templateId: null, exercises: [{ exerciseId: 'bench', notes: 'Seat 4\nGrip wider', sets: [S(100, 5)] }] } };
      const v = backup.validateBackup(JSON.parse(JSON.stringify(backup.buildBackup({ entries: [w] }, {}))));
      const back = backup.diffImport({}, v.snapshot.stores).add.find(x => x.record.id === 'w').record;
      assert.eq([back.notes, back.values.exercises[0].notes], ['Slept badly, still PR’d', 'Seat 4\nGrip wider']);
    });
    test('re-importing the same file adds nothing', () => {
      const diff = backup.diffImport(stores, backup.validateBackup(file).snapshot.stores);
      assert.eq([diff.add.length, diff.update.length, diff.duplicates], [0, 0, 2]);
    });
    test('a newer copy updates; an older copy never overwrites', () => {
      const incoming = { entries: [rec('a', '2026-10-05T00:00:00Z', { values: { weight: 81 } }), rec('b', '2026-09-01T00:00:00Z')] };
      const diff = backup.diffImport(stores, incoming);
      assert.eq(diff.update.map(x => x.record.id), ['a']);
      assert.eq(diff.duplicates, 1);
    });
    test('records imported from another app dedupe by source key even with new ids', () => {
      const mine = { entries: [rec('x', '2026-10-01T00:00:00Z', { source: { app: 'gym-tracker', key: 'w1' } })] };
      const diff = backup.diffImport(mine, { entries: [rec('y', '2026-10-09T00:00:00Z', { source: { app: 'gym-tracker', key: 'w1' } })] });
      assert.eq([diff.add.length, diff.duplicates], [0, 1]);
    });
    test('rejects things that aren’t backups', () => {
      assert.ok(backup.validateBackup(null).errors.length);
      assert.ok(backup.validateBackup({ app: 'other' }).errors.length);
      assert.ok(/old Gym Tracker/.test(backup.validateBackup({ app: 'gym-tracker-legacy' }).errors[0]));
      assert.ok(/newer version/.test(backup.validateBackup({ ...file, schemaVersion: 99 }).errors[0]));
    });
    test('damaged records are skipped and counted, not imported', () => {
      const v = backup.validateBackup({ ...file, stores: { entries: [rec('ok', '2026-10-01T00:00:00Z'), { id: 5 }, null] } });
      assert.eq([v.snapshot.stores.entries.length, v.skippedInvalid], [1, 2]);
    });
    test('entries without dates or values fail validation', () =>
      assert.ok(backup.validateBackup({ ...file, stores: { entries: [{ id: 'z', type: 'body', updatedAt: 'x' }] } }).errors.length));
    test('CSV escaping: commas, quotes, newlines, formula injection; numbers untouched', () => {
      assert.eq(backup.csvCell('a,b'), '"a,b"');
      assert.eq(backup.csvCell('say "hi"'), '"say ""hi"""');
      assert.eq(backup.csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
      assert.eq(backup.csvCell(-5), '-5');
      assert.eq(backup.csvCell(null), '');
    });
    test('tracker CSV uses display units in headers and values', () => {
      const csv = backup.trackerCSV(tracker('body'), [{ dayKey: '2026-10-01', timestamp: '2026-10-01T07:05:00.000-07:00', values: { weight: units.toCanonical('mass', 185, 'lb') }, notes: 'post, run' }], imperial);
      const [head, row] = csv.split('\r\n');
      assert.ok(head.startsWith('date,time,Bodyweight (lb),Body fat (%)'));
      assert.ok(row.startsWith('2026-10-01,07:05,185,'));
      assert.ok(row.endsWith('"post, run"'));
    });
    test('workout CSV has one row per set with est. 1RM', () => {
      const t = tracker('workout');
      const csv = backup.trackerCSV(t, [{ dayKey: '2026-10-01', timestamp: '2026-10-01T18:00:00.000-07:00', values: { name: 'Push', exercises: [{ exerciseId: 'bench', sets: [S(100, 5), S(60, 10, 'warmup')] }] } }], metric, id => id.toUpperCase());
      const rows = csv.split('\r\n');
      assert.eq(rows.length, 3);
      assert.eq(rows[1], '2026-10-01,18:00,Push,BENCH,1,working,100,5,,,116.7,,');
    });
  });

  /* ════════════════════════════════════
     OLD GYM TRACKER IMPORT
     ════════════════════════════════════ */
  suite('Old Gym Tracker mapper', () => {
    const { legacy, backup } = HL;
    const sess = (date, dayType, exercises) => ({ date, dayType, exercises });
    const ex = (name, type, sets) => ({ name, type, sets: sets.map(([weight, reps, isDropSet = false]) => ({ weight, reps, isDropSet })) });
    const keys = {
      gym_sessions: JSON.stringify([
        sess('2026-09-22T06:16:34.778Z', 'Upper A', [ex('Skull Crushers', 'accessory', [[60, 10], [60, 9], [40, 12, true]]), ex('Dips (chest lean)', 'compound', [[0, 12], [0, 10]])]),
        sess('2026-10-20T01:30:00.000Z', 'Upper A', [ex('Deadlift', 'compound', [[225, 5]]), ex('Pec Deck (Decline)', 'accessory', [[70, 10]])]),
        sess('2026-10-21T01:30:00.000Z', 'Lower A', [ex('Conventional Deadlift', 'compound', [[235, 5]]), ex('Pull-ups', 'compound', [[0, 8]]), ex('Empty', 'accessory', [['', '']])]),
      ]),
      gym_weights: JSON.stringify([{ date: '2026-10-21T14:00:00.000Z', weight: 204.6 }, { date: 'bad', weight: 1 }]),
      gym_custom_ex: JSON.stringify([{ name: 'Pec Deck (Decline)', type: 'accessory', muscleGroup: 'Chest', custom: true }, { name: 'Unused Thing', type: 'compound', muscleGroup: 'Back', custom: true }]),
      gym_macro_log: JSON.stringify([{ id: Date.parse('2026-10-20T03:30:00Z') + 0.42, date: '2026-10-20', foodName: 'Chicken', cal: 400, pro: 50, carb: 0, fat: 9 }]),
      gym_macro_goals: JSON.stringify({ cal: 2200, pro: 180, carb: 220, fat: 70 }),
      gym_app_settings: JSON.stringify({ hiddenTabs: ['diet'] }),
      gym_ex_overrides: JSON.stringify({ 'skull crushers': { repRange: '8-12' } }),
    };
    const lib = schema.BUILTIN_EXERCISES;
    const out = legacy.mapLegacy(keys, { exercises: lib, now: new Date('2026-10-23T07:00:00Z') });
    const workouts = out.entries.filter(e => e.type === 'workout');
    const exOf = (w, i) => w.values.exercises[i];

    test('every session with logged sets becomes a workout; empty exercises are dropped', () => {
      assert.eq(out.report.workouts, 3);
      assert.eq(workouts[2].values.exercises.length, 2);
    });
    test('pounds convert exactly to kg', () => assert.near(exOf(workouts[0], 0).sets[0].weightKg, 27.2155422));
    test('drop sets keep their type; everything else is a working set', () =>
      assert.eq(exOf(workouts[0], 0).sets.map(s => s.setType), ['working', 'working', 'drop']));
    test('0 lb means bodyweight', () => {
      assert.eq(exOf(workouts[0], 1).sets[0].weightKg, null);
      assert.eq(out.report.bodyweightSets, 3);
    });
    test('UTC start time lands on the local calendar day', () => {
      const d = new Date('2026-09-22T06:16:34.778Z');
      assert.eq(workouts[0].dayKey, util.dayKey(d));
      assert.eq(new Date(workouts[0].timestamp).getTime(), d.getTime());
    });
    test('confirmed aliases link to the library (Skull Crushers, Conventional Deadlift → Deadlift)', () => {
      assert.eq(exOf(workouts[0], 0).exerciseId, 'ex-skull-crusher');
      assert.eq(exOf(workouts[2], 0).exerciseId, 'ex-deadlift');
      assert.eq(exOf(workouts[1], 0).exerciseId, 'ex-deadlift');
    });
    test('near-exact names match (Pull-ups → Pull-up)', () => assert.eq(exOf(workouts[2], 1).exerciseId, 'ex-pull-up'));
    test('variants stay separate as new exercises with inferred muscles', () => {
      const dips = out.exercises.find(e => e.name === 'Dips (chest lean)');
      assert.eq([dips.primary, dips.equipment, dips.category], [['chest'], 'bodyweight', 'compound']);
      const decline = out.exercises.find(e => e.name === 'Pec Deck (Decline)');
      assert.eq([decline.primary, decline.equipment, decline.category], [['chest'], 'machine', 'isolation']);
    });
    test('unused custom exercises still come over', () => {
      const u = out.exercises.find(e => e.name === 'Unused Thing');
      assert.eq(u.primary, ['lats']);
    });
    test('one template per split day from its latest session, linked to its workouts', () => {
      assert.eq(out.templates.map(t => [t.name, t.color]), [['Upper A', 'orange'], ['Lower A', 'green']]);
      assert.eq(out.templates[0].exercises.map(s => s.exerciseId), ['ex-deadlift', exOf(workouts[1], 1).exerciseId]);
      assert.eq(workouts[1].values.templateId, out.templates[0].id);
    });
    test('weigh-ins convert; invalid rows are skipped', () => {
      const w = out.entries.filter(e => e.type === 'body');
      assert.eq(w.length, 1);
      assert.eq(units.display('mass', w[0].values.weight, imperial), 204.6);
    });
    test('meals take their time from the epoch id, not the UTC date string', () => {
      const m = out.entries.find(e => e.type === 'nutrition');
      assert.eq(m.values, { food: 'Chicken', calories: 400, protein: 50, carbs: 0, fat: 9 });
      assert.eq(m.dayKey, util.dayKey(new Date('2026-10-20T03:30:00Z')));
    });
    test('macro goals map to Food goals', () => assert.eq(out.macroGoals, { calories: 2200, protein: 180, carbs: 220, fat: 70 }));
    test('settings and overrides are reported as skipped', () =>
      assert.eq(out.report.skipped.map(s => s.key), ['gym_app_settings', 'gym_ex_overrides']));
    test('every record is tagged with its source for dedupe', () =>
      assert.ok([...out.entries, ...out.exercises, ...out.templates].every(r => r.source?.app === 'gym-tracker' && r.source.key)));
    test('importing twice adds nothing the second time, even after renaming an imported exercise', () => {
      const first = backup.diffImport({}, { exercises: out.exercises, entries: out.entries, templates: out.templates });
      const existing = { exercises: [...lib, ...first.add.filter(x => x.store === 'exercises').map(x => ({ ...x.record, name: x.record.name === 'Pec Deck (Decline)' ? 'Decline Pec Deck' : x.record.name }))],
        entries: first.add.filter(x => x.store === 'entries').map(x => x.record), templates: first.add.filter(x => x.store === 'templates').map(x => x.record) };
      const again = legacy.mapLegacy(keys, { exercises: existing.exercises, now: new Date('2026-10-23T07:00:00Z') });
      const second = backup.diffImport(existing, { exercises: again.exercises, entries: again.entries, templates: again.templates });
      assert.eq(second.add.length, 0);
      const renamed = existing.exercises.find(e => e.name === 'Decline Pec Deck');
      assert.eq(again.entries.find(e => e.type === 'workout' && e.values.exercises.some(x => x.exerciseId === renamed.id)) != null, true);
    });
    test('damaged keys are reported, not fatal', () => {
      const bad = legacy.mapLegacy({ gym_sessions: '{nope', gym_weights: '[]' }, { exercises: lib });
      assert.eq([bad.report.workouts, bad.report.skipped[0].key], [0, 'gym_sessions']);
    });
    test('an in-progress workout becomes a draft with filled sets ticked', () => {
      const d = legacy.mapLegacy({ gym_draft: JSON.stringify({ dayType: 'Arm Day', date: '2026-10-22T20:00:00Z', exercises: [ex('Hammer Curl', 'accessory', [[35, 10], ['', '']])] }) }, { exercises: lib }).draft;
      assert.eq([d.id, d.name, d.exercises[0].exerciseId, d.exercises[0].sets.map(s => s.done)], ['workout', 'Arm Day', 'ex-hammer-curl', [true, false]]);
    });
  });

  /* ════════════════════════════════════
     DEMO DATA
     ════════════════════════════════════ */
  suite('Demo data', () => {
    const { demo } = HL;
    const a = demo.generateDemo({ today: '2026-10-23', days: 182, seed: 7 });
    const b = demo.generateDemo({ today: '2026-10-23', days: 182, seed: 7 });
    const strip = e => ({ ...e, id: null, createdAt: null, updatedAt: null, tz: null, values: JSON.parse(JSON.stringify(e.values, (k, v) => (k === 'id' || k === 'itemId' ? null : v))) });
    const byType = t => a.entries.filter(e => e.type === t);
    test('deterministic for a given seed and date', () => assert.eq(a.entries.map(strip), b.entries.map(strip)));
    test('every record is tagged as demo', () => assert.ok([...a.entries, ...a.checklistItems].every(demo.isDemo)));
    test('covers ~6 months ending yesterday', () => {
      const days = a.entries.map(e => e.dayKey).sort();
      assert.eq([days[0], days.at(-1)], ['2026-04-24', '2026-10-22']);
    });
    test('realistic volume per tracker', () => {
      assert.ok(byType('workout').length > 90 && byType('workout').length < 110, `workouts ${byType('workout').length}`);
      assert.ok(byType('body').length > 130, 'weigh-ins');
      assert.eq(byType('nutrition').length, 182 * 3);
      assert.eq(byType('sleep').length, 182);
    });
    test('workouts only use library exercises and progress over time', () => {
      const ids = new Set(schema.BUILTIN_EXERCISES.map(e => e.id));
      assert.ok(byType('workout').every(w => w.values.exercises.every(x => ids.has(x.exerciseId))));
      const idx = domain.exerciseIndex(byType('workout'));
      const bench = idx.get('ex-barbell-bench-press');
      assert.ok(domain.personalBests(bench.slice(-3)).weight > domain.personalBests(bench.slice(0, 3)).weight);
    });
    test('supplement logs point at the demo checklist items', () => {
      const items = new Set(a.checklistItems.map(i => i.id));
      assert.ok(byType('supplements').every(e => items.has(e.values.itemId)));
    });
    test('sleep durations are plausible', () => {
      const t = tracker('sleep');
      const mins = byType('sleep').map(e => domain.withComputed(t, e.values).duration);
      assert.ok(mins.every(m => m >= 300 && m <= 600), `range ${Math.min(...mins)}–${Math.max(...mins)}`);
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
