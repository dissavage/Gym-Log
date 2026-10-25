/* ════════════════════════════════════
   MORE — settings
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, repo } = HL;

  function systemOf(prefs) {
    for (const [name, sys] of Object.entries(units.SYSTEMS)) {
      if (Object.entries(sys).every(([dim, u]) => prefs[dim] === u)) return name;
    }
    return 'custom';
  }

  function segRow(name, label, sub, value, options) {
    return `
      <div class="settings-row seg-row">
        <div><div class="settings-lbl" id="${name}-lbl">${label}</div>${sub ? `<div class="settings-sub">${sub}</div>` : ''}</div>
        <div class="seg" role="radiogroup" aria-labelledby="${name}-lbl">
          ${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
      </div>`;
  }

  function render(el) {
    const s = repo.getSettings();
    el.innerHTML = `
      <header class="page-head"><div><p class="page-kicker">Settings &amp; your data</p><h1 class="page-title">More</h1></div></header>
      <section class="settings-section" aria-labelledby="trk-h">
        <h2 class="section-label" id="trk-h">Trackers</h2>
        <p class="field-hint block-gap">Track anything: create your own with any fields. Order here is the order on Today.</p>
        ${HL.trackers.listHtml()}
      </section>
      <section class="settings-section" aria-labelledby="units-h">
        <h2 class="section-label" id="units-h">Display</h2>
        <div class="settings-card">
          ${segRow('system', 'Measurement system', 'Data is stored in metric; this only changes display', systemOf(s.units), [['imperial', 'lb · oz'], ['metric', 'kg · ml']])}
          ${segRow('theme', 'Theme', 'Auto follows your phone', s.theme, [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']])}
        </div>
      </section>
      <section class="settings-section" aria-labelledby="wo-h">
        <h2 class="section-label" id="wo-h">Workout</h2>
        <div class="settings-card">
          ${segRow('effort', 'Effort rating', 'Shown on each set', s.effort, [['rpe', 'RPE'], ['rir', 'RIR'], ['off', 'Off']])}
          <div class="settings-row stack">${HL.durationField.html({ id: 'set-rest', name: 'restSec', label: 'Default rest', sub: 'Per-exercise rest overrides this', value: s.restSec })}</div>
          ${segRow('plateStep', 'Weight +/− step', s.units.mass === 'lb' ? '5 lb or 2.5 lb' : '2.5 kg or 1.25 kg', s.plateStep, [['standard', 'Standard'], ['fine', 'Fine']])}
          <button type="button" class="settings-row settings-link" data-act="exercises">
            <span><span class="settings-lbl">Exercise library</span><span class="settings-sub">Add, edit or hide exercises</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('chev-right', 18)}</span>
          </button>
        </div>
      </section>
      ${HL.data.sectionHtml()}`;
    HL.data.fillStorage(el.querySelector('#storage-box'));
  }

  function onChange(e) {
    const { name, value } = e.target;
    if (name === 'system') repo.setSettings({ units: { ...units.SYSTEMS[value] } });
    if (name === 'effort' || name === 'plateStep' || name === 'theme') repo.setSettings({ [name]: value });
    if (name === 'restSec' && Number(value) > 0) repo.setSettings({ restSec: Number(value) });
  }

  function onClick(e) {
    if (HL.trackers.onClick(e) || HL.data.onClick(e)) return;
    if (e.target.closest('[data-act="exercises"]')) HL.exercises.pick({ manage: true });
  }

  HL.views = HL.views || {};
  HL.views.more = { stores: ['trackers', 'meta', 'entries', 'checklistItems'], render, onChange, onClick };
})(globalThis.HL = globalThis.HL || {});
