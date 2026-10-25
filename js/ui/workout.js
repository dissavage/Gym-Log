/* ════════════════════════════════════
   WORKOUT — start screen, active session, finish, templates
   The active session is a draft record saved on every change, so closing the app
   mid-workout loses nothing. Typing updates the draft without re-rendering.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo, session } = HL;
  const { esc } = util;

  const DRAFT_ID = 'workout';
  const SET_TYPES = { warmup: ['Warm-up', 'W'], working: ['Working', ''], drop: ['Drop', 'D'], failure: ['Failure', 'F'] };
  const TYPE_CYCLE = ['working', 'warmup', 'drop', 'failure'];
  const COLORS = ['orange', 'green', 'blue', 'purple', 'yellow'];
  const COLOR_NAME = { orange: 'Lime', green: 'Green', blue: 'Blue', purple: 'Purple', yellow: 'Yellow' };  // 'orange' is the stored id of the accent colour
  const PR_LABEL = { weight: 'Weight PR', e1rm: 'Est. 1RM PR', reps: 'Rep PR', volume: 'Volume PR' };

  let draft = null;
  let indexCache = null;
  let viewEl = null;
  let elapsedTimer = null;
  let swipe = null;
  let panelOpen = false;       // detail panel under the active set (UI only, not saved)
  let expandPick = null;       // UI only: { key } expanded by hand ({ key: null } = all collapsed); null = default rule
  let suppressClickUntil = 0;
  let typing = null;           // weight/reps input cleared on focus: { el, setId, key, value }
  let naming = null;           // UI only: while the header's name input is open, the name to fall back to

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

  const { newSet } = session;

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

  // One set, prefilled from the first working set last time (rules in session.js)
  const exerciseSlot = (exerciseId, slot) => session.exerciseSlot(exerciseId, lastSession(exerciseId)?.sets, slot);

  const liveTemplate = id => { const t = id && repo.get('templates', id); return t && !t.deletedAt ? t : null; };

  /* ════════════════════════════════════
     STARTING
     ════════════════════════════════════ */
  function begin(props, { rename = false } = {}) {
    draft = repo.make('draft', { id: DRAFT_ID, name: 'Workout', templateId: null, editingId: null, startedAt: util.localISO(), exercises: [], active: null, rest: null, ...props });
    draft.active = draft.exercises.flatMap(e => e.sets).find(s => !s.done)?.id || null;
    panelOpen = false;
    expandPick = null;
    naming = rename ? draft.name : null;
    saveDraft();
    render();
    if (viewEl) viewEl.scrollTop = 0;
  }

  // Opens with the name ready to type over; the caller focuses it (focusName) inside the same tap
  function startEmpty() {
    begin({ name: `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} workout` }, { rename: true });
  }

  // The template's exercises in order, one set each; the first one opens expanded
  function startTemplate(t) {
    const exercises = session.fromTemplate(t, id => lastSession(id)?.sets, id => !!repo.get('exercises', id));
    begin({ name: t.name, templateId: t.id, exercises });
  }

  // Not reachable from the UI any more (kept for now)
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
    typing = null;
    if (!draft) { naming = null; el.innerHTML = startHtml(); return; }
    el.innerHTML = activeHtml();
    updateProgress();
    HL.rest.sync();
    tickElapsed();
    if (!draft.editingId) elapsedTimer = setInterval(tickElapsed, 1000);
  }

  const sortedTemplates = () => repo.all('templates').sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  // The template after the one used last time, wrapping around (also shown on Today)
  function nextTemplate(templates = sortedTemplates(), last = repo.lastEntry('workout')) {
    if (!templates.length) return null;
    const i = last ? templates.findIndex(t => t.id === last.values.templateId) : -1;
    return templates[(i + 1) % templates.length];
  }

  function startHtml() {
    const last = repo.lastEntry('workout');
    const templates = sortedTemplates();
    const next = nextTemplate(templates, last);
    const exName = id => repo.get('exercises', id)?.name;
    return `
      <header class="page-head"><div><p class="page-kicker">Start a session</p><h1 class="page-title">Workout</h1></div></header>
      <button type="button" class="btn btn-primary btn-block" data-act="start-empty">${util.icon('plus', 20)} Start empty workout</button>
      <section class="block-top" aria-labelledby="tpl-h">
        <div class="card-hdr">
          <h2 class="section-label" id="tpl-h">Templates</h2>
          <button type="button" class="link-btn" data-act="new-template">+ New template</button>
        </div>
        ${templates.length ? templates.map(t => `
          <div class="tpl-card c-${esc(t.color || 'orange')}${t === next ? ' is-next' : ''}">
            <button type="button" class="tpl-main" data-act="start-template" data-id="${t.id}" aria-label="Start ${esc(t.name)}${t === next ? ' (up next)' : ''}">
              <span class="tpl-top"><span class="tpl-dot" aria-hidden="true"></span><span class="tpl-name">${esc(t.name)}</span>${t === next ? '<span class="tpl-pill" aria-hidden="true">Up next</span>' : ''}</span>
              <span class="tpl-sub">${esc(t.exercises.map(s => exName(s.exerciseId)).filter(Boolean).join(' · ') || 'No exercises yet')}</span>
            </button>
            <button type="button" class="icon-btn" data-act="edit-template" data-id="${t.id}" aria-label="Edit ${esc(t.name)}">${util.icon('pencil', 18)}</button>
          </div>`).join('') : `
          <div class="empty-state compact"><strong>No templates yet</strong>Save your usual routines (Push, Pull, Legs…) to start them in one tap — or finish a workout and save it as a template.</div>`}
      </section>`;
  }

  /* ── The one expanded exercise; every other one is a collapsed row ── */
  const { isDoneEx } = session;
  const focusedEx = () => session.focused(draft.exercises, draft.active, expandPick);

  const restLabel = util.formatDuration;

  // Name + timer. While renaming, the name is an input in the same spot (sticky, so above the keyboard).
  function titleHtml() {
    const editing = draft.editingId ? repo.get('entries', draft.editingId) : null;
    const sub = editing
      ? `<span class="wo-sub">Editing · ${esc(util.fmtDay(editing.dayKey, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>`
      : '<span class="wo-timer" data-elapsed>0:00</span>';
    if (naming != null) {
      return `<div class="wo-title">
          <input class="wo-name-in" data-rename-input value="${esc(draft.name)}" maxlength="60" enterkeyhint="done" autocomplete="off" autocapitalize="words" aria-label="Workout name">
          ${sub}</div>`;
    }
    return `<button type="button" class="wo-title" data-act="rename" aria-label="Rename workout: ${esc(draft.name)}">
        <span class="wo-name"><span>${esc(draft.name)}</span>${util.icon('pencil', 14)}</span>
        ${sub}</button>`;
  }

  function activeHtml() {
    const editing = !!draft.editingId;
    return `
      <header class="wo-head">
        <button type="button" class="icon-btn" data-act="back" aria-label="Back to Today">${util.icon('chev-down', 22)}</button>
        ${titleHtml()}
        <button type="button" class="btn btn-primary wo-finish" data-act="finish">${editing ? 'Save' : 'Finish'}</button>
      </header>
      <div class="wo-progress">
        <div class="wo-progress-txt"><span data-progress></span><span data-progress-pct></span></div>
        <div class="wo-pbar" aria-hidden="true"><span data-progress-fill></span></div>
      </div>
      <div class="rest-card" data-rest-card hidden></div>
      <div class="wo-list">${bodyHtml()}</div>
      <button type="button" class="btn btn-dashed btn-block wo-add-ex" data-act="add-exercise">${util.icon('plus', 18)} Add exercise</button>
      <p class="wo-discard"><button type="button" class="link-btn" data-act="discard">${editing ? 'Cancel editing' : 'Discard workout'}</button></p>`;
  }

  function bodyHtml() {
    if (!draft.exercises.length) {
      return '<div class="empty-state"><strong>No exercises yet</strong>Add your first exercise — it fills in from last time automatically.</div>';
    }
    const prefs = repo.getSettings().units;
    const focus = focusedEx();
    const done = draft.exercises.filter(ex => ex !== focus && isDoneEx(ex));
    const next = draft.exercises.filter(ex => ex !== focus && !isDoneEx(ex));
    return `
      ${done.length ? `<h2 class="section-label wo-group-lbl">Done</h2>${done.map(ex => doneRowHtml(ex, prefs)).join('')}` : ''}
      ${focus ? focusedHtml(focus, prefs) : ''}
      ${next.length ? `<h2 class="section-label wo-group-lbl">Up next</h2>${next.map(ex => nextRowHtml(ex, prefs)).join('')}` : ''}`;
  }

  const exerciseOf = ex => repo.get('exercises', ex.exerciseId) || { name: 'Unknown exercise', primary: [] };

  function doneRowHtml(ex, prefs) {
    const exercise = exerciseOf(ex);
    const counted = ex.sets.filter(domain.countsForPR);
    const best = counted.reduce((b, s) => ((domain.e1rm(s.weightKg || 0, s.reps) || s.reps / 100) > (domain.e1rm(b.weightKg || 0, b.reps) || b.reps / 100) ? s : b), counted[0]);
    const pr = domain.sessionPRs(history(ex.exerciseId), ex.sets.filter(s => s.done)).length > 0;
    const sub = `${ex.sets.length} set${ex.sets.length === 1 ? '' : 's'}${best ? ` · best ${setText(best, prefs)}` : ''}`;
    return `
      <article class="wo-ex wo-row" data-ex="${ex.key}">
        <button type="button" class="wo-row-btn" data-act="focus-ex" aria-expanded="false" aria-label="${esc(`${exercise.name}, done: ${sub}${pr ? ', personal record' : ''}. Show sets`)}">
          <span class="wo-row-check" aria-hidden="true">${util.icon('check', 14)}</span>
          <span class="grow"><span class="wo-row-name">${esc(exercise.name)}</span><span class="wo-row-sub">${esc(sub)}</span></span>
          ${pr ? '<span class="pr-pill" aria-hidden="true">PR</span>' : ''}
          <span class="muted" aria-hidden="true">${util.icon('chev-down', 20)}</span>
        </button>
      </article>`;
  }

  function nextRowHtml(ex, prefs) {
    const exercise = exerciseOf(ex);
    const left = ex.sets.filter(s => !s.done);
    const first = left.find(s => s.setType === 'working') || left[0];
    const w = first?.weightKg ? ` · ${fmtWeight(first.weightKg, prefs)} ${units.label('mass', prefs)}` : '';
    const sub = first ? `${left.length} × ${first.reps ?? '—'}${w}` : 'No sets yet';
    return `
      <article class="wo-ex wo-row" data-ex="${ex.key}">
        <button type="button" class="wo-row-btn" data-act="focus-ex" aria-expanded="false" aria-label="${esc(`${exercise.name}: ${sub}. Start this exercise`)}">
          <span class="grow"><span class="wo-row-name">${esc(exercise.name)}</span><span class="wo-row-sub">${esc(sub)}</span></span>
          <span class="muted" aria-hidden="true">${util.icon('chev-right', 20)}</span>
        </button>
      </article>`;
  }

  function focusedHtml(ex, prefs) {
    const exercise = exerciseOf(ex);
    const last = lastSession(ex.exerciseId);
    const repMin = ex.repMin ?? exercise.repMin;
    const repMax = ex.repMax ?? exercise.repMax;
    const rest = exercise.restSec || repo.getSettings().restSec;
    const sub = [HL.exercises.muscleNames(exercise.primary),
      repMin ? `Target ${repMin}${repMax && repMax !== repMin ? `–${repMax}` : ''} reps` : '',
      `Rest ${restLabel(rest)}`].filter(Boolean).join(' · ');
    const ordinals = {};
    let working = 0;
    const rows = ex.sets.map(set => {
      const nth = ordinals[set.setType] = (ordinals[set.setType] ?? -1) + 1;
      if (set.setType === 'working') working++;
      const prev = domain.matchingSet(last?.sets, set.setType, nth);
      const active = draft.active === set.id;
      return setRowHtml(set, working, prev, prefs) + (active && panelOpen ? panelHtml(set, prefs) : '');
    }).join('');
    return `
      <article class="wo-ex wo-focus" data-ex="${ex.key}" aria-label="${esc(exercise.name)}">
        <header class="wo-ex-hdr">
          <span class="drag-handle" data-drag aria-hidden="true">${util.icon('grip', 20)}</span>
          <div class="grow">
            <h2 class="wo-ex-name">${esc(exercise.name)}</h2>
            <p class="wo-ex-sub">${esc(sub)}</p>
          </div>
          <button type="button" class="icon-btn" data-act="ex-menu" aria-label="Options for ${esc(exercise.name)}">${util.icon('dots', 22)}</button>
        </header>
        <p class="wo-last">${last
          ? `Last · ${esc(util.fmtDay(last.dayKey, { month: 'short', day: 'numeric' }))}: ${esc(last.sets.map(s => domain.formatSet(s, prefs)).join(', '))}`
          : 'First time — no history yet'}</p>
        ${ex.notes ? `<p class="wo-notes">📝 ${esc(ex.notes)}</p>` : ''}
        <div class="set-head" aria-hidden="true"><span>Set</span><span>Previous</span><span>${esc(units.label('mass', prefs))}</span><span>Reps</span><span></span></div>
        <ol class="set-list">${rows}</ol>
        <button type="button" class="btn btn-dashed btn-block wo-add-set" data-act="add-set">${util.icon('plus', 16)} Add set</button>
      </article>`;
  }

  const fmtWeight = (kg, prefs) => units.display('mass', kg, prefs).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const setText = (s, prefs) => `${s.weightKg ? fmtWeight(s.weightKg, prefs) : 'BW'} × ${s.reps ?? '—'}`;

  function setRowHtml(set, workingNo, prev, prefs) {
    const [typeName, letter] = SET_TYPES[set.setType];
    const label = set.setType === 'working' ? `Set ${workingNo}` : `${typeName} set`;
    const active = draft.active === set.id;
    const unit = units.label('mass', prefs);
    const w = set.weightKg != null ? fmtWeight(set.weightKg, prefs) : '';
    const raw = set.weightKg != null ? units.display('mass', set.weightKg, prefs) : ''; // inputs get a plain number, no thousands separator
    const prevText = prev ? setText(prev, prefs) : '—';
    const values = active ? `
      <input class="set-in" data-field="weight" inputmode="decimal" autocomplete="off" value="${raw}" placeholder="—" aria-label="${esc(`${label} weight (${unit})`)}">
      <input class="set-in" data-field="reps" inputmode="numeric" autocomplete="off" value="${set.reps ?? ''}" placeholder="—" aria-label="${esc(`${label} reps`)}">` : `
      <span class="set-cell" data-act="activate" data-cell="weight" aria-hidden="true">${w || '—'}</span>
      <span class="set-cell" data-act="activate" data-cell="reps" aria-hidden="true">${set.reps ?? '—'}</span>`;
    return `
      <li class="set-row t-${set.setType}${set.done ? ' done' : ''}${active ? ' active' : ''}" data-set="${set.id}">
        <div class="set-swipe">
          <button type="button" class="set-type" data-act="cycle-type" aria-label="${label}. Change set type">${letter || workingNo}</button>
          <button type="button" class="set-prev" data-act="activate"${active ? ` aria-expanded="${panelOpen}"` : ''}
            aria-label="${esc(active ? `${label} details, previous ${prevText}` : `Edit ${label}: ${w || '—'} ${unit} × ${set.reps ?? '—'}, previous ${prevText}`)}">${esc(prevText)}</button>
          ${values}
          <button type="button" class="set-check" data-act="toggle-done" aria-pressed="${set.done}" aria-label="${label} done">${util.icon('check', 18)}</button>
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
          <div class="stepper-wrap"><input class="stepper-input" data-field="weight" inputmode="decimal" autocomplete="off" value="${w}" placeholder="—" aria-labelledby="pw-${set.id}">
            <span class="stepper-unit">${units.label('mass', prefs)}</span></div>
          <button type="button" class="stepper-btn" data-act="step" data-field="weight" data-dir="1" aria-label="More weight">+</button>
        </div>
        <div class="panel-row">
          <span class="panel-lbl" id="pr-${set.id}">Reps</span>
          <button type="button" class="stepper-btn" data-act="step" data-field="reps" data-dir="-1" aria-label="One less rep">−</button>
          <div class="stepper-wrap"><input class="stepper-input" data-field="reps" inputmode="numeric" autocomplete="off" value="${set.reps ?? ''}" placeholder="—" aria-labelledby="pr-${set.id}">
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
          ${Object.entries(SET_TYPES).map(([k, [name]]) => `<label class="t-${k}"><input type="radio" name="stype-${set.id}" value="${k}" ${set.setType === k ? 'checked' : ''}><span>${name}</span></label>`).join('')}
        </fieldset>
        <div class="panel-actions">
          <button type="button" class="btn btn-danger" data-act="delete-set">Delete</button>
          <button type="button" class="btn btn-success grow" data-act="toggle-done">${set.done ? 'Undo done' : '✓ Done · Start rest'}</button>
        </div>
      </li>`;
  }

  // Re-render the exercise list, keeping focus on the same control (or the next set's ✓)
  function renderBody() {
    const list = viewEl?.querySelector('.wo-list');
    if (!list) { render(); return; }
    const a = document.activeElement;
    let focusSel = null;
    if (a && list.contains(a)) {
      const holder = a.closest('[data-set], [data-panel], [data-ex]');
      const id = holder?.dataset.set || holder?.dataset.panel;
      if (a.dataset.act || a.dataset.field) {
        focusSel = `${id ? `[data-set="${id}"] ` : holder?.dataset.ex ? `[data-ex="${holder.dataset.ex}"] ` : ''}${a.dataset.act ? `[data-act="${a.dataset.act}"]` : `[data-field="${a.dataset.field}"]`}`;
      }
    }
    typing = null;   // the cleared input is about to be replaced (re-focusing it below clears it again)
    list.innerHTML = bodyHtml();
    updateProgress();
    if (!focusSel) return;
    const target = list.querySelector(focusSel) || (draft.active && list.querySelector(`[data-set="${draft.active}"] [data-act="toggle-done"]`));
    target?.focus({ preventScroll: true });
  }

  function updateProgress() {
    const el = viewEl?.querySelector('[data-progress]');
    if (!el) return;
    const all = draft.exercises.flatMap(e => e.sets);
    const doneN = all.filter(s => s.done).length;
    const focus = focusedEx();
    const pct = all.length ? Math.round((doneN / all.length) * 100) : 0;
    // Counts the sets actually in the session (one per exercise to start, more as sets are added)
    const n = draft.exercises.length;
    el.textContent = !n ? 'No exercises yet'
      : `${focus ? `Exercise ${draft.exercises.indexOf(focus) + 1} of ${n}` : `${n} exercise${n === 1 ? '' : 's'}`} · ${doneN} of ${all.length} set${all.length === 1 ? '' : 's'}`;
    viewEl.querySelector('[data-progress-pct]').textContent = `${pct}%`;
    viewEl.querySelector('[data-progress-fill]').style.width = `${pct}%`;
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
    const w = set.weightKg != null ? fmtWeight(set.weightKg, prefs) : '';
    const raw = set.weightKg != null ? units.display('mass', set.weightKg, prefs) : '';
    for (const el of util.$$(`[data-set="${set.id}"] [data-field], [data-panel="${set.id}"] [data-field]`, viewEl)) {
      if (el !== skipInput) el.value = el.dataset.field === 'weight' ? raw : (set.reps ?? '');
    }
    for (const el of util.$$(`[data-set="${set.id}"] [data-cell]`, viewEl)) el.textContent = (el.dataset.cell === 'weight' ? w : set.reps) || '—';
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
      renderBody();
      return;
    }
    if (!(set.reps > 0)) {
      draft.active = setId;
      saveDraft();
      renderBody();
      viewEl.querySelector(`[data-set="${setId}"] input[data-field="reps"]`)?.focus();
      HL.toast('Enter the reps for this set first', { kind: 'error' });
      return;
    }
    const focusBefore = focusedEx();
    const exercise = repo.get('exercises', ex.exerciseId);
    const restSec = exercise?.restSec || repo.getSettings().restSec;
    let bests = domain.personalBests(history(ex.exerciseId));
    for (const s of ex.sets.slice(0, index)) bests = domain.addToBests(bests, s);

    Object.assign(set, { done: true, completedAt: util.localISO(), restSec });
    const prs = domain.setPRs(bests, set);
    draft.active = nextUndone(setId);
    panelOpen = false;
    saveDraft();
    HL.rest.start(restSec);
    renderBody();
    // Finished this exercise: it collapses and the next one opens, scrolled into view
    if (focusedEx() !== focusBefore) scrollToView(viewEl.querySelector('.wo-focus'), 'start');
    if (prs.length) HL.toast(`🏆 ${prs.map(p => PR_LABEL[p]).join(' + ')} — ${exercise.name} ${domain.formatSet(set, repo.getSettings().units)}`, { duration: 4500 });
  }

  // First tap makes a set active (editable inline); tapping its PREVIOUS cell again opens the detail panel
  function activate(setId) {
    if (!findSet(setId)) return;
    if (draft.active === setId) {
      panelOpen = !panelOpen;
    } else {
      draft.active = setId;
      panelOpen = false;
      saveDraft();
    }
    expandPick = null;
    renderBody();
  }

  const scrollToView = (el, block) => el?.scrollIntoView({ block, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  // The one expand/collapse path: expands `key` (collapsing the others) with its first unticked set
  // active, or collapses everything when `key` is null. Collapsed rows call it; so can an exercise name.
  function setExpanded(key) {
    const ex = key && findEx(key);
    expandPick = { key: ex ? key : null };
    if (ex) draft.active = (ex.sets.find(s => !s.done) || ex.sets[0])?.id || null;
    panelOpen = false;
    saveDraft();
    renderBody();
    if (!ex) return;
    viewEl.querySelector('.wo-focus [data-act="toggle-done"]')?.focus({ preventScroll: true });
    viewEl.querySelector('.wo-focus')?.scrollIntoView({ block: 'nearest' });
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
    // Stepping while this field is cleared for typing: the stepped number becomes the one to fall back to.
    // A different cleared field of the same set stays empty.
    const key = field === 'weight' ? 'weightKg' : 'reps';
    const cleared = typing?.setId === setId ? typing : null;
    if (cleared?.key === key) cleared.value = set[key];
    saveDraft();
    refreshSet(set, cleared && cleared.key !== key ? cleared.el : null);
    if (cleared?.key === key) cleared.el.dataset.prev = cleared.el.value;
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
    renderBody();
  }

  function deleteSet(setId) {
    const found = findSet(setId);
    if (!found) return;
    const { ex, set, index } = found;
    ex.sets.splice(index, 1);
    if (draft.active === setId) draft.active = null;
    saveDraft();
    renderBody();
    HL.undoToast('Set deleted', () => {
      const target = draft && findEx(ex.key);
      if (!target) return;
      target.sets.splice(index, 0, set);
      saveDraft();
      renderBody();
    });
  }

  function cycleType(setId) {
    const { ex, set } = findSet(setId);
    set.setType = TYPE_CYCLE[(TYPE_CYCLE.indexOf(set.setType) + 1) % TYPE_CYCLE.length];
    saveDraft();
    renderBody();
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
    const t = liveTemplate(draft.templateId);
    const slots = new Map((t?.exercises || []).map(s => [s.exerciseId, s]));
    const inSession = new Set(draft.exercises.map(ex => ex.exerciseId));
    const addedNow = new Map();   // exerciseId → key, for un-adding from the picker
    HL.exercises.pick({
      onUnpick: exercise => { if (addedNow.has(exercise.id)) removeExercise(addedNow.get(exercise.id)); addedNow.delete(exercise.id); },
      suggest: t && { label: `From ${t.name}`, ids: [...slots.keys()].filter(id => !inSession.has(id)) },
      onPick: exercise => {
        const slot = exerciseSlot(exercise.id, slots.get(exercise.id));
        draft.exercises.push(slot);
        addedNow.set(exercise.id, slot.key);
        // The new exercise opens with its one set ready to edit
        draft.active = slot.sets[0].id;
        expandPick = null;
        panelOpen = false;
        saveDraft();
        render();
        scrollToView(viewEl.querySelector(`[data-set="${draft.active}"]`), 'center');
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
      title: exercise?.name || 'Exercise', icon: util.icon('workout', 20),
      body: `
        <div class="menu-list">
          <button type="button" class="menu-item" data-m="up" ${i === 0 ? 'disabled' : ''}>${util.icon('arrow-up', 18)} Move up</button>
          <button type="button" class="menu-item" data-m="down" ${i === draft.exercises.length - 1 ? 'disabled' : ''}>${util.icon('arrow-down', 18)} Move down</button>
          <button type="button" class="menu-item" data-m="settings">${util.icon('pencil', 18)} Rest time, rep target &amp; muscles</button>
          <button type="button" class="menu-item danger" data-m="remove">${util.icon('close', 18)} Remove from workout</button>
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
        renderBody();
      },
    });
  }

  // Drag by the handle: cards collapse to headers so even long workouts are easy to reorder
  function startDrag(e, handle) {
    const list = viewEl.querySelector('.wo-list');
    const card = handle.closest('.wo-ex');
    e.preventDefault();
    // The view groups exercises (done / focused / up next); reorder in true workout order
    for (const ex of draft.exercises) list.appendChild(list.querySelector(`[data-ex="${ex.key}"]`));
    list.classList.add('reordering');
    card.classList.add('dragging');
    // Moving the card (above, and while dragging) drops a touch's capture on the handle,
    // so follow this pointer on the window rather than on the handle
    const id = e.pointerId;
    try { handle.setPointerCapture(id); } catch { /* pointer already released */ }
    const move = ev => {
      if (ev.pointerId !== id) return;
      const others = util.$$('.wo-ex', list).filter(c => c !== card);
      const before = others.find(c => { const r = c.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (before) { if (card.nextElementSibling !== before) list.insertBefore(card, before); }
      else if (list.lastElementChild !== card) list.appendChild(card);
    };
    const end = ev => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const order = util.$$('.wo-ex', list).map(c => c.dataset.ex);
      draft.exercises.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      saveDraft();
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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
    // Nothing ticked: the exercise is left out. Some ticked: the unticked sets with reps can be ticked here.
    const skipped = session.skipped(draft.exercises);
    const unticked = draft.exercises.filter(ex => !skipped.includes(ex)).flatMap(e => e.sets).filter(s => !s.done && s.reps > 0);
    const skippedNames = new Intl.ListFormat('en', { type: 'conjunction' }).format(skipped.map(ex => exerciseOf(ex).name));
    const sum = domain.workoutSummary(draft);
    const mins = Math.round((Date.now() - Date.parse(draft.startedAt)) / 60000);
    const prs = [];
    for (const ex of draft.exercises) {
      const name = repo.get('exercises', ex.exerciseId)?.name || 'Exercise';
      for (const p of domain.sessionPRs(history(ex.exerciseId), ex.sets.filter(s => s.done))) {
        const detail = p.type === 'volume' ? units.format('mass', p.value, prefs, 0)
          : p.type === 'e1rm' ? `${domain.formatSet(p.set, prefs)} (est. ${units.format('mass', domain.e1rm(p.set.weightKg, p.set.reps), prefs, 0)})`
          : domain.formatSet(p.set, prefs);
        prs.push(`<li class="pr-row">${util.icon('trophy', 18)}<span><b>${esc(name)}</b> — ${PR_LABEL[p.type]}: ${esc(detail)}</span></li>`);
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
      ${skipped.length || unticked.length ? `
        <div class="notice" role="note">
          ${skipped.length ? `<p>${util.icon('alert', 18)}<span>${esc(skippedNames)} ${skipped.length === 1 ? 'wasn’t' : 'weren’t'} done and won’t be saved.</span></p>` : ''}
          ${unticked.length ? `
          <p>${util.icon('alert', 18)}<span>${unticked.length} set${unticked.length === 1 ? ' isn’t' : 's aren’t'} ticked off and won’t be saved.</span></p>
          <button type="button" class="btn btn-ghost btn-sm" data-act="tick-all">Tick ${unticked.length === 1 ? 'it' : 'them all'} done</button>` : ''}
        </div>` : ''}
      <div class="field"><label class="field-label" for="wo-name">Name</label>
        <input class="input" id="wo-name" name="name" value="${esc(draft.name)}"></div>
      ${!draft.templateId && !editing ? '<label class="check-inline"><input type="checkbox" name="asTemplate"> Save as a template</label>' : ''}
      ${editing ? '<button type="button" class="btn btn-danger btn-block block-top" data-act="delete-entry">Delete this workout</button>' : ''}
      <p class="field-hint" id="fin-err" role="alert"></p>`;

    HL.sheet.open({
      title: editing ? 'Save changes?' : 'Finish workout?', icon: util.icon('flag', 20), body,
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
    const exercises = session.toSave(draft.exercises);
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
        exercises: exercises.map(ex => ({ exerciseId: ex.exerciseId, repMin: ex.repMin, repMax: ex.repMax })),
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

  // Rename inline in the sticky header: a bottom sheet would sit under the iPhone keyboard
  function rename() {
    if (naming == null) naming = draft.name;
    renderTitle();
    focusName();
  }

  // iOS only opens the keyboard when focus() runs inside the tap itself: call this synchronously
  // from the click handler, after the (synchronous) render. No timers or awaits before it.
  function focusName() {
    const input = viewEl?.querySelector('[data-rename-input]');
    if (!input) return;
    input.focus({ preventScroll: true });   // it's in the sticky header: scrolling to it only hides the progress line
    input.select();
    input.setSelectionRange(0, input.value.length);   // select() alone doesn't always take on iOS
  }

  // Enter / tap outside keep what was typed; Escape, or leaving it empty, keeps the name it had
  function commitName(keep) {
    if (naming == null) return;
    const typed = viewEl.querySelector('[data-rename-input]')?.value.trim();
    draft.name = (keep && typed) || naming;
    naming = null;
    saveDraft();
    renderTitle();
  }

  // Only the title is redrawn, so a tap on Back or Finish that ends the rename still lands
  function renderTitle() {
    const title = viewEl?.querySelector('.wo-head .wo-title');
    if (!title) return;
    title.outerHTML = titleHtml();
    tickElapsed();
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
          <button type="button" class="icon-btn" data-t="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${util.icon('arrow-up', 18)}</button>
          <button type="button" class="icon-btn" data-t="down" ${i === state.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">${util.icon('arrow-down', 18)}</button>
          <button type="button" class="icon-btn" data-t="remove" aria-label="Remove">${util.icon('close', 18)}</button>
        </div>
        <div class="tpl-slot-row">
          <span class="panel-lbl">Target reps</span>
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
        <div class="seg color-seg">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${state.color === c ? 'checked' : ''}><span class="swatch c-${c}">${COLOR_NAME[c]}</span></label>`).join('')}</div>
      </fieldset>
      <h3 class="section-label section-gap">Exercises</h3>
      <ol class="tpl-slots" id="tpl-slots">${listHtml()}</ol>
      <button type="button" class="btn btn-dashed btn-block" data-t="add">+ Add exercises</button>
      ${template ? '<button type="button" class="btn btn-danger btn-block block-top" data-t="delete">Delete template</button>' : ''}
      <p class="field-hint" id="tpl-err" role="alert"></p>`;

    HL.sheet.open({
      title: template ? 'Edit template' : 'New template', icon: util.icon('workout', 20), body,
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
          if (t === 'add') {
            HL.exercises.pick({
              title: 'Add to template',
              onPick: ex => { state.exercises.push({ exerciseId: ex.id, repMin: ex.repMin, repMax: ex.repMax }); refresh(); },
              onUnpick: ex => {
                const at = state.exercises.map(s => s.exerciseId).lastIndexOf(ex.id);
                if (at >= 0) state.exercises.splice(at, 1);
                refresh();
              },
            });
          }
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
      case 'back':            HL.app.show('today'); break;
      case 'focus-ex':        setExpanded(key); break;
      case 'start-empty':     startEmpty(); focusName(); break;
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
    const holder = e.target.closest('[data-set], [data-panel]');
    if (!field || !holder) return;
    const { set } = findSet(holder.dataset.set || holder.dataset.panel);
    const n = util.parseNum(e.target.value);
    // Typed then erased: the set keeps the number it had before the tap
    if (e.target === typing?.el && e.target.value === '') set[typing.key] = typing.value;
    else if (field === 'weight') set.weightKg = n == null ? null : units.toCanonical('mass', Math.max(0, n), units.unitFor('mass', repo.getSettings().units));
    else set.reps = n == null ? null : Math.max(0, Math.round(n));
    saveDraft();
    refreshSet(set, e.target);
  }

  // Tapping a prefilled number empties it for typing; the old number stays visible as the placeholder.
  // Left empty, it goes back on blur. The draft keeps the old number meanwhile, so ✓ and −/+ use it.
  function onFocusIn(e) {
    const el = e.target;
    const holder = el.matches('input[data-field]') && el.closest('[data-set], [data-panel]');
    const found = holder && findSet(holder.dataset.set || holder.dataset.panel);
    if (!found) return;
    const key = el.dataset.field === 'weight' ? 'weightKg' : 'reps';
    typing = { el, setId: found.set.id, key, value: found.set[key] };
    el.dataset.prev = el.value;
    el.dataset.ph = el.placeholder;
    if (el.value) el.placeholder = el.value;
    el.value = '';
  }

  function onFocusOut(e) {
    const el = e.target;
    if (el.matches('[data-rename-input]')) { commitName(true); return; }
    if (el !== typing?.el) return;
    if (el.value === '') el.value = el.dataset.prev;
    el.placeholder = el.dataset.ph;
    delete el.dataset.prev;
    delete el.dataset.ph;
    typing = null;
  }

  function onKeyDown(e) {
    if (!e.target.matches('[data-rename-input]') || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    e.preventDefault();
    commitName(e.key === 'Enter');
    viewEl.querySelector('[data-act="rename"]')?.focus({ preventScroll: true });
  }

  function onChange(e) {
    if (!e.target.name?.startsWith('stype-')) return;
    const { ex, set } = findSet(e.target.name.slice(6));
    set.setType = e.target.value;
    saveDraft();
    renderBody();
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
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('keydown', onKeyDown);
  }

  HL.views = HL.views || {};
  HL.views.workout = { stores: ['exercises', 'templates', 'entries'], render, onClick, onInput, onChange, init };
  // Starting from another tab (Today's "Up next" card): never replaces a workout in progress
  const startFrom = fn => (...args) => {
    loadDraft();
    if (!draft) fn(...args);
    HL.app.show('workout');
  };

  HL.workout = {
    editEntry,
    current: () => { loadDraft(); return draft; },
    nextTemplate: () => nextTemplate(),
    start: startFrom(templateId => { const t = repo.get('templates', templateId); if (t) startTemplate(t); }),
    // From Today's button: still inside that tap, so the name field can take focus (and the keyboard)
    startEmpty: () => { startFrom(startEmpty)(); focusName(); },
  };
})(globalThis.HL = globalThis.HL || {});
