// Audio engine: one <audio> element, Media Session for lock-screen controls,
// queue + "play next", sleep timer, resume, listening stats.
import { state, on, emit, getTrack, getPlaylist, saveTrack, saveTrackSoon, saveSession, addListen, setSetting, continueTrack, MARK_COLORS } from './store.js';
import { get as dbGet } from './db.js';
import { artworkFor } from './artwork.js';
import { clamp, uid, device } from './util.js';
import { playable, keepOnly, forget } from './media.js';

const audio = document.getElementById('audio');
export const audioEl = audio;

export const P = {
  id: null,
  ready: false,
  queue: [],
  context: { ids: [], label: 'Library' },
  history: [],
  sleep: { mode: 'off', endsAt: 0, total: 0 },
  volumeSupported: true,
};

let objectUrl = null;
let lastTick = 0;
let baseVolume = 1;
let sleepTimer = null;

export const current = () => (P.id ? getTrack(P.id) : null);
export const isPlaying = () => Boolean(P.id) && !audio.paused && !audio.ended;
export const time = () => (pending ? pending.t : trustedTime());
export const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration || 0);

// iOS ignores element volume (hardware buttons only) — detect instead of pretending.
try {
  const v = audio.volume;
  audio.volume = 0.42;
  P.volumeSupported = Math.abs(audio.volume - 0.42) < 0.01 && !device.ios;
  audio.volume = v;
} catch {
  P.volumeSupported = false;
}

/* ───────────── where the sound comes from ─────────────
   An iPhone's player only jumps around properly in audio it can ask for piece by piece, the
   way a web server hands out a file ("byte ranges"). Audio handed over as one block of
   stored data plays, but skipping and resuming silently do nothing — which is what kept
   happening. So the audio is served to the player at an ordinary address by the app's own
   service worker (sw.js), straight out of the device's storage, in pieces, like a server.

   If that isn't available, or a jump still doesn't land, the player falls back to a copy in
   memory, then to the stored file as it is. Each audio remembers what worked for it. */

const ROOT = new URL('./', location.href).href;
const MODES = ['sw', 'mem', 'file'];
let swMedia = false;
const modeFor = new Map(); // id → mode that is known to work (or is being tried)

// Is the media-serving service worker in charge of this page?
async function checkSW() {
  try {
    if (!navigator.serviceWorker?.controller) return (swMedia = false);
    const r = await fetch(`${ROOT}media/ping`, { cache: 'no-store' });
    swMedia = r.headers.get('x-earmark-media') === '1';
  } catch {
    swMedia = false;
  }
  return swMedia;
}
export const swReady = checkSW();
navigator.serviceWorker?.addEventListener?.('controllerchange', checkSW);

const firstMode = () => (swMedia ? 'sw' : 'mem');
const modeOf = (id) => modeFor.get(id) || firstMode();

/** Point the element at the audio, starting at `at` seconds. */
async function attach(id, at, mode) {
  const blob = state.blobs.get(id);
  let url;
  if (mode === 'sw') {
    url = `${ROOT}media/${encodeURIComponent(id)}?s=${blob?.size || 0}`;
  } else {
    let b = blob;
    if (mode === 'mem') {
      try {
        b = await playable(id);
      } catch {
        b = blob;
      }
    } else {
      try {
        b = (await dbGet('blobs', id))?.blob || blob;
      } catch {}
    }
    if (P.id !== id) return false;
    if (!b) return false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(b);
    url = objectUrl;
  }
  if (mode === 'sw' && objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  P.ready = false;
  loadingOurs = true;
  // "#t=" asks the player to start there itself; the jump below makes sure of it.
  audio.src = at > 0.5 ? `${url}#t=${at.toFixed(2)}` : url;
  audio.defaultPlaybackRate = state.settings.speed;
  audio.playbackRate = state.settings.speed;
  audio.preservesPitch = true;
  return true;
}

/* ───────────── jumping ─────────────
   A jump is only done when the player says it is there. Until then the screen and the lock
   screen show where it is going; if it never gets there the next way of playing is tried. */

let pending = null; // { t, tries, since }
let lastGood = 0; // the last position known to be right
let asked = false; // playback was asked for and nothing has stopped it since
let loadingOurs = false; // the current load was started here (not by the phone)
let noSeekFor = null;
let swapWhenQuiet = false;

/** The element's time, unless the phone has plainly thrown our place away (it reports 0). */
function trustedTime() {
  const ct = audio.currentTime || 0;
  return lastGood > 5 && ct < 1.5 && lastGood - ct > 4 ? lastGood : ct;
}

function jump(t) {
  pending = { t, tries: 0, since: 0 };
  apply();
}

function apply() {
  const p = pending;
  if (!p || audio.readyState < 1) return; // the phone loads nothing until play is pressed
  if (Math.abs(audio.currentTime - p.t) < 0.75) return arrived(true);
  if (audio.seeking) return;
  if (!p.since) p.since = performance.now();
  if (p.tries >= 3) return arrived(false);
  p.tries++;
  try {
    audio.currentTime = p.t;
  } catch {}
}

// A jump that doesn't land within a few seconds of the player being ready counts as failed.
setInterval(() => {
  const p = pending;
  if (p && p.since && audio.readyState >= 1 && performance.now() - p.since > (audio.paused ? 6000 : 3500)) arrived(false);
}, 700);

function arrived(ok) {
  const p = pending;
  pending = null;
  if (ok) {
    lastGood = p.t;
    if (P.id) modeFor.set(P.id, modeOf(P.id));
  } else if (p && P.id) {
    // This way of playing can't jump: try the next one, from the place we wanted.
    const i = MODES.indexOf(modeOf(P.id));
    if (i < MODES.length - 1) {
      modeFor.set(P.id, MODES[i + 1]);
      lastGood = p.t;
      reattach(p.t);
      return;
    }
    if (noSeekFor !== P.id) {
      noSeekFor = P.id;
      emit('player:noseek', { id: P.id });
    }
  }
  updatePositionState();
  emit('player:time', { seek: true });
}

/** Reload the current audio (new way of playing, or a repaired file) without losing the place. */
async function reattach(at = time()) {
  const id = P.id;
  if (!id) return;
  const resume = asked || !audio.paused;
  pending = null;
  const ok = await attach(id, at, modeOf(id));
  if (!ok || P.id !== id) return;
  if (at > 0.5) jump(at);
  if (resume) play();
  emit('player:state');
}

/* ───────────── loading & transport ───────────── */

export function load(id, { autoplay = true, at = null, context = null, noHistory = false } = {}) {
  const t = getTrack(id);
  if (!t) return false;
  if (!state.blobs.get(id)) {
    // Not known in memory (rare) — look in storage, then retry.
    dbGet('blobs', id).then((row) => {
      if (row?.blob) {
        state.blobs.set(id, row.blob);
        load(id, { autoplay, at, context, noHistory });
      } else emit('player:error', { message: 'Audio file missing on this device.' });
    });
    return false;
  }

  if (P.id && P.id !== id) {
    commitPosition();
    if (!noHistory) {
      P.history.push(P.id);
      if (P.history.length > 60) P.history.shift();
    }
  }
  if (context) P.context = { ids: context.ids.slice(0, 800), label: context.label || 'Library' };
  P.queue = P.queue.filter((q) => q !== id);

  let start = at;
  if (start == null) start = t.finished ? 0 : t.position || 0;
  if (t.finished && at == null) {
    t.finished = false;
    t.position = 0;
  }
  P.id = id;
  pending = null;
  lastGood = start;
  keepOnly([id]);

  const mode = modeOf(id);
  const go = () => {
    if (start > 0.5) jump(start);
    if (autoplay) play();
    else emit('player:state');
  };
  if (mode === 'sw') {
    attach(id, start, mode); // synchronous for this mode: play() stays inside the tap
    go();
  } else {
    if (start > 0.5) pending = { t: start, tries: 0, since: 0 };
    attach(id, start, mode).then((ok) => ok && P.id === id && go());
  }

  t.lastPlayedAt = Date.now();
  saveTrack(t, { silent: true });
  saveSession({ lastId: id, queue: P.queue, context: P.context });
  setMetadata(t);
  emit('player:load', t);
  emit('player:queue');
  return true;
}

export function play() {
  if (!P.id) {
    const t = continueTrack(null);
    if (t) load(t.id, { autoplay: true });
    return;
  }
  asked = true;
  // If the phone dropped our place while the audio sat paused, go back to it first.
  if (!pending && lastGood > 5 && (audio.currentTime || 0) < 1.5) jump(lastGood);
  const p = audio.play();
  p?.catch?.((err) => {
    if (err?.name !== 'NotAllowedError') return; // "interrupted by a new load" is us swapping sources
    asked = false;
    emit('player:blocked');
  });
}
export function pause() {
  asked = false;
  audio.pause();
}
export const toggle = () => (audio.paused ? play() : pause());

export function seek(t) {
  if (!P.id) return;
  const d = duration();
  const target = d > 0 ? clamp(t, 0, Math.max(0, d - 0.25)) : Math.max(0, t);
  lastGood = target;
  jump(target);
  const tr = current();
  if (tr && tr.finished && target < d - 2) tr.finished = false;
  commitPosition();
  emit('player:time', { seek: true });
  updatePositionState();
}

export function skip(dir) {
  const step = dir < 0 ? state.settings.skipBack : state.settings.skipFwd;
  seek(time() + dir * step);
  emit('player:skip', { dir, step });
}

function contextNext(from = P.id) {
  const ids = P.context.ids.filter((id) => getTrack(id));
  const i = ids.indexOf(from);
  for (let k = i + 1; k < ids.length; k++) if (!getTrack(ids[k]).finished) return ids[k];
  return null;
}

function nextId(auto) {
  while (P.queue.length) {
    const id = P.queue.shift();
    if (getTrack(id) && id !== P.id) return id;
  }
  if (auto && !state.settings.autoplay) return null;
  return contextNext();
}

export function next({ auto = false } = {}) {
  const id = nextId(auto);
  if (!id) {
    if (!auto) emit('player:end-of-queue');
    emit('player:queue');
    return false;
  }
  load(id, { autoplay: true });
  return true;
}

export function prev() {
  if (time() > 4) return seek(0);
  let id = null;
  while (P.history.length && !id) {
    const h = P.history.pop();
    if (getTrack(h) && h !== P.id) id = h;
  }
  if (!id) {
    const ids = P.context.ids.filter((x) => getTrack(x));
    const i = ids.indexOf(P.id);
    if (i > 0) id = ids[i - 1];
  }
  if (!id) return seek(0);
  load(id, { autoplay: true, noHistory: true });
}

function warmNext() {}

/** The stored file was replaced (made skippable): switch to it without losing the place. */
function reloadSource() {
  if (!P.id) return;
  if (!audio.paused && document.hidden) {
    swapWhenQuiet = true; // never interrupt audio playing behind the lock screen
    return;
  }
  swapWhenQuiet = false;
  noSeekFor = null;
  forget(P.id);
  modeFor.delete(P.id);
  reattach(time());
}
on('blob', (d) => d?.id === P.id && reloadSource());

export function unload() {
  pending = null;
  asked = false;
  lastGood = 0;
  keepOnly([]);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  P.id = null;
  P.ready = false;
  if (ms) ms.metadata = null;
  saveSession({ lastId: null });
  emit('player:load', null);
  emit('player:state');
}

export function playFrom(id, ids, label) {
  if (P.id === id && P.ready) {
    toggle();
    return;
  }
  load(id, { autoplay: true, context: { ids, label } });
}

function commitPosition() {
  const t = current();
  if (!t) return;
  if (pending || P.ready) t.position = time();
  saveTrack(t, { silent: true });
}

/* ───────────── queue ───────────── */

function queueChanged() {
  saveSession({ queue: P.queue, context: P.context });
  emit('player:queue');
  if (P.id) warmNext();
}
export function playNext(id) {
  if (id === P.id) return;
  P.queue = [id, ...P.queue.filter((x) => x !== id)];
  queueChanged();
}
export function addToQueue(id) {
  if (id === P.id || P.queue.includes(id)) return;
  P.queue.push(id);
  queueChanged();
}
export function removeFromQueue(id) {
  P.queue = P.queue.filter((x) => x !== id);
  queueChanged();
}
export function moveInQueue(from, to) {
  const [x] = P.queue.splice(from, 1);
  P.queue.splice(to, 0, x);
  queueChanged();
}
export function clearQueue() {
  P.queue = [];
  queueChanged();
}
/** What plays after the queue runs out (autoplay preview). */
export function contextPreview(n = 5) {
  const out = [];
  let from = P.id;
  const seen = new Set([P.id, ...P.queue]);
  for (let i = 0; i < 400 && out.length < n; i++) {
    const id = contextNext(from);
    if (!id) break;
    if (!seen.has(id)) out.push(id);
    seen.add(id);
    from = id;
  }
  return out;
}

/* ───────────── rate / volume ───────────── */

export function setSpeed(r) {
  r = clamp(Math.round(r * 100) / 100, 0.5, 3);
  audio.playbackRate = r;
  audio.defaultPlaybackRate = r;
  setSetting('speed', r);
  emit('player:rate', r);
  updatePositionState();
}

export function setVolume(v) {
  baseVolume = clamp(v, 0, 1);
  audio.volume = baseVolume;
  if (audio.muted && v > 0) audio.muted = false;
  emit('player:volume');
}
export const commitVolume = () => setSetting('volume', baseVolume);
export function toggleMute() {
  audio.muted = !audio.muted;
  emit('player:volume');
}

/* ───────────── sleep timer ───────────── */

export function setSleep(minutes) {
  clearInterval(sleepTimer);
  restoreVolume();
  if (minutes === 'end') P.sleep = { mode: 'end', endsAt: 0, total: 0 };
  else if (minutes > 0) {
    P.sleep = { mode: 'time', endsAt: Date.now() + minutes * 60000, total: minutes * 60000 };
    sleepTimer = setInterval(checkSleep, 1000);
  } else P.sleep = { mode: 'off', endsAt: 0, total: 0 };
  emit('player:sleep');
}
export function extendSleep(minutes) {
  if (P.sleep.mode !== 'time') return setSleep(minutes);
  P.sleep.endsAt += minutes * 60000;
  P.sleep.total += minutes * 60000;
  restoreVolume();
  emit('player:sleep');
}
export const sleepLeft = () => (P.sleep.mode === 'time' ? Math.max(0, P.sleep.endsAt - Date.now()) : 0);

function checkSleep() {
  if (P.sleep.mode !== 'time') return;
  const left = sleepLeft();
  if (left <= 0) {
    pause();
    clearInterval(sleepTimer);
    P.sleep = { mode: 'off', endsAt: 0, total: 0 };
    setTimeout(restoreVolume, 400);
    emit('player:sleep');
    emit('player:sleep-done');
    return;
  }
  if (state.settings.sleepFade && P.volumeSupported && left < 30000 && !audio.paused) {
    audio.volume = baseVolume * Math.max(0.04, left / 30000);
  }
  emit('player:sleep-tick');
}
function restoreVolume() {
  if (P.volumeSupported) audio.volume = baseVolume;
}

/* ───────────── marks & notes ───────────── */

export function addMark(trackId = P.id, at = time(), name = '') {
  const t = getTrack(trackId);
  if (!t) return null;
  const n = t.marks.length;
  const m = { id: uid(), t: at, name: name || `Mark ${n + 1}`, color: MARK_COLORS[n % MARK_COLORS.length], at: Date.now() };
  t.marks = [...t.marks, m].sort((a, b) => a.t - b.t);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, added: m.id });
  return m;
}
export function updateMark(trackId, markId, patch) {
  const t = getTrack(trackId);
  const m = t?.marks.find((x) => x.id === markId);
  if (!m) return;
  Object.assign(m, patch);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, changed: markId });
}
export function removeMark(trackId, markId) {
  const t = getTrack(trackId);
  if (!t) return;
  t.marks = t.marks.filter((m) => m.id !== markId);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, removed: markId });
}
export function addNote(trackId, text, at = null) {
  const t = getTrack(trackId);
  if (!t || !text.trim()) return null;
  const n = { id: uid(), text: text.trim().slice(0, 2000), t: at, at: Date.now() };
  t.notes = [...(t.notes || []), n];
  saveTrack(t, { silent: true });
  emit('notes', { trackId, added: n.id });
  return n;
}
export function removeNote(trackId, noteId) {
  const t = getTrack(trackId);
  if (!t) return;
  t.notes = t.notes.filter((n) => n.id !== noteId);
  saveTrack(t, { silent: true });
  emit('notes', { trackId, removed: noteId });
}

/* ───────────── media session (lock screen, headphones, car) ───────────── */

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

export function setMetadata(t = current()) {
  if (!ms || !t) return;
  const pl = t.playlists.map(getPlaylist).find(Boolean);
  try {
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: pl?.name || 'Earmark',
      album: 'Earmark',
      artwork: [{ src: artworkFor(t), sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

function updatePositionState() {
  if (!ms?.setPositionState) return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    ms.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: clamp(time(), 0, d) });
  } catch {}
}

/**
 * The phone's own controls. An iPhone shows one pair of side buttons — skip ±seconds or
 * previous/next — so it gets whichever Settings asks for; everything else gets both.
 * Skips always use your own seconds, not the system's 10.
 */
function bindMediaKeys() {
  if (!ms) return;
  const set = (action, fn) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {}
  };
  const tracks = state.settings.lockButtons === 'tracks';
  const skips = !device.ios || !tracks;
  const jumps = !device.ios || tracks;
  set('play', () => play());
  set('pause', () => pause());
  set('seekbackward', skips ? () => skip(-1) : null);
  set('seekforward', skips ? () => skip(1) : null);
  set('previoustrack', jumps ? () => prev() : null);
  set('nexttrack', jumps ? () => next() : null);
  set('seekto', (d) => Number.isFinite(d?.seekTime) && seek(d.seekTime));
}
on('settings', (d) => d?.k === 'lockButtons' && bindMediaKeys());


/* ───────────── element events ───────────── */

audio.addEventListener('loadedmetadata', () => {
  P.ready = true;
  apply();
  audio.playbackRate = state.settings.speed;
  const t = current();
  if (t && Number.isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1) {
    t.duration = audio.duration;
    saveTrack(t, { silent: true });
  }
  updatePositionState();
  emit('player:time');
});

for (const ev of ['loadeddata', 'canplay', 'playing', 'seeked']) audio.addEventListener(ev, apply);

// The phone started loading the audio again by itself (it threw it away while the app was in
// the background). Whatever it reports next, head back to where we were.
audio.addEventListener('loadstart', () => {
  if (loadingOurs) {
    loadingOurs = false;
    return;
  }
  if (!P.id) return;
  P.ready = false;
  if (!pending && lastGood > 1) pending = { t: lastGood, tries: 0, since: 0 };
});

audio.addEventListener('timeupdate', () => {
  const t = current();
  if (!t) return;
  if (pending) {
    apply();
    if (pending) return; // still on its way: don't overwrite the place we're heading to
  }
  if (!P.ready) return;
  // Playing from the start although we were far in, and nobody asked for that: the phone
  // restarted the audio. Go back instead of saving "0:00" over the real place.
  if (!audio.seeking && lastGood > 5 && audio.currentTime < 1.5 && lastGood - audio.currentTime > 4) {
    jump(lastGood);
    return;
  }
  lastGood = audio.currentTime;
  // An audio that can't be jumped in keeps its saved place until you have listened past it.
  if (!(noSeekFor === t.id && audio.currentTime + 2 < (t.position || 0))) {
    t.position = audio.currentTime;
    saveTrackSoon(t);
  }
  const now = performance.now();
  if (!audio.paused && lastTick) {
    const dt = (now - lastTick) / 1000;
    if (dt > 0 && dt < 2.5) addListen(dt);
  }
  lastTick = audio.paused ? 0 : now;
  checkSleep();
  emit('player:time');
});

audio.addEventListener('play', () => {
  lastTick = performance.now();
  if (ms) ms.playbackState = 'playing';
  updatePositionState();
  emit('player:state');
});
audio.addEventListener('pause', () => {
  lastTick = 0;
  asked = false;
  commitPosition();
  if (swapWhenQuiet) reloadSource();
  if (ms) ms.playbackState = 'paused';
  emit('player:state');
});
audio.addEventListener('waiting', () => emit('player:state'));
audio.addEventListener('playing', () => emit('player:state'));
audio.addEventListener('ratechange', updatePositionState);
audio.addEventListener('ended', () => {
  const t = current();
  lastGood = 0;
  if (t) {
    t.finished = true;
    t.position = 0;
    t.plays = (t.plays || 0) + 1;
    saveTrack(t);
  }
  if (P.sleep.mode === 'end') {
    setSleep(0);
    emit('player:sleep-done');
    emit('player:state');
    return;
  }
  if (!next({ auto: true })) emit('player:state');
});

// The audio couldn't be loaded this way (or its source died while the app slept): try the next way.
audio.addEventListener('error', () => {
  const id = P.id;
  if (!id || !audio.getAttribute('src')) return;
  const i = MODES.indexOf(modeOf(id));
  if (i < MODES.length - 1) {
    modeFor.set(id, MODES[i + 1]);
    reattach(pending ? pending.t : lastGood);
    return;
  }
  asked = false;
  emit('player:error', { message: "This audio couldn't be played." });
  emit('player:state');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) commitPosition();
  else if (swapWhenQuiet) reloadSource();
});
addEventListener('pagehide', commitPosition);

/* ───────────── boot ───────────── */

/** Plain-text snapshot for troubleshooting playback on a phone (Settings → About). */
export function report() {
  const t = current();
  const blob = t && state.blobs.get(t.id);
  const ranges = (r) => {
    const out = [];
    for (let i = 0; i < (r?.length || 0); i++) out.push(`${r.start(i).toFixed(1)}–${r.end(i).toFixed(1)}`);
    return out.join(' ') || 'none';
  };
  const names = { sw: 'served in pieces', mem: 'memory copy', file: 'stored file' };
  return [
    `track: ${t ? `${t.title} (${t.source || 'file'})` : 'none'}`,
    `file: ${blob ? `${blob.type || '?'} · ${(blob.size / 1048576).toFixed(1)} MB · checked ${t.cx ?? 'no'}` : 'none'}`,
    `source: ${t ? names[modeOf(t.id)] : '-'} · worker ${swMedia ? 'ready' : 'not in charge'} · last good ${lastGood.toFixed(1)}`,
    `state: ready ${audio.readyState} · net ${audio.networkState} · ${audio.paused ? 'paused' : 'playing'}${audio.seeking ? ' · seeking' : ''}${audio.error ? ` · error ${audio.error.code}` : ''}`,
    `time: ${audio.currentTime.toFixed(1)} of ${Number.isFinite(audio.duration) ? audio.duration.toFixed(1) : audio.duration} · saved ${(t?.position || 0).toFixed(1)}${pending ? ` · heading to ${pending.t.toFixed(1)} (try ${pending.tries})` : ''}`,
    `seekable: ${ranges(audio.seekable)}`,
    `buffered: ${ranges(audio.buffered)}`,
    `lock buttons: ${state.settings.lockButtons || 'skip'} · skip ${state.settings.skipBack}/${state.settings.skipFwd}s · speed ${audio.playbackRate}`,
  ].join('\n');
}

export async function restore() {
  bindMediaKeys();
  baseVolume = state.settings.volume ?? 1;
  if (P.volumeSupported) audio.volume = baseVolume;
  const s = state.session;
  P.queue = (s.queue || []).filter((id) => getTrack(id));
  if (s.context?.ids) P.context = { ids: s.context.ids.filter((id) => getTrack(id)), label: s.context.label || 'Library' };
  await Promise.race([swReady, new Promise((r) => setTimeout(r, 1500))]);
  if (s.lastId && getTrack(s.lastId) && !P.id) load(s.lastId, { autoplay: false });
}
