/* ════════════════════════════════════
   DATA — backup / restore, CSV, storage persistence, wipe, install hint
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, repo, backup, schema } = HL;
  const { esc } = util;
  const REMIND_DAYS = 14;
  const SNOOZE_DAYS = 3;
  const INSTALL_DISMISS_KEY = 'healthlog.installHintDismissed';

  /* ════════════════════════════════════
     FILE OUT — share sheet on iPhone, download elsewhere
     ════════════════════════════════════ */
  // Resolves true once the file was handed off; false if the person cancelled the share sheet
  async function deliver(filename, text, mime) {
    const file = new File([text], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false;
        // Some browsers refuse share outside certain contexts; fall back to a download
      }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  async function exportBackup() {
    const data = backup.buildBackup(repo.snapshot(), repo.getSettings());
    const n = backup.countRecords(data.stores);
    const ok = await deliver(`healthlog-backup-${util.dayKey()}.json`, JSON.stringify(data), 'application/json');
    if (!ok) return;
    repo.setMeta('lastExportAt', new Date().toISOString());
    HL.toast(`Backup saved · ${n.toLocaleString()} records`);
  }

  function openCSV() {
    const prefs = repo.getSettings().units;
    const trackers = repo.trackers({ archived: true }).filter(t => repo.entries({ type: t.key }).length);
    if (!trackers.length) { HL.toast('Nothing to export yet', { kind: 'info' }); return; }
    HL.sheet.open({
      title: 'Export CSV', icon: util.icon('file', 20),
      body: `
        <p class="field-hint block-gap">One spreadsheet per tracker, in your display units. Workouts export one row per set.</p>
        <div class="menu-list">${trackers.map(t => `
          <button type="button" class="menu-item" data-csv="${esc(t.key)}">${util.trackerIcon(t, 18)} ${esc(t.name)}
            <span class="muted small">· ${repo.entries({ type: t.key }).length} logs</span></button>`).join('')}</div>`,
      onMount: api => api.form.addEventListener('click', async e => {
        const btn = e.target.closest('[data-csv]');
        if (!btn) return;
        const t = repo.tracker(btn.dataset.csv);
        const name = id => repo.get('exercises', id)?.name || id;
        const csv = backup.trackerCSV(t, repo.entries({ type: t.key }), prefs, name);
        const slug = HL.domain.slugify(t.name).replace(/_/g, '-');
        if (await deliver(`healthlog-${slug}-${util.dayKey()}.csv`, csv, 'text/csv')) HL.toast(`${t.name} exported`);
      }),
    });
  }

  /* ════════════════════════════════════
     IMPORT — validate → preview → confirm
     ════════════════════════════════════ */
  const STORE_NAMES = {
    entries: 'logs', trackers: 'trackers', exercises: 'exercises', templates: 'templates',
    presets: 'quick picks', checklistItems: 'checklist items', drafts: 'workouts in progress',
  };

  function pickFile(onText) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try { onText(await file.text(), file.name); }
      catch { HL.toast('Couldn’t read that file', { kind: 'error' }); }
    });
    input.click();
  }

  function importText(text) {
    let data;
    try { data = JSON.parse(text); } catch { HL.toast('That file isn’t valid JSON', { kind: 'error' }); return; }
    const v = backup.validateBackup(data);
    if (v.errors.length) { HL.toast(v.errors.join(' '), { kind: 'error', duration: 7000 }); return; }
    previewImport(v, data.exportedAt);
  }

  const startImport = () => pickFile(importText);

  function previewImport(v, exportedAt) {
    const diff = backup.diffImport(repo.snapshot(), v.snapshot.stores);
    const rows = Object.entries(diff.byStore).filter(([, t]) => t.add || t.update || t.duplicates);
    const nothing = !diff.add.length && !diff.update.length;
    const body = `
      <p class="block-gap">Backup from <b>${esc(exportedAt ? new Date(exportedAt).toLocaleString() : 'an unknown date')}</b>.</p>
      <div class="stat-grid three">
        <div class="stat"><span class="stat-lbl">New</span><span class="stat-val">${diff.add.length.toLocaleString()}</span></div>
        <div class="stat"><span class="stat-lbl">Newer copies</span><span class="stat-val">${diff.update.length.toLocaleString()}</span></div>
        <div class="stat"><span class="stat-lbl">Already here</span><span class="stat-val">${diff.duplicates.toLocaleString()}</span></div>
      </div>
      <p class="block-gap">${nothing ? 'Everything in this backup is already in the app — nothing to import.'
        : `This will add <b>${diff.add.length.toLocaleString()}</b> record${diff.add.length === 1 ? '' : 's'}${diff.update.length ? ` and update <b>${diff.update.length}</b> that changed since` : ''}. <b>${diff.duplicates.toLocaleString()}</b> duplicate${diff.duplicates === 1 ? '' : 's'} will be skipped. Nothing here gets deleted.`}</p>
      ${rows.length ? `<div class="table-wrap block-gap"><table class="mini-table"><thead><tr><th scope="col">Type</th><th scope="col">New</th><th scope="col">Updated</th><th scope="col">Skipped</th></tr></thead>
        <tbody>${rows.map(([s, t]) => `<tr><th scope="row">${esc(STORE_NAMES[s] || s)}</th><td>${t.add}</td><td>${t.update}</td><td>${t.duplicates}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${v.skippedInvalid ? `<p class="field-hint">${v.skippedInvalid} damaged record${v.skippedInvalid === 1 ? '' : 's'} in the file will be ignored.</p>` : ''}
      ${v.settings && !nothing ? '<label class="check-inline"><input type="checkbox" name="withSettings" checked> Also restore settings (units, rest timer, targets)</label>' : ''}`;
    HL.sheet.open({
      title: 'Import backup', icon: util.icon('upload', 20), body,
      footer: nothing ? '<button type="submit" class="btn btn-ghost">Close</button>'
        : `<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button><button type="submit" class="btn btn-primary">Import</button>`,
      onMount: api => api.form.addEventListener('click', e => { if (e.target.closest('[data-act="cancel"]')) api.close(); }),
      onSubmit: async (form, api) => {
        if (nothing) { api.close(); return; }
        const withSettings = form.elements.withSettings?.checked;
        api.close();
        repo.importRecords([...diff.add, ...diff.update]);
        if (withSettings) repo.setSettings(v.settings);
        try {
          await repo.flushNow();
          HL.toast(`Imported ${(diff.add.length + diff.update.length).toLocaleString()} records`);
        } catch {
          HL.toast('Imported into memory, but saving to storage is still retrying', { kind: 'error' });
        }
      },
    });
  }

  /* ════════════════════════════════════
     STORAGE & WIPE
     ════════════════════════════════════ */
  // Ask the browser not to evict our data under storage pressure
  async function requestPersist() {
    if (!navigator.storage?.persist) return null;
    try {
      return (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch { return null; }
  }

  async function storageStatus() {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  }

  function fmtBytes(b) {
    if (b < 1024 ** 2) return `${Math.max(1, Math.round(b / 1024))} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(1)} GB`;
  }

  async function fillStorage(el) {
    const s = await storageStatus();
    if (!el.isConnected) return;
    el.querySelector('[data-storage="persist"]').textContent = s.persisted == null
      ? 'Not supported by this browser — keep regular backups.'
      : s.persisted ? '✓ Protected: the browser won’t clear it to free space.' : '⚠ Not protected yet — the browser may clear it if storage runs low. Install the app and keep backups.';
    el.querySelector('[data-storage="usage"]').textContent = s.usage == null ? '' : `Using ${fmtBytes(s.usage)}${s.quota ? ` of ${fmtBytes(s.quota)} available` : ''}.`;
    el.querySelector('[data-act="persist"]').hidden = s.persisted !== false;
  }

  function openWipe() {
    HL.sheet.open({
      title: 'Delete all data', icon: util.icon('alert', 20),
      body: `
        <p class="block-gap">This permanently deletes every log, tracker, exercise, template and setting in Health Log on this device. It can’t be undone.</p>
        <p class="block-gap"><b>Export a backup first</b> if you might want any of it back. Your old Gym Tracker app isn’t touched.</p>
        <div class="field"><label class="field-label" for="wipe-confirm">Type DELETE to confirm</label>
          <input class="input" id="wipe-confirm" name="confirm" autocomplete="off" autocapitalize="characters"></div>
        <p class="field-hint" id="wipe-err" role="alert"></p>`,
      footer: '<button type="button" class="btn btn-ghost" data-act="backup">Back up first</button><button type="submit" class="btn btn-danger">Delete everything</button>',
      onMount: api => api.form.addEventListener('click', e => { if (e.target.closest('[data-act="backup"]')) exportBackup(); }),
      onSubmit: async form => {
        if (form.elements.confirm.value.trim() !== 'DELETE') { form.querySelector('#wipe-err').textContent = 'Type DELETE (in capitals) to confirm.'; return; }
        try {
          await repo.wipe();
          if (window.caches) for (const k of await caches.keys()) if (k.startsWith('healthlog-')) await caches.delete(k);
          location.reload();
        } catch (err) {
          form.querySelector('#wipe-err').textContent = `Couldn’t delete: ${err.message}`;
        }
      },
    });
  }

  /* ════════════════════════════════════
     SETTINGS SECTION & REMINDERS
     ════════════════════════════════════ */
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function sectionHtml() {
    const last = repo.getMeta('lastExportAt');
    return `
      <section class="settings-section" aria-labelledby="data-h">
        <h2 class="section-label" id="data-h">Your data</h2>
        <div class="settings-card">
          <button type="button" class="settings-row settings-link" data-act="export">
            <span><span class="settings-lbl">Back up everything</span><span class="settings-sub">${last ? `Last backup ${esc(new Date(last).toLocaleDateString())}` : 'No backup yet'} · JSON file</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('upload', 18)}</span></button>
          <button type="button" class="settings-row settings-link" data-act="import">
            <span><span class="settings-lbl">Restore from backup</span><span class="settings-sub">Shows what will be added before importing</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('download', 18)}</span></button>
          <button type="button" class="settings-row settings-link" data-act="csv">
            <span><span class="settings-lbl">Export CSV</span><span class="settings-sub">Per tracker, for spreadsheets</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('chev-right', 18)}</span></button>
          <button type="button" class="settings-row settings-link" data-act="legacy">
            <span><span class="settings-lbl">Import from old Gym Tracker</span><span class="settings-sub">Workouts, bodyweight, macros and splits</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('chev-right', 18)}</span></button>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="stor-h">
        <h2 class="section-label" id="stor-h">Storage</h2>
        <div class="settings-card"><div class="settings-row stack" id="storage-box">
          <p class="small" data-storage="persist">Checking…</p>
          <p class="settings-sub" data-storage="usage"></p>
          <button type="button" class="btn btn-ghost btn-sm" data-act="persist" hidden>Ask to protect my data</button>
          ${isIOS() && !isStandalone() ? `<p class="small notice-text">📲 On iPhone, install Health Log: tap Share, then <b>Add to Home Screen</b>. The installed app keeps its own data, separate from Safari — install first, then import.</p>` : ''}
        </div></div>
      </section>
      ${demoHtml()}
      <section class="settings-section" aria-labelledby="danger-h">
        <h2 class="section-label danger-label" id="danger-h">Danger zone</h2>
        <button type="button" class="btn btn-danger btn-block" data-act="wipe">Delete all data…</button>
      </section>
      <p class="field-hint about">Health Log · data schema v${schema.SCHEMA_VERSION} · everything stays on this device</p>`;
  }

  /* ════════════════════════════════════
     DEMO DATA — clearly labelled, removable in one tap
     ════════════════════════════════════ */
  const demoRecords = () => ['entries', 'checklistItems'].flatMap(store =>
    repo.all(store, { deleted: true }).filter(HL.demo.isDemo).map(record => ({ store, record })));

  function demoHtml() {
    const n = demoRecords().filter(x => x.store === 'entries').length;
    return `
      <section class="settings-section" aria-labelledby="demo-h">
        <h2 class="section-label" id="demo-h">Demo data</h2>
        <div class="settings-card">
          ${n ? `
          <button type="button" class="settings-row settings-link" data-act="demo-remove">
            <span><span class="settings-lbl">Remove demo data</span><span class="settings-sub">${n.toLocaleString()} sample logs — your own logs stay</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('close', 18)}</span></button>` : `
          <button type="button" class="settings-row settings-link" data-act="demo-load">
            <span><span class="settings-lbl">Load demo data</span><span class="settings-sub">6 months of sample logs to explore the charts</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('chev-right', 18)}</span></button>`}
        </div>
      </section>`;
  }

  function openLoadDemo() {
    const real = repo.entries().filter(e => !HL.demo.isDemo(e)).length;
    HL.sheet.open({
      title: 'Load demo data', icon: util.icon('flask', 20),
      body: `
        <p class="block-gap">Adds about 6 months of made-up workouts, weigh-ins, meals, sleep and more — each one marked as demo — so you can see how the charts and PRs look with real history.</p>
        ${real ? `<p class="notice">${util.icon('alert', 18)}<span>You already have ${real.toLocaleString()} log${real === 1 ? '' : 's'} of your own. Demo logs will mix into your charts until you remove them (More → Remove demo data). Your own logs are never touched.</span></p>` : ''}`,
      footer: '<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button><button type="submit" class="btn btn-primary">Load demo data</button>',
      onMount: api => api.form.addEventListener('click', e => { if (e.target.closest('[data-act="cancel"]')) api.close(); }),
      onSubmit: async (form, api) => {
        api.close();
        const { entries, checklistItems } = HL.demo.generateDemo();
        repo.importRecords([...checklistItems.map(record => ({ store: 'checklistItems', record })), ...entries.map(record => ({ store: 'entries', record }))]);
        await repo.flushNow().catch(() => {});
        HL.toast(`Loaded ${entries.length.toLocaleString()} demo logs — remove them anytime from More`);
      },
    });
  }

  async function removeDemo() {
    const items = demoRecords();
    for (const { store, record } of items) repo.hardDelete(store, record.id);
    await repo.flushNow().catch(() => {});
    HL.toast(`Removed ${items.filter(x => x.store === 'entries').length.toLocaleString()} demo logs`);
  }

  // Returns true when the click was handled here
  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'export': exportBackup(); return true;
      case 'import': startImport(); return true;
      case 'csv': openCSV(); return true;
      case 'legacy': HL.legacyImport.open(); return true;
      case 'wipe': openWipe(); return true;
      case 'demo-load': openLoadDemo(); return true;
      case 'demo-remove': removeDemo(); return true;
      case 'persist':
        requestPersist().then(() => fillStorage(document.getElementById('storage-box')));
        return true;
      case 'snooze-backup':
        repo.setMeta('backupSnoozeUntil', util.addDays(util.dayKey(), SNOOZE_DAYS));
        return true;
      case 'install-dismiss':
        try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* private mode */ }
        HL.app.markDirty(null);
        return true;
      default: return false;
    }
  }

  // Today banner: no backup in 14+ days (counted from the first log if never exported)
  function reminderHtml() {
    const entries = repo.entries().filter(e => !HL.demo.isDemo(e));
    if (!entries.length) return '';
    const today = util.dayKey();
    const snooze = repo.getMeta('backupSnoozeUntil');
    if (snooze && snooze > today) return '';
    const last = repo.getMeta('lastExportAt');
    const since = last ? util.dayKeyOf(last) : entries[entries.length - 1].dayKey;
    const days = util.daysBetween(since, today);
    if (days < REMIND_DAYS) return '';
    return `
      <div class="nudge" role="note">
        <span aria-hidden="true">💾</span>
        <span class="grow">${last ? `It’s been ${days} days since your last backup.` : 'You haven’t backed up yet.'} Save a copy somewhere safe (Files, iCloud Drive, email).</span>
        <span class="nudge-acts">
          <button type="button" class="link-btn" data-act="export">Back up</button>
          <button type="button" class="link-btn" data-act="snooze-backup">Later</button>
        </span>
      </div>`;
  }

  function installHintHtml() {
    let dismissed = false;
    try { dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch { /* private mode */ }
    if (dismissed || !isIOS() || isStandalone()) return '';
    return `
      <div class="nudge" role="note">
        <span aria-hidden="true">📲</span>
        <span class="grow">Install Health Log for offline use and safer storage: tap <b>Share</b>, then <b>Add to Home Screen</b>. The installed app has its own separate data.</span>
        <button type="button" class="link-btn" data-act="install-dismiss">Dismiss</button>
      </div>`;
  }

  HL.data = { sectionHtml, onClick, fillStorage, requestPersist, reminderHtml, installHintHtml, pickFile };
})(globalThis.HL = globalThis.HL || {});
