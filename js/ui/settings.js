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
      </section>`;
  }

  function onChange(e) {
    if (e.target.name === 'system') repo.setSettings({ units: { ...units.SYSTEMS[e.target.value] } });
  }

  HL.views = HL.views || {};
  HL.views.more = { title: 'More', stores: [], render, onChange };
})(globalThis.HL = globalThis.HL || {});
