import { state } from './store.js';

const base = () => (state.settings.server || '').trim().replace(/\/+$/, '');

function headers(extra = {}) {
  const h = { ...extra };
  if (state.settings.accessKey) h['X-Access-Key'] = state.settings.accessKey;
  return h;
}

async function json(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new Error(body?.error || `Server answered ${res.status}`);
  return body;
}

export async function health(timeout = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${base()}/api/health`, { headers: headers(), signal: ctrl.signal, cache: 'no-store' });
    return await json(res);
  } finally {
    clearTimeout(t);
  }
}

export const startJob = (url, quality) =>
  fetch(`${base()}/api/jobs`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, quality }),
  }).then(json);

export const getJob = (id) => fetch(`${base()}/api/jobs/${id}`, { headers: headers(), cache: 'no-store' }).then(json);

export const deleteJob = (id) => fetch(`${base()}/api/jobs/${id}`, { method: 'DELETE', headers: headers() }).catch(() => {});

export const updateDownloader = () => fetch(`${base()}/api/update`, { method: 'POST', headers: headers() }).then(json);

/** Streams the MP3 to the device, reporting 0..1 progress. */
export async function fetchFile(id, onProgress) {
  const res = await fetch(`${base()}/api/jobs/${id}/file`, { headers: headers(), cache: 'no-store' });
  if (!res.ok) await json(res);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  return new Blob(chunks, { type: 'audio/mpeg' });
}
