// No-server path: links go to an iPhone Shortcut that downloads them on the phone,
// and the files come back in through Import. Also handles any audio file you pick or drop.
import * as db from './db.js';
import { state, emit, addTrack, saveTrack, setInPlaylist, suggestPlaylist } from './store.js';
import { uid, sourceOf, mediaKey, device } from './util.js';
import { shortTitle } from './shorten.js';
import { inspect, defragment } from './mp4.js';
import { plainTitle } from './repair.js';
import { adopt } from './media.js';

/** What the Shortcut names files: "Title [Youtube-dQw4w9WgXcQ].m4a", so the link can be rebuilt on import. */
export const NAME_TEMPLATE = '%(title).80B [%(extractor_key)s-%(id)s].%(ext)s';

const PENDING_TTL = 12 * 3600e3;
const AUDIO_EXT = /\.(mp3|m4a|mp4|m4b|aac|wav|ogg|oga|opus|webm|flac|caf|aiff?)$/i;
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', caf: 'audio/x-caf', aif: 'audio/aiff', aiff: 'audio/aiff' };

/** 'server' → the computer fetches; 'shortcut' → the iPhone Shortcut fetches. */
export function fetchMode() {
  const v = state.settings.fetchVia;
  if (v === 'server' || v === 'shortcut') return v;
  if (state.server.online) return 'server';
  return device.ios ? 'shortcut' : 'server';
}

/* ── links waiting in Shortcuts ── */
let pending = [];
export const pendingLinks = () => pending;
const savePending = () => db.kvSet('pending', pending).catch(() => {});

function dropPending(key) {
  if (!key) return;
  const before = pending.length;
  pending = pending.filter((p) => p.key !== key);
  if (pending.length !== before) savePending();
}

function handoffJob(p) {
  state.jobs = state.jobs.filter((j) => !(j.stage === 'handoff' && j.key === p.key));
  const job = { lid: uid(), url: p.url, key: p.key, source: p.source, stage: 'handoff', progress: 0, meta: null, error: null, playlistId: p.playlistId || null, createdAt: p.at, updatedAt: Date.now() };
  state.jobs = [job, ...state.jobs].slice(0, 8);
  emit('jobs', job);
  return job;
}

export async function restorePending() {
  const saved = (await db.kvGet('pending', []).catch(() => [])) || [];
  pending = saved.filter((p) => p && Date.now() - p.at < PENDING_TTL);
  if (pending.length !== saved.length) savePending();
  pending.slice().reverse().forEach(handoffJob);
}

export function shortcutLink(url) {
  const name = String(state.settings.shortcutName || '').trim() || 'Earmark';
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(url)}`;
}

/** Remembers the link (so the file can be matched to it later) and opens the Shortcut. */
export function handOff(url, { playlistId = null } = {}) {
  const key = mediaKey(url);
  pending = [{ url, key, source: sourceOf(url), at: Date.now(), playlistId }, ...pending.filter((p) => p.key !== key)].slice(0, 12);
  savePending();
  const job = handoffJob(pending[0]);
  const a = document.createElement('a');
  a.href = shortcutLink(url);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  return { handoff: job };
}

/* ── import ── */
export function parseName(name) {
  const base = String(name || '').replace(/\.[^./]{1,5}$/, '');
  let title = base;
  let url = null;
  let key = null;
  let extractor = '';
  const tag = base.match(/\s*\[([A-Za-z]+)-([\w-]+)\]\s*$/);
  const plain = !tag && base.match(/\s*\[([\w-]{11})\]\s*$/); // yt-dlp's default "Title [id]"
  if (tag) {
    title = base.slice(0, tag.index);
    extractor = tag[1];
    const id = tag[2];
    if (/^youtube/i.test(extractor) && /^[\w-]{11}$/.test(id)) url = `https://www.youtube.com/watch?v=${id}`;
    else if (/^twitter$/i.test(extractor) && /^\d+$/.test(id)) url = `https://x.com/i/status/${id}`;
    key = url ? mediaKey(url) : `${extractor.toLowerCase()}:${id}`;
  } else if (plain) {
    title = base.slice(0, plain.index);
    extractor = 'Youtube';
    url = `https://www.youtube.com/watch?v=${plain[1]}`;
    key = `yt:${plain[1]}`;
  }
  title = plainTitle(title).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, url, key, extractor };
}

/** Best effort: iOS may not load metadata until play, in which case the player fills it in later. */
function probeDuration(blob, ms = 2500) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.muted = true;
    const src = URL.createObjectURL(blob);
    let done = false;
    const end = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      URL.revokeObjectURL(src);
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    const timer = setTimeout(() => end(0), ms);
    a.addEventListener('loadedmetadata', () => end(a.duration), { once: true });
    a.addEventListener('error', () => end(0), { once: true });
    a.src = src;
  });
}

const isAudio = (f) => f && (f.type?.startsWith('audio/') || f.type === 'video/mp4' || AUDIO_EXT.test(f.name || ''));

function touch(job) {
  job.updatedAt = Date.now();
  emit('jobs', job);
}

async function importOne(file) {
  const info = parseName(file.name);
  let link = info.key ? pending.find((p) => p.key === info.key) : null;
  // An untagged file right after a single hand-off is almost certainly that link.
  if (!link && !info.key && pending.length === 1 && Date.now() - pending[0].at < 3600e3) link = pending[0];
  const url = info.url || link?.url || null;
  const key = info.key || link?.key || null;
  const src = url ? sourceOf(url) : null;

  const dup = key && state.tracks.find((t) => t.key === key || (t.url && mediaKey(t.url) === key));
  let job = key && state.jobs.find((j) => j.stage === 'handoff' && j.key === key);
  if (dup) {
    dropPending(key);
    if (job) {
      job.stage = 'done';
      job.trackId = dup.id;
      touch(job);
    }
    return { duplicate: dup };
  }

  const short = shortTitle({ title: info.title, extractor_key: info.extractor || src?.name || '' });
  if (!job) {
    job = { lid: uid(), url, key, source: src || { key: 'file', name: 'File' }, stage: 'saving', progress: 0, meta: null, error: null, createdAt: Date.now() };
    state.jobs = [job, ...state.jobs.filter((j) => j.stage !== 'done' || Date.now() - j.createdAt < 120000)].slice(0, 8);
  }
  job.stage = 'saving';
  job.progress = 0.15;
  job.meta = { title: info.title, shortTitle: short };
  touch(job);

  try {
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
    let type = file.type && file.type !== 'video/mp4' ? file.type : TYPES[ext] || 'audio/mpeg';
    // Copy the bytes: a picked file can be a temporary iOS file that disappears later.
    const bytes = await file.arrayBuffer();
    job.progress = 0.5;
    touch(job);
    // Audio straight from YouTube / X comes in a container Safari can play but not skip
    // through. Rewrap it here (same sound, new index) so skipping and resuming just work.
    let parts = [bytes];
    let duration = 0;
    const plain = defragment(bytes);
    if (plain) {
      parts = plain.parts;
      type = 'audio/mp4';
      duration = plain.duration;
    } else duration = inspect(bytes).duration || 0;
    const blob = new Blob(parts, { type });
    job.progress = 0.7;
    touch(job);
    if (!duration) duration = await probeDuration(blob);
    job.progress = 0.85;
    job.meta.duration = duration;
    touch(job);

    const playlistId = link?.playlistId || null;
    const track = await addTrack(
      {
        key,
        url,
        source: src && src.key !== 'web' ? src.name : src?.name || 'File',
        title: short,
        originalTitle: info.title,
        duration,
        playlists: playlistId ? [playlistId] : [],
      },
      blob,
    );
    adopt(track.id, blob);
    track.cx = 1; // container already checked (see repair.js)
    saveTrack(track, { silent: true });
    dropPending(key);
    job.stage = 'done';
    job.progress = 1;
    job.trackId = track.id;
    job.size = blob.size;
    touch(job);

    try {
      await navigator.storage?.persist?.();
    } catch {}

    let filed = null;
    if (!playlistId && state.settings.autoFile) {
      const s = suggestPlaylist(track);
      if (s) {
        await setInPlaylist(track.id, s.id, true);
        filed = s;
      }
    }
    return { track, filed };
  } catch (e) {
    job.stage = 'error';
    job.error = /quota/i.test(e?.name || e?.message || '') ? 'No room left on this device' : "Couldn't import that file";
    touch(job);
    return { error: job.error };
  }
}

export async function importFiles(list) {
  const files = [...(list || [])].filter(isAudio);
  if (!files.length) return list?.length ? [{ error: 'That isn’t an audio file. Pick an MP3 or M4A.' }] : [];
  const out = [];
  for (const f of files) out.push(await importOne(f));
  return out;
}

/** Opens the file picker. Call it straight from a tap — iOS only shows pickers inside a user gesture. */
let input = null;
export function pickFiles() {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3,.m4a,.m4b,.mp4,.aac,.wav,.ogg,.opus,.webm,.flac';
    input.hidden = true;
    document.body.append(input);
  }
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(importFiles(input.files));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
