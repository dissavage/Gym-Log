/* ════════════════════════════════════
   WORKOUT — start screen, active session, finish, templates
   The active session is a draft record saved on every change, so closing the app
   mid-workout loses nothing. Typing updates the draft without re-rendering.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo } = HL;
  const { esc } = util;

  const DRAFT_ID = 'workout';
  const SET_TYPES = { warmup: ['Warm-up', 'W'], working: ['Working', ''], drop: ['Drop', 'D'], failure: ['Failure', 'F'] };
  const TYPE_CYCLE = ['working', 'warmup', 'drop', 'failure'];
  const COLORS = ['orange', 'green', 'blue', 'purple', 'yellow'];
  const PR_LABEL = { weight: 'Weight PR', e1rm: 'Est. 1RM PR', reps: 'Rep PR', volume: 'Volume PR' };

  let draft = null;
  let indexCache = null;
  let viewEl = null;
  let elapsedTimer = null;
  let swipe = null;
  let suppressClickUntil = 0;

  /* ════════════════════════════════════
     DRAFT
     ════════════════════════════════════ */
  function loadDraft() {
    const d = repo.get('drafts', DRAFT_ID);
    draft = d && !d.deletedAt ? d : null;
  }

  function saveDraft() {
    if (draft) draft = repo.put('drafts', draft);
  }

  const newSet = (props = {}) => ({
    id: util.uuid(), setType: 'working', weightKg: null, reps: null, rpe: null, rir: null,
    restSec: null, done: false, completedAt: null, ...props,
  });

  const findEx = key => draft.exercises.find(e => e.key === key);

  function findSet(setId) {
    for (const ex of draft?.exercises || []) {
      const index = ex.sets.findIndex(s => s.id === setId);
      if (index >= 0) return { ex, set: ex.sets[index], index };
    }
    return null;
  }

  // Next unticked set after this one, wrapping to the first unticked set anywhere
  function nextUndone(afterId) {
    const all = draft.exercises.flatMap(ex => ex.sets);
    const i = all.findIndex(s => s.id === afterId);
    return (all.slice(i + 1).find(s => !s.done) || all.find(s => !s.done))?.id || null;
  }

  /* ════════════════════════════════════
     HISTORY & PRE-FILL
     ════════════════════════════════════ */
  repo.on('change', ({ store }) => { if (store === 'entries') indexCache = null; });

  function history(exerciseId) {
    indexCache = indexCache || domain.exerciseIndex(repo.entries({ type: 'workout' }));
    const list = indexCache.get(exerciseId) || [];
    return draft?.editingId ? list.filter(s => s.entryId !== draft.editingId) : list;
  }

  const lastSession = id => history(id).slice(-1)[0] || null;

  // Same structure and numbers as last time, nothing ticked. A template's set count wins.
  function prefillSets(exerciseId, count) {
    const last = lastSession(exerciseId);
    if (count) {
      const work = last ? last.sets.filter(s => s.setType === 'working' || s.setType === 'failure') : [];
      return Array.from({ length: count }, (_, i) => {
        const src = work[i] || work[work.length - 1];
        return newSet(src ? { weightKg: src.weightKg, reps: src.reps } : {});
      });
    }
    if (last) return last.sets.map(s => newSet({ setType: s.setType, weightKg: s.weightKg, reps: s.reps }));
    return [newSet()];
  }

  const exerciseSlot = (exerciseId, slot = {}) => ({
    key: util.uuid(), exerciseId, notes: '',
    repMin: slot.repMin ?? null, repMax: slot.repMax ?? null,
    sets: prefillSets(exerciseId, slot.sets),
  });

  /* ════════════════════════════════════
     STARTING
     ════════════════════════════════════ */
  function begin(props) {
    draft = repo.make('draft', { id: DRAFT_ID, name: 'Workout', templateId: null, editingId: null, startedAt: util.localISO(), exercises: [], active: null, rest: null, ...props });
    draft.active = draft.exercises.flatMap(e => e.sets).find(s => !s.done)?.id || null;
    saveDraft();
    render();
    viewEl.scrollTop = 0;
  }

  function startEmpty() {
    begin({ name: `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} workout` });
  }

  function startTemplate(t) {
    const exercises = t.exercises.filter(s => repo.get('exercises', s.exerciseId)).map(s => exerciseSlot(s.exerciseId, s));
    begin({ name: t.name, templateId: t.id, exercises });
  }

  function repeatLast() {
    const last = repo.lastEntry('workout');
    if (!last) return;
    const exercises = last.values.exercises.map(ex => ({
      key: util.uuid(), exerciseId: ex.exerciseId, notes: '', repMin: ex.repMin ?? null, repMax: ex.repMax ?? null,
      sets: ex.sets.map(s => newSet({ setType: s.setType, weightKg: s.weightKg, reps: s.reps })),
    }));
    begin({ name: last.values.name || 'Workout', templateId: last.values.templateId || null, exercises });
  }

  // Load a saved workout into the editor; saving writes back to the same entry
  function editEntry(entry) {
    if (draft && draft.editingId !== entry.id) {
      HL.toast('Finish or discard the workout in progress first', { kind: 'error' });
      HL.app.show('workout');
      return;
    }
    if (!draft) {
      draft = repo.make('draft', {
        id: DRAFT_ID, name: entry.values.name || 'Workout', templateId: entry.values.templateId || null,
        editingId: entry.id, startedAt: entry.values.startedAt || entry.timestamp, active: null, rest: null,
        exercises: structuredClone(entry.values.exercises || []).map(ex => ({ ...ex, key: util.uuid() })),
      });
      saveDraft();
    }
    HL.app.show('workout');
    render();
  }

  /* ════════════════════════════════════
     RENDER
     ════════════════════════════════════ */
  function render(el = viewEl) {
    viewEl = el;
    if (!el) return;
    loadDraft();
    clearInterval(elapsedTimer);
    if (!draft) { el.innerHTML = startHtml(); return; }
    el.innerHTML = activeHtml();
    tickElapsed();
    if (!draft.editingId) elapsedTimer = setInterval(tickElapsed, 1000);
  }

  function startHtml() {
    const last = repo.lastEntry('workout');
    const templates = repo.all('templates').sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const exName = id => repo.get('exercises', id)?.name;
    return `
      <header class="page-head"><div><h1 class="page-title">Workout</h1><p class="page-sub">Start a session</p></div></header>
      <button type="button" class="btn btn-primary btn-block" data-act="start-empty">Start empty workout</button>
      ${last ? `
        <button type="button" class="wo-repeat" data-act="repeat-last">
          <span class="wo-repeat-icon" aria-hidden="true">↻</span>
          <span class="grow"><span class="wo-repeat-title">Repeat last: ${esc(last.values.name || 'Workout')}</span>
          <span class="wo-repeat-sub">${esc(util.fmtDay(last.dayKey, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${last.values.exercises.length} exercise${last.values.exercises.length === 1 ? '' : 's'}</span></span>
        </button>` : ''}
      <section class="block-top" aria-labelledby="tpl-h">
        <div class="card-hdr">
          <h2 class="section-label" id="tpl-h">Templates</h2>
          <button type="button" class="link-btn" data-act="new-template">+ New template</button>
        </div>
        ${templates.length ? templates.map(t => `
          <div class="tpl-card c-${esc(t.color || 'orange')}">
            <button type="button" class="tpl-main" data-act="start-template" data-id="${t.id}" aria-label="Start ${esc(t.name)}">
              <span class="tpl-name">${esc(t.name)}</span>
              <span class="tpl-sub">${esc(t.exercises.map(s => exName(s.exerciseId)).filter(Boolean).join(' · ') || 'No exercises yet')}</span>
            </button>
            <button type="button" class="icon-btn" data-act="edit-template" data-id="${t.id}" aria-label="Edit ${esc(t.name)}">✎</button>
          </div>`).join('') : `
          <div class="empty-state compact"><strong>No templates yet</strong>Save your usual routines (Push, Pull, Legs…) to start them in one tap — or finish a workout and save it as a template.</div>`}
      </section>`;
  }

  function activeHtml() {
    const prefs = repo.getSettings().units;
    const all = draft.exercises.flatMap(e => e.sets);
    const editing = draft.editingId ? repo.get('entries', draft.editingId) : null;
    return `
      <header class="wo-top">
        <div class="grow">
          <button type="button" class="wo-name" data-act="rename">${esc(draft.name)} <span aria-hidden="true" class="muted">✎</span></button>
          <p class="page-sub">${editing ? `Editing · ${esc(util.fmtDay(editing.dayKey, { weekday: 'short', month: 'short', day: 'numeric' }))}` : '<span data-elapsed>0:00</span>'}
            · <span data-progress>${all.filter(s => s.done).length}/${all.length} sets</span></p>
        </div>
        <button type="button" class="btn btn-success btn-sm" data-act="finish">${editing ? 'Save' : 'Finish'}</button>
      </header>
      <div class="wo-list">${draft.exercises.map(ex => cardHtml(ex, prefs)).join('') || `
        <div class="empty-state"><strong>No exercises yet</strong>Add your first exercise — sets fill in from last time automatically.</div>`}</div>
      <button type="button" class="btn btn-dashed btn-block" data-act="add-exercise">+ Add exercise</button>
      <p class="wo-discard"><button type="button" class="link-btn" data-act="discard">${editing ? 'Cancel editing' : 'Discard workout'}</button></p>`;
  }

  function cardHtml(ex, prefs) {
    const exercise = repo.get('exercises', ex.exerciseId) || { name: 'Unknown exercise', primary: [] };
    const last = lastSession(ex.exerciseId);
    const repMin = ex.repMin ?? exercise.repMin;
    const repMax = ex.repMax ?? exercise.repMax;
    const target = repMin ? ` · Target ${repMin}${repMax && repMax !== repMin ? `–${repMax}` : ''} reps` : '';
    const ordinals = {};
    let working = 0;
    const rows = ex.sets.map(set => {
      const nth = ordinals[set.setType] = (ordinals[set.setType] ?? -1) + 1;
      if (set.setType === 'working') working++;
      const prev = domain.matchingSet(last?.sets, set.setType, nth);
      return setRowHtml(set, working, prev, prefs) + (draft.active === set.id ? panelHtml(set, prefs) : '');
    }).join('');
    return `
      <article class="wo-ex" data-ex="${ex.key}" aria-label="${esc(exercise.name)}">
        <header class="wo-ex-hdr">
          <span class="drag-handle" data-drag aria-hidden="true">⠿</span>
          <div class="grow">
            <h3 class="wo-ex-name">${esc(exercise.name)}</h3>
            <p class="wo-ex-sub">${esc(HL.exercises.muscleNames(exercise.primary))}${esc(target)}</p>
          </div>
          <button type="button" class="icon-btn" data-act="ex-menu" aria-label="Options for ${esc(exercise.name)}">⋯</button>
        </header>
        <p class="wo-last">${last
          ? `Last · ${esc(util.fmtDay(last.dayKey, { month: 'short', day: 'numeric' }))}: ${esc(last.sets.map(s => domain.formatSet(s, prefs)).join(', '))}`
          : 'First time — no history yet'}</p>
        ${ex.notes ? `<p class="wo-notes">📝 ${esc(ex.notes)}</p>` : ''}
        <ol class="set-list">${rows}</ol>
        <button type="button" class="btn btn-dashed btn-block btn-sm" data-act="add-set">+ Add set</button>
      </article>`;
  }

  const fmtWeight = (kg, prefs) => units.display('mass', kg, prefs).toLocaleString(undefined, { maximumFractionDigits: 2 });

  function setValHtml(set, prefs) {
    const w = set.weightKg != null ? `${fmtWeight(set.weightKg, prefs)}<small> ${units.label('mass', prefs)}</small>` : '—';
    const effort = set.rpe != null ? ` <small>@${set.rpe}</small>` : set.rir != null ? ` <small>${set.rir} RIR</small>` : '';
    return `${w} × ${set.reps ?? '—'}${effort}`;
  }

  function setRowHtml(set, workingNo, prev, prefs) {
    const [typeName, letter] = SET_TYPES[set.setType];
    const badge = letter || String(workingNo);
    const label = set.setType === 'working' ? `Set ${workingNo}` : `${typeName} set`;
    const active = draft.active === set.id;
    return `
      <li class="set-row t-${set.setType}${set.done ? ' done' : ''}${active ? ' active' : ''}" data-set="${set.id}">
        <div class="set-swipe">
          <button type="button" class="set-type" data-act="cycle-type" aria-label="${label}. Change set type">${badge}</button>
          <button type="button" class="set-main" data-act="activate" aria-expanded="${active}" aria-label="${label}: ${esc(domain.formatSet(set, prefs))}${prev ? `, last time ${esc(domain.formatSet(prev, prefs))}` : ''}. Edit">
            <span class="set-val">${setValHtml(set, prefs)}</span>
            ${prev ? `<span class="set-last">last ${esc(domain.formatSet(prev, prefs))}</span>` : ''}
          </button>
          <button type="button" class="set-check" data-act="toggle-done" aria-pressed="${set.done}" aria-label="${label} done">✓</button>
        </div>
        <span class="set-del" aria-hidden="true">Delete</span>
      </li>`;
  }

  function panelHtml(set, prefs) {
    const effort = repo.getSettings().effort;
    const opts = effort === 'rir' ? [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']] : [[6, '6'], [7, '7'], [8, '8'], [9, '9'], [10, '10']];
    const cur = effort === 'rir' ? set.rir : set.rpe;
    const w = set.weightKg != null ? units.display('mass', set.weightKg, prefs) : '';
    return `
      <li class="set-panel" data-panel="${set.id}">
        <div class="panel-row">
          <span class="panel-lbl" id="pw-${set.id}">Weight</span>
          <button type="button" class="stepper-btn" data-act="step" data-field="weight" data-dir="-1" aria-label="Less weight">−</button>
          <div class="stepper-wrap"><input class="stepper-input" data-field="weight" inputmode="decimal" autocomplete="off" value="${w}" placeholder="0" aria-labelledby="pw-${set.id}">
            <span class="stepper-unit">${units.label('mass', prefs)}</span></div>
          <button type="button" class="stepper-btn" data-act="step" data-field="weight" data-dir="1" aria-label="More weight">+</button>
        </div>
        <div class="panel-row">
          <span class="panel-lbl" id="pr-${set.id}">Reps</span>
          <button type="button" class="stepper-btn" data-act="step" data-field="reps" data-dir="-1" aria-label="One less rep">−</button>
          <div class="stepper-wrap"><input class="stepper-input" data-field="reps" inputmode="numeric" autocomplete="off" value="${set.reps ?? ''}" placeholder="0" aria-labelledby="pr-${set.id}">
            <span class="stepper-unit">reps</span></div>
          <button type="button" class="stepper-btn" data-act="step" data-field="reps" data-dir="1" aria-label="One more rep">+</button>
        </div>
        ${effort !== 'off' ? `
        <div class="panel-row" role="group" aria-label="${effort === 'rir' ? 'Reps in reserve' : 'RPE'}">
          <span class="panel-lbl">${effort === 'rir' ? 'RIR' : 'RPE'}</span>
          <div class="chip-row grow">${opts.map(([v, l]) => `<button type="button" class="chip" data-act="effort" data-value="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>
        </div>` : ''}
        <fieldset class="seg type-seg">
          <legend class="sr-only">Set type</legend>
          ${Object.entries(SET_TYPES).map(([k, [name]]) => `<label><input type="radio" name="stype-${set.id}" value="${k}" ${set.setType === k ? 'checked' : ''}><span>${name}</span></label>`).join('')}
        </fieldset>
        <div class="panel-actions">
          <button type="button" class="btn btn-danger btn-sm" data-act="delete-set">Delete</button>
          <button type="button" class="btn btn-success grow" data-act="toggle-done">${set.done ? 'Undo done' : '✓ Done'}</button>
        </div>
      </li>`;
  }

  // Re-render one exercise card, keeping focus on the same control
  function renderCard(key) {
    const old = viewEl?.querySelector(`[data-ex="${key}"]`);
    const ex = findEx(key);
    if (!old || !ex) { render(); return; }
    const a = document.activeElement;
    let focusSel = null;
    if (a && old.contains(a)) {
      const holder = a.closest('[data-set], [data-panel]');
      const id = holder?.dataset.set || holder?.dataset.panel;
      if (a.dataset.act) focusSel = `${id ? `[data-set="${id}"] ` : ''}[data-act="${a.dataset.act}"]`;
    }
    old.outerHTML = cardHtml(ex, repo.getSettings().units);
    updateProgress();
    if (focusSel) viewEl.querySelector(focusSel)?.focus({ preventScroll: true });
  }

  function updateProgress() {
    const el = viewEl?.querySelector('[data-progress]');
    if (!el) return;
    const all = draft.exercises.flatMap(e => e.sets);
    el.textContent = `${all.filter(s => s.done).length}/${all.length} sets`;
  }

  function tickElapsed() {
    const el = viewEl?.querySelector('[data-elapsed]');
    if (!el || !draft) { clearInterval(elapsedTimer); return; }
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(draft.startedAt)) / 1000));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
    el.textContent = `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`;
  }

  // Update one set's numbers in place (no re-render, so typing isn't interrupted)
  function refreshSet(set, skipInput) {
    const prefs = repo.getSettings().units;
    const row = viewEl.querySelector(`[data-set="${set.id}"]`);
    if (row) row.querySelector('.set-val').innerHTML = setValHtml(set, prefs);
    const panel = viewEl.querySelector(`[data-panel="${set.id}"]`);
    if (!panel) return;
    const wIn = panel.querySelector('input[data-field="weight"]');
    const rIn = panel.querySelector('input[data-field="reps"]');
    if (wIn !== skipInput) wIn.value = set.weightKg != null ? units.display('mass', set.weightKg, prefs) : '';
    if (rIn !== skipInput) rIn.value = set.reps ?? '';
  }

  /* ════════════════════════════════════
     SET ACTIONS
     ════════════════════════════════════ */
  function weightStep() {
    const fine = repo.getSettings().plateStep === 'fine';
    return units.unitFor('mass', repo.getSettings().units) === 'lb' ? (fine ? 2.5 : 5) : (fine ? 1.25 : 2.5);
  }

  function toggleDone(setId) {
    const found = findSet(setId);
    if (!found) return;
    const { ex, set, index } = found;
    if (set.done) {
      Object.assign(set, { done: false, completedAt: null });
      draft.active = setId;
      saveDraft();
      renderCard(ex.key);
      return;
    }
    if (!(set.reps > 0)) {
      draft.active = setId;
      saveDraft();
      renderCard(ex.key);
      viewEl.querySelector(`[data-panel="${setId}"] input[data-field="reps"]`)?.focus();
      HL.toast('Enter the reps for this set first', { kind: 'error' });
      return;
    }
    const exercise = repo.get('exercises', ex.exerciseId);
    const restSec = exercise?.restSec || repo.getSettings().restSec;
    let bests = domain.personalBests(history(ex.exerciseId));
    for (const s of ex.sets.slice(0, index)) bests = domain.addToBests(bests, s);

    Object.assign(set, { done: true, completedAt: util.localISO(), restSec });
    const prs = domain.setPRs(bests, set);
    const next = nextUndone(setId);
    draft.active = next;
    saveDraft();
    HL.rest.start(restSec);
    renderCard(ex.key);
    const nextEx = next && findSet(next).ex;
    if (nextEx && nextEx.key !== ex.key) renderCard(nextEx.key);
    if (prs.length) HL.toast(`🏆 ${prs.map(p => PR_LABEL[p]).join(' + ')} — ${exercise.name} ${domain.formatSet(set, repo.getSettings().units)}`, { duration: 4500 });
  }

  function activate(setId) {
    const found = findSet(setId);
    if (!found) return;
    const prev = draft.active && findSet(draft.active);
    draft.active = draft.active === setId ? null : setId;
    saveDraft();
    renderCard(found.ex.key);
    if (prev && prev.ex.key !== found.ex.key) renderCard(prev.ex.key);
  }

  function step(setId, field, dir) {
    const { set } = findSet(setId);
    const prefs = repo.getSettings().units;
    if (field === 'weight') {
      const unit = units.unitFor('mass', prefs);
      const cur = set.weightKg != null ? units.fromCanonical('mass', set.weightKg, unit) : 0;
      const next = Math.max(0, util.round(cur + dir * weightStep(), 2));
      set.weightKg = units.toCanonical('mass', next, unit);
    } else {
      set.reps = Math.max(0, (set.reps || 0) + dir);
    }
    saveDraft();
    refreshSet(set);
  }

  function addSet(key) {
    const ex = findEx(key);
    const prev = ex.sets[ex.sets.length - 1];
    const type = !prev || prev.setType === 'warmup' ? 'working' : prev.setType;
    const nth = ex.sets.filter(s => s.setType === type).length;
    const src = domain.matchingSet(lastSession(ex.exerciseId)?.sets, type, nth) || prev;
    const set = newSet({ setType: type, weightKg: src?.weightKg ?? null, reps: src?.reps ?? null });
    ex.sets.push(set);
    draft.active = set.id;
    saveDraft();
    renderCard(key);
  }

  function deleteSet(setId) {
    const found = findSet(setId);
    if (!found) return;
    const { ex, set, index } = found;
    ex.sets.splice(index, 1);
    if (draft.active === setId) draft.active = null;
    saveDraft();
    renderCard(ex.key);
    HL.undoToast('Set deleted', () => {
      const target = draft && findEx(ex.key);
      if (!target) return;
      target.sets.splice(index, 0, set);
      saveDraft();
      renderCard(ex.key);
    });
  }

  function cycleType(setId) {
    const { ex, set } = findSet(setId);
    set.setType = TYPE_CYCLE[(TYPE_CYCLE.indexOf(set.setType) + 1) % TYPE_CYCLE.length];
    saveDraft();
    renderCard(ex.key);
  }

  function setEffort(setId, value) {
    const { set } = findSet(setId);
    const field = repo.getSettings().effort === 'rir' ? 'rir' : 'rpe';
    set[field] = set[field] === value ? null : value;
    saveDraft();
    refreshSet(set);
    util.$$(`[data-panel="${setId}"] [data-act="effort"]`, viewEl).forEach(c => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === set[field])));
  }

  /* ════════════════════════════════════
     EXERCISE ACTIONS
     ════════════════════════════════════ */
  function addExercises() {
    HL.exercises.pick({
      onPick: exercise => {
        const slot = exerciseSlot(exercise.id);
        draft.exercises.push(slot);
        if (!draft.active) draft.active = slot.sets.find(s => !s.done)?.id || null;
        saveDraft();
        render();
        HL.toast(`${exercise.name} added`);
      },
    });
  }

  function moveExercise(key, dir) {
    const i = draft.exercises.findIndex(e => e.key === key);
    const j = i + dir;
    if (j < 0 || j >= draft.exercises.length) return;
    [draft.exercises[i], draft.exercises[j]] = [draft.exercises[j], draft.exercises[i]];
    saveDraft();
    render();
  }

  function removeExercise(key) {
    const i = draft.exercises.findIndex(e => e.key === key);
    const [removed] = draft.exercises.splice(i, 1);
    if (removed.sets.some(s => s.id === draft.active)) draft.active = null;
    saveDraft();
    render();
    const name = repo.get('exercises', removed.exerciseId)?.name || 'Exercise';
    HL.undoToast(`${name} removed`, () => {
      if (!draft) return;
      draft.exercises.splice(i, 0, removed);
      saveDraft();
      render();
    });
  }

  function openExerciseMenu(key) {
    const ex = findEx(key);
    const i = draft.exercises.indexOf(ex);
    const exercise = repo.get('exercises', ex.exerciseId);
    HL.sheet.open({
      title: exercise?.name || 'Exercise', icon: '🏋️',
      body: `
        <div class="menu-list">
          <button type="button" class="menu-item" data-m="up" ${i === 0 ? 'disabled' : ''}>↑ Move up</button>
          <button type="button" class="menu-item" data-m="down" ${i === draft.exercises.length - 1 ? 'disabled' : ''}>↓ Move down</button>
          <button type="button" class="menu-item" data-m="settings">⚙ Rest time, rep target &amp; muscles</button>
          <button type="button" class="menu-item danger" data-m="remove">✕ Remove from workout</button>
        </div>
        <div class="field block-top">
          <label class="field-label" for="ex-notes">Notes for this workout</label>
          <textarea class="input" id="ex-notes" name="notes" placeholder="Seat height 4, felt strong…">${esc(ex.notes || '')}</textarea>
        </div>`,
      footer: '<button type="submit" class="btn btn-primary">Save notes</button>',
      onMount: api => api.form.addEventListener('click', e => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        api.close();
        if (m === 'up') moveExercise(key, -1);
        if (m === 'down') moveExercise(key, 1);
        if (m === 'remove') removeExercise(key);
        if (m === 'settings' && exercise) HL.exercises.edit(exercise, { onSave: () => render() });
      }),
      onSubmit: (form, api) => {
        ex.notes = form.elements.notes.value.trim();
        saveDraft();
        api.close();
        renderCard(key);
      },
    });
  }

  // Drag by the handle: cards collapse to headers so even long workouts are easy to reorder
  function startDrag(e, handle) {
    const list = viewEl.querySelector('.wo-list');
    const card = handle.closest('.wo-ex');
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    list.classList.add('reordering');
    card.classList.add('dragging');
    const move = ev => {
      const others = util.$$('.wo-ex', list).filter(c => c !== card);
      const before = others.find(c => { const r = c.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (before) { if (card.nextElementSibling !== before) list.insertBefore(card, before); }
      else if (list.lastElementChild !== card) list.appendChild(card);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      const order = util.$$('.wo-ex', list).map(c => c.dataset.ex);
      draft.exercises.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      saveDraft();
      render();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end, { once: true });
    handle.addEventListener('pointercancel', end, { once: true });
  }

  /* ── Swipe a set row left to delete it ── */
  function onPointerDown(e) {
    const handle = e.target.closest('[data-drag]');
    if (handle && draft) { startDrag(e, handle); return; }
    const inner = e.target.closest('.set-swipe');
    if (!inner || e.button > 0) return;
    swipe = { inner, row: inner.closest('.set-row'), x0: e.clientX, y0: e.clientY, dx: 0, on: false, id: e.pointerId };
  }

  function onPointerMove(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    if (!swipe.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
      if (dx > -12 || Math.abs(dx) < Math.abs(dy)) return;
      swipe.on = true;
      swipe.row.classList.add('swiping');
    }
    swipe.dx = Math.max(-140, Math.min(0, dx));
    swipe.inner.style.transform = `translateX(${swipe.dx}px)`;
  }

  function onPointerUp() {
    if (!swipe) return;
    const { on, dx, inner, row } = swipe;
    swipe = null;
    if (!on) return;
    suppressClickUntil = Date.now() + 400;
    row.classList.remove('swiping');
    if (dx < -90) deleteSet(row.dataset.set);
    else inner.style.transform = '';
  }

  /* ════════════════════════════════════
     FINISH / DISCARD / RENAME
     ════════════════════════════════════ */
  function openFinish() {
    const prefs = repo.getSettings().units;
    const editing = !!draft.editingId;
    const unticked = draft.exercises.flatMap(e => e.sets).filter(s => !s.done && s.reps > 0);
    const sum = domain.workoutSummary(draft);
    const mins = Math.round((Date.now() - Date.parse(draft.startedAt)) / 60000);
    const prs = [];
    for (const ex of draft.exercises) {
      const name = repo.get('exercises', ex.exerciseId)?.name || 'Exercise';
      for (const p of domain.sessionPRs(history(ex.exerciseId), ex.sets.filter(s => s.done))) {
        const detail = p.type === 'volume' ? units.format('mass', p.value, prefs, 0)
          : p.type === 'e1rm' ? `${domain.formatSet(p.set, prefs)} (est. ${units.format('mass', domain.e1rm(p.set.weightKg, p.set.reps), prefs, 0)})`
          : domain.formatSet(p.set, prefs);
        prs.push(`<li>🏆 <b>${esc(name)}</b> — ${PR_LABEL[p.type]}: ${esc(detail)}</li>`);
      }
    }
    const body = `
      <div class="stat-grid">
        <div class="stat"><span class="stat-lbl">Duration</span><span class="stat-val">${editing ? '—' : esc(util.fmtDuration(Math.max(1, mins)))}</span></div>
        <div class="stat"><span class="stat-lbl">Exercises</span><span class="stat-val">${sum.exercises}</span></div>
        <div class="stat"><span class="stat-lbl">Working sets</span><span class="stat-val">${sum.workingSets}</span></div>
        <div class="stat"><span class="stat-lbl">Volume</span><span class="stat-val">${esc(units.format('mass', sum.volume, prefs, 0))}</span></div>
      </div>
      ${prs.length ? `<h3 class="section-label section-gap">Personal records</h3><ul class="pr-list">${prs.join('')}</ul>` : ''}
      ${unticked.length ? `
        <div class="notice" role="note">
          <p>⚠ ${unticked.length} set${unticked.length === 1 ? ' isn’t' : 's aren’t'} ticked off and won’t be saved.</p>
          <button type="button" class="btn btn-ghost btn-sm" data-act="tick-all">Tick ${unticked.length === 1 ? 'it' : 'them all'} done</button>
        </div>` : ''}
      <div class="field"><label class="field-label" for="wo-name">Name</label>
        <input class="input" id="wo-name" name="name" value="${esc(draft.name)}"></div>
      ${!draft.templateId && !editing ? '<label class="check-inline"><input type="checkbox" name="asTemplate"> Save as a template</label>' : ''}
      ${editing ? '<button type="button" class="btn btn-danger btn-block block-top" data-act="delete-entry">Delete this workout</button>' : ''}
      <p class="field-hint" id="fin-err" role="alert"></p>`;

    HL.sheet.open({
      title: editing ? 'Save changes?' : 'Finish workout?', icon: '🏁', body,
      footer: `<button type="button" class="btn btn-ghost" data-act="keep">${editing ? 'Back' : 'Keep going'}</button>
        <button type="submit" class="btn btn-success">${editing ? 'Save changes' : 'Save workout'}</button>`,
      onMount: api => api.form.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'keep') api.close();
        if (act === 'tick-all') {
          const now = util.localISO();
          for (const s of unticked) Object.assign(s, { done: true, completedAt: s.completedAt || now });
          saveDraft();
          api.close();
          render();
          openFinish();
        }
        if (act === 'delete-entry') {
          const id = draft.editingId;
          api.close();
          closeDraft();
          repo.softDelete('entries', id);
          HL.undoToast('Workout deleted', () => repo.restore('entries', id));
        }
      }),
      onSubmit: (form, api) => {
        if (!draft.exercises.some(ex => ex.sets.some(s => s.done))) {
          form.querySelector('#fin-err').textContent = 'Tick off at least one set to save this workout.';
          return;
        }
        draft.name = form.elements.name.value.trim() || draft.name;
        const asTemplate = form.elements.asTemplate?.checked;
        api.close();
        saveWorkout(asTemplate, prs.length);
      },
    });
  }

  function saveWorkout(asTemplate, prCount) {
    const exercises = draft.exercises
      .map(ex => ({
        exerciseId: ex.exerciseId, notes: ex.notes || '', repMin: ex.repMin ?? null, repMax: ex.repMax ?? null,
        sets: ex.sets.filter(s => s.done).map(s => ({ ...s })),
      }))
      .filter(ex => ex.sets.length);
    const existing = draft.editingId ? repo.get('entries', draft.editingId) : null;
    const endedAt = existing?.values.endedAt || util.localISO();
    const values = {
      name: draft.name, templateId: draft.templateId, startedAt: draft.startedAt, endedAt,
      durationMin: existing?.values.durationMin ?? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(draft.startedAt)) / 60000)),
      exercises,
    };
    if (existing) repo.put('entries', { ...existing, values });
    else repo.put('entries', repo.newEntry('workout', values, { when: draft.startedAt }));

    if (asTemplate) {
      repo.put('templates', repo.make('template', {
        name: draft.name, color: 'orange', order: repo.all('templates').length,
        exercises: exercises.map(ex => ({ exerciseId: ex.exerciseId, sets: ex.sets.filter(domain.isWorkingSet).length || ex.sets.length, repMin: ex.repMin, repMax: ex.repMax })),
      }));
    }
    closeDraft();
    HL.toast(existing ? 'Workout updated' : `Workout saved${prCount ? ` · ${prCount} PR${prCount === 1 ? '' : 's'} 🏆` : ''}`);
  }

  function closeDraft() {
    HL.rest.stop();
    repo.hardDelete('drafts', DRAFT_ID);
    draft = null;
    render();
  }

  function discard() {
    const saved = draft;
    const editing = !!draft.editingId;
    closeDraft();
    HL.undoToast(editing ? 'Edit cancelled' : 'Workout discarded', () => {
      repo.put('drafts', saved);
      render();
    });
  }

  function rename() {
    HL.sheet.open({
      title: 'Rename workout', icon: '✎',
      body: `<div class="field"><label class="field-label" for="rn">Name</label><input class="input" id="rn" name="name" value="${esc(draft.name)}" autofocus></div>`,
      footer: '<button type="submit" class="btn btn-primary">Save</button>',
      onSubmit: (form, api) => {
        draft.name = form.elements.name.value.trim() || draft.name;
        saveDraft();
        api.close();
        render();
      },
    });
  }

  /* ════════════════════════════════════
     TEMPLATES
     ════════════════════════════════════ */
  function openTemplateEditor(template) {
    const state = template ? structuredClone(template) : { name: '', color: 'orange', exercises: [] };
    const listHtml = () => state.exercises.length ? state.exercises.map((s, i) => `
      <li class="tpl-slot" data-i="${i}">
        <div class="tpl-slot-top">
          <span class="grow tpl-slot-name">${esc(repo.get('exercises', s.exerciseId)?.name || 'Unknown')}</span>
          <button type="button" class="icon-btn" data-t="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="icon-btn" data-t="down" ${i === state.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" class="icon-btn" data-t="remove" aria-label="Remove">✕</button>
        </div>
        <div class="tpl-slot-row">
          <span class="panel-lbl">Sets</span>
          <button type="button" class="stepper-btn sm" data-t="sets-" aria-label="Fewer sets">−</button>
          <span class="tpl-sets" aria-live="polite">${s.sets}</span>
          <button type="button" class="stepper-btn sm" data-t="sets+" aria-label="More sets">+</button>
          <label class="sr-only" for="rmin-${i}">Reps from</label>
          <input class="input tpl-rep" id="rmin-${i}" data-r="repMin" inputmode="numeric" placeholder="reps" value="${s.repMin ?? ''}">
          <span class="muted">–</span>
          <label class="sr-only" for="rmax-${i}">Reps to</label>
          <input class="input tpl-rep" id="rmax-${i}" data-r="repMax" inputmode="numeric" placeholder="reps" value="${s.repMax ?? ''}">
        </div>
      </li>`).join('') : '<li class="muted small">No exercises yet.</li>';

    const body = `
      <div class="field"><label class="field-label" for="tpl-name">Name</label>
        <input class="input" id="tpl-name" name="name" value="${esc(state.name)}" placeholder="e.g. Upper A"></div>
      <fieldset class="field"><legend class="field-label">Color</legend>
        <div class="seg color-seg">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${state.color === c ? 'checked' : ''}><span class="swatch c-${c}">${c[0].toUpperCase() + c.slice(1)}</span></label>`).join('')}</div>
      </fieldset>
      <h3 class="section-label section-gap">Exercises</h3>
      <ol class="tpl-slots" id="tpl-slots">${listHtml()}</ol>
      <button type="button" class="btn btn-dashed btn-block" data-t="add">+ Add exercises</button>
      ${template ? '<button type="button" class="btn btn-danger btn-block block-top" data-t="delete">Delete template</button>' : ''}
      <p class="field-hint" id="tpl-err" role="alert"></p>`;

    HL.sheet.open({
      title: template ? 'Edit template' : 'New template', icon: '📋', body,
      footer: '<button type="submit" class="btn btn-primary">Save template</button>',
      onMount: api => {
        const slots = api.form.querySelector('#tpl-slots');
        const refresh = () => { slots.innerHTML = listHtml(); };
        api.form.addEventListener('input', e => {
          const r = e.target.dataset.r;
          if (r) state.exercises[Number(e.target.closest('[data-i]').dataset.i)][r] = util.parseNum(e.target.value);
        });
        api.form.addEventListener('click', e => {
          const t = e.target.closest('[data-t]')?.dataset.t;
          if (!t) return;
          const i = Number(e.target.closest('[data-i]')?.dataset.i);
          const s = state.exercises[i];
          if (t === 'add') {
            HL.exercises.pick({
              title: 'Add to template',
              onPick: ex => { state.exercises.push({ exerciseId: ex.id, sets: 3, repMin: ex.repMin, repMax: ex.repMax }); refresh(); },
            });
          }
          if (t === 'sets-') { s.sets = Math.max(1, s.sets - 1); refresh(); }
          if (t === 'sets+') { s.sets = Math.min(20, s.sets + 1); refresh(); }
          if (t === 'remove') { state.exercises.splice(i, 1); refresh(); }
          if (t === 'up' || t === 'down') {
            const j = i + (t === 'up' ? -1 : 1);
            [state.exercises[i], state.exercises[j]] = [state.exercises[j], state.exercises[i]];
            refresh();
          }
          if (t === 'delete') {
            api.close();
            repo.softDelete('templates', template.id);
            HL.undoToast(`${template.name} deleted`, () => repo.restore('templates', template.id));
          }
        });
      },
      onSubmit: (form, api) => {
        const name = form.elements.name.value.trim();
        if (!name) { form.querySelector('#tpl-err').textContent = 'Give the template a name.'; return; }
        const props = { name, color: form.elements.color.value, exercises: state.exercises };
        repo.put('templates', template ? { ...template, ...props } : repo.make('template', { ...props, order: repo.all('templates').length }));
        api.close();
        HL.toast(`${name} saved`);
      },
    });
  }

  /* ════════════════════════════════════
     EVENTS
     ════════════════════════════════════ */
  function onClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const key = el.closest('[data-ex]')?.dataset.ex;
    const holder = el.closest('[data-set], [data-panel]');
    const setId = holder?.dataset.set || holder?.dataset.panel;
    const template = el.dataset.id && repo.get('templates', el.dataset.id);
    switch (act) {
      case 'start-empty':     startEmpty(); break;
      case 'repeat-last':     repeatLast(); break;
      case 'start-template':  startTemplate(template); break;
      case 'edit-template':   openTemplateEditor(template); break;
      case 'new-template':    openTemplateEditor(null); break;
      case 'rename':          rename(); break;
      case 'finish':          openFinish(); break;
      case 'discard':         discard(); break;
      case 'add-exercise':    addExercises(); break;
      case 'ex-menu':         openExerciseMenu(key); break;
      case 'add-set':         addSet(key); break;
      case 'activate':        activate(setId); break;
      case 'toggle-done':     HL.rest.unlockAudio(); toggleDone(setId); break;
      case 'cycle-type':      cycleType(setId); break;
      case 'delete-set':      deleteSet(setId); break;
      case 'step':            step(setId, el.dataset.field, Number(el.dataset.dir)); break;
      case 'effort':          setEffort(setId, Number(el.dataset.value)); break;
    }
  }

  function onInput(e) {
    const field = e.target.dataset.field;
    const panel = e.target.closest('[data-panel]');
    if (!field || !panel) return;
    const { set } = findSet(panel.dataset.panel);
    const n = util.parseNum(e.target.value);
    if (field === 'weight') set.weightKg = n == null ? null : units.toCanonical('mass', Math.max(0, n), units.unitFor('mass', repo.getSettings().units));
    else set.reps = n == null ? null : Math.max(0, Math.round(n));
    saveDraft();
    refreshSet(set, e.target);
  }

  function onChange(e) {
    if (!e.target.name?.startsWith('stype-')) return;
    const { ex, set } = findSet(e.target.name.slice(6));
    set.setType = e.target.value;
    saveDraft();
    renderCard(ex.key);
  }

  function init() {
    loadDraft();
    HL.rest.bind(() => draft?.rest || null, rest => {
      if (!draft) return;
      draft.rest = rest;
      saveDraft();
    });
    const el = document.getElementById('view-workout');
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  }

  HL.views = HL.views || {};
  HL.views.workout = { stores: ['exercises', 'templates', 'entries'], render, onClick, onInput, onChange, init };
  HL.workout = {
    editEntry,
    current: () => { loadDraft(); return draft; },
  };
})(globalThis.HL = globalThis.HL || {});
