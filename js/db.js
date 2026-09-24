const TtsDB = (() => {
  const DB_NAME = 'tts-reader';
  const DB_VERSION = 1;
  const STORE_PREFS = 'prefs';
  const STORE_HISTORY = 'history';
  const HISTORY_LIMIT = 10;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_PREFS)) {
          db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const store = db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = fn(store);
      transaction.oncomplete = () => resolve(result && result._value !== undefined ? result._value : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => { result._value = result.result; };
      }
    });
  }

  async function getPref(key, fallback = null) {
    try {
      const db = await open();
      const row = await tx(db, STORE_PREFS, 'readonly', (s) => s.get(key));
      return row ? row.value : fallback;
    } catch (err) {
      return fallback;
    }
  }

  async function setPref(key, value) {
    try {
      const db = await open();
      await tx(db, STORE_PREFS, 'readwrite', (s) => s.put({ key, value }));
    } catch (err) { /* 持久化失败不影响功能 */ }
  }

  async function addHistory(entry) {
    try {
      const db = await open();
      await tx(db, STORE_HISTORY, 'readwrite', (s) => s.add({
        text: entry.text,
        preview: entry.text.replace(/\s+/g, ' ').slice(0, 60),
        charCount: entry.text.length,
        voiceURI: entry.voiceURI || '',
        rate: entry.rate,
        pitch: entry.pitch,
        volume: entry.volume,
        createdAt: Date.now()
      }));
      const all = await getAllHistory();
      const excess = all.slice(0, Math.max(0, all.length - HISTORY_LIMIT));
      for (const item of excess) {
        await tx(db, STORE_HISTORY, 'readwrite', (s) => s.delete(item.id));
      }
    } catch (err) { /* 忽略 */ }
  }

  async function getAllHistory() {
    try {
      const db = await open();
      const rows = await tx(db, STORE_HISTORY, 'readonly', (s) => s.getAll());
      return (rows || []).sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      return [];
    }
  }

  async function deleteHistory(id) {
    try {
      const db = await open();
      await tx(db, STORE_HISTORY, 'readwrite', (s) => s.delete(id));
    } catch (err) { /* 忽略 */ }
  }

  return { getPref, setPref, addHistory, getAllHistory, deleteHistory };
})();
