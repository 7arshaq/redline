// Offline shell. Network-first (fresh when online, instant fallback when not).
// Audio never goes through here — it lives in IndexedDB.
const VERSION = 'redline-v2'; // keep in step with BUILD in js/util.js
// Paths are relative so the app works at the site root or in a sub-folder (e.g. GitHub Pages).
const ROOT = new URL('./', self.location).href;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/util.js', 'js/icons.js', 'js/db.js', 'js/store.js', 'js/api.js', 'js/downloads.js', 'js/anim.js', 'js/nav.js',
  'js/artwork.js', 'js/player.js', 'js/shorten.js', 'js/importer.js', 'js/mp4.js', 'js/repair.js', 'js/fx.js', 'js/media.js',
  'js/ui/kit.js', 'js/ui/deck.js', 'js/ui/turntable.js', 'js/ui/library.js', 'js/ui/marks.js', 'js/ui/setup.js',
  'js/ui/sheet.js', 'js/ui/toast.js', 'js/ui/track-actions.js',
  'fonts/geist.woff2', 'fonts/serif.woff2', 'fonts/serif-italic.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(new URL(u, ROOT), { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('redline-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* ───────────── audio, served like a web server would ─────────────
   An iPhone's player only skips and resumes properly in audio it can fetch piece by piece
   ("byte ranges"). Saved audio lives in IndexedDB, so it is served from there at
   media/<id>, answering each range request with exactly the bytes asked for. */
const MEDIA = `${ROOT}media/`;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open('earmark');
    // Never create the database from here: that's the app's job.
    r.onupgradeneeded = () => r.transaction.abort();
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => {
        d.close();
        dbp = null;
      };
      resolve(d);
    };
    r.onerror = () => {
      dbp = null;
      reject(r.error);
    };
  });
  return dbp;
}
async function storedBlob(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const q = d.transaction('blobs').objectStore('blobs').get(id);
    q.onsuccess = () => resolve(q.result?.blob || null);
    q.onerror = () => reject(q.error);
  });
}
async function sniff(blob) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (s.slice(4, 8) === 'ftyp') return 'audio/mp4';
  if (s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s.startsWith('RIFF')) return 'audio/wav';
  if (s.startsWith('OggS')) return 'audio/ogg';
  if (s.startsWith('fLaC')) return 'audio/flac';
  return blob.type || 'audio/mpeg';
}
let held = null; // { id, size, blob, type } — the audio being played, kept handy
async function media(req, url) {
  const id = decodeURIComponent(url.pathname.slice(new URL(MEDIA).pathname.length));
  if (id === 'ping') return new Response(null, { status: 204, headers: { 'x-earmark-media': '1' } });
  const want = Number(url.searchParams.get('s')) || 0;
  if (!held || held.id !== id || (want && held.size !== want)) {
    const blob = await storedBlob(id).catch(() => null);
    if (!blob) return new Response('not found', { status: 404 });
    held = { id, size: blob.size, blob, type: await sniff(blob).catch(() => blob.type || 'audio/mpeg') };
  }
  const { blob, size, type } = held;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return new Response(blob, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2] || 0));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(MEDIA)) {
    e.respondWith(media(req, url).catch(() => new Response('error', { status: 500 })));
    return;
  }
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT) || url.href.startsWith(`${ROOT}api/`)) return;

  const isNav = req.mode === 'navigate';
  e.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const key = isNav ? ROOT : req;
      // Network first, but never let a slow/absent server stall the app.
      // Files are re-checked with the host every time ("no-cache"), so an update always
      // arrives whole — never half new code, half the browser's ten-minute-old copies.
      const net = fetch(isNav ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
        return res;
      });
      net.catch(() => {});
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), isNav ? 3500 : 6000);
      });
      late.catch(() => {});
      try {
        const res = await Promise.race([net, late]);
        clearTimeout(timer);
        if (!res.ok && res.status >= 500) throw new Error('bad gateway');
        return res;
      } catch {
        clearTimeout(timer);
        const hit = (await cache.match(isNav ? ROOT : req, { ignoreSearch: true })) || (isNav && (await cache.match(`${ROOT}index.html`)));
        if (hit) return hit;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })(),
  );
});
