// Tiny promise wrapper around IndexedDB. Audio blobs live here, on the device.
const NAME = 'earmark';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const getAll = async (name) => wrap((await store(name)).getAll());
export const get = async (name, key) => wrap((await store(name)).get(key));
export const put = async (name, value) => wrap((await store(name, 'readwrite')).put(value));
export const del = async (name, key) => wrap((await store(name, 'readwrite')).delete(key));

export async function kvGet(k, fallback = null) {
  const row = await get('kv', k).catch(() => null);
  return row ? row.v : fallback;
}
export const kvSet = (k, v) => put('kv', { k, v });

export async function blobSizes() {
  const rows = await getAll('blobs');
  return rows.reduce((n, r) => n + (r.blob?.size || 0), 0);
}
