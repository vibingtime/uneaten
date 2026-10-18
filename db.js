// Tiny IndexedDB wrapper. Plain script so the service worker can read the
// same items when a reminder arrives.
//   'uneaten'.items:            {id, photo: Blob|null, note, category, shelf, expires: 'YYYY-MM-DD', added: ms}
//   'uneaten-kinds'.categories: {id, label, icon, keeps: 'days'|'weeks'|'months', shelf}  (the user's own kinds)
//   'uneaten-sound'.sound:      {id: 'door', blob, name}  (the door sound the user chose)
//
// Each database is opened without asking for a newer version, so a copy of
// the app still running in another tab can never block it. Changing a
// version would wait until every old tab closed, and every save would hang.
globalThis.DB = (() => {
  const opening = {};

  function open(name, store, version) {
    opening[name] ??= new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      // Only runs when the database is first created.
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // If a later version ever does need an upgrade, step aside for it.
        db.onversionchange = () => {
          db.close();
          delete opening[name];
        };
        resolve(db);
      };
      req.onerror = () => {
        delete opening[name];
        reject(req.error);
      };
    });
    return opening[name];
  }

  async function run(name, store, mode, fn) {
    const db = await open(name, store);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const items = (mode, fn) => run('uneaten', 'items', mode, fn);
  const kinds = (mode, fn) => run('uneaten-kinds', 'categories', mode, fn);
  const sound = (mode, fn) => run('uneaten-sound', 'sound', mode, fn);

  // A short-lived build kept kinds in the 'uneaten' database itself; read
  // those too so nothing saved then goes missing.
  async function legacyKinds() {
    const db = await open('uneaten', 'items');
    if (!db.objectStoreNames.contains('categories')) return [];
    return new Promise((resolve) => {
      const req = db.transaction('categories', 'readonly').objectStore('categories').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
  }

  return {
    all: () => items('readonly', (s) => s.getAll()),
    put: (item) => items('readwrite', (s) => s.put(item)),
    remove: (id) => items('readwrite', (s) => s.delete(id)),
    categories: async () => {
      const [mine, old] = await Promise.all([kinds('readonly', (s) => s.getAll()), legacyKinds()]);
      const ids = new Set(mine.map((c) => c.id));
      return [...mine, ...old.filter((c) => !ids.has(c.id))];
    },
    putCategory: (c) => kinds('readwrite', (s) => s.put(c)),
    doorSound: () => sound('readonly', (s) => s.get('door')),
    putDoorSound: (blob, name) => sound('readwrite', (s) => s.put({ id: 'door', blob, name })),
    removeCategory: async (id) => {
      await kinds('readwrite', (s) => s.delete(id));
      const db = await open('uneaten', 'items');
      if (db.objectStoreNames.contains('categories')) {
        db.transaction('categories', 'readwrite').objectStore('categories').delete(id);
      }
    },
  };
})();
