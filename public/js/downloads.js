// Orchestrates link → server job → MP3 on device → library.
import * as api from './api.js';
import { state, emit, addTrack, getTrack, setInPlaylist, suggestPlaylist } from './store.js';
import { uid, sleep, sourceOf, extractUrl, mediaKey } from './util.js';
import { fetchMode, handOff } from './importer.js';
import { adopt } from './media.js';

export const STAGE_LABEL = {
  sending: 'Sending',
  queued: 'Queued',
  starting: 'Looking',
  downloading: 'Downloading',
  converting: 'Converting',
  ready: 'Converting',
  saving: 'Saving',
  handoff: 'In Shortcuts',
  done: 'Saved',
  error: 'Failed',
};

/** 0..1 across the whole pipeline, so one bar can tell the full story. */
export function overall(job) {
  if (!job) return 0;
  const p = job.progress || 0;
  switch (job.stage) {
    case 'sending':
    case 'queued':
      return 0.02;
    case 'starting':
      return 0.06;
    case 'downloading':
      return 0.08 + p * 0.62;
    case 'converting':
    case 'ready':
      return 0.74;
    case 'saving':
      return 0.8 + p * 0.2;
    case 'done':
      return 1;
    default:
      return 0;
  }
}

export const activeJobs = () => state.jobs.filter((j) => !['done', 'error', 'handoff'].includes(j.stage));

function findDuplicate(url, key) {
  const mk = mediaKey(url);
  return state.tracks.find((t) => (key && t.key === key) || (mk && mediaKey(t.url) === mk)) || null;
}

function touch(job) {
  job.updatedAt = Date.now();
  emit('jobs', job);
}

/**
 * @returns {Promise<{track?:object, duplicate?:object, error?:string}>}
 */
export async function addLink(raw, { playlistId = null } = {}) {
  const url = extractUrl(raw);
  if (!url) return { error: "That doesn't look like a link." };

  const dup = findDuplicate(url);
  if (dup) return { duplicate: dup };
  // No server on this phone: the iPhone Shortcut downloads it, Import brings it in.
  if (fetchMode() === 'shortcut') return handOff(url, { playlistId });
  if (state.jobs.some((j) => !['done', 'error', 'handoff'].includes(j.stage) && mediaKey(j.url) === mediaKey(url))) {
    return { error: 'Already fetching that one.' };
  }

  const job = {
    lid: uid(),
    url,
    source: sourceOf(url),
    stage: 'sending',
    progress: 0,
    meta: null,
    error: null,
    trackId: null,
    playlistId,
    createdAt: Date.now(),
  };
  state.jobs = [job, ...state.jobs.filter((j) => !['done', 'error'].includes(j.stage) || Date.now() - j.createdAt < 120000)].slice(0, 8);
  touch(job);

  try {
    const created = await api.startJob(url, state.settings.quality);
    job.id = created.id;
    job.stage = created.stage;
    touch(job);

    let misses = 0;
    for (;;) {
      await sleep(job.stage === 'queued' ? 1000 : 550);
      let s;
      try {
        s = await api.getJob(job.id);
        misses = 0;
      } catch (e) {
        if (++misses > 6) throw e;
        continue;
      }
      job.stage = s.stage;
      job.progress = s.progress;
      if (s.meta) job.meta = s.meta;
      job.error = s.error;
      touch(job);
      if (s.stage === 'ready' || s.stage === 'error') break;
    }
    if (job.stage === 'error') throw new Error(job.error || 'Download failed');

    const lateDup = findDuplicate(url, job.meta?.key);
    if (lateDup) {
      api.deleteJob(job.id);
      job.stage = 'done';
      job.trackId = lateDup.id;
      touch(job);
      return { duplicate: lateDup };
    }

    job.stage = 'saving';
    job.progress = 0;
    touch(job);
    const blob = await api.fetchFile(job.id, (p) => {
      job.progress = p;
      touch(job);
    });
    const m = job.meta || {};
    const track = await addTrack(
      {
        key: m.key,
        url: m.webpage || url,
        source: job.source && job.source.key !== 'web' ? job.source.name : m.source || job.source?.name,
        title: m.shortTitle || m.title,
        originalTitle: m.title,
        uploader: m.uploader,
        description: m.description,
        duration: m.duration,
        playlists: playlistId ? [playlistId] : [],
      },
      blob,
    );
    adopt(track.id, blob);
    api.deleteJob(job.id);
    job.stage = 'done';
    job.trackId = track.id;
    job.size = blob.size;
    touch(job);

    try {
      await navigator.storage?.persist?.();
    } catch {}

    // Seamless filing: same channel as before → same playlist (can be undone from the toast).
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
    job.error = e?.message === 'Failed to fetch' ? "Can't reach the server. Is it running?" : e?.message || 'Something went wrong.';
    touch(job);
    if (job.id) api.deleteJob(job.id);
    return { error: job.error, job };
  }
}

export function retry(job) {
  state.jobs = state.jobs.filter((j) => j !== job);
  emit('jobs');
  return addLink(job.url, { playlistId: job.playlistId });
}

export const trackForJob = (job) => (job?.trackId ? getTrack(job.trackId) : null);
