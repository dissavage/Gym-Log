/* ════════════════════════════════════
   REPO — in-memory cache over IndexedDB
   Reads are synchronous from memory. Writes update memory first, then queue to IDB;
   a failed write stays queued (and retried) so data is never silently dropped.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { db, schema, util, units } = HL;
  const PURGE_AFTER_DAYS = 30;

  const cache = Object.fromEntries(Object.keys(schema.STORES).map(s => [s, new Map()]));
  const bus = new EventTarget();
  const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));
  const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

  /* ════════════════════════════════════
     WRITE QUEUE
     ════════════════════════════════════ */
  const pending = new Map();   // "store/id" → op; later writes to the same record supersede earlier ones
  let flushTimer = null;
  let flushing = null;
  let retryDelay = 0;
  let failing = false;

  function enqueue(op) {
    pending.set(`${op.store}/${op.key ?? op.value[schema.STORES[op.store].keyPath]}`, op);
    scheduleFlush(0);
  }

  function scheduleFlush(delay) {
    if (flushTimer || flushing) return;
    flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (flushing) return flushing;
    if (!pending.size) return;
    const batch = [...pending.entries()];
    pending.clear();
    flushing = db.write(batch.map(([, op]) => op)).then(() => {
      if (failing) { failing = false; retryDelay = 0; emit('writestatus', { ok: true, pending: 0 }); }
    }, err => {
      for (const [k, op] of batch) if (!pending.has(k)) pending.set(k, op);
      retryDelay = retryDelay ? Math.min(retryDelay * 2, 30000) : 2000;
      failing = true;
      emit('writestatus', { ok: false, pending: pending.size, error: err });
    }).finally(() => {
      flushing = null;
      if (pending.size) scheduleFlush(failing ? retryDelay : 0);
    });
    return flushing;
  }

  // Resolves once everything queued so far is on disk; rejects if the write fails
  async function flushNow() {
    while (pending.size || flushing) {
      await (flushing || flush());
      if (failing) throw new Error('Some changes could not be saved yet');
    }
  }

  const pendingCount = () => pending.size;

  /* ════════════════════════════════════
     RECORDS
     ════════════════════════════════════ */
  const nowUTC = () => new Date().toISOString();

  function make(type, props = {}) {
    const t = nowUTC();
    return {
      id: util.uuid(), type, timestamp: util.localISO(), createdAt: t, updatedAt: t,
      deletedAt: null, notes: '', source: null, ...props,
    };
  }

  function newEntry(trackerKey, values, { when, notes = '' } = {}) {
    const d = when ? new Date(when) : new Date();
    return make(trackerKey, { timestamp: util.localISO(d), dayKey: util.dayKey(d), tz: util.tzName(), values, notes });
  }

  const get = (store, id) => cache[store].get(id) || null;

  function all(store, { deleted = false } = {}) {
    const out = [];
    for (const r of cache[store].values()) if (deleted || !r.deletedAt) out.push(r);
    return out;
  }

  function put(store, record, { touch = true } = {}) {
    const rec = touch ? { ...record, updatedAt: nowUTC() } : record;
    cache[store].set(rec[schema.STORES[store].keyPath], rec);
    enqueue({ store, op: 'put', value: rec });
    emit('change', { store, record: rec });
    return rec;
  }

  function softDelete(store, id) {
    const rec = get(store, id);
    if (!rec) return null;
    return put(store, { ...rec, deletedAt: nowUTC() });
  }

  function restore(store, id) {
    const rec = get(store, id);
    if (!rec) return null;
    return put(store, { ...rec, deletedAt: null });
  }

  function hardDelete(store, id) {
    const rec = get(store, id);
    cache[store].delete(id);
    enqueue({ store, op: 'delete', key: id });
    emit('change', { store, record: rec, removed: true });
  }

  /* ── Backup support ── */
  // Every data store, soft-deleted rows included, so a restore also restores deletions
  function snapshot() {
    const stores = {};
    for (const s of schema.DATA_STORES) stores[s] = all(s, { deleted: true });
    return stores;
  }

  // Imported records keep their own timestamps so later imports can tell what's newer
  function importRecords(items) {
    for (const { store, record } of items) put(store, record, { touch: false });
  }

  // Deletes only this app's storage: the healthlog database and healthlog.* settings
  async function wipe() {
    pending.clear();
    clearTimeout(flushTimer);
    flushTimer = null;
    await db.deleteDatabase();
    for (const k of Object.keys(localStorage)) if (k.startsWith('healthlog.')) localStorage.removeItem(k);
  }

  /* ── Lookups ── */
  function tracker(key) {
    for (const t of cache.trackers.values()) if (t.key === key) return t;
    return null;
  }

  const trackers = ({ archived = false } = {}) =>
    all('trackers').filter(t => archived || !t.archived).sort((a, b) => a.order - b.order);

  function entries({ type, dayKey } = {}) {
    const out = [];
    for (const e of cache.entries.values()) {
      if (e.deletedAt) continue;
      if (type && e.type !== type) continue;
      if (dayKey && e.dayKey !== dayKey) continue;
      out.push(e);
    }
    return out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  const lastEntry = type => entries({ type })[0] || null;

  const getMeta = key => cache.meta.get(key)?.value;
  const setMeta = (key, value) => put('meta', { key, value }, { touch: false });

  /* ════════════════════════════════════
     BOOT
     ════════════════════════════════════ */
  async function boot() {
    for (const store of Object.keys(schema.STORES)) {
      const rows = await db.getAll(store);
      cache[store] = new Map(rows.map(r => [r[schema.STORES[store].keyPath], r]));
    }

    const version = getMeta('schemaVersion');
    if (version == null) {
      setMeta('schemaVersion', schema.SCHEMA_VERSION);
    } else if (version < schema.SCHEMA_VERSION) {
      await migrateStored(version);
    } else if (version > schema.SCHEMA_VERSION) {
      throw new Error('Your data was saved by a newer version of Health Log. Reload to update the app.');
    }

    seedBuiltins();
    purgeDeleted();
    await flushNow();
  }

  async function migrateStored(from) {
    const snapshot = { schemaVersion: from, stores: {} };
    for (const s of schema.DATA_STORES) snapshot.stores[s] = all(s, { deleted: true });
    const next = schema.runMigrations(snapshot);
    const ops = [];
    for (const s of schema.DATA_STORES) {
      ops.push({ store: s, op: 'clear' });
      cache[s] = new Map();
      for (const r of next.stores[s] || []) { cache[s].set(r.id, r); ops.push({ store: s, op: 'put', value: r }); }
    }
    cache.meta.set('schemaVersion', { key: 'schemaVersion', value: next.schemaVersion });
    ops.push({ store: 'meta', op: 'put', value: { key: 'schemaVersion', value: next.schemaVersion } });
    await db.write(ops);
  }

  // Adds built-ins that don't exist yet; never overwrites user edits (goals, order, archive, renames).
  // Seeds carry a fixed old timestamp so, when a backup is restored onto a fresh install,
  // any edited copy in the backup counts as newer and wins.
  const SEED_TIME = '2000-01-01T00:00:00.000Z';

  function seedBuiltins() {
    const seed = (store, type, def) => {
      if (!cache[store].has(def.id)) put(store, { ...make(type, def), createdAt: SEED_TIME, updatedAt: SEED_TIME }, { touch: false });
    };
    for (const def of schema.BUILTIN_TRACKERS) seed('trackers', 'tracker', def);
    for (const def of schema.BUILTIN_EXERCISES) seed('exercises', 'exercise', def);
  }

  function purgeDeleted() {
    const cutoff = Date.now() - PURGE_AFTER_DAYS * 86400000;
    for (const store of schema.DATA_STORES) {
      for (const r of [...cache[store].values()]) {
        if (r.deletedAt && Date.parse(r.deletedAt) < cutoff) hardDelete(store, r.id);
      }
    }
  }

  /* ════════════════════════════════════
     SETTINGS — small, synchronous, so localStorage (namespaced away from the old app)
     ════════════════════════════════════ */
  const SETTINGS_KEY = 'healthlog.settings';
  const DEFAULTS = { units: { ...units.SYSTEMS.imperial }, effort: 'rpe', weekStart: 1, restSec: 90, plateStep: 'standard', theme: 'dark' };
  let settings = loadSettings();

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { ...DEFAULTS, ...saved, units: { ...DEFAULTS.units, ...(saved.units || {}) } };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  const getSettings = () => settings;

  function setSettings(patch) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      emit('error', { message: 'Settings could not be saved on this device', error: err });
    }
    emit('settings', settings);
  }

  HL.repo = {
    on, boot, flush, flushNow, pendingCount,
    make, newEntry, get, all, put, softDelete, restore, hardDelete, snapshot, importRecords, wipe,
    tracker, trackers, entries, lastEntry, getMeta, setMeta,
    getSettings, setSettings,
  };
})(globalThis.HL = globalThis.HL || {});
