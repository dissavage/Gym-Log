/* ════════════════════════════════════
   DEMO DATA — pure, deterministic sample history for exploring charts
   Every record is tagged source.app = 'demo' so "Remove demo data" deletes exactly these.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units } = HL;
  const SOURCE = 'demo';
  const lb = v => units.toCanonical('mass', v, 'lb');
  const oz = v => units.toCanonical('volume', v, 'floz');
  const mi = v => units.toCanonical('distance', v, 'mi');

  const SPLIT = [
    { name: 'Upper A', ex: [['ex-barbell-bench-press', 175, 5, 'c'], ['ex-barbell-row', 145, 8, 'c'], ['ex-overhead-press', 95, 6, 'c'], ['ex-lat-pulldown', 130, 10, 'i'], ['ex-triceps-pushdown-rope', 50, 12, 'i']] },
    { name: 'Lower A', ex: [['ex-back-squat', 225, 5, 'c'], ['ex-romanian-deadlift', 185, 8, 'c'], ['ex-leg-extension', 110, 12, 'i'], ['ex-standing-calf-raise', 150, 12, 'i']] },
    { name: 'Upper B', ex: [['ex-incline-dumbbell-press', 60, 8, 'c'], ['ex-pull-up', null, 8, 'c'], ['ex-dumbbell-lateral-raise', 20, 12, 'i'], ['ex-ez-bar-curl', 60, 10, 'i'], ['ex-face-pull', 40, 15, 'i']] },
    { name: 'Lower B', ex: [['ex-deadlift', 275, 5, 'c'], ['ex-leg-press', 360, 10, 'c'], ['ex-lying-leg-curl', 90, 10, 'i'], ['ex-hip-thrust', 185, 10, 'c']] },
  ];
  const MEALS = [
    ['Oats, berries & whey', 520, 42, 70, 10], ['Eggs & toast', 480, 30, 40, 22], ['Greek yogurt bowl', 390, 35, 45, 8],
    ['Chicken rice bowl', 720, 55, 85, 16], ['Turkey sandwich', 560, 40, 55, 18], ['Salmon salad', 610, 42, 25, 36],
    ['Steak, potatoes & greens', 820, 60, 70, 30], ['Pasta with meat sauce', 780, 45, 95, 22], ['Stir-fry & noodles', 700, 48, 80, 18],
  ];
  const CARDIO = [['Run', 3.1, 28], ['Walk', 2.5, 45], ['Cycle', 9, 40], ['Row', 0, 20]];
  const SUPPLEMENTS = [['Creatine', 5, 'g'], ['Vitamin D', 2000, 'IU'], ['Fish oil', 2, 'caps']];

  /**
   * generateDemo({ today, days, seed }) → { entries, checklistItems }
   * Same seed and today → same data (apart from random ids).
   */
  function generateDemo({ today = util.dayKey(), days = 182, seed = 7 } = {}) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pick = list => list[Math.floor(rnd() * list.length)];
    const between = (a, b) => a + rnd() * (b - a);
    const round = (v, step) => Math.round(v / step) * step;
    const iso = new Date().toISOString();
    let n = 0;
    const base = (type, key) => ({ id: util.uuid(), type, createdAt: iso, updatedAt: iso, deletedAt: null, notes: '', source: { app: SOURCE, key: `${key}:${n++}` } });
    const at = (dayKey, h, m = 0) => { const d = util.parseDayKey(dayKey); d.setHours(h, m); return d; };
    const entry = (type, d, values, key) => ({ ...base(type, key), timestamp: util.localISO(d), dayKey: util.dayKey(d), tz: util.tzName(), values });

    const checklistItems = SUPPLEMENTS.map(([name, dose, unit], order) => ({
      ...base('checklistItem', 'item'), timestamp: util.localISO(), trackerType: 'supplements', name, dose, unit, active: true, order,
    }));

    const entries = [];
    let splitIdx = 0;
    for (let i = days; i >= 1; i--) {
      const day = util.addDays(today, -i);
      const progress = (days - i) / days;           // 0 → 1 across the period
      const dow = util.parseDayKey(day).getDay();

      // Bodyweight: slow cut from ~192 to ~184 lb with daily water-weight noise
      if (rnd() < 0.85) {
        const v = { weight: lb(192 - progress * 8 + between(-1.4, 1.4)) };
        if (dow === 1) v.bodyFat = util.round(19 - progress * 2.5 + between(-0.4, 0.4), 1);
        if (dow === 1 && i % 28 < 7) v.waist = units.toCanonical('length', util.round(35 - progress * 1.5 + between(-0.2, 0.2), 2), 'in');
        entries.push(entry('body', at(day, 7, 5 + Math.floor(rnd() * 20)), v, 'body'));
      }

      // Food: three meals
      [[8, 0], [12, 30], [19, 0]].forEach(([h, m], k) => {
        const [food, cal, pro, carb, fat] = MEALS[Math.floor(rnd() * 3) + k * 3];
        const f = between(0.85, 1.15);
        entries.push(entry('nutrition', at(day, h, m + Math.floor(rnd() * 25)), {
          food, calories: round(cal * f, 10), protein: Math.round(pro * f), carbs: Math.round(carb * f), fat: Math.round(fat * f),
        }, 'meal'));
      });

      // Water: 3–6 drinks
      const drinks = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < drinks; k++) entries.push(entry('hydration', at(day, 9 + k * 2, Math.floor(rnd() * 50)), { amount: oz(pick([8, 16, 16, 24])) }, 'water'));

      // Sleep (logged in the morning)
      const bed = at(day, 22, 0);
      bed.setMinutes(bed.getMinutes() + Math.floor(between(0, 140)));
      const wake = round(Math.floor(between(360, 450)), 5);
      const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      entries.push(entry('sleep', at(day, 7, 0), { bedTime: hhmm(bed), wakeTime: `0${Math.floor(wake / 60)}:${String(wake % 60).padStart(2, '0')}`, quality: 2 + Math.floor(rnd() * 4) }, 'sleep'));

      // Mood, energy, soreness
      entries.push(entry('mood', at(day, 21, 0), { mood: 3 + Math.floor(rnd() * 3), energy: 2 + Math.floor(rnd() * 4), soreness: 1 + Math.floor(rnd() * 3) }, 'mood'));

      // Supplements, most days
      checklistItems.forEach(item => {
        if (rnd() < 0.9) entries.push(entry('supplements', at(day, 8, 15), { itemId: item.id, item: item.name, dose: item.dose, unit: item.unit }, 'supp'));
      });

      // Cardio on Tuesdays and Saturdays
      if (dow === 2 || dow === 6) {
        const [activity, dist, mins] = pick(CARDIO);
        const v = { activity, duration: round(mins * between(0.85, 1.2), 1), avgHr: Math.round(between(120, 150)), calories: round(mins * between(9, 12), 10) };
        if (dist) v.distance = mi(util.round(dist * between(0.9, 1.15), 2));
        entries.push(entry('cardio', at(day, 17, 30), v, 'cardio'));
      }

      // Lifting Mon/Tue/Thu/Fri, rotating through the split; +5 lb every two weeks on compounds
      if ([1, 2, 4, 5].includes(dow)) {
        const plan = SPLIT[splitIdx++ % SPLIT.length];
        const start = at(day, 18, Math.floor(rnd() * 20));
        const bump = Math.floor((days - i) / 14);
        const exercises = plan.ex.map(([exerciseId, w0, reps, cat]) => {
          const w = w0 == null ? null : w0 + bump * (cat === 'c' ? 5 : 2.5);
          const set = (weight, r, setType = 'working', rpe = null) => ({
            id: util.uuid(), setType, weightKg: weight == null ? null : lb(weight), reps: r, rpe, rir: null, restSec: cat === 'c' ? 150 : 90, done: true, completedAt: null,
          });
          const sets = [];
          if (cat === 'c' && w) sets.push(set(round(w * 0.5, 5), 8, 'warmup'));
          for (let k = 0; k < 3; k++) sets.push(set(w, reps - (k === 2 && rnd() < 0.4 ? 1 : 0), 'working', k === 2 ? pick([8, 8.5, 9]) : null));
          if (cat === 'i' && w && rnd() < 0.25) sets.push(set(round(w * 0.7, 2.5), reps, 'drop'));
          return { exerciseId, notes: '', repMin: null, repMax: null, sets };
        });
        const mins = Math.round(between(50, 72));
        entries.push(entry('workout', start, {
          name: plan.name, templateId: null, startedAt: util.localISO(start),
          endedAt: util.localISO(new Date(start.getTime() + mins * 60000)), durationMin: mins, exercises,
        }, 'workout'));
      }
    }
    return { entries, checklistItems };
  }

  const isDemo = r => r?.source?.app === SOURCE;

  HL.demo = { generateDemo, isDemo };
})(globalThis.HL = globalThis.HL || {});
