/* ════════════════════════════════════
   LEGACY IMPORT — old Gym Tracker → Health Log, with a preview before anything is written
   On desktop the old app's keys are readable directly (same origin). On iPhone each
   Home Screen app has its own storage, so the old app exports a file instead.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, repo, legacy, backup } = HL;
  const { esc } = util;
  const MACRO_FIELD_NAME = { calories: 'kcal', protein: 'g protein', carbs: 'g carbs', fat: 'g fat' };

  // Read-only: copies the old app's keys without touching them
  function readDirect() {
    const keys = {};
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('gym_')) keys[k] = localStorage.getItem(k);
    } catch { return null; }
    return keys.gym_sessions || keys.gym_weights || keys.gym_macro_log ? keys : null;
  }

  function open() {
    const direct = readDirect();
    if (direct) { preview(direct, 'the old app in this browser'); return; }
    HL.sheet.open({
      title: 'Import from old Gym Tracker', icon: util.icon('download', 20),
      body: `
        <p class="block-gap">On iPhone, each Home Screen app keeps its own storage, so first save a copy from the old app:</p>
        <ol class="steps">
          <li>Open the old <b>Gym Tracker</b> from its icon.</li>
          <li>On its Home tab, tap <b>⚙</b> (top right) and scroll to <b>Move to Health Log</b>.</li>
          <li>Tap <b>Export for Health Log</b> → <b>Save to Files</b>.</li>
          <li>Come back here and choose that file.</li>
        </ol>
        <p class="field-hint">The old app’s data isn’t changed. You’ll see exactly what will be imported before anything is saved, and importing the same file twice won’t create duplicates.</p>`,
      footer: '<button type="submit" class="btn btn-primary">Choose export file</button>',
      onSubmit: (form, api) => { api.close(); HL.data.pickFile(fromText); },
    });
  }

  function fromText(text) {
    let data;
    try { data = JSON.parse(text); } catch { HL.toast('That file isn’t valid JSON', { kind: 'error' }); return; }
    if (data?.app === backup.APP_TAG) { HL.toast('That’s a Health Log backup — use “Restore from backup” instead.', { kind: 'error', duration: 6000 }); return; }
    if (data?.app !== 'gym-tracker-legacy' || !data.keys || typeof data.keys !== 'object') {
      HL.toast('That isn’t an export from the old Gym Tracker.', { kind: 'error' });
      return;
    }
    preview(data.keys, `your export from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'the old app'}`);
  }

  function preview(keys, from) {
    const exercises = repo.all('exercises', { deleted: true });
    const mapped = legacy.mapLegacy(keys, { exercises });
    const r = mapped.report;
    const keepDraft = mapped.draft && !HL.workout.current();
    const incoming = { exercises: mapped.exercises, entries: mapped.entries, templates: mapped.templates, drafts: keepDraft ? [mapped.draft] : [] };
    const diff = backup.diffImport(repo.snapshot(), incoming);
    const nothing = !diff.add.length && !diff.update.length;
    const addedOf = store => diff.byStore[store]?.add || 0;
    const matched = new Set(mapped.entries.filter(e => e.type === 'workout').flatMap(e => e.values.exercises.map(x => x.exerciseId)));
    const libraryHits = [...matched].filter(id => exercises.some(e => e.id === id)).length;
    const muscleNames = ids => HL.exercises.muscleNames(ids) || 'muscles not set';

    const body = `
      <p class="block-gap">From ${esc(from)}.</p>
      <div class="stat-grid three">
        <div class="stat"><span class="stat-lbl">Workouts</span><span class="stat-val">${r.workouts}</span></div>
        <div class="stat"><span class="stat-lbl">Weigh-ins</span><span class="stat-val">${r.weighIns}</span></div>
        <div class="stat"><span class="stat-lbl">Meals</span><span class="stat-val">${r.meals}</span></div>
      </div>
      <p class="block-gap">${nothing ? 'Everything in this export is already in Health Log — nothing to import.'
        : `This will add <b>${diff.add.length.toLocaleString()}</b> record${diff.add.length === 1 ? '' : 's'}: ${[
          addedOf('entries') && `${addedOf('entries')} logs`, addedOf('exercises') && `${addedOf('exercises')} exercises`,
          addedOf('templates') && `${addedOf('templates')} templates`, addedOf('drafts') && 'your in-progress workout',
        ].filter(Boolean).join(', ')}.${diff.duplicates ? ` <b>${diff.duplicates}</b> already imported will be skipped.` : ''} Nothing is deleted.`}</p>
      <ul class="plain-list block-gap">
        <li>${r.sets.toLocaleString()} sets, including ${r.dropSets} drop sets${r.bodyweightSets ? ` and ${r.bodyweightSets} bodyweight sets (logged as 0 lb)` : ''}. The old app had no warm-up flag, so other sets count as working sets.</li>
        <li>Weights convert from lb exactly; dates appear in your time zone.</li>
        <li>${libraryHits} exercise${libraryHits === 1 ? '' : 's'} matched the library${r.linked.length ? ` (${r.linked.length} by a similar name)` : ''}; ${r.created.length} kept as your own exercise${r.created.length === 1 ? '' : 's'}.</li>
        ${mapped.templates.length ? `<li>Templates from your split days: ${esc(mapped.templates.map(t => t.name).join(', '))}, using each day’s most recent workout.</li>` : ''}
        ${mapped.draft && !keepDraft ? '<li>Your old in-progress workout is skipped because one is already open here.</li>' : ''}
      </ul>
      ${r.linked.length || mapped.exercises.length ? `
        <details class="fold">
          <summary>Exercise details</summary>
          <div class="fold-body">
            ${r.linked.length ? `<p class="section-label section-gap">Linked to the library</p>
              <ul class="plain-list">${r.linked.map(([a, b]) => `<li>${esc(a)} → <b>${esc(b)}</b></li>`).join('')}</ul>` : ''}
            ${mapped.exercises.length ? `<p class="section-label section-gap block-top">New exercises</p>
              <ul class="plain-list">${mapped.exercises.map(e => `<li>${esc(e.name)} <span class="muted">· ${esc(muscleNames(e.primary))}</span></li>`).join('')}</ul>
              <p class="field-hint">Muscles are guessed from the old app’s groups — fix any in More → Exercise library.</p>` : ''}
          </div>
        </details>` : ''}
      ${r.skipped.length ? `<p class="field-hint">Not imported: ${esc(r.skipped.map(s => `${s.key} (${s.reason})`).join('; '))}.</p>` : ''}
      ${mapped.macroGoals && Object.keys(mapped.macroGoals).length && !nothing ? `
        <label class="check-inline"><input type="checkbox" name="goals" checked> Use my old daily goals (${esc(Object.entries(mapped.macroGoals).map(([k, v]) => `${v} ${MACRO_FIELD_NAME[k]}`).join(', '))})</label>` : ''}`;

    HL.sheet.open({
      title: 'Import from old Gym Tracker', icon: util.icon('download', 20), body,
      footer: nothing ? '<button type="submit" class="btn btn-ghost">Close</button>'
        : '<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button><button type="submit" class="btn btn-primary">Import</button>',
      onMount: api => api.form.addEventListener('click', e => { if (e.target.closest('[data-act="cancel"]')) api.close(); }),
      onSubmit: async (form, api) => {
        if (nothing) { api.close(); return; }
        const useGoals = form.elements.goals?.checked;
        api.close();
        repo.importRecords([...diff.add, ...diff.update]);
        if (useGoals) applyGoals(mapped.macroGoals);
        repo.setMeta('legacyImportAt', new Date().toISOString());
        try {
          await repo.flushNow();
          HL.toast(`Imported ${r.workouts} workout${r.workouts === 1 ? '' : 's'}, ${r.weighIns} weigh-in${r.weighIns === 1 ? '' : 's'}${r.meals ? ` and ${r.meals} meals` : ''}`, { duration: 5000 });
        } catch {
          HL.toast('Imported into memory, but saving to storage is still retrying', { kind: 'error' });
        }
      },
    });
  }

  function applyGoals(goals) {
    const t = structuredClone(repo.tracker('nutrition'));
    if (!t) return;
    for (const f of t.fields) if (goals[f.key]) f.goal = { target: goals[f.key], dir: f.goal?.dir || 'atLeast' };
    repo.put('trackers', t);
  }

  HL.legacyImport = { open };
})(globalThis.HL = globalThis.HL || {});
