/* ════════════════════════════════════
   DB — thin promise wrapper over IndexedDB (the only file that touches IDB)
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { DB_NAME, DB_VERSION, STORES } = HL.schema;
  let dbPromise = null;

  const reqDone = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const txDone = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });

  function upgrade(db, tx) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.objectStoreNames.contains(name)
        ? tx.objectStore(name)
        : db.createObjectStore(name, { keyPath: def.keyPath });
      for (const [idx, path, opts] of def.indexes) {
        if (!os.indexNames.contains(idx)) os.createIndex(idx, path, opts || {});
      }
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('IndexedDB is not available in this browser')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result, req.transaction);
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgraded the schema: close so it isn't blocked, and reload into the new version
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked — close other Health Log tabs'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  async function getAll(store) {
    const db = await open();
    return reqDone(db.transaction(store).objectStore(store).getAll());
  }

  // ops: [{ store, op: 'put' | 'delete' | 'clear', value | key }] — applied in one transaction
  async function write(ops) {
    const db = await open();
    const names = [...new Set(ops.map(o => o.store))];
    const tx = db.transaction(names, 'readwrite');
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      if (o.op === 'put') os.put(o.value);
      else if (o.op === 'delete') os.delete(o.key);
      else if (o.op === 'clear') os.clear();
    }
    return txDone(tx);
  }

  async function deleteDatabase() {
    if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Close other Health Log tabs, then try again'));
    });
  }

  HL.db = { open, getAll, write, deleteDatabase };
})(globalThis.HL = globalThis.HL || {});
