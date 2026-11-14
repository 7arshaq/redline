// One-time tune-ups for audio that is already saved on the device:
//  · files kept in YouTube's raw "fragmented" container are rewritten so they can be skipped through
//  · titles that still carry yt-dlp's file-name stand-ins (｜ ： ？) are cleaned and re-shortened
import { state, emit, getTrack, saveTrack } from './store.js';
import * as db from './db.js';
import { inspect, defragment } from './mp4.js';
import { shortTitle } from './shorten.js';
import { adopt, bytesOf } from './media.js';

const CHECKED = 1; // bump to look at every file again
const MAX_BYTES = 900 * 1048576;
const busy = new Set();

const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 800 }) : setTimeout(r, 60)));

/** @returns true when the file was rewritten */
export async function repairTrack(id, { force = false } = {}) {
  const t = getTrack(id);
  if (!t || busy.has(id) || (t.cx === CHECKED && !force)) return false;
  busy.add(id);
  try {
    const blob = state.blobs.get(id) || (await db.get('blobs', id))?.blob;
    if (!blob) return false;
    const head = inspect(await bytesOf(blob.slice(0, 262144)));
    let fixed = false;
    if (head.mp4 && head.fragmented && blob.size < MAX_BYTES) {
      const res = defragment(await bytesOf(blob));
      if (res) {
        const next = new Blob(res.parts, { type: 'audio/mp4' });
        await db.put('blobs', { id, blob: next });
        state.blobs.set(id, next);
        adopt(id, next);
        t.size = next.size;
        if (res.duration > 0) t.duration = res.duration;
        fixed = true;
      }
    }
    t.cx = CHECKED;
    await saveTrack(t, { silent: true });
    if (fixed) emit('blob', { id });
    return fixed;
  } catch {
    return false;
  } finally {
    busy.delete(id);
  }
}

/** Checks everything not looked at yet, the audio you're about to play first. */
export async function repairLibrary(firstId = null) {
  const ids = state.tracks.filter((t) => t.cx !== CHECKED).map((t) => t.id);
  const i = ids.indexOf(firstId);
  if (i > 0) ids.unshift(...ids.splice(i, 1));
  let fixed = 0;
  for (const id of ids) {
    if (await repairTrack(id)) fixed++;
    await idle();
  }
  return fixed;
}

/* yt-dlp swaps characters that aren't allowed in file names for look-alikes. Put them back. */
const STAND_INS = { '＂': '"', '＊': '*', '：': ':', '＜': '<', '＞': '>', '？': '?', '｜': '|', '⧸': '/', '⧹': '\\' };
const STAND_IN_RE = /[＂＊：＜＞？｜⧸⧹]/g;
const HAS_STAND_IN = /[＂＊：＜＞？｜⧸⧹]/;
export const plainTitle = (s) => String(s || '').replace(STAND_IN_RE, (c) => STAND_INS[c]);

export async function tidyTitles() {
  let changed = 0;
  for (const t of state.tracks) {
    const orig = t.originalTitle || '';
    if (!HAS_STAND_IN.test(`${orig} ${t.title}`)) continue;
    const kind = t.source === 'X' ? 'Twitter' : t.source || '';
    const wasAuto = !orig || t.title === orig || t.title === shortTitle({ title: orig, extractor_key: kind });
    t.originalTitle = plainTitle(orig);
    if (wasAuto) t.title = shortTitle({ title: t.originalTitle || plainTitle(t.title), extractor_key: kind });
    else t.title = plainTitle(t.title);
    await saveTrack(t, { silent: true });
    changed++;
  }
  if (changed) emit('tracks', {});
  return changed;
}
