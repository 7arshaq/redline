// What the <audio> element is actually given to play.
//
// On an iPhone, a file handed straight back out of the app's storage plays, but the phone
// can't jump around in it: skipping does nothing and resuming starts from zero. The same
// bytes held in memory behave properly (that is the state an audio is in right after it is
// added, which is why it "worked for a bit"). So the player never plays the stored file
// directly. It asks here for an in-memory copy — kept only for the audio that is playing and
// the one that plays next — and falls back to the stored file only if no copy can be made.
import { state, on } from './store.js';
import * as db from './db.js';

const live = new Map(); // id → Blob held in memory
const making = new Map(); // id → Promise<Blob>
const HUGE = 600 * 1048576; // beyond this a second copy isn't worth the memory

export const liveCopy = (id) => live.get(id) || null;

/** A blob that was just built in memory (a fresh import or repair): no need to copy it again. */
export function adopt(id, blob) {
  live.set(id, blob);
}
export function forget(id) {
  live.delete(id);
  making.delete(id);
}
/** Let go of every copy except the ones still needed. */
export function keepOnly(ids) {
  for (const id of [...live.keys()]) if (!ids.includes(id)) live.delete(id);
}
on('tracks', (d) => d?.removed && forget(d.id));

/** Read a blob's bytes, whichever way this browser will allow. */
export async function bytesOf(blob) {
  try {
    return await blob.arrayBuffer();
  } catch {}
  try {
    return await new Response(blob).arrayBuffer();
  } catch {}
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsArrayBuffer(blob);
  });
}

/** The type, told from the first bytes, so playback never depends on a label that got lost. */
export function sniffType(buf, fallback = '') {
  const b = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  const s = String.fromCharCode(...b);
  if (s.slice(4, 8) === 'ftyp') return 'audio/mp4';
  if (s.startsWith('ID3')) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg';
  if (s.startsWith('RIFF')) return 'audio/wav';
  if (s.startsWith('OggS')) return 'audio/ogg';
  if (s.startsWith('fLaC')) return 'audio/flac';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  return fallback && fallback !== 'application/octet-stream' ? fallback : 'audio/mpeg';
}

/** @returns {Promise<Blob>} an in-memory copy of the audio (or the stored file itself if it is huge) */
export function playable(id) {
  const have = live.get(id);
  if (have) return Promise.resolve(have);
  if (making.has(id)) return making.get(id);
  const job = (async () => {
    // Ask the database again instead of trusting a handle from when the app started: those
    // can go stale after the phone has kept the app asleep for a while.
    let stored = null;
    try {
      stored = (await db.get('blobs', id))?.blob || null;
    } catch {}
    stored = stored || state.blobs.get(id);
    if (!stored) throw new Error('missing');
    state.blobs.set(id, stored);
    if (stored.size > HUGE) return stored;
    const buf = await bytesOf(stored);
    const copy = new Blob([buf], { type: sniffType(buf, stored.type) });
    live.set(id, copy);
    return copy;
  })();
  making.set(id, job);
  const done = () => making.get(id) === job && making.delete(id);
  job.then(done, done);
  return job;
}
