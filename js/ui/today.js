/* ════════════════════════════════════
   TODAY — quick-log grid, totals vs goals, supplements checklist, today's log
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, units, domain, repo } = HL;
  const { esc } = util;

  /* ════════════════════════════════════
     RENDER
     ════════════════════════════════════ */
  function render(el) {
    const today = util.dayKey();
    const prefs = repo.getSettings().units;
    const trackers = repo.trackers();
    const todays = repo.entries({ dayKey: today });
    const byType = type => todays.filter(e => e.type === type);

    el.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">Today</h1>
          <p class="page-sub">${esc(util.fmtDay(today))}</p>
        </div>
      </header>
      ${resumeHtml()}
      <section aria-labelledby="qa-h">
        <h2 id="qa-h" class="section-label section-gap">Quick log</h2>
        <div class="qa-grid">${trackers.map(t => tileHtml(t, byType(t.key), prefs)).join('')}</div>
      </section>
      ${goalsCardHtml(trackers, byType, prefs)}
      ${checklistCardHtml(byType('supplements'))}
      ${logCardHtml(todays, prefs)}`;
  }

  function draftProgress(d) {
    const sets = d.exercises.flatMap(e => e.sets);
    return `${sets.filter(s => s.done).length}/${sets.length} sets`;
  }

  function resumeHtml() {
    const d = HL.workout.current();
    if (!d) return '';
    return `
      <button type="button" class="resume-card" data-act="resume">
        <span class="resume-icon" aria-hidden="true">🏋️</span>
        <span class="grow"><span class="resume-title">${d.editingId ? 'Editing' : 'Workout in progress'}: ${esc(d.name)}</span>
          <span class="resume-sub">${esc(draftProgress(d))} · tap to resume</span></span>
        <span aria-hidden="true">›</span>
      </button>`;
  }

  function tileHtml(t, entries, prefs) {
    let val = 'Tap to log';
    let done = false;
    const d = t.kind === 'workout' && HL.workout.current();
    if (d) {
      val = `In progress · ${draftProgress(d)}`;
    } else if (t.kind === 'checklist') {
      const items = activeItems(t.key);
      const taken = takenMap(entries);
      if (items.length) { val = `${items.filter(i => taken.has(i.id)).length}/${items.length} taken`; done = taken.size >= items.length; }
    } else if (entries.length) {
      const f = t.fields.find(x => x.primary) || t.fields[0];
      const v = domain.aggregate(t, entries, f.key);
      val = v != null ? domain.formatField(f, v, prefs) : `${entries.length} logged`;
      done = !!(f.goal && domain.goalProgress(v, f.goal).state === 'met');
      if (t.kind === 'workout') val = `Done · ${val}`;
    } else if (t.kind === 'workout') {
      val = 'Start';
    }
    return `
      <button type="button" class="qa-tile" data-log="${esc(t.key)}" aria-label="${esc(`${t.name}: ${val}`)}">
        <span class="qa-icon" aria-hidden="true">${t.icon}</span>
        <span><span class="qa-name">${esc(t.name)}</span><span class="qa-val${done ? ' done' : ''}">${done ? '✓ ' : ''}${esc(val)}</span></span>
      </button>`;
  }

  /* ── Goals ── */
  function goalFields(trackers) {
    const out = [];
    for (const t of trackers) for (const f of t.fields) if (f.goal) out.push({ t, f });
    return out;
  }

  function goalsCardHtml(trackers, byType, prefs) {
    const rows = goalFields(trackers);
    const body = rows.length ? rows.map(({ t, f }) => goalRowHtml(t, f, byType(t.key), prefs)).join('') : `
      <div class="empty-state compact"><strong>No daily goals yet</strong>Set targets for calories, protein, water or sleep to track them here.</div>`;
    return `
      <section class="card" aria-labelledby="goals-h">
        <div class="card-hdr">
          <h2 id="goals-h" class="section-label">Today vs goals</h2>
          <button type="button" class="link-btn" data-act="edit-goals">Edit goals</button>
        </div>
        ${body}
      </section>`;
  }

  // Goal numbers are shown in display units; duration goals stay in minutes
  const shown = (f, v, prefs) => (f.dim ? units.display(f.dim, v, prefs) : v);

  function goalRowHtml(t, f, entries, prefs) {
    const v = domain.aggregate(t, entries, f.key) || 0;
    const g = domain.goalProgress(v, f.goal);
    const unit = f.dim ? ` ${units.label(f.dim, prefs)}` : f.unit ? ` ${f.unit}` : '';
    const fmt = n => f.kind === 'duration' ? util.fmtDuration(n) : `${util.fmtNum(shown(f, n, prefs), f.dim ? 1 : 0)}${unit}`;
    const remain = Math.abs(g.delta);
    const status = g.state === 'met' ? '<span class="met">✓ Goal met</span>'
      : g.state === 'over' ? `<span class="over">▲ ${esc(fmt(remain))} over</span>`
      : `<span>${esc(fmt(remain))} to go</span>`;
    const chips = t.quick?.chips?.[units.unitFor(f.dim, prefs)];
    return `
      <div class="goal-row">
        <div class="goal-top">
          <span class="goal-name">${t.icon ? `<span aria-hidden="true">${t.icon}</span> ` : ''}${esc(f.label === 'Amount' ? t.name : f.label)}</span>
          <span class="goal-nums"><b>${esc(fmt(v))}</b> / ${esc(fmt(f.goal.target))}</span>
        </div>
        <div class="bar" role="progressbar" aria-label="${esc(f.label)}" aria-valuemin="0" aria-valuemax="${Math.round(shown(f, f.goal.target, prefs))}" aria-valuenow="${Math.round(shown(f, v, prefs))}">
          <div class="bar-fill ${g.state === 'under' ? '' : g.state}" style="width:${Math.min(100, g.pct * 100).toFixed(1)}%"></div>
        </div>
        <div class="goal-status">${status}
          ${chips ? `<span class="chip-row">${chips.map(c => `<button type="button" class="add-chip" data-water="${c}" aria-label="Add ${c} ${esc(units.label(f.dim, prefs))} of water">+${c}</button>`).join('')}</span>` : ''}
        </div>
      </div>`;
  }

  /* ── Supplements checklist ── */
  const activeItems = type => repo.all('checklistItems')
    .filter(i => i.trackerType === type && i.active !== false)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  // itemId → today's entry
  function takenMap(entries) {
    const m = new Map();
    for (const e of entries) if (e.values.itemId) m.set(e.values.itemId, e);
    return m;
  }

  function checklistCardHtml(entries) {
    const t = repo.tracker('supplements');
    if (!t || t.archived) return '';
    const items = activeItems('supplements');
    const taken = takenMap(entries);
    const list = items.length ? `
      <ul class="check-list">${items.map(i => {
        const e = taken.get(i.id);
        const dose = [i.dose, i.unit].filter(x => x != null && x !== '').join(' ');
        const sub = [dose, e ? `taken ${util.fmtTime(e.timestamp)}` : ''].filter(Boolean).join(' · ');
        return `
          <li class="check-row">
            <button type="button" class="check-btn" data-check="${i.id}" aria-pressed="${!!e}">
              <span class="check-box" aria-hidden="true">${e ? '✓' : ''}</span>
              <span class="check-text"><span class="check-name">${esc(i.name)}</span>
              ${sub ? `<span class="check-sub">${esc(sub)}</span>` : ''}</span>
            </button>
          </li>`;
      }).join('')}</ul>` : `
      <div class="empty-state compact"><strong>No daily items yet</strong>Add the supplements or meds you take each day, then tick them off here.</div>`;
    return `
      <section class="card" aria-labelledby="supp-h">
        <div class="card-hdr">
          <h2 id="supp-h" class="section-label">${t.icon} Supplements${items.length ? ` · ${[...taken.keys()].filter(id => items.some(i => i.id === id)).length}/${items.length}` : ''}</h2>
          <button type="button" class="link-btn" data-act="manage-items">${items.length ? 'Edit' : '+ Add item'}</button>
        </div>
        ${list}
      </section>`;
  }

  /* ── Today's log ── */
  function logCardHtml(todays, prefs) {
    const rows = todays.filter(e => e.type !== 'supplements');
    return `
      <section class="card" aria-labelledby="log-h">
        <div class="card-hdr"><h2 id="log-h" class="section-label">Logged today</h2></div>
        ${rows.length ? `<ul class="log-list">${rows.map(e => {
          const t = repo.tracker(e.type);
          if (!t) return '';
          return `
            <li><button type="button" class="log-row" data-edit="${e.id}">
              <span class="log-icon" aria-hidden="true">${t.icon}</span>
              <span class="log-main"><span class="log-name">${esc(t.name)}</span>
                <span class="log-sum">${esc(domain.summarizeEntry(t, e, prefs) || 'No values')}</span></span>
              <span class="log-time">${esc(util.fmtTime(e.timestamp))}</span>
            </button></li>`;
        }).join('')}</ul>` : `
          <div class="empty-state compact"><strong>Nothing logged yet today</strong>Tap a tile above — most logs take two taps.</div>`}
      </section>`;
  }

  /* ════════════════════════════════════
     ACTIONS
     ════════════════════════════════════ */
  function onClick(e) {
    const tile = e.target.closest('[data-log]');
    if (tile) {
      if (tile.dataset.log === 'supplements') { focusChecklist(); return; }
      HL.entry.open(tile.dataset.log);
      return;
    }
    const water = e.target.closest('[data-water]');
    if (water) {
      HL.entry.quickLog('hydration', { amount: units.toCanonical('volume', Number(water.dataset.water), units.unitFor('volume', repo.getSettings().units)) });
      return;
    }
    const check = e.target.closest('[data-check]');
    if (check) { toggleItem(check.dataset.check); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const entry = repo.get('entries', edit.dataset.edit);
      if (entry) HL.entry.open(entry.type, { entry });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') HL.app.show('workout');
    if (act === 'edit-goals') openGoalsSheet();
    if (act === 'manage-items') openItemsSheet();
  }

  function focusChecklist() {
    const card = document.getElementById('supp-h');
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const first = document.querySelector('[data-check]') || document.querySelector('[data-act="manage-items"]');
    first?.focus({ preventScroll: true });
  }

  function toggleItem(itemId) {
    const item = repo.get('checklistItems', itemId);
    const existing = takenMap(repo.entries({ type: 'supplements', dayKey: util.dayKey() })).get(itemId);
    if (existing) {
      repo.softDelete('entries', existing.id);
      HL.undoToast(`${item.name} unticked`, () => repo.restore('entries', existing.id));
    } else {
      const values = { itemId, item: item.name };
      if (item.dose != null) values.dose = item.dose;
      if (item.unit) values.unit = item.unit;
      repo.put('entries', repo.newEntry('supplements', values));
    }
  }

  /* ── Goals sheet ── */
  function openGoalsSheet() {
    const prefs = repo.getSettings().units;
    const candidates = [];
    for (const t of repo.trackers()) for (const f of t.fields) {
      if ((f.kind === 'number' || f.kind === 'duration') && (f.agg === 'sum' || f.goal) && t.kind !== 'checklist') candidates.push({ t, f });
    }
    const unitOf = f => f.kind === 'duration' ? 'min' : f.dim ? units.label(f.dim, prefs) : (f.unit || '');
    const body = candidates.map(({ t, f }) => {
      const id = `g-${t.key}-${f.key}`;
      const val = f.goal ? util.round(shown(f, f.goal.target, prefs), f.dim ? 1 : 0) : '';
      return `
        <div class="field">
          <label class="field-label" for="${id}">${t.icon} ${esc(t.name)} · ${esc(f.label)}</label>
          <div class="row-gap">
            <div class="stepper-wrap"><input class="stepper-input stepper-sm" id="${id}" name="${id}" inputmode="decimal" value="${val}" placeholder="No goal">
              <span class="stepper-unit">${esc(unitOf(f))}</span></div>
            <select class="input goal-dir" name="${id}-dir" aria-label="Goal type for ${esc(f.label)}">
              ${[['atLeast', 'At least'], ['atMost', 'At most'], ['target', 'About']].map(([v, l]) =>
                `<option value="${v}" ${(f.goal?.dir || 'atLeast') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>`;
    }).join('') + '<p class="field-hint">Leave a value empty to remove that goal.</p>';

    HL.sheet.open({
      title: 'Daily goals', icon: '🎯', body,
      footer: '<button type="submit" class="btn btn-primary">Save goals</button>',
      onSubmit: (form, api) => {
        const changed = new Map();
        for (const { t, f } of candidates) {
          const id = `g-${t.key}-${f.key}`;
          const n = util.parseNum(form.elements[id].value);
          const goal = n == null || n <= 0 ? null
            : { target: f.dim ? units.toCanonical(f.dim, n, units.unitFor(f.dim, prefs)) : n, dir: form.elements[`${id}-dir`].value };
          const tr = changed.get(t.id) || structuredClone(t);
          tr.fields.find(x => x.key === f.key).goal = goal;
          changed.set(t.id, tr);
        }
        for (const tr of changed.values()) repo.put('trackers', tr);
        api.close();
        HL.toast('Goals saved');
      },
    });
  }

  /* ── Checklist items sheet ── */
  function openItemsSheet() {
    const listHtml = () => {
      const items = activeItems('supplements');
      return items.length ? `<ul class="check-list">${items.map(i => `
        <li class="check-row">
          <span class="check-text grow"><span class="check-name">${esc(i.name)}</span>
            <span class="check-sub">${esc([i.dose, i.unit].filter(x => x != null && x !== '').join(' ') || 'No dose set')}</span></span>
          <button type="button" class="icon-btn" data-del-item="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button>
        </li>`).join('')}</ul>` : '<p class="muted small">No items yet.</p>';
    };
    const body = `
      <div id="items-list" class="block-gap">${listHtml()}</div>
      <h3 class="section-label section-gap">Add a daily item</h3>
      <div class="field"><label class="field-label" for="it-name">Name</label>
        <input class="input" id="it-name" name="name" placeholder="e.g. Creatine" autocapitalize="words"></div>
      <div class="row-gap">
        <div class="field grow"><label class="field-label" for="it-dose">Dose</label>
          <input class="input" id="it-dose" name="dose" inputmode="decimal" placeholder="5"></div>
        <div class="field grow"><label class="field-label" for="it-unit">Unit</label>
          <input class="input" id="it-unit" name="unit" placeholder="g, mg, caps"></div>
      </div>
      <p class="field-hint" id="it-err" role="alert"></p>`;

    HL.sheet.open({
      title: 'Supplements & meds', icon: '💊', body,
      footer: '<button type="submit" class="btn btn-primary">Add item</button>',
      onMount: api => {
        api.form.addEventListener('click', e => {
          const del = e.target.closest('[data-del-item]');
          if (!del) return;
          const item = repo.get('checklistItems', del.dataset.delItem);
          repo.softDelete('checklistItems', item.id);
          api.form.querySelector('#items-list').innerHTML = listHtml();
          HL.undoToast(`${item.name} removed`, () => {
            repo.restore('checklistItems', item.id);
            const list = document.getElementById('items-list');
            if (list) list.innerHTML = listHtml();
          });
        });
      },
      onSubmit: (form) => {
        const name = form.elements.name.value.trim();
        if (!name) { form.querySelector('#it-err').textContent = 'Enter a name.'; return; }
        const order = activeItems('supplements').length;
        repo.put('checklistItems', repo.make('checklistItem', {
          trackerType: 'supplements', name, dose: util.parseNum(form.elements.dose.value),
          unit: form.elements.unit.value.trim(), active: true, order,
        }));
        form.reset();
        form.querySelector('#it-err').textContent = '';
        form.querySelector('#items-list').innerHTML = listHtml();
        form.elements.name.focus();
        HL.toast(`${name} added`);
      },
    });
  }

  HL.views = HL.views || {};
  HL.views.today = { title: 'Today', stores: ['entries', 'trackers', 'checklistItems', 'presets', 'drafts'], render, onClick };
})(globalThis.HL = globalThis.HL || {});
