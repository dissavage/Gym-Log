/* ════════════════════════════════════
   TODAY — streak strip, up-next workout, daily-log tiles, quick add, supplements, today's log
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
    const settings = repo.getSettings();
    const prefs = settings.units;
    const trackers = repo.trackers();
    const all = repo.entries();
    const todays = all.filter(e => e.dayKey === today);
    const byType = type => todays.filter(e => e.type === type);

    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="page-kicker">${esc(`${util.fmtDay(today, { weekday: 'long' })} · ${util.fmtDay(today, { month: 'short', day: 'numeric' })}`)}</p>
          <h1 class="page-title">Today</h1>
        </div>
      </header>
      ${HL.data.installHintHtml()}
      ${HL.data.reminderHtml()}
      ${streakHtml(all, today, settings.weekStart)}
      ${upNextHtml()}
      <section class="daily" aria-labelledby="daily-h">
        <div class="sec-hdr">
          <h2 id="daily-h" class="section-label">Daily log</h2>
          <button type="button" class="link-btn" data-act="edit-goals">Edit goals</button>
        </div>
        <div class="tile-grid">
          ${tilesHtml(trackers, byType, prefs, today)}
          <button type="button" class="tile tile-new" data-act="new-tracker">${util.icon('plus', 18)}<span>New tracker</span></button>
        </div>
        ${quickRowsHtml(trackers, prefs)}
      </section>
      ${checklistCardHtml(byType('supplements'))}
      ${logCardHtml(todays, prefs)}`;
  }

  /* ── Streak strip: this week at a glance ── */
  function streakHtml(all, today, weekStart) {
    const logged = new Set();
    const lifted = new Set();
    for (const e of all) {
      logged.add(e.dayKey);
      if (e.type === 'workout') lifted.add(e.dayKey);
    }
    const streak = domain.streaks([...logged], today).current;
    const start = util.weekStartOf(today, weekStart);
    const end = util.addDays(start, 6);
    const workouts = all.filter(e => e.type === 'workout' && e.dayKey >= start && e.dayKey <= end).length;
    const days = Array.from({ length: 7 }, (_, i) => {
      const key = util.addDays(start, i);
      const state = lifted.has(key) ? 'done' : key === today ? 'today' : key > today ? 'future' : logged.has(key) ? 'logged' : 'empty';
      return `
        <li class="sd is-${state}${key === today ? ' is-now' : ''}">
          <span class="sd-l">${esc(util.fmtDay(key, { weekday: 'narrow' }))}</span>
          <span class="sd-c">${state === 'done' ? util.icon('check', 14) : state === 'logged' ? '<i></i>' : ''}</span>
        </li>`;
    }).join('');
    return `
      <section class="card streak" aria-label="Streak this week">
        <div class="streak-num" aria-hidden="true"><span class="streak-val">${streak}</span><span class="streak-lbl">day streak</span></div>
        <ol class="streak-week" aria-hidden="true">${days}</ol>
        <p class="sr-only">${workouts} workout${workouts === 1 ? '' : 's'} this week. ${streak}-day logging streak.</p>
      </section>`;
  }

  /* ── Up next: the template after the last one done (or the workout in progress) ── */
  const shortDay = key => util.fmtDay(key, { weekday: 'short', month: 'short', day: 'numeric' });

  function upNextCard(label, when, title, sub, primary, alts) {
    return `
      <section class="card upnext" aria-labelledby="upnext-h">
        <div class="upnext-top"><span class="upnext-lbl">${esc(label)}</span>${when ? `<span class="upnext-when">${esc(when)}</span>` : ''}</div>
        <h2 class="upnext-title" id="upnext-h">${esc(title)}</h2>
        ${sub ? `<p class="upnext-sub">${esc(sub)}</p>` : ''}
        ${primary}
        ${alts.length ? `<div class="upnext-alt">${alts.join('')}</div>` : ''}
      </section>`;
  }

  function upNextHtml() {
    const d = HL.workout.current();
    if (d) {
      const sets = d.exercises.flatMap(e => e.sets);
      const mins = d.editingId ? null : Math.max(0, Math.round((Date.now() - Date.parse(d.startedAt)) / 60000));
      return upNextCard(d.editingId ? 'Editing' : 'In progress', '', d.name,
        `${sets.filter(s => s.done).length}/${sets.length} sets${mins != null ? ` · ${mins} min` : ''}`,
        `<button type="button" class="btn btn-primary btn-block" data-act="resume">${util.icon('play', 18)} Resume workout</button>`, []);
    }
    const next = HL.workout.nextTemplate();
    if (!next) {
      return upNextCard('Up next', '', 'No templates yet', 'Save your usual routines as templates to start them from here.',
        `<button type="button" class="btn btn-primary btn-block" data-act="start-empty">${util.icon('play', 18)} Start empty workout</button>`,
        ['<button type="button" class="btn btn-ghost" data-act="other-templates">Templates</button>']);
    }
    const lastOfThis = repo.entries({ type: 'workout' }).find(e => e.values.templateId === next.id);
    const slots = next.exercises.filter(s => repo.get('exercises', s.exerciseId));
    const muscles = [...new Set(slots.slice(0, 3).flatMap(s => repo.get('exercises', s.exerciseId).primary))];
    const totalSets = slots.reduce((n, s) => n + (s.sets || 0), 0);
    const sub = [`${slots.length} exercise${slots.length === 1 ? '' : 's'}`, `${totalSets} set${totalSets === 1 ? '' : 's'}`, HL.exercises.muscleNames(muscles)].filter(Boolean).join(' · ');
    return upNextCard('Up next', lastOfThis ? `Last done ${shortDay(lastOfThis.dayKey)}` : 'Not done yet', next.name, sub,
      `<button type="button" class="btn btn-primary btn-block" data-act="start-next" data-id="${next.id}">${util.icon('play', 18)} Start workout</button>`,
      ['<button type="button" class="btn btn-ghost" data-act="other-templates">Other templates</button>']);
  }

  /* ── Daily-log tiles: one per tracker, goals shown as thin bars ── */
  // Goal numbers are shown in display units; duration goals stay in minutes
  const shown = (f, v, prefs) => (f.dim ? units.display(f.dim, v, prefs) : v);
  const plainDp = f => (typeof f.step === 'number' && String(f.step).includes('.') ? String(f.step).split('.')[1].length : 0);

  // [number, unit] so the number can be big and the unit small
  function parts(f, v, prefs) {
    if (v == null) return ['—', ''];
    if (f.kind === 'duration') return [util.fmtDuration(v), ''];
    if (f.kind === 'scale') return [util.fmtNum(v, 1), `/ ${f.max || 5}`];
    if (f.kind === 'bool') return [v ? 'Yes' : 'No', ''];
    if (f.dim) return [util.fmtNum(units.display(f.dim, v, prefs), 1), units.label(f.dim, prefs)];
    return [util.fmtNum(v, plainDp(f)), f.unit || ''];
  }

  const joinUnit = ([n, u]) => (u ? (u === '%' ? `${n}%` : `${n} ${u}`) : n);
  const target = (f, prefs) => joinUnit(parts(f, f.goal.target, prefs));

  function barHtml(f, v, prefs, cls = '') {
    const g = domain.goalProgress(v || 0, f.goal);
    const over = g.state === 'over' && f.goal.dir === 'atMost';
    return `<span class="tbar ${cls}" role="progressbar" aria-label="${esc(f.label)}" aria-valuemin="0"
      aria-valuemax="${Math.round(shown(f, f.goal.target, prefs))}" aria-valuenow="${Math.round(shown(f, v || 0, prefs))}">
      <span class="tbar-fill${over ? ' over' : ''}" style="width:${Math.min(100, g.pct * 100).toFixed(1)}%"></span></span>`;
  }

  function bigHtml(f, v, prefs, size, goalText) {
    const [n, u] = parts(f, v, prefs);
    const unit = goalText ? ` / ${goalText}` : u ? ` ${u}` : '';
    return `<span class="tile-big${v == null ? ' is-empty' : ''}"><span class="tile-num tile-num-${size}">${esc(n)}</span>${unit ? `<span class="tile-unit">${esc(unit)}</span>` : ''}</span>`;
  }

  function tileHtml(t, entries, prefs, today) {
    const visible = t.fields.filter(f => !f.hidden);
    const goals = visible.filter(f => f.goal);
    const primary = visible.find(f => f.primary) || visible.find(f => domain.isNumericField(f)) || visible[0];
    const value = f => (entries.length ? domain.aggregate(t, entries, f.key) : null);
    const top = `
      <span class="tile-top"><span class="tile-name">${util.trackerIcon(t, 16)}<span>${esc(t.name)}</span></span>
        <span class="tile-add">${util.icon('plus', 18)}</span></span>`;
    let body = '';
    let label = 'nothing logged today';
    let wide = false;

    if (goals.length >= 2) {
      wide = true;
      const main = goals.includes(primary) ? primary : goals[0];
      const v = value(main);
      label = v == null ? `nothing logged today, goal ${target(main, prefs)}` : `${joinUnit(parts(main, v, prefs))} of ${target(main, prefs)}`;
      body = `${bigHtml(main, v, prefs, 'xl', target(main, prefs))}${barHtml(main, v, prefs)}
        <span class="tile-minis">${goals.filter(f => f !== main).map(f => {
          const fv = value(f);
          return `<span class="mini"><span class="mini-lbl">${esc(f.label)}</span>
            <span class="mini-val">${esc(parts(f, fv ?? 0, prefs)[0])}<span class="tile-unit"> / ${esc(target(f, prefs))}</span></span>
            ${barHtml(f, fv, prefs, 'thin')}</span>`;
        }).join('')}</span>`;
    } else if (goals.length === 1) {
      const f = goals[0];
      const v = value(f);
      label = v == null ? `nothing logged today, goal ${target(f, prefs)}` : `${joinUnit(parts(f, v, prefs))} of ${target(f, prefs)}`;
      body = `${bigHtml(f, v, prefs, 'l', target(f, prefs))}${barHtml(f, v, prefs)}`;
    } else if (!entries.length || !primary) {
      body = `${bigHtml(primary || {}, null, prefs, 'l')}<span class="tile-sub">Tap to log</span>`;
    } else {
      const v = value(primary);
      const latest = entries[0];
      let sub = `${entries.length} logged · ${util.fmtTime(latest.timestamp)}`;
      if (primary.kind === 'scale') sub = `${primary.label} · ${util.fmtTime(latest.timestamp)}`;
      if (primary.kind === 'number' && primary.agg === 'last' && primary.dim) sub = weekChange(t, primary, v, prefs, today) || sub;
      label = joinUnit(parts(primary, v, prefs));
      body = `${bigHtml(primary, v, prefs, 'l')}<span class="tile-sub${sub.startsWith('↓') || sub.startsWith('↑') ? ' is-delta' : ''}">${esc(sub)}</span>`;
    }
    return {
      wide,
      html: `
        <button type="button" class="tile${wide ? ' tile-wide' : ''}" data-log="${esc(t.key)}" aria-label="${esc(`Log ${t.name}: ${label}`)}">
          ${top}${body}
        </button>`,
    };
  }

  // Full-width tiles wait until the half-width row they'd interrupt is complete,
  // so the two-column grid has no holes and reading order matches what's on screen
  function tilesHtml(trackers, byType, prefs, today) {
    const out = [];
    const waiting = [];
    let col = 0;
    for (const t of trackers.filter(x => x.kind !== 'workout' && x.kind !== 'checklist')) {
      const tile = tileHtml(t, byType(t.key), prefs, today);
      if (tile.wide) {
        if (col === 0) out.push(tile.html); else waiting.push(tile.html);
        continue;
      }
      out.push(tile.html);
      col = 1 - col;
      if (col === 0) out.push(...waiting.splice(0));
    }
    return [...out, ...waiting].join('');
  }

  // "↓ 0.6 lb this week": today's value against the last one logged 7+ days ago
  function weekChange(t, f, now, prefs, today) {
    const ref = repo.entries({ type: t.key }).find(e => e.dayKey <= util.addDays(today, -7) && e.values[f.key] != null);
    if (!ref || now == null) return null;
    const delta = util.round(units.display(f.dim, now, prefs) - units.display(f.dim, ref.values[f.key], prefs), 1);
    if (!delta) return 'No change this week';
    return `${delta < 0 ? '↓' : '↑'} ${util.fmtNum(Math.abs(delta), 1)} ${units.label(f.dim, prefs)} this week`;
  }

  /* ── Quick-add chips (water and any tracker with quick-add amounts) ── */
  function quickRowsHtml(trackers, prefs) {
    const rows = trackers.map(t => ({ t, qc: domain.quickChips(t, prefs) })).filter(x => x.qc);
    if (!rows.length) return '';
    return `<div class="quick-rows">${rows.map(({ t, qc }) => `
      <div class="quick-row">
        <span class="quick-lbl">${esc(t.name)}</span>
        <span class="chip-row">${qc.values.map(c => `<button type="button" class="add-chip" data-quick-t="${esc(t.key)}" data-quick="${c}"
          aria-label="Add ${c}${qc.unit ? ` ${esc(qc.unit)}` : ''} to ${esc(t.name)}">+${c}${qc.unit ? ` ${esc(qc.unit)}` : ''}</button>`).join('')}</span>
      </div>`).join('')}</div>`;
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
              <span class="check-box" aria-hidden="true">${e ? util.icon('check', 16) : ''}</span>
              <span class="check-text"><span class="check-name">${esc(i.name)}</span>
              ${sub ? `<span class="check-sub">${esc(sub)}</span>` : ''}</span>
            </button>
          </li>`;
      }).join('')}</ul>` : `
      <div class="empty-state compact"><strong>No daily items yet</strong>Add the supplements or meds you take each day, then tick them off here.</div>`;
    return `
      <section class="card list-card" aria-labelledby="supp-h">
        <div class="card-hdr list-hdr">
          <h2 id="supp-h" class="section-label">${esc(t.name)}${items.length ? ` · ${[...taken.keys()].filter(id => items.some(i => i.id === id)).length}/${items.length}` : ''}</h2>
          <button type="button" class="link-btn" data-act="manage-items">${items.length ? 'Edit' : '+ Add item'}</button>
        </div>
        ${list}
      </section>`;
  }

  /* ── Today's log ── */
  function logCardHtml(todays, prefs) {
    const rows = todays.filter(e => e.type !== 'supplements');
    return `
      <section class="card list-card" aria-labelledby="log-h">
        <div class="card-hdr list-hdr"><h2 id="log-h" class="section-label">Logged today</h2></div>
        ${rows.length ? `<ul class="log-list">${rows.map(e => {
          const t = repo.tracker(e.type);
          if (!t) return '';
          return `
            <li><button type="button" class="log-row" data-edit="${e.id}">
              <span class="icon-sq" aria-hidden="true">${util.trackerIcon(t, 18)}</span>
              <span class="log-main"><span class="log-name">${esc(t.kind === 'workout' ? e.values.name || t.name : t.name)}</span>
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
    if (HL.data.onClick(e)) return;
    const tile = e.target.closest('[data-log]');
    if (tile) { HL.entry.open(tile.dataset.log); return; }
    const quick = e.target.closest('[data-quick-t]');
    if (quick) {
      const t = repo.tracker(quick.dataset.quickT);
      const prefs = repo.getSettings().units;
      const f = domain.quickChips(t, prefs).field;
      HL.entry.quickLog(t.key, { [f.key]: units.fieldToCanonical(f, Number(quick.dataset.quick), prefs) });
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
    const btn = e.target.closest('[data-act]');
    switch (btn?.dataset.act) {
      case 'resume':
      case 'other-templates': HL.app.show('workout'); break;
      case 'start-next':      HL.workout.start(btn.dataset.id); break;
      case 'start-empty':     HL.workout.startEmpty(); break;
      case 'new-tracker':     HL.trackers.openBuilder(null); break;
      case 'edit-goals':      openGoalsSheet(); break;
      case 'manage-items':    openItemsSheet(); break;
    }
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
      if ((f.kind === 'number' || f.kind === 'duration') && !f.hidden && (f.agg === 'sum' || f.goal || !t.builtIn) && t.kind !== 'checklist') candidates.push({ t, f });
    }
    const unitOf = f => f.kind === 'duration' ? 'min' : f.dim ? units.label(f.dim, prefs) : (f.unit || '');
    const body = candidates.map(({ t, f }) => {
      const id = `g-${t.key}-${f.key}`;
      const val = f.goal ? util.round(shown(f, f.goal.target, prefs), f.dim ? 1 : 0) : '';
      return `
        <div class="field">
          <label class="field-label" for="${id}">${util.trackerIcon(t, 14)} ${esc(t.name)} · ${esc(f.label)}</label>
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
      title: 'Daily goals', icon: util.icon('target', 20), body,
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
          <button type="button" class="icon-btn" data-del-item="${i.id}" aria-label="Remove ${esc(i.name)}">${util.icon('close', 18)}</button>
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
      title: 'Supplements & meds', icon: util.icon('supplements', 20), body,
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
  HL.views.today = { stores: ['entries', 'trackers', 'checklistItems', 'presets', 'drafts', 'meta', 'templates', 'exercises'], render, onClick };
})(globalThis.HL = globalThis.HL || {});
