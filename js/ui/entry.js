/* ════════════════════════════════════
   ENTRY SHEET — one generic form for every tracker, built from its field list
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo } = HL;
  const { esc } = util;

  /* ════════════════════════════════════
     FIELD RENDERING
     ════════════════════════════════════ */
  // Value as it appears in the input, in the user's display unit
  function inputValue(field, value, prefs) {
    if (value == null || value === '') return '';
    if (field.kind === 'number' && field.dim) return String(units.display(field.dim, value, prefs));
    return String(value);
  }

  function unitLabel(field, prefs) {
    if (field.kind === 'duration') return 'min';
    if (field.dim) return units.label(field.dim, prefs);
    return field.unit || '';
  }

  function stepperHtml(field, value, prefs, placeholder) {
    const id = `f-${field.key}`;
    const v = inputValue(field, value, prefs);
    const step = field.kind === 'duration' ? (field.step || 5) : units.stepFor(field, prefs);
    return `
      <div class="field">
        <label class="field-label" for="${id}">${esc(field.label)}</label>
        <div class="stepper" data-step="${step}" data-min="${field.min ?? ''}" data-max="${field.max ?? ''}">
          <button type="button" class="stepper-btn" data-stepper="-1" aria-label="Decrease ${esc(field.label)}">−</button>
          <div class="stepper-wrap">
            <input id="${id}" class="stepper-input" name="${field.key}" inputmode="decimal" autocomplete="off"
              value="${esc(v)}" data-orig="${esc(v)}" placeholder="${esc(placeholder)}" aria-describedby="${id}-err">
            <span class="stepper-unit">${esc(unitLabel(field, prefs))}</span>
          </div>
          <button type="button" class="stepper-btn" data-stepper="1" aria-label="Increase ${esc(field.label)}">+</button>
        </div>
        <div class="field-hint" id="${id}-err" role="alert"></div>
      </div>`;
  }

  function segHtml(field, value, options, ends) {
    return `
      <fieldset class="field">
        <legend class="field-label">${esc(field.label)}</legend>
        <div class="seg">
          ${options.map(o => `
            <label><input type="radio" name="${field.key}" value="${o.value}" ${String(value) === String(o.value) ? 'checked' : ''}>
            <span>${esc(o.label)}</span></label>`).join('')}
        </div>
        ${ends ? `<div class="seg-ends" aria-hidden="true"><span>${esc(ends[0])}</span><span>${esc(ends[1])}</span></div>` : ''}
      </fieldset>`;
  }

  function fieldHtml(field, value, prefs, placeholder) {
    const id = `f-${field.key}`;
    if (field.computed) {
      return `
        <div class="field">
          <span class="field-label">${esc(field.label)}</span>
          <output class="computed-val" data-computed="${field.key}">${esc(domain.formatField(field, value, prefs) || '—')}</output>
        </div>`;
    }
    switch (field.kind) {
      case 'number':
      case 'duration':
        return stepperHtml(field, value, prefs, placeholder);
      case 'scale': {
        const opts = [];
        for (let i = field.min || 1; i <= (field.max || 5); i++) opts.push({ value: i, label: String(i) });
        return segHtml(field, value, opts, field.scaleLabels);
      }
      case 'bool':
        return segHtml(field, value, [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]);
      case 'time':
        return `
          <div class="field">
            <label class="field-label" for="${id}">${esc(field.label)}</label>
            <input type="time" class="input" id="${id}" name="${field.key}" value="${esc(value || '')}">
          </div>`;
      default: {
        const opts = field.options || [];
        return `
          <div class="field">
            <label class="field-label" for="${id}">${esc(field.label)}</label>
            <input type="text" class="input" id="${id}" name="${field.key}" value="${esc(value || '')}" autocomplete="off" autocapitalize="sentences">
            ${opts.length ? `<div class="chips">${opts.map(o =>
              `<button type="button" class="chip" data-fill="${field.key}" data-value="${esc(o)}" aria-pressed="${o === value}">${esc(o)}</button>`).join('')}</div>` : ''}
          </div>`;
      }
    }
  }

  function fieldsHtml(tracker, values, prefs, placeholders) {
    const groups = new Map();
    let html = '';
    for (const f of tracker.fields) {
      if (f.hidden) continue;
      if (f.group) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); continue; }
      html += fieldHtml(f, values[f.key], prefs, placeholders[f.key] ?? '');
    }
    for (const [name, fields] of groups) {
      const filled = fields.some(f => values[f.key] != null);
      html += `
        <details class="fold" ${filled ? 'open' : ''}>
          <summary>${esc(name)}</summary>
          <div class="fold-body">${fields.map(f => fieldHtml(f, values[f.key], prefs, placeholders[f.key] ?? '')).join('')}</div>
        </details>`;
    }
    return html;
  }

  /* ════════════════════════════════════
     READING THE FORM
     ════════════════════════════════════ */
  // Returns { values, errors }. Untouched numeric inputs keep their exact stored value,
  // so re-saving an entry never drifts through a unit round-trip.
  function readValues(form, tracker, original, prefs) {
    const values = {};
    const errors = {};
    for (const f of tracker.fields) {
      if (f.computed) continue;
      // Hidden fields aren't on the form; keep whatever the entry already had
      if (f.hidden) { if (original[f.key] != null) values[f.key] = original[f.key]; continue; }
      const el = form.elements[f.key];
      if (!el) continue;
      if (f.kind === 'number' || f.kind === 'duration') {
        const raw = el.value.trim();
        if (raw === '') continue;
        if (raw === el.dataset.orig && original[f.key] != null) { values[f.key] = original[f.key]; continue; }
        const n = util.parseNum(raw);
        if (n == null) { errors[f.key] = 'Enter a number'; continue; }
        if (f.min != null && n < f.min) { errors[f.key] = `Must be at least ${f.min}`; continue; }
        if (f.max != null && n > f.max) { errors[f.key] = `Must be ${f.max} or less`; continue; }
        values[f.key] = f.dim ? units.toCanonical(f.dim, n, units.unitFor(f.dim, prefs)) : n;
      } else if (f.kind === 'scale') {
        if (el.value) values[f.key] = Number(el.value);
      } else if (f.kind === 'bool') {
        if (el.value) values[f.key] = el.value === 'true';
      } else {
        const s = el.value.trim();
        if (s) values[f.key] = s;
      }
    }
    return { values, errors };
  }

  function stepInput(btn) {
    const stepper = btn.closest('.stepper');
    const input = stepper.querySelector('input');
    const step = Number(stepper.dataset.step) || 1;
    const dp = String(step).includes('.') ? String(step).split('.')[1].length : 0;
    const base = util.parseNum(input.value) ?? util.parseNum(input.placeholder) ?? 0;
    let next = util.round(base + step * Number(btn.dataset.stepper), dp);
    if (stepper.dataset.min !== '') next = Math.max(Number(stepper.dataset.min), next);
    if (stepper.dataset.max !== '') next = Math.min(Number(stepper.dataset.max), next);
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ════════════════════════════════════
     OPEN
     ════════════════════════════════════ */
  /** open(trackerKey, { entry, values }) — edit an entry, or log a new one (optionally prefilled) */
  function open(trackerKey, { entry = null, values: given = null } = {}) {
    const tracker = repo.tracker(trackerKey);
    if (!tracker) return;
    if (tracker.kind === 'workout') {
      if (entry) HL.workout.editEntry(entry); else HL.app.show('workout');
      return;
    }
    const prefs = repo.getSettings().units;
    const last = repo.lastEntry(trackerKey);
    const original = entry ? entry.values : {};
    let values = entry ? { ...entry.values } : { ...(given || {}) };
    if (!entry && !given && tracker.quick?.prefill === 'last' && last) {
      for (const f of tracker.fields) if (!f.computed && last.values[f.key] != null) values[f.key] = last.values[f.key];
    }
    values = domain.withComputed(tracker, values);

    // Placeholders show the last value so an empty stepper starts from something sensible
    const placeholders = {};
    if (last) for (const f of tracker.fields) {
      if (f.kind === 'number' || f.kind === 'duration') placeholders[f.key] = inputValue(f, last.values[f.key], prefs);
    }

    const presets = tracker.quick?.presets
      ? repo.all('presets').filter(p => p.trackerType === trackerKey).sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const chips = domain.quickChips(tracker, prefs);
    const when = entry ? entry.timestamp : util.localISO();

    const body = `
      ${chips && !entry ? `
        <div class="field">
          <span class="field-label">Quick add · ${esc(chips.field.label)}</span>
          <div class="chip-row">${chips.values.map(c => `<button type="button" class="add-chip" data-quick="${c}">+${c}${chips.unit ? ` ${esc(chips.unit)}` : ''}</button>`).join('')}</div>
        </div>` : ''}
      ${presets.length ? `
        <div class="field">
          <span class="field-label">Quick ${tracker.key === 'nutrition' ? 'foods' : 'picks'}</span>
          <div class="chip-row">${presets.map(p => `<button type="button" class="chip" data-preset="${p.id}">${esc(p.name)}</button>`).join('')}</div>
        </div>` : ''}
      ${fieldsHtml(tracker, values, prefs, placeholders)}
      <div class="field">
        <label class="field-label" for="f-when">When</label>
        <input type="datetime-local" class="input" id="f-when" name="__when" value="${util.toInputDateTime(when)}">
      </div>
      <details class="fold" ${entry?.notes ? 'open' : ''}>
        <summary>Notes</summary>
        <div class="fold-body"><div class="field">
          <label class="sr-only" for="f-notes">Notes</label>
          <textarea class="input" id="f-notes" name="__notes">${esc(entry?.notes || '')}</textarea>
        </div></div>
      </details>
      ${tracker.quick?.presets && !entry ? `
        <label class="check-inline"><input type="checkbox" name="__savePreset"> Save as quick ${tracker.key === 'nutrition' ? 'food' : 'pick'}</label>` : ''}
      <p class="field-hint" id="entry-err" role="alert"></p>`;

    const footer = `
      ${entry ? '<button type="button" class="btn btn-danger" data-act="delete">Delete</button>' : ''}
      <button type="submit" class="btn btn-primary">${entry ? 'Save' : 'Log'}</button>`;

    HL.sheet.open({
      title: entry ? `Edit ${tracker.name}` : tracker.name,
      icon: tracker.icon,
      body, footer,
      onMount: api => wire(api, tracker, entry, prefs, presets, original),
      onSubmit: (form, api) => submit(form, api, tracker, entry, prefs, original),
    });
  }

  function wire(api, tracker, entry, prefs, presets, original) {
    const { form } = api;
    form.addEventListener('click', e => {
      const stepBtn = e.target.closest('[data-stepper]');
      if (stepBtn) { stepInput(stepBtn); return; }
      const fill = e.target.closest('[data-fill]');
      if (fill) {
        form.elements[fill.dataset.fill].value = fill.dataset.value;
        util.$$(`[data-fill="${fill.dataset.fill}"]`, form).forEach(c => c.setAttribute('aria-pressed', String(c === fill)));
        return;
      }
      const quick = e.target.closest('[data-quick]');
      if (quick) {
        const f = domain.quickChips(tracker, prefs).field;
        api.close();
        quickLog(tracker.key, { [f.key]: units.fieldToCanonical(f, Number(quick.dataset.quick), prefs) });
        return;
      }
      const preset = e.target.closest('[data-preset]');
      if (preset) { applyValues(form, tracker, presets.find(p => p.id === preset.dataset.preset).values, prefs); return; }
      if (e.target.closest('[data-act="delete"]')) {
        api.close();
        repo.softDelete('entries', entry.id);
        HL.undoToast(`${tracker.name} entry deleted`, () => repo.restore('entries', entry.id));
      }
    });
    // Live preview for computed fields (e.g. sleep duration from bed/wake time)
    form.addEventListener('input', () => {
      const outs = util.$$('[data-computed]', form);
      if (!outs.length) return;
      const { values } = readValues(form, tracker, original, prefs);
      const computed = domain.withComputed(tracker, values);
      for (const o of outs) {
        const f = tracker.fields.find(x => x.key === o.dataset.computed);
        o.textContent = domain.formatField(f, computed[f.key], prefs) || '—';
      }
    });
  }

  function applyValues(form, tracker, values, prefs) {
    for (const f of tracker.fields) {
      const el = form.elements[f.key];
      if (!el || f.computed) continue;
      const v = values[f.key];
      if (f.kind === 'scale' || f.kind === 'bool') {
        util.$$(`input[name="${f.key}"]`, form).forEach(r => { r.checked = r.value === String(v); });
      } else {
        el.value = inputValue(f, v, prefs);
        el.dataset.orig = '';
      }
    }
    form.dispatchEvent(new Event('input'));
  }

  function submit(form, api, tracker, entry, prefs, original) {
    const { values, errors } = readValues(form, tracker, original, prefs);
    for (const f of tracker.fields) {
      const errEl = form.querySelector(`#f-${f.key}-err`);
      const input = form.elements[f.key];
      if (errEl) errEl.textContent = errors[f.key] || '';
      if (input && input.setAttribute) input.setAttribute('aria-invalid', String(!!errors[f.key]));
    }
    const formErr = form.querySelector('#entry-err');
    if (Object.keys(errors).length) { formErr.textContent = 'Fix the highlighted fields.'; return; }
    if (!Object.keys(values).length) { formErr.textContent = 'Enter at least one value.'; return; }

    const whenRaw = form.elements.__when.value;
    const when = whenRaw ? new Date(whenRaw) : new Date();
    const notes = form.elements.__notes.value.trim();

    if (entry) {
      repo.put('entries', { ...entry, values, notes, timestamp: util.localISO(when), dayKey: util.dayKey(when) });
      HL.toast(`${tracker.name} updated`);
    } else {
      repo.put('entries', repo.newEntry(tracker.key, values, { when, notes }));
      if (form.elements.__savePreset?.checked) {
        const name = values.food || domain.summarizeEntry(tracker, { values }, prefs, 2);
        repo.put('presets', repo.make('preset', { trackerType: tracker.key, name, values }));
      }
      HL.toast(`${tracker.name} logged`);
    }
    api.close();
  }

  // One-tap logging (water chips, presets) with an undo
  function quickLog(trackerKey, values) {
    const tracker = repo.tracker(trackerKey);
    const rec = repo.put('entries', repo.newEntry(trackerKey, values));
    const summary = domain.summarizeEntry(tracker, rec, repo.getSettings().units, 1);
    HL.undoToast(`${tracker.name} +${summary}`, () => repo.softDelete('entries', rec.id));
  }

  HL.entry = { open, quickLog };
})(globalThis.HL = globalThis.HL || {});
