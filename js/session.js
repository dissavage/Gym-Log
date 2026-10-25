/* ════════════════════════════════════
   SESSION — pure rules for building and saving a workout session
   Kept out of the workout screen so tests.html can check them.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util } = HL;

  const newSet = (props = {}) => ({
    id: util.uuid(), setType: 'working', weightKg: null, reps: null, rpe: null, rir: null,
    restSec: null, done: false, completedAt: null, ...props,
  });

  // An exercise joins a session with one working set, numbered like the first working set last time
  // (warm-ups skipped). No history: weight stays empty and reps come from the template's target, if any.
  function firstSet(lastSets, slot = {}) {
    const sets = lastSets || [];
    const src = sets.find(s => s.setType === 'working') || sets.find(s => s.setType !== 'warmup');
    return newSet(src ? { weightKg: src.weightKg, reps: src.reps } : { reps: slot.repMin ?? null });
  }

  // A template slot lends its rep target; the `sets` count older templates store is ignored
  const exerciseSlot = (exerciseId, lastSets, slot = {}) => ({
    key: util.uuid(), exerciseId, notes: '',
    repMin: slot.repMin ?? null, repMax: slot.repMax ?? null,
    sets: [firstSet(lastSets, slot)],
  });

  // Every exercise in the template, in its order, one set each
  function fromTemplate(template, lastSetsOf, exists = () => true) {
    return (template.exercises || []).filter(s => exists(s.exerciseId))
      .map(s => exerciseSlot(s.exerciseId, lastSetsOf(s.exerciseId), s));
  }

  const isDoneEx = ex => ex.sets.length > 0 && ex.sets.every(s => s.done);

  /**
   * The one expanded exercise. `pick` is the exercise expanded by hand ({ key }, or { key: null } for
   * all collapsed); it holds while the active set is in it. Otherwise: the exercise holding the active
   * set, else the first unfinished one, else the last.
   */
  function focused(exercises, activeId, pick = null) {
    const holding = activeId ? exercises.find(ex => ex.sets.some(s => s.id === activeId)) : null;
    if (pick) {
      if (!pick.key) return null;
      const ex = exercises.find(e => e.key === pick.key);
      if (ex && (!holding || holding === ex)) return ex;
    }
    return holding || exercises.find(ex => !isDoneEx(ex)) || exercises[exercises.length - 1] || null;
  }

  // Exercises with nothing ticked: left out when the session is saved
  const skipped = exercises => exercises.filter(ex => !ex.sets.some(s => s.done));

  // What a finished session saves: ticked sets only, skipped exercises dropped
  function toSave(exercises) {
    return exercises
      .map(ex => ({
        exerciseId: ex.exerciseId, notes: ex.notes || '', repMin: ex.repMin ?? null, repMax: ex.repMax ?? null,
        sets: ex.sets.filter(s => s.done).map(s => ({ ...s })),
      }))
      .filter(ex => ex.sets.length);
  }

  HL.session = { newSet, firstSet, exerciseSlot, fromTemplate, isDoneEx, focused, skipped, toSave };
})(globalThis.HL = globalThis.HL || {});
