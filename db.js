// Tiny IndexedDB wrapper. Plain script so the service worker can read the
// same items when a reminder arrives.
//   items:      {id, photo: Blob|null, note, category, shelf, expires: 'YYYY-MM-DD', added: ms}
//   categories: {id, label, icon, keeps: 'days'|'weeks'|'months', shelf}  (the user's own kinds)
globalThis.DB = (() => {
  let opening;

  function open() {
    opening ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('uneaten', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['items', 'categories']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer copy of the app (another tab, the service worker) upgrade.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    });
    return opening;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    all: () => run('items', 'readonly', (s) => s.getAll()),
    put: (item) => run('items', 'readwrite', (s) => s.put(item)),
    remove: (id) => run('items', 'readwrite', (s) => s.delete(id)),
    categories: () => run('categories', 'readonly', (s) => s.getAll()),
    putCategory: (c) => run('categories', 'readwrite', (s) => s.put(c)),
    removeCategory: (id) => run('categories', 'readwrite', (s) => s.delete(id)),
  };
})();
