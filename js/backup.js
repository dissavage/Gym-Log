/* ════════════════════════════════════
   BACKUP — pure: build / validate / diff backups, and CSV export
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { schema, units, domain, util } = HL;
  const APP_TAG = 'healthlog';

  /* ════════════════════════════════════
     BUILD
     ════════════════════════════════════ */
  // stores: { storeName: [records incl. soft-deleted] }
  function buildBackup(stores, settings, exportedAt = new Date().toISOString()) {
    const out = { app: APP_TAG, schemaVersion: schema.SCHEMA_VERSION, exportedAt, settings, stores: {} };
    for (const s of schema.DATA_STORES) out.stores[s] = stores[s] || [];
    return out;
  }

  const countRecords = stores => Object.values(stores).reduce((n, list) => n + list.length, 0);

  /* ════════════════════════════════════
     VALIDATE
     ════════════════════════════════════ */
  // Returns { snapshot, errors }. snapshot is migrated to the current schema.
  function validateBackup(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['This file isn’t a Health Log backup.'] };
    if (data.app === 'gym-tracker-legacy') return { errors: ['This is an old Gym Tracker export — use “Import from old Gym Tracker” instead.'] };
    if (data.app !== APP_TAG) return { errors: ['This file isn’t a Health Log backup.'] };
    if (!Number.isInteger(data.schemaVersion)) return { errors: ['The backup is missing its version number.'] };
    if (data.schemaVersion > schema.SCHEMA_VERSION) {
      return { errors: [`This backup is from a newer version of Health Log (v${data.schemaVersion}). Update the app, then import it.`] };
    }
    if (!data.stores || typeof data.stores !== 'object') return { errors: ['The backup has no data in it.'] };

    const clean = {};
    let bad = 0;
    for (const s of schema.DATA_STORES) {
      const list = data.stores[s] ?? [];
      if (!Array.isArray(list)) { errors.push(`“${s}” isn’t a list.`); continue; }
      clean[s] = list.filter(r => {
        const ok = r && typeof r === 'object' && typeof r.id === 'string' && r.id && typeof r.type === 'string' && typeof r.updatedAt === 'string';
        if (!ok) bad++;
        return ok;
      });
    }
    for (const e of clean.entries || []) {
      if (typeof e.dayKey !== 'string' || typeof e.timestamp !== 'string' || !e.values || typeof e.values !== 'object') {
        errors.push('Some entries are missing their date or values.');
        break;
      }
    }
    if (errors.length) return { errors };

    let snapshot;
    try {
      snapshot = schema.runMigrations({ schemaVersion: data.schemaVersion, stores: clean });
    } catch (err) {
      return { errors: [err.message] };
    }
    return { snapshot, settings: data.settings || null, skippedInvalid: bad, errors: [] };
  }

  /* ════════════════════════════════════
     DIFF — never a blind overwrite
     ════════════════════════════════════ */
  /**
   * existing / incoming: { storeName: [records] }
   * A record is new when its id is unknown and (if it came from another app) its source key is too;
   * it updates when the incoming copy has a newer updatedAt; otherwise it's a duplicate.
   * Returns { add: [{store, record}], update: [...], duplicates, byStore: { s: {add, update, duplicates} } }
   */
  function diffImport(existing, incoming) {
    const result = { add: [], update: [], duplicates: 0, byStore: {} };
    for (const s of schema.DATA_STORES) {
      const have = new Map((existing[s] || []).map(r => [r.id, r]));
      const sourceKeys = new Set((existing[s] || []).filter(r => r.source?.key).map(r => `${r.source.app}:${r.source.key}`));
      const tally = { add: 0, update: 0, duplicates: 0 };
      for (const r of incoming[s] || []) {
        const mine = have.get(r.id);
        if (mine) {
          if (r.updatedAt > mine.updatedAt) { result.update.push({ store: s, record: r }); tally.update++; }
          else { result.duplicates++; tally.duplicates++; }
        } else if (r.source?.key && sourceKeys.has(`${r.source.app}:${r.source.key}`)) {
          result.duplicates++; tally.duplicates++;
        } else {
          result.add.push({ store: s, record: r }); tally.add++;
        }
      }
      result.byStore[s] = tally;
    }
    return result;
  }

  /* ════════════════════════════════════
     CSV
     ════════════════════════════════════ */
  // Text that a spreadsheet would run as a formula (=, +, -, @) gets a leading ' — numbers never do
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const csvLine = cells => cells.map(csvCell).join(',');

  function displayNumber(field, v, prefs) {
    if (v == null || v === '') return '';
    if (field.kind === 'bool') return v ? 'yes' : 'no';
    if (field.dim) return units.display(field.dim, v, prefs, 3);
    return v;
  }

  function columnName(field, prefs) {
    if (field.kind === 'duration') return `${field.label} (min)`;
    if (field.dim) return `${field.label} (${units.label(field.dim, prefs)})`;
    return field.unit ? `${field.label} (${field.unit})` : field.label;
  }

  // One row per entry; workouts get one row per set. Values in display units, with units in headers.
  function trackerCSV(tracker, entries, prefs, exerciseName = id => id) {
    const sorted = [...entries].filter(e => !e.deletedAt).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    if (tracker.kind === 'workout') {
      const w = units.label('mass', prefs);
      const rows = [csvLine(['date', 'time', 'workout', 'exercise', 'set', 'set type', `weight (${w})`, 'reps', 'rpe', 'rir', 'est 1rm (' + w + ')', 'notes'])];
      for (const e of sorted) {
        for (const ex of e.values.exercises || []) {
          ex.sets.forEach((s, i) => {
            const est = domain.e1rm(s.weightKg || 0, s.reps);
            rows.push(csvLine([e.dayKey, util.toInputDateTime(e.timestamp).slice(11), e.values.name, exerciseName(ex.exerciseId), i + 1, s.setType,
              s.weightKg != null ? units.display('mass', s.weightKg, prefs, 2) : '', s.reps, s.rpe, s.rir,
              est ? units.display('mass', est, prefs, 1) : '', ex.notes || '']));
          });
        }
      }
      return rows.join('\r\n');
    }
    const fields = tracker.fields;
    const rows = [csvLine(['date', 'time', ...fields.map(f => columnName(f, prefs)), 'notes'])];
    for (const e of sorted) {
      const values = domain.withComputed(tracker, e.values);
      rows.push(csvLine([e.dayKey, util.toInputDateTime(e.timestamp).slice(11), ...fields.map(f => displayNumber(f, values[f.key], prefs)), e.notes || '']));
    }
    return rows.join('\r\n');
  }

  HL.backup = { APP_TAG, buildBackup, countRecords, validateBackup, diffImport, csvCell, trackerCSV };
})(globalThis.HL = globalThis.HL || {});
