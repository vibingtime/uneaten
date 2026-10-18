// Tiny IndexedDB wrapper. Plain script so the service worker can read the
// same items when a reminder arrives. Item: {id, photo: Blob|null, note,
// expires: 'YYYY-MM-DD', added: ms}.
globalThis.DB = (() => {
  let opening;

  function open() {
    opening ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('uneaten', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', mode);
      const req = fn(tx.objectStore('items'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    all: () => run('readonly', (s) => s.getAll()),
    put: (item) => run('readwrite', (s) => s.put(item)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
  };
})();
