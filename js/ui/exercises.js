/* ════════════════════════════════════
   EXERCISES — library picker and create/edit sheet
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, schema, repo } = HL;
  const { esc, icon } = util;

  const MUSCLE_NAME = Object.fromEntries(schema.MUSCLES.map(m => [m.id, m.name]));
  const muscleNames = ids => (ids || []).map(id => MUSCLE_NAME[id] || id).join(', ');
  const cap = s => s[0].toUpperCase() + s.slice(1);

  const library = () => repo.all('exercises').filter(e => !e.archived);

  // Most recently trained first, then alphabetical
  function recentOrder() {
    const last = new Map();
    for (const e of repo.entries({ type: 'workout' })) {
      for (const ex of e.values.exercises || []) if (!last.has(ex.exerciseId)) last.set(ex.exerciseId, e.timestamp);
    }
    return last;
  }

  /* ════════════════════════════════════
     PICKER
     ════════════════════════════════════ */
  /**
   * pick({ title, onPick(exercise), onUnpick(exercise), manage, suggest: { label, ids } })
   * Stays open so several exercises can be added; tapping a ticked one again un-adds it (onUnpick).
   * Manage mode opens the editor instead. `suggest` lists exercises above the search
   * (a template's, when adding to its session).
   */
  function pick({ title = 'Add exercises', onPick, onUnpick, manage = false, suggest = null } = {}) {
    const picked = new Set();
    let query = '';
    let muscle = '';
    const recent = recentOrder();
    const suggested = (suggest?.ids || []).map(id => repo.get('exercises', id)).filter(e => e && !e.archived && !e.deletedAt);

    const rowHtml = e => `
        <li><button type="button" class="pick-row" data-pick="${e.id}" aria-pressed="${picked.has(e.id)}">
          <span class="grow"><span class="pick-name">${esc(e.name)}</span>
          <span class="pick-sub">${esc([muscleNames(e.primary), e.equipment].filter(Boolean).join(' · '))}${e.builtIn ? '' : ' · custom'}</span></span>
          <span class="pick-mark" aria-hidden="true">${icon(manage ? 'chev-right' : picked.has(e.id) ? 'check' : 'plus', 18)}</span>
        </button></li>`;

    const listHtml = () => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = library()
        .filter(e => !muscle || e.primary.includes(muscle) || e.secondary.includes(muscle))
        .filter(e => words.every(w => e.nameLower.includes(w)))
        .sort((a, b) => {
          const ra = recent.get(a.id) || '', rb = recent.get(b.id) || '';
          if (!words.length && ra !== rb) return ra < rb ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
      const create = `<button type="button" class="btn btn-dashed btn-block" data-act="create">+ Create ${query ? `“${esc(query)}”` : 'new exercise'}</button>`;
      if (!rows.length) return `<p class="empty-state compact">No exercises match.</p>${create}`;
      return `<ul class="pick-list">${rows.map(rowHtml).join('')}</ul>${create}`;
    };

    const body = `
      ${suggested.length ? `
      <section class="pick-suggest" aria-labelledby="pick-sug-h">
        <h3 class="section-label" id="pick-sug-h">${esc(suggest.label)}</h3>
        <ul class="pick-list">${suggested.map(rowHtml).join('')}</ul>
      </section>
      <h3 class="section-label pick-all-h">All exercises</h3>` : ''}
      <div class="field">
        <label class="sr-only" for="pick-q">Search exercises</label>
        <input type="search" class="input" id="pick-q" placeholder="Search exercises" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="muscle-chips" role="group" aria-label="Filter by muscle">
        <button type="button" class="chip" data-muscle="" aria-pressed="true">All</button>
        ${schema.MUSCLES.map(m => `<button type="button" class="chip" data-muscle="${m.id}" aria-pressed="false">${esc(m.name)}</button>`).join('')}
      </div>
      <div id="pick-list">${listHtml()}</div>`;

    HL.sheet.open({
      title: manage ? 'Exercise library' : title, icon: icon('workout', 20), body, cancel: false,
      footer: `<button type="submit" class="btn btn-primary btn-block">Done</button>`,
      onSubmit: (form, api) => api.close(),
      onMount: api => {
        const list = api.form.querySelector('#pick-list');
        const refresh = () => { list.innerHTML = listHtml(); };
        api.form.querySelector('#pick-q').addEventListener('input', util.debounce(e => { query = e.target.value.trim(); refresh(); }, 120));
        api.form.addEventListener('click', e => {
          const chip = e.target.closest('[data-muscle]');
          if (chip) {
            muscle = chip.dataset.muscle;
            util.$$('[data-muscle]', api.form).forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
            refresh();
            return;
          }
          const row = e.target.closest('[data-pick]');
          if (row) {
            const ex = repo.get('exercises', row.dataset.pick);
            if (manage) { edit(ex, { onSave: refresh }); return; }
            const on = !picked.has(ex.id);
            if (!on && !onUnpick) return;
            if (on) { picked.add(ex.id); onPick(ex); } else { picked.delete(ex.id); onUnpick(ex); }
            // The same exercise can be listed twice (suggested and in the full list)
            for (const r of util.$$(`[data-pick="${ex.id}"]`, api.form)) {
              r.setAttribute('aria-pressed', String(on));
              r.querySelector('.pick-mark').innerHTML = icon(on ? 'check' : 'plus', 18);
            }
            return;
          }
          if (e.target.closest('[data-act="create"]')) {
            edit(null, {
              name: query,
              onSave: ex => {
                if (!manage) { picked.add(ex.id); onPick(ex); }
                refresh();
              },
            });
          }
        });
      },
    });
  }

  /* ════════════════════════════════════
     EDITOR
     ════════════════════════════════════ */
  function edit(exercise, { name = '', onSave } = {}) {
    const ex = exercise || { name, primary: [], secondary: [], equipment: 'barbell', category: 'compound', restSec: null, repMin: null, repMax: null };
    const sec = new Set(ex.secondary);
    const body = `
      <div class="field"><label class="field-label" for="ex-name">Name</label>
        <input class="input" id="ex-name" name="name" value="${esc(ex.name)}" autocapitalize="words" ${exercise ? '' : 'autofocus'}></div>
      <div class="field"><label class="field-label" for="ex-primary">Primary muscle</label>
        <select class="input" id="ex-primary" name="primary">
          <option value="">Choose…</option>
          ${schema.MUSCLES.map(m => `<option value="${m.id}" ${ex.primary[0] === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select></div>
      <fieldset class="field"><legend class="field-label">Also works</legend>
        <div class="chips">${schema.MUSCLES.map(m => `<button type="button" class="chip" data-sec="${m.id}" aria-pressed="${sec.has(m.id)}">${esc(m.name)}</button>`).join('')}</div>
      </fieldset>
      <div class="row-gap">
        <div class="field grow"><label class="field-label" for="ex-equip">Equipment</label>
          <select class="input" id="ex-equip" name="equipment">${schema.EQUIPMENT.map(q => `<option value="${q}" ${ex.equipment === q ? 'selected' : ''}>${cap(q)}</option>`).join('')}</select></div>
        <div class="field grow"><label class="field-label" for="ex-cat">Type</label>
          <select class="input" id="ex-cat" name="category">${['compound', 'isolation'].map(c => `<option value="${c}" ${ex.category === c ? 'selected' : ''}>${cap(c)}</option>`).join('')}</select></div>
      </div>
      <div class="field">${HL.durationField.html({ id: 'ex-rest', name: 'restSec', label: 'Rest after each set', value: ex.restSec ?? null, fallback: repo.getSettings().restSec, labelClass: 'field-label' })}</div>
      <div class="row-gap">
        <div class="field grow"><label class="field-label" for="ex-rmin">Target reps from</label>
          <input class="input" id="ex-rmin" name="repMin" inputmode="numeric" value="${ex.repMin ?? ''}" placeholder="e.g. 6"></div>
        <div class="field grow"><label class="field-label" for="ex-rmax">to</label>
          <input class="input" id="ex-rmax" name="repMax" inputmode="numeric" value="${ex.repMax ?? ''}" placeholder="e.g. 10"></div>
      </div>
      ${exercise ? '<button type="button" class="btn btn-danger btn-block block-top" data-act="archive">Hide from the library</button>' : ''}
      <p class="field-hint" id="ex-err" role="alert"></p>`;

    HL.sheet.open({
      title: exercise ? 'Edit exercise' : 'New exercise', icon: icon('workout', 20), body,
      footer: '<button type="submit" class="btn btn-primary">Save</button>',
      onMount: api => api.form.addEventListener('click', e => {
        const chip = e.target.closest('[data-sec]');
        if (chip) {
          sec.has(chip.dataset.sec) ? sec.delete(chip.dataset.sec) : sec.add(chip.dataset.sec);
          chip.setAttribute('aria-pressed', String(sec.has(chip.dataset.sec)));
          return;
        }
        if (e.target.closest('[data-act="archive"]')) {
          repo.put('exercises', { ...exercise, archived: true });
          api.close();
          onSave?.(exercise);
          HL.undoToast(`${exercise.name} hidden from the library`, () => {
            repo.put('exercises', { ...repo.get('exercises', exercise.id), archived: false });
            onSave?.(exercise);
          });
        }
      }),
      onSubmit: (form, api) => {
        const err = form.querySelector('#ex-err');
        const nm = form.elements.name.value.trim();
        const primary = form.elements.primary.value;
        if (!nm) { err.textContent = 'Enter a name.'; return; }
        if (!primary) { err.textContent = 'Choose the primary muscle.'; return; }
        const clash = library().find(e => e.nameLower === nm.toLowerCase() && e.id !== exercise?.id);
        if (clash) { err.textContent = `“${clash.name}” already exists.`; return; }
        const repMin = util.parseNum(form.elements.repMin.value);
        const repMax = util.parseNum(form.elements.repMax.value);
        const props = {
          // Built-ins can have several primaries (deadlift); the select only edits the first
          name: nm, nameLower: nm.toLowerCase(), primary: [primary, ...ex.primary.slice(1).filter(m => m !== primary)],
          secondary: [...sec].filter(m => m !== primary),
          equipment: form.elements.equipment.value, category: form.elements.category.value,
          restSec: util.parseNum(form.elements.restSec.value), repMin, repMax: repMax ?? repMin,
        };
        const saved = exercise
          ? repo.put('exercises', { ...exercise, ...props })
          : repo.put('exercises', repo.make('exercise', { ...props, builtIn: false, archived: false }));
        api.close();
        HL.toast(`${nm} saved`);
        onSave?.(saved);
      },
    });
  }

  HL.exercises = { pick, edit, muscleNames };
})(globalThis.HL = globalThis.HL || {});
