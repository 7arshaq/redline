// App state + persistence + a tiny event bus.
import * as db from './db.js';
import { uid, dayKey, throttle } from './util.js';

// Colour families lifted from the bento reference.
export const SWATCHES = [
  // Vintage Charm: burnt orange, slate, wheat, midnight violet, ink — and their tints.
  // (The order matters: saved audio and playlists store their colour as a position here.)
  { key: 'burnt', bg: '#c44900', ink: '#f7ead2', dim: '#8a3300' },
  { key: 'slate', bg: '#183a37', ink: '#efd6ac', dim: '#0f2725' },
  { key: 'wheat', bg: '#efd6ac', ink: '#04151f', dim: '#c9a974' },
  { key: 'violet', bg: '#432534', ink: '#efd6ac', dim: '#2b1722' },
  { key: 'sand', bg: '#d8b981', ink: '#04151f', dim: '#b0915a' },
  { key: 'ink', bg: '#1d4053', ink: '#efd6ac', dim: '#12303f' },
  { key: 'cream', bg: '#f7ead2', ink: '#04151f', dim: '#d6c09c' },
  { key: 'teal', bg: '#2a5a6e', ink: '#efd6ac', dim: '#1b3e4d' },
  { key: 'ember', bg: '#e06a22', ink: '#04151f', dim: '#a84c12' },
  { key: 'moss', bg: '#2c5c56', ink: '#efd6ac', dim: '#1d413c' },
  { key: 'tan', bg: '#b8955d', ink: '#04151f', dim: '#8f703e' },
  { key: 'plum', bg: '#5c3448', ink: '#efd6ac', dim: '#3f2231' },
];
/** The order new audio picks its colour in: warm, cool, earthy in turn, so a library never
 *  sits in one corner of the palette. (Stored colours are indexes into SWATCHES.) */
const COLOUR_ORDER = [0, 7, 1, 10, 9, 3, 8, 2, 11, 4, 6, 5];
export const nextColour = (n) => COLOUR_ORDER[n % COLOUR_ORDER.length];
/** Soft fill for controls sitting on a swatch: darkens light tiles, lightens dark ones. */
export const swatchSoft = (sw) => (/^#[ef]/i.test(sw.ink) ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)');
export const MARK_COLORS = ['#f0193a', '#ffffff', '#8a8a8a'];

export const DEFAULTS = {
  skipBack: 5,
  skipFwd: 5,
  speed: 1,
  quality: 'standard',
  autoplay: true,
  autoFetch: true,
  autoFile: true,
  sleepFade: true,
  viewMode: 'list',
  sort: 'recent',
  server: '',
  fetchVia: 'auto',
  shortcutName: 'Earmark',
  accessKey: '',
  volume: 1,
  haptics: true,
  sfx: true,
  lockButtons: 'skip',
};

export const state = {
  tracks: [],
  byId: new Map(),
  blobs: new Map(),
  playlists: [],
  settings: { ...DEFAULTS },
  stats: { days: {}, total: 0 },
  session: { lastId: null, queue: [], context: null },
  jobs: [],
  server: { online: null },
};

/* ── events ── */
const bus = new EventTarget();
export function on(evt, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(evt, handler);
  return () => bus.removeEventListener(evt, handler);
}
export function emit(evt, detail) {
  bus.dispatchEvent(new CustomEvent(evt, { detail }));
}

/* ── load ── */
export async function load() {
  const [tracks, playlists, settings, stats, session, blobs] = await Promise.all([
    db.getAll('tracks'),
    db.getAll('playlists'),
    db.kvGet('settings', {}),
    db.kvGet('stats', null),
    db.kvGet('session', null),
    db.getAll('blobs'),
  ]);
  state.tracks = tracks.sort((a, b) => b.addedAt - a.addedAt);
  state.byId = new Map(tracks.map((t) => [t.id, t]));
  state.playlists = playlists.sort((a, b) => a.createdAt - b.createdAt);
  state.settings = { ...DEFAULTS, ...settings };
  if (stats) state.stats = stats;
  if (session) state.session = { ...state.session, ...session };
  for (const row of blobs) state.blobs.set(row.id, row.blob);
}

/* ── tracks ── */
export const getTrack = (id) => state.byId.get(id) || null;

export async function saveTrack(t, { silent = false } = {}) {
  await db.put('tracks', t);
  if (!silent) emit('tracks', { id: t.id });
}

const pendingPos = new Set();
const flushPositions = throttle(() => {
  for (const id of pendingPos) {
    const t = getTrack(id);
    if (t) db.put('tracks', t);
  }
  pendingPos.clear();
}, 2500);
export function saveTrackSoon(t) {
  pendingPos.add(t.id);
  flushPositions();
}

export async function addTrack(fields, blob) {
  const id = uid();
  const t = {
    id,
    key: fields.key || null,
    url: fields.url,
    source: fields.source || null,
    title: fields.title || 'Untitled audio',
    originalTitle: fields.originalTitle || fields.title || '',
    uploader: fields.uploader || null,
    description: fields.description || null,
    duration: fields.duration || 0,
    size: blob.size,
    addedAt: Date.now(),
    lastPlayedAt: 0,
    position: 0,
    finished: false,
    favorite: false,
    playlists: fields.playlists || [],
    marks: [],
    notes: [],
    color: nextColour(state.tracks.length),
    plays: 0,
  };
  await db.put('blobs', { id, blob });
  await db.put('tracks', t);
  state.blobs.set(id, blob);
  state.tracks.unshift(t);
  state.byId.set(id, t);
  emit('tracks', { id, added: true });
  return t;
}

export async function deleteTrack(id) {
  await db.del('tracks', id);
  await db.del('blobs', id);
  state.tracks = state.tracks.filter((t) => t.id !== id);
  state.byId.delete(id);
  state.blobs.delete(id);
  emit('tracks', { id, removed: true });
}

export async function updateTrack(id, patch) {
  const t = getTrack(id);
  if (!t) return;
  Object.assign(t, patch);
  await saveTrack(t);
  return t;
}

/* ── playlists ── */
export const getPlaylist = (id) => state.playlists.find((p) => p.id === id) || null;

export async function createPlaylist(name) {
  const used = new Set(state.playlists.map((p) => p.color));
  const color = COLOUR_ORDER.find((c) => !used.has(c)) ?? state.playlists.length % SWATCHES.length;
  const p = { id: uid(), name: name.trim().slice(0, 40) || 'Playlist', color, createdAt: Date.now(), updatedAt: Date.now() };
  state.playlists.push(p);
  await db.put('playlists', p);
  emit('playlists', { id: p.id, added: true });
  return p;
}

export async function updatePlaylist(id, patch) {
  const p = getPlaylist(id);
  if (!p) return;
  Object.assign(p, patch, { updatedAt: Date.now() });
  await db.put('playlists', p);
  emit('playlists', { id });
}

export async function deletePlaylist(id) {
  state.playlists = state.playlists.filter((p) => p.id !== id);
  await db.del('playlists', id);
  for (const t of state.tracks) {
    if (t.playlists.includes(id)) {
      t.playlists = t.playlists.filter((x) => x !== id);
      await db.put('tracks', t);
    }
  }
  emit('playlists', { id, removed: true });
  emit('tracks', {});
}

export async function setInPlaylist(trackId, plId, on) {
  const t = getTrack(trackId);
  const p = getPlaylist(plId);
  if (!t || !p) return;
  const has = t.playlists.includes(plId);
  if (on === undefined) on = !has;
  if (on === has) return;
  t.playlists = on ? [...t.playlists, plId] : t.playlists.filter((x) => x !== plId);
  p.updatedAt = Date.now();
  await db.put('playlists', p);
  await saveTrack(t);
  emit('playlists', { id: plId });
}

export const playlistTracks = (plId) => state.tracks.filter((t) => t.playlists.includes(plId));

/** Which playlist does this channel usually go into? */
export function suggestPlaylist(track) {
  if (!track.uploader) return null;
  const counts = new Map();
  for (const t of state.tracks) {
    if (t.id === track.id || t.uploader !== track.uploader) continue;
    for (const p of t.playlists) counts.set(p, (counts.get(p) || 0) + 1);
  }
  let best = null;
  for (const [p, n] of counts) if (getPlaylist(p) && (!best || n > best.n)) best = { id: p, n };
  return best ? getPlaylist(best.id) : null;
}

/* ── settings ── */
export async function setSetting(k, v) {
  state.settings[k] = v;
  await db.kvSet('settings', state.settings);
  emit('settings', { k, v });
}

/* ── session (resume where you left off) ── */
export const saveSession = throttle((patch) => {
  Object.assign(state.session, patch);
  db.kvSet('session', state.session);
}, 800);

/* ── listening stats ── */
const flushStats = throttle(() => {
  db.kvSet('stats', state.stats);
  emit('stats');
}, 8000);
export function addListen(sec) {
  if (!(sec > 0)) return;
  const k = dayKey();
  state.stats.days[k] = (state.stats.days[k] || 0) + sec;
  state.stats.total = (state.stats.total || 0) + sec;
  flushStats();
}

/* ── queries ── */
export function progressOf(t) {
  if (!t) return 0;
  if (t.finished) return 1;
  return t.duration ? Math.min(1, (t.position || 0) / t.duration) : 0;
}

export function query({ filter = 'all', search = '', sort = 'recent' } = {}) {
  let list = state.tracks.slice();
  if (filter === 'fav') list = list.filter((t) => t.favorite);
  else if (filter === 'progress') list = list.filter((t) => !t.finished && t.position > 5);
  else if (filter === 'new') list = list.filter((t) => !t.finished && !(t.position > 5));
  else if (filter === 'done') list = list.filter((t) => t.finished);
  else if (filter === 'loose') list = list.filter((t) => !t.playlists.length);
  else if (filter.startsWith('pl:')) list = list.filter((t) => t.playlists.includes(filter.slice(3)));
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((t) => `${t.title} ${t.originalTitle} ${t.uploader || ''}`.toLowerCase().includes(q));
  }
  const by = {
    recent: (a, b) => b.addedAt - a.addedAt,
    played: (a, b) => (b.lastPlayedAt || b.addedAt) - (a.lastPlayedAt || a.addedAt),
    title: (a, b) => a.title.localeCompare(b.title),
    longest: (a, b) => (b.duration || 0) - (a.duration || 0),
    shortest: (a, b) => (a.duration || 0) - (b.duration || 0),
  }[sort];
  return by ? list.sort(by) : list;
}

/** The track the "Continue" tile should offer. */
export function continueTrack(currentId) {
  if (currentId && getTrack(currentId)) return getTrack(currentId);
  const played = state.tracks.filter((t) => t.lastPlayedAt).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  return played.find((t) => !t.finished) || state.tracks.find((t) => !t.finished && !t.lastPlayedAt) || played[0] || null;
}
