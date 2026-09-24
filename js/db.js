/* IndexedDB 封装：偏好设置 + 最近朗读记录 */
const DB = (() => {
  const DB_NAME = 'tts-reader';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('prefs')) {
          db.createObjectStore('prefs', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('history')) {
          const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      fn(t.objectStore(store));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async savePrefs(prefs) {
      const db = await open();
      return tx(db, 'prefs', 'readwrite', (s) => s.put({ key: 'prefs', ...prefs }));
    },
    async loadPrefs() {
      const db = await open();
      const t = db.transaction('prefs', 'readonly');
      const rec = await reqToPromise(t.objectStore('prefs').get('prefs'));
      return rec || null;
    },
    async addHistory(item) {
      const db = await open();
      item.ts = Date.now();
      await tx(db, 'history', 'readwrite', (s) => s.add(item));
      // 只保留最近 10 条
      const all = await this.getHistory();
      if (all.length > 10) {
        const excess = all.slice(0, all.length - 10);
        await tx(db, 'history', 'readwrite', (s) => excess.forEach((r) => s.delete(r.id)));
      }
    },
    async getHistory() {
      const db = await open();
      const t = db.transaction('history', 'readonly');
      const all = await reqToPromise(t.objectStore('history').getAll());
      return all.sort((a, b) => a.ts - b.ts);
    },
    async deleteHistory(id) {
      const db = await open();
      return tx(db, 'history', 'readwrite', (s) => s.delete(id));
    },
  };
})();
