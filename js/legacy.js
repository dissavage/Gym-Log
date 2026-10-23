/* ════════════════════════════════════
   LEGACY — pure mapper from the old Gym Tracker's gym_* localStorage keys
   Old data is only read, never written. Every record gets a source key, so running
   the import twice finds the first copy and skips it.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units } = HL;
  const SOURCE = 'gym-tracker';
  const lbToKg = lb => units.toCanonical('mass', lb, 'lb');

  // Old app's exercise lists by group (copied from Gym-Tracker) — used to infer muscles
  const OLD_GROUPS = {
    chest: ['Flat Barbell Bench Press', 'Incline Barbell Bench Press', 'Decline Barbell Bench Press', 'Incline Dumbbell Press', 'Flat Dumbbell Press', 'Decline Dumbbell Press', 'Dips (chest lean)', 'Landmine Press', 'Machine Chest Press (flat)', 'Machine Chest Press (incline)', 'Hammer Strength Chest Press', 'Pec Deck / Chest Fly Machine', 'Cable Chest Fly (low-to-high)', 'Cable Chest Fly (high-to-low)', 'Cable Chest Fly (mid)', 'Dumbbell Chest Fly'],
    shoulders_push: ['Dumbbell Shoulder Press', 'Barbell OHP', 'Arnold Press', 'Machine Shoulder Press', 'Side Lateral Raise', 'Cable Lateral Raise', 'Lateral Raise Machine', 'Cable Lateral Raise (single arm)', 'Front Raise', 'Cable Front Raise'],
    shoulders_rear: ['Face Pulls', 'Rear Delt Fly (cable)', 'Rear Delt Fly (dumbbell)', 'Rear Delt Machine', 'Reverse Pec Deck'],
    back: ['Pull-ups', 'Chin-ups', 'Barbell Row', 'Lat Pulldown (wide grip)', 'T-Bar Row', 'Deadlift', 'Trap Bar Deadlift', 'Rack Pull', 'Assisted Pull-up Machine', 'Seated Cable Row (wide grip)', 'Seated Cable Row (close grip)', 'Seated Row Machine', 'Single-Arm Dumbbell Row', 'Single-Arm Cable Row', 'Lat Pulldown (close grip)', 'Lat Pulldown (neutral grip)', 'Lat Pulldown Machine', 'Chest-Supported Row', 'Chest-Supported Row Machine', 'Hammer Strength Row', 'Low Row Machine', 'Straight-Arm Pulldown'],
    biceps: ['Barbell Curl', 'EZ Bar Curl', 'Dumbbell Curl', 'Hammer Curl', 'Incline Dumbbell Curl', 'Cable Curl (bar)', 'Cable Curl (rope)', 'Cable Bicep Curl (single arm)', 'Preacher Curl (barbell)', 'Preacher Curl (dumbbell)', 'Preacher Curl Machine', 'Concentration Curl', 'Spider Curl', 'Cable Reverse Curl', 'Reverse Curl (barbell)'],
    triceps: ['Close-Grip Bench Press', 'Dips (upright)', 'Tricep Pushdown (rope)', 'Tricep Pushdown (bar)', 'Tricep Pushdown (V-bar)', 'Tricep Pushdown (single arm)', 'Overhead Tricep Extension (cable)', 'Overhead Tricep Extension (dumbbell)', 'Overhead Tricep Extension (EZ bar)', 'Skull Crushers', 'Tricep Machine (isolation)', 'Kickback (dumbbell)', 'Kickback (cable)'],
    traps: ['Barbell Shrug', 'Dumbbell Shrug', 'Cable Shrug', 'Machine Shrug', "Farmer's Carry"],
    forearms: ['Wrist Curl (barbell)', 'Wrist Curl (dumbbell)', 'Reverse Wrist Curl', 'Behind-the-Back Wrist Curl', 'Plate Pinch', 'Towel Pull-up', 'Dead Hang'],
    quads: ['Barbell Back Squat', 'Front Squat', 'Hack Squat Machine', 'Leg Press (standard)', 'Goblet Squat', 'Leg Press (isolation / narrow stance)', 'Leg Press (wide stance)', 'Leg Extension Machine', 'Leg Extension (single leg)', 'Bulgarian Split Squat', 'Lunges (walking)', 'Lunges (stationary)', 'Step-ups', 'Sissy Squat'],
    hamstrings: ['Romanian Deadlift', 'Stiff-Leg Deadlift', 'Conventional Deadlift', 'Sumo Deadlift', 'Good Mornings', 'Leg Curl (lying)', 'Leg Curl (seated)', 'Leg Curl (standing single leg)', 'Nordic Curl', 'Cable Pull-through', 'Single Leg Deadlift', 'Glute Ham Raise', 'Reverse Hyperextension'],
    glutes: ['Hip Thrust', 'Glute Bridge', 'Hip Abduction Machine', 'Hip Adduction Machine', 'Cable Hip Abduction', 'Cable Hip Adduction', 'Donkey Kickback (cable)', 'Donkey Kickback (machine)'],
    calves: ['Standing Calf Raise', 'Seated Calf Raise', 'Leg Press Calf Raise', 'Single-Leg Calf Raise'],
    abs: ['Abs Machine (crunch)', 'Cable Crunch', 'Hanging Leg Raise', 'Hanging Knee Raise', 'Decline Sit-up', 'Plank', 'Russian Twist', 'Cable Woodchop', 'Ab Wheel Rollout'],
  };

  // Custom exercises stored the old Muscle Group label
  const LABEL_GROUP = {
    'chest': 'chest', 'back': 'back', 'shoulders': 'shoulders_push', 'biceps': 'biceps', 'triceps': 'triceps',
    'quads': 'quads', 'hamstrings': 'hamstrings', 'glutes': 'glutes', 'calves': 'calves', 'abs / core': 'abs',
    'traps': 'traps', 'forearms': 'forearms',
  };

  // Same movement under another name — confirmed with the user (Oct 2026)
  const ALIASES = {
    'skull crushers': 'ex-skull-crusher',
    'ez bar curl': 'ex-ez-bar-curl',
    'leg curl (lying)': 'ex-lying-leg-curl',
    'leg extension machine': 'ex-leg-extension',
    'leg press (standard)': 'ex-leg-press',
    'lateral raise machine': 'ex-machine-lateral-raise',
    'pec deck / chest fly machine': 'ex-pec-deck',
    'conventional deadlift': 'ex-deadlift',
  };

  const TEMPLATE_COLORS = { 'upper a': 'orange', 'lower a': 'green', 'upper b': 'blue', 'lower b': 'purple', 'arm day': 'yellow' };

  // Near-exact match: case, punctuation and a trailing plural "s" don't matter ("Pull-ups" = "Pull-up")
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');

  const OLD_GROUP_OF = new Map();
  for (const [g, names] of Object.entries(OLD_GROUPS)) for (const n of names) OLD_GROUP_OF.set(norm(n), g);

  /* ════════════════════════════════════
     EXERCISE INFERENCE
     ════════════════════════════════════ */
  function musclesFor(name, group) {
    const n = name.toLowerCase();
    switch (group) {
      case 'back':
        if (/deadlift|rack pull/.test(n)) return [['glutes', 'hamstrings', 'lower_back'], ['upper_back', 'traps']];
        if (/row/.test(n)) return [['upper_back'], ['lats', 'biceps']];
        return [['lats'], ['biceps']];
      case 'shoulders_push':
        if (/lateral/.test(n)) return [['side_delts'], []];
        if (/press/.test(n)) return [['front_delts'], ['side_delts', 'triceps']];
        return [['front_delts'], []];
      case 'shoulders_rear': return [['rear_delts'], ['upper_back']];
      case 'chest': return /press|dip/.test(n) ? [['chest'], ['front_delts', 'triceps']] : [['chest'], []];
      case 'hamstrings':
        if (/deadlift|good morning|hyperextension|pull-through/.test(n)) return [['hamstrings', 'glutes'], ['lower_back']];
        return [['hamstrings'], []];
      case 'glutes':
        if (/adduct/.test(n)) return [['adductors'], []];
        if (/abduct/.test(n)) return [['abductors'], ['glutes']];
        return [['glutes'], ['hamstrings']];
      case 'quads': return /press|squat|lunge|step/.test(n) ? [['quads', 'glutes'], ['adductors']] : [['quads'], []];
      case 'biceps': return [['biceps'], ['forearms']];
      case undefined: case null: return [[], []];
      default: return [[group], []];
    }
  }

  function equipmentFor(name) {
    const n = name.toLowerCase();
    if (/smith/.test(n)) return 'smith';
    if (/machine|hammer strength|pec deck|leg press|hack squat|extension|leg curl|extreme row/.test(n)) return 'machine';
    if (/cable|pulldown|pushdown|face pull/.test(n)) return 'cable';
    if (/dumbbell/.test(n)) return 'dumbbell';
    if (/\bdips?\b|pull-?up|chin-?up|push-?up|plank|hang|nordic|sit-up/.test(n)) return 'bodyweight';
    if (/barbell|ez bar|deadlift|squat|bench|ohp|row|shrug|curl/.test(n)) return 'barbell';
    return 'other';
  }

  /* ════════════════════════════════════
     MAP
     ════════════════════════════════════ */
  function parseKey(keys, name, report) {
    const raw = keys[name];
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch {
      report.skipped.push({ key: name, reason: 'could not be read (damaged JSON)' });
      return null;
    }
  }

  const isNum = v => v !== '' && v != null && Number.isFinite(Number(v));

  /**
   * mapLegacy(keys, { exercises, now })
   * keys: { gym_sessions: '<json string>', ... } exactly as stored by the old app
   * exercises: current Health Log exercise records (for matching by name)
   * Returns { exercises, entries, templates, draft, macroGoals, report }
   */
  function mapLegacy(keys, { exercises = [], now = new Date() } = {}) {
    const report = { workouts: 0, sets: 0, dropSets: 0, bodyweightSets: 0, weighIns: 0, meals: 0, linked: [], created: [], skipped: [] };
    const nowISO = now.toISOString();
    const make = (type, props, at = nowISO) => ({
      id: util.uuid(), type, timestamp: util.localISO(new Date(at)), createdAt: at, updatedAt: at, deletedAt: null, notes: '', ...props,
    });
    const src = key => ({ app: SOURCE, key });

    // Exercise resolution: alias → exact/near-exact name → new custom exercise
    const byNorm = new Map();
    const bySource = new Map();
    for (const e of exercises) {
      if (!e.deletedAt) byNorm.set(norm(e.name), e.id);
      if (e.source?.app === SOURCE) bySource.set(e.source.key, e.id);
    }
    const byId = new Set(exercises.map(e => e.id));
    const customs = new Map((parseKey(keys, 'gym_custom_ex', report) || []).map(c => [norm(c.name), c]));
    const newExercises = [];
    const resolved = new Map();

    function exerciseIdFor(name, oldType) {
      const k = norm(name);
      if (resolved.has(k)) return resolved.get(k);
      // An exercise created by an earlier import keeps its link even if it was renamed since
      let id = bySource.get(`exercise:${k}`) || ALIASES[name.toLowerCase().trim()];
      if (id && !byId.has(id)) id = null;
      if (!id) id = byNorm.get(k) || null;
      if (id) {
        const target = exercises.find(e => e.id === id);
        if (target && target.name.toLowerCase() !== name.trim().toLowerCase()) report.linked.push([name.trim(), target.name]);
      } else {
        const custom = customs.get(k);
        const group = OLD_GROUP_OF.get(k) || LABEL_GROUP[String(custom?.muscleGroup || '').toLowerCase()];
        const [primary, secondary] = musclesFor(name, group);
        const type = custom?.type || oldType;
        const rec = make('exercise', {
          name: name.trim(), nameLower: name.trim().toLowerCase(), primary, secondary,
          equipment: equipmentFor(name), category: type === 'compound' ? 'compound' : 'isolation',
          builtIn: false, archived: false, restSec: null, repMin: null, repMax: null, source: src(`exercise:${k}`),
        });
        newExercises.push(rec);
        byNorm.set(k, rec.id);
        id = rec.id;
        report.created.push(rec.name);
      }
      resolved.set(k, id);
      return id;
    }

    const toSet = s => {
      const w = Number(s.weight);
      return {
        id: util.uuid(), setType: s.isDropSet ? 'drop' : 'working',
        // A logged weight of 0 means bodyweight (e.g. dips)
        weightKg: w > 0 ? lbToKg(w) : null, reps: Math.round(Number(s.reps)),
        rpe: null, rir: null, restSec: null, done: true, completedAt: null,
      };
    };

    /* ── Workouts ── */
    const sessions = (parseKey(keys, 'gym_sessions', report) || [])
      .filter(s => s && s.date && !isNaN(Date.parse(s.date)))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const entries = [];
    const latestByDay = new Map();
    for (const sess of sessions) {
      const start = new Date(sess.date);
      const exs = (sess.exercises || []).map(ex => {
        const sets = (ex.sets || []).filter(s => isNum(s.weight) && isNum(s.reps) && Number(s.reps) > 0).map(toSet);
        return sets.length ? { exerciseId: exerciseIdFor(ex.name, ex.type), notes: '', repMin: null, repMax: null, sets } : null;
      }).filter(Boolean);
      if (!exs.length) continue;
      const name = (sess.dayType || 'Workout').trim();
      entries.push(make('workout', {
        timestamp: util.localISO(start), dayKey: util.dayKey(start), tz: util.tzName(),
        values: { name, templateId: null, startedAt: util.localISO(start), endedAt: null, durationMin: null, exercises: exs },
        source: src(`session:${sess.date}`),
      }, sess.date));
      latestByDay.set(name.toLowerCase(), { name, exercises: exs, entry: entries[entries.length - 1] });
      report.workouts++;
      for (const ex of exs) for (const s of ex.sets) {
        report.sets++;
        if (s.setType === 'drop') report.dropSets++;
        if (s.weightKg == null) report.bodyweightSets++;
      }
    }

    // Custom exercises come over even if they were never used in a workout
    for (const c of customs.values()) if (c?.name) exerciseIdFor(c.name, c.type);

    /* ── Templates: one per split day, exercises from its most recent session ── */
    const split = parseKey(keys, 'gym_split_config', report);
    const colors = { ...TEMPLATE_COLORS };
    if (Array.isArray(split)) for (const d of split) if (d?.name) colors[d.name.toLowerCase()] = d.color || 'orange';
    const templates = [];
    for (const [k, day] of latestByDay) {
      const t = make('template', {
        name: day.name, color: colors[k] || 'orange', order: templates.length,
        exercises: day.exercises.map(ex => ({ exerciseId: ex.exerciseId, sets: ex.sets.filter(s => s.setType === 'working').length || ex.sets.length, repMin: null, repMax: null })),
        source: src(`template:${k}`),
      });
      templates.push(t);
    }
    // Link each imported workout to its day's template
    const tplByName = new Map(templates.map(t => [t.name.toLowerCase(), t.id]));
    for (const e of entries) e.values.templateId = tplByName.get(e.values.name.toLowerCase()) || null;

    /* ── Bodyweight ── */
    for (const w of parseKey(keys, 'gym_weights', report) || []) {
      if (!w?.date || !isNum(w.weight) || Number(w.weight) <= 0 || isNaN(Date.parse(w.date))) continue;
      const at = new Date(w.date);
      entries.push(make('body', {
        timestamp: util.localISO(at), dayKey: util.dayKey(at), tz: util.tzName(),
        values: { weight: lbToKg(Number(w.weight)) }, source: src(`weight:${w.date}`),
      }, w.date));
      report.weighIns++;
    }

    /* ── Food log: the numeric id is the epoch-ms when it was logged, which avoids the old UTC date bug ── */
    const plausible = ms => ms > Date.parse('2015-01-01') && ms < now.getTime() + 86400000;
    for (const m of parseKey(keys, 'gym_macro_log', report) || []) {
      if (!m) continue;
      const ms = Math.floor(Number(m.id));
      const at = plausible(ms) ? new Date(ms) : (m.date ? util.parseDayKey(m.date) : null);
      if (!at) continue;
      if (!plausible(ms)) at.setHours(12);
      const values = {};
      if (m.foodName) values.food = String(m.foodName);
      for (const [from, to] of [['cal', 'calories'], ['pro', 'protein'], ['carb', 'carbs'], ['fat', 'fat']]) if (isNum(m[from])) values[to] = Number(m[from]);
      if (!Object.keys(values).length) continue;
      entries.push(make('nutrition', {
        timestamp: util.localISO(at), dayKey: util.dayKey(at), tz: util.tzName(), values,
        source: src(`meal:${m.id ?? `${m.date}:${m.foodName}`}`),
      }, at.toISOString()));
      report.meals++;
    }

    const goals = parseKey(keys, 'gym_macro_goals', report);
    const macroGoals = goals && typeof goals === 'object'
      ? Object.fromEntries([['cal', 'calories'], ['pro', 'protein'], ['carb', 'carbs'], ['fat', 'fat']].filter(([k]) => Number(goals[k]) > 0).map(([k, to]) => [to, Number(goals[k])]))
      : null;

    /* ── In-progress workout ── */
    let draft = null;
    const old = parseKey(keys, 'gym_draft', report);
    if (old?.exercises?.length) {
      const start = old.date && !isNaN(Date.parse(old.date)) ? new Date(old.date) : now;
      draft = {
        ...make('draft', { timestamp: util.localISO(start) }),
        id: 'workout', name: (old.dayType || 'Workout').trim(), templateId: tplByName.get(String(old.dayType || '').toLowerCase()) || null,
        editingId: null, startedAt: util.localISO(start), active: null, rest: null,
        exercises: old.exercises.map(ex => ({
          key: util.uuid(), exerciseId: exerciseIdFor(ex.name, ex.type), notes: '', repMin: null, repMax: null,
          // In the old app a set counted once both boxes were filled
          sets: (ex.sets || []).map(s => ({
            id: util.uuid(), setType: s.isDropSet ? 'drop' : 'working',
            weightKg: isNum(s.weight) && Number(s.weight) > 0 ? lbToKg(Number(s.weight)) : null,
            reps: isNum(s.reps) ? Math.round(Number(s.reps)) : null,
            rpe: null, rir: null, restSec: null, done: isNum(s.reps) && isNum(s.weight), completedAt: null,
          })),
        })),
      };
    }

    for (const [key, reason] of [
      ['gym_app_settings', 'tab layout — no equivalent here'],
      ['gym_ex_overrides', 'rep ranges and day filters — skipped as you chose'],
      ['gym_quick_log', 'food shortcuts — skipped as you chose'],
      ['gym_diet_custom', 'custom foods — skipped as you chose'],
    ]) if (keys[key] != null) report.skipped.push({ key, reason });

    return { exercises: newExercises, entries, templates, draft, macroGoals, report };
  }

  HL.legacy = { mapLegacy };
})(globalThis.HL = globalThis.HL || {});
