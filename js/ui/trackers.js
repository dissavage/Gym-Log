/* ════════════════════════════════════
   TRACKERS — manage list (More tab) and the custom tracker builder
   A custom tracker is just a field list on the same engine as the built-ins, so
   Today tiles, the entry sheet, History, goals and charts all work without special cases.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo } = HL;
  const { esc } = util;

  const ICONS = ['📊', '👣', '🧘', '🚴', '🏊', '🧗', '❤️', '🩸', '🌡️', '💉', '🍎', '🥗', '☕', '🍺', '🚭', '💤',
    '📖', '✍️', '🧠', '😊', '🎯', '⏱️', '🦷', '🧴', '🌞', '🐕', '🎸', '💻'];
  const UNIT_CHOICES = [['', 'No unit'], ['dim:mass', 'Weight (lb / kg)'], ['dim:volume', 'Volume (oz / ml)'],
    ['dim:distance', 'Distance (mi / km)'], ['dim:length', 'Length (in / cm)'], ['custom', 'Custom unit…']];
  const AGG_CHOICES = [['sum', 'Add them up'], ['avg', 'Average them'], ['last', 'Keep the latest'], ['max', 'Keep the highest']];
  const PRECISION = [[1, 'Whole numbers'], [0.1, '1 decimal'], [0.01, '2 decimals']];
  const DIRS = [['atLeast', 'At least'], ['atMost', 'At most'], ['target', 'About']];
  const KIND_NAME = Object.fromEntries(domain.FIELD_KINDS);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;

  const hasEntries = key => repo.entries({ type: key }).length > 0;
  const fieldHasData = (trackerKey, fieldKey) => repo.entries({ type: trackerKey }).some(e => e.values[fieldKey] != null);

  /* ════════════════════════════════════
     LIST (More tab)
     ════════════════════════════════════ */
  function listHtml() {
    const all = repo.trackers({ archived: true });
    return `
      <div class="settings-card">${all.map((t, i) => {
        const n = t.fields.filter(f => !f.hidden && !f.computed).length;
        const sub = [t.builtIn ? 'Built-in' : 'Custom', t.kind === 'workout' ? '' : `${n} field${n === 1 ? '' : 's'}`, t.archived ? 'hidden from Today' : '']
          .filter(Boolean).join(' · ');
        return `
          <div class="settings-row tracker-row${t.archived ? ' is-archived' : ''}">
            <button type="button" class="tracker-main" data-tr="edit" data-id="${t.id}" aria-label="Edit ${esc(t.name)}">
              <span class="tracker-icon" aria-hidden="true">${t.icon}</span>
              <span><span class="settings-lbl">${esc(t.name)}</span><span class="settings-sub">${esc(sub)}</span></span>
            </button>
            <button type="button" class="icon-btn" data-tr="up" data-id="${t.id}" aria-label="Move ${esc(t.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="icon-btn" data-tr="down" data-id="${t.id}" aria-label="Move ${esc(t.name)} down" ${i === all.length - 1 ? 'disabled' : ''}>↓</button>
          </div>`;
      }).join('')}</div>
      <button type="button" class="btn btn-dashed btn-block block-top" data-tr="new">+ New tracker</button>`;
  }

  // Returns true when the click belonged to the tracker list
  function onClick(e) {
    const btn = e.target.closest('[data-tr]');
    if (!btn) return false;
    const act = btn.dataset.tr;
    if (act === 'new') openBuilder(null);
    if (act === 'edit') openBuilder(repo.get('trackers', btn.dataset.id));
    if (act === 'up' || act === 'down') move(btn.dataset.id, act === 'up' ? -1 : 1);
    return true;
  }

  function move(id, dir) {
    const all = repo.trackers({ archived: true });
    const i = all.findIndex(t => t.id === id);
    const j = i + dir;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    all.forEach((t, order) => { if (t.order !== order) repo.put('trackers', { ...t, order }); });
  }

  /* ════════════════════════════════════
     BUILDER
     ════════════════════════════════════ */
  const newField = (kind = 'number') => ({ key: null, label: '', ...domain.fieldDefaults(kind) });

  function unitChoiceOf(f) {
    if (f.dim) return `dim:${f.dim}`;
    return f.unit != null && f.unit !== '' ? 'custom' : '';
  }

  // Goal targets are edited in display units; stored canonically
  const goalDisplay = (f, prefs) => (f.goal ? util.round(f.dim ? units.display(f.dim, f.goal.target, prefs) : f.goal.target, 2) : '');

  function fieldCardHtml(t, f, i, count, prefs) {
    const locked = !!(f.key && t.key && fieldHasData(t.key, f.key));
    const numeric = f.kind === 'number' || f.kind === 'duration';
    const choice = f._unitChoice ?? unitChoiceOf(f);
    return `
      <li class="bf${f.hidden ? ' is-hidden' : ''}" data-i="${i}">
        <div class="bf-top">
          <label class="sr-only" for="bf-label-${i}">Field name</label>
          <input class="input" id="bf-label-${i}" data-f="label" value="${esc(f.label)}" placeholder="Field name, e.g. Steps" autocapitalize="sentences">
          <button type="button" class="icon-btn" data-b="up" aria-label="Move field up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-b="down" aria-label="Move field down" ${i === count - 1 ? 'disabled' : ''}>↓</button>
          ${locked
            ? `<button type="button" class="btn btn-ghost btn-sm" data-b="${f.hidden ? 'show' : 'hide'}" aria-label="${f.hidden ? 'Show' : 'Hide'} ${esc(f.label)}">${f.hidden ? 'Show' : 'Hide'}</button>`
            : `<button type="button" class="icon-btn" data-b="remove" aria-label="Remove ${esc(f.label || 'field')}">✕</button>`}
        </div>
        ${f.hidden ? '<p class="field-hint">Hidden — its past data is kept but it’s not on the form.</p>' : `
        <div class="row-gap">
          <div class="field grow"><label class="field-label" for="bf-kind-${i}">Type</label>
            <select class="input" id="bf-kind-${i}" data-f="kind" ${locked ? 'disabled' : ''}>${domain.FIELD_KINDS.map(([v, l]) => opt(v, l, f.kind)).join('')}</select></div>
          ${f.kind === 'number' ? `
          <div class="field grow"><label class="field-label" for="bf-unit-${i}">Unit</label>
            <select class="input" id="bf-unit-${i}" data-f="unitChoice" ${locked ? 'disabled' : ''}>${UNIT_CHOICES.map(([v, l]) => opt(v, l, choice)).join('')}</select></div>` : ''}
        </div>
        ${f.kind === 'number' && choice === 'custom' ? `
          <div class="field"><label class="field-label" for="bf-u-${i}">Unit name</label>
            <input class="input" id="bf-u-${i}" data-f="unit" value="${esc(f.unit || '')}" placeholder="steps, %, bpm, mg…"></div>` : ''}
        ${f.kind === 'number' && !choice.startsWith('dim:') ? `
          <div class="field"><label class="field-label" for="bf-step-${i}">Precision</label>
            <select class="input" id="bf-step-${i}" data-f="step">${PRECISION.map(([v, l]) => opt(v, l, f.step ?? 1)).join('')}</select></div>` : ''}
        ${f.kind === 'scale' ? `
          <div class="row-gap">
            <div class="field grow"><label class="field-label" for="bf-lo-${i}">1 means</label>
              <input class="input" id="bf-lo-${i}" data-f="scaleLo" value="${esc(f.scaleLabels?.[0] || '')}" placeholder="Low"></div>
            <div class="field grow"><label class="field-label" for="bf-hi-${i}">5 means</label>
              <input class="input" id="bf-hi-${i}" data-f="scaleHi" value="${esc(f.scaleLabels?.[1] || '')}" placeholder="High"></div>
          </div>` : ''}
        ${numeric || f.kind === 'scale' ? `
          <div class="field"><label class="field-label" for="bf-agg-${i}">Logged more than once a day?</label>
            <select class="input" id="bf-agg-${i}" data-f="agg">${AGG_CHOICES.map(([v, l]) => opt(v, l, f.agg)).join('')}</select></div>` : ''}
        ${numeric ? `
          <div class="field"><label class="field-label" for="bf-goal-${i}">Daily goal (optional)</label>
            <div class="row-gap">
              <input class="input grow" id="bf-goal-${i}" data-f="goalTarget" inputmode="decimal" value="${esc(String(f._goalText ?? goalDisplay(f, prefs)))}" placeholder="No goal">
              <label class="sr-only" for="bf-dir-${i}">Goal type</label>
              <select class="input goal-dir" id="bf-dir-${i}" data-f="goalDir">${DIRS.map(([v, l]) => opt(v, l, f.goal?.dir || f._goalDir || 'atLeast')).join('')}</select>
            </div></div>` : ''}
        ${locked ? '<p class="field-hint">This field has data, so its type and unit are locked.</p>' : ''}`}
      </li>`;
  }

  function openBuilder(tracker) {
    const prefs = repo.getSettings().units;
    if (tracker?.builtIn) { openBuiltIn(tracker); return; }
    const state = tracker ? structuredClone(tracker) : {
      name: '', icon: ICONS[0], kind: 'entry', builtIn: false, archived: false,
      fields: [newField('number')], quick: { prefill: 'last', presets: true },
    };
    const qc = tracker && domain.quickChips(tracker, prefs);
    let chipsText = qc ? qc.values.join(', ') : '';

    const listHtml = () => state.fields.map((f, i) => fieldCardHtml(state, f, i, state.fields.length, prefs)).join('');
    const iconChoices = ICONS.includes(state.icon) ? ICONS : [state.icon, ...ICONS];

    const body = `
      <div class="field"><label class="field-label" for="tb-name">Name</label>
        <input class="input" id="tb-name" name="name" value="${esc(state.name)}" placeholder="e.g. Steps, Blood pressure, Meditation" autocapitalize="words" ${tracker ? '' : 'autofocus'}></div>
      <fieldset class="field"><legend class="field-label">Icon</legend>
        <div class="icon-grid">${iconChoices.map(ic => `
          <label><input type="radio" name="icon" value="${ic}" ${state.icon === ic ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div>
        <label class="field-hint" for="tb-icon">Or type any emoji</label>
        <input class="input icon-input" id="tb-icon" name="iconText" maxlength="8" placeholder="🙂">
      </fieldset>
      <h3 class="section-label section-gap">Fields</h3>
      <ol class="bf-list" id="bf-list">${listHtml()}</ol>
      <button type="button" class="btn btn-dashed btn-block" data-b="add">+ Add field</button>
      <div class="field block-top"><label class="field-label" for="tb-chips">Quick-add buttons (optional)</label>
        <input class="input" id="tb-chips" name="chips" value="${esc(chipsText)}" placeholder="e.g. 1000, 5000" inputmode="decimal">
        <p class="field-hint">One-tap amounts for the first number field, separated by commas.</p></div>
      <label class="check-inline"><input type="checkbox" name="prefill" ${state.quick?.prefill === 'last' ? 'checked' : ''}> Pre-fill with my last entry</label>
      <label class="check-inline"><input type="checkbox" name="onToday" ${state.archived ? '' : 'checked'}> Show on Today</label>
      <p class="field-hint" id="tb-err" role="alert"></p>`;

    const canDelete = tracker && !hasEntries(tracker.key);
    HL.sheet.open({
      title: tracker ? `Edit ${tracker.name}` : 'New tracker', icon: tracker?.icon || '✨', body,
      footer: `${tracker ? `<button type="button" class="btn btn-danger" data-b="${canDelete ? 'delete' : 'archive'}">${canDelete ? 'Delete' : tracker.archived ? 'Show on Today' : 'Hide from Today'}</button>` : ''}
        <button type="submit" class="btn btn-primary">${tracker ? 'Save' : 'Create tracker'}</button>`,
      onMount: api => {
        const list = api.form.querySelector('#bf-list');
        const refresh = () => { list.innerHTML = listHtml(); };
        const fieldOf = el => state.fields[Number(el.closest('[data-i]')?.dataset.i)];

        api.form.addEventListener('input', e => {
          const f = fieldOf(e.target);
          const prop = e.target.dataset.f;
          if (!f || !prop) return;
          if (prop === 'label' || prop === 'unit') f[prop] = e.target.value;
          if (prop === 'scaleLo' || prop === 'scaleHi') {
            f.scaleLabels = [...(f.scaleLabels || ['', ''])];
            f.scaleLabels[prop === 'scaleLo' ? 0 : 1] = e.target.value;
          }
          if (prop === 'goalTarget') f._goalText = e.target.value;
        });
        api.form.addEventListener('change', e => {
          const f = fieldOf(e.target);
          const prop = e.target.dataset.f;
          if (!f || !prop) return;
          const i = state.fields.indexOf(f);
          if (prop === 'kind') {
            state.fields[i] = { ...newField(e.target.value), key: f.key, label: f.label };
            refresh();
          }
          if (prop === 'unitChoice') {
            f._unitChoice = e.target.value;
            f.dim = e.target.value.startsWith('dim:') ? e.target.value.slice(4) : null;
            if (e.target.value !== 'custom') f.unit = null;
            refresh();
          }
          if (prop === 'agg') f.agg = e.target.value;
          if (prop === 'step') f.step = Number(e.target.value);
          if (prop === 'goalDir') f._goalDir = e.target.value;
        });
        api.form.addEventListener('click', e => {
          const b = e.target.closest('[data-b]')?.dataset.b;
          if (!b) return;
          const f = fieldOf(e.target);
          const i = state.fields.indexOf(f);
          if (b === 'add') { state.fields.push(newField('number')); refresh(); list.lastElementChild?.querySelector('input')?.focus(); }
          if (b === 'remove') { state.fields.splice(i, 1); refresh(); }
          if (b === 'hide' || b === 'show') { f.hidden = b === 'hide'; refresh(); }
          if (b === 'up' || b === 'down') {
            const j = i + (b === 'up' ? -1 : 1);
            [state.fields[i], state.fields[j]] = [state.fields[j], state.fields[i]];
            refresh();
          }
          if (b === 'delete') {
            api.close();
            repo.softDelete('trackers', tracker.id);
            HL.undoToast(`${tracker.name} deleted`, () => repo.restore('trackers', tracker.id));
          }
          if (b === 'archive') {
            api.close();
            repo.put('trackers', { ...tracker, archived: !tracker.archived });
            HL.toast(tracker.archived ? `${tracker.name} is back on Today` : `${tracker.name} hidden from Today — its data is kept`);
          }
        });
      },
      onSubmit: (form, api) => save(form, api, tracker, state, prefs),
    });
  }

  function save(form, api, tracker, state, prefs) {
    const err = form.querySelector('#tb-err');
    state.name = form.elements.name.value.trim();
    state.icon = form.elements.iconText.value.trim() || form.elements.icon.value || ICONS[0];

    // Goals: typed in display units, stored canonically
    for (const f of state.fields) {
      const n = util.parseNum(f._goalText ?? (f.goal ? String(goalDisplay(f, prefs)) : ''));
      const dir = f._goalDir || f.goal?.dir || 'atLeast';
      f.goal = (f.kind === 'number' || f.kind === 'duration') && n != null
        ? { target: f.dim ? units.toCanonical(f.dim, n, units.unitFor(f.dim, prefs)) : n, dir } : null;
      f.label = (f.label || '').trim();
      if (f.kind === 'number' && f.dim) f.step = domain.DIM_STEPS[f.dim];
      if (f.kind === 'number' && (f._unitChoice ?? unitChoiceOf(f)) === 'custom') f.unit = (f.unit || '').trim() || null;
    }
    const errors = domain.validateTracker(state, repo.all('trackers', { deleted: true }));
    if (errors.length) { err.textContent = errors.join(' '); return; }

    const taken = new Set(state.fields.map(f => f.key).filter(Boolean));
    const fields = state.fields.map(f => {
      const { _goalText, _goalDir, _unitChoice, ...clean } = f;
      if (!clean.key) { clean.key = domain.uniqueKey(clean.label, taken); taken.add(clean.key); }
      clean.primary = false;
      return clean;
    });
    // The first visible number-like field is what tiles, quick-add buttons and summaries lead with
    const primary = fields.find(f => !f.hidden && domain.isNumericField(f)) || fields.find(f => !f.hidden);
    primary.primary = true;

    const values = form.elements.chips.value.split(',').map(s => util.parseNum(s)).filter(n => n != null && n > 0);
    let chips = null;
    if (values.length && (primary.kind === 'number' || primary.kind === 'duration')) {
      if (primary.dim) {
        // Store the amounts for both unit systems so switching units keeps sensible buttons
        const cur = units.unitFor(primary.dim, prefs);
        const other = Object.keys(units.DIMS[primary.dim].units).find(u => u !== cur);
        const step = domain.DIM_STEPS[primary.dim][other];
        const convert = v => units.fromCanonical(primary.dim, units.toCanonical(primary.dim, v, cur), other);
        chips = { [cur]: values, [other]: values.map(v => util.round(util.round(convert(v) / step) * step, 2)) };
      } else {
        chips = { _: values };
      }
    }

    const props = {
      name: state.name, icon: state.icon, fields, archived: !form.elements.onToday.checked,
      quick: { prefill: form.elements.prefill.checked ? 'last' : 'none', presets: true, ...(chips ? { chips } : {}) },
    };
    if (tracker) {
      repo.put('trackers', { ...tracker, ...props });
    } else {
      const keys = new Set(repo.all('trackers', { deleted: true }).map(t => t.key));
      const order = Math.max(-1, ...repo.all('trackers', { deleted: true }).map(t => t.order)) + 1;
      repo.put('trackers', repo.make('tracker', { ...props, key: domain.uniqueKey(state.name, keys, 'c_'), kind: 'entry', builtIn: false, order }));
    }
    api.close();
    HL.toast(tracker ? `${state.name} saved` : `${state.name} created — it’s on Today`);
  }

  /* ── Built-ins: rename, re-icon, hide from Today; their fields are fixed ── */
  function openBuiltIn(t) {
    const body = `
      <div class="field"><label class="field-label" for="tb-name">Name</label>
        <input class="input" id="tb-name" name="name" value="${esc(t.name)}"></div>
      <div class="field"><label class="field-label" for="tb-icon">Icon</label>
        <input class="input icon-input" id="tb-icon" name="iconText" value="${esc(t.icon)}" maxlength="8"></div>
      <label class="check-inline"><input type="checkbox" name="onToday" ${t.archived ? '' : 'checked'}> Show on Today</label>
      <h3 class="section-label section-gap block-top">Fields</h3>
      <ul class="plain-list">${t.fields.map(f => `<li>${esc(f.label)} <span class="muted">· ${esc(KIND_NAME[f.kind] || f.kind)}${f.computed ? ' (calculated)' : ''}</span></li>`).join('')}</ul>
      <p class="field-hint">Built-in fields are fixed so your history stays consistent. Set daily goals from Today → Edit goals, or create a custom tracker for anything else.</p>
      <p class="field-hint" id="tb-err" role="alert"></p>`;
    HL.sheet.open({
      title: `Edit ${t.name}`, icon: t.icon, body,
      footer: '<button type="submit" class="btn btn-primary">Save</button>',
      onSubmit: (form, api) => {
        const name = form.elements.name.value.trim();
        if (!name) { form.querySelector('#tb-err').textContent = 'Give the tracker a name.'; return; }
        repo.put('trackers', { ...t, name, icon: form.elements.iconText.value.trim() || t.icon, archived: !form.elements.onToday.checked });
        api.close();
        HL.toast(`${name} saved`);
      },
    });
  }

  HL.trackers = { listHtml, onClick, openBuilder };
})(globalThis.HL = globalThis.HL || {});
