/* ════════════════════════════════════
   MORE — settings
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { units, repo } = HL;

  function systemOf(prefs) {
    for (const [name, sys] of Object.entries(units.SYSTEMS)) {
      if (Object.entries(sys).every(([dim, u]) => prefs[dim] === u)) return name;
    }
    return 'custom';
  }

  function segRow(name, label, sub, value, options) {
    return `
      <div class="settings-row">
        <div><div class="settings-lbl" id="${name}-lbl">${label}</div>${sub ? `<div class="settings-sub">${sub}</div>` : ''}</div>
        <div class="seg" role="radiogroup" aria-labelledby="${name}-lbl">
          ${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
      </div>`;
  }

  function render(el) {
    const s = repo.getSettings();
    el.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">More</h1><p class="page-sub">Settings and your data</p></div></header>
      <section class="settings-section" aria-labelledby="units-h">
        <h2 class="section-label" id="units-h">Units</h2>
        <div class="settings-card">
          ${segRow('system', 'Measurement system', 'Data is stored in metric; this only changes display', systemOf(s.units), [['imperial', 'lb · oz'], ['metric', 'kg · ml']])}
        </div>
      </section>
      <section class="settings-section" aria-labelledby="wo-h">
        <h2 class="section-label" id="wo-h">Workout</h2>
        <div class="settings-card">
          ${segRow('effort', 'Effort rating', 'Shown on each set', s.effort, [['rpe', 'RPE'], ['rir', 'RIR'], ['off', 'Off']])}
          ${segRow('restSec', 'Default rest', 'Per-exercise rest overrides this', String(s.restSec), [['60', '1:00'], ['90', '1:30'], ['120', '2:00'], ['180', '3:00']])}
          ${segRow('plateStep', 'Weight +/− step', s.units.mass === 'lb' ? '5 lb or 2.5 lb' : '2.5 kg or 1.25 kg', s.plateStep, [['standard', 'Standard'], ['fine', 'Fine']])}
          <button type="button" class="settings-row settings-link" data-act="exercises">
            <span><span class="settings-lbl">Exercise library</span><span class="settings-sub">Add, edit or hide exercises</span></span>
            <span aria-hidden="true" class="muted">›</span>
          </button>
        </div>
      </section>`;
  }

  function onChange(e) {
    const { name, value } = e.target;
    if (name === 'system') repo.setSettings({ units: { ...units.SYSTEMS[value] } });
    if (name === 'effort' || name === 'plateStep') repo.setSettings({ [name]: value });
    if (name === 'restSec') repo.setSettings({ restSec: Number(value) });
  }

  function onClick(e) {
    if (e.target.closest('[data-act="exercises"]')) HL.exercises.pick({ manage: true });
  }

  HL.views = HL.views || {};
  HL.views.more = { title: 'More', stores: [], render, onChange, onClick };
})(globalThis.HL = globalThis.HL || {});
