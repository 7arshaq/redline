// Small shared pieces: records, hairlines, list rows, and what happens after a link is added.
import { state, progressOf, setInPlaylist, createPlaylist } from '../store.js';
import * as player from '../player.js';
import { retry } from '../downloads.js';
import { pickFiles } from '../importer.js';
import { icon } from '../icons.js';
import { esc, fmtTime, fmtDur, clamp } from '../util.js';
import { toast } from './toast.js';
import { prompt } from './sheet.js';
import { sfx } from '../fx.js';

const P4 = (p) => clamp(p || 0, 0, 1).toFixed(4);
/** A 1px progress line. */
export const line = (p = 0, cls = '') => `<i class="line ${cls}" style="--p:${P4(p)}" aria-hidden="true"></i>`;
export const setLine = (el, p) => el && el.style.setProperty('--p', P4(p));

export const pp = () => `<span class="pp" data-on="0">${icon('play', 'pp-a')}${icon('pause', 'pp-b')}</span>`;

/** A small record. `live` ones spin while audio plays; `p` draws how far you are as a red arc. */
export function disc({ p = null, live = false } = {}) {
  const arc = p == null ? '' : `<circle cx="50" cy="50" r="48.5" fill="none" stroke="var(--red)" stroke-width="1.5" pathLength="100" stroke-dasharray="${(clamp(p, 0, 1) * 100).toFixed(2)} 100" transform="rotate(-90 50 50)" class="disc-arc"/>`;
  return `<svg class="disc-mini ${live ? 'live' : ''}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="48.5" fill="#101010" stroke="rgba(242,239,233,.1)"/>
    ${arc}
    <g class="spin">
      <circle cx="50" cy="50" r="41" fill="none" stroke="rgba(242,239,233,.06)"/><circle cx="50" cy="50" r="34" fill="none" stroke="rgba(242,239,233,.05)"/><circle cx="50" cy="50" r="27" fill="none" stroke="rgba(242,239,233,.06)"/>
      <path d="M50 6 A44 44 0 0 1 88 28" fill="none" stroke="rgba(242,239,233,.16)" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="16" fill="var(--red)"/><rect x="49.2" y="37" width="1.6" height="6" rx=".8" fill="#fff" opacity=".9"/>
    </g>
    <circle cx="50" cy="50" r="2.4" fill="#080808"/>
  </svg>`;
}

export function timeLabel(t) {
  if (!t.finished && t.position > 5 && t.duration) return `${fmtDur(t.duration - t.position, true)} left`;
  return t.duration ? fmtDur(t.duration, true) : '';
}

export function metaLine(t) {
  const bits = [t.finished ? 'Played' : timeLabel(t), t.uploader].filter(Boolean).map(esc);
  return (t.favorite ? icon('star-fill', 'fav-ic') : '') + bits.join(' · ');
}

export function rowHTML(t) {
  const cur = player.P.id === t.id;
  const p = progressOf(t);
  return `<li class="row ${cur ? 'is-current' : ''}" data-id="${t.id}" role="button" tabindex="0">
    <span class="row-main"><span class="row-title">${esc(t.title)}</span><span class="row-meta">${metaLine(t)}</span></span>
    <span class="row-end"><button class="icon-btn sm row-more" type="button" aria-label="More">${icon('more')}</button></span>
    ${!t.finished && p > 0.005 ? line(p) : ''}
  </li>`;
}

export function cellHTML(t) {
  const cur = player.P.id === t.id;
  return `<li class="cell ${cur ? 'is-current' : ''}" data-id="${t.id}" role="button" tabindex="0">
    <span class="cell-disc">${disc({ p: progressOf(t), live: cur })}</span>
    <span class="cell-title">${esc(t.title)}</span>
    <span class="row-meta">${metaLine(t)}</span>
  </li>`;
}

/** Slide the white pill of a segmented control under `btn`. */
export function placeSeg(seg, btn, animate = true) {
  if (!seg || !btn) return;
  const pill = seg.querySelector('.seg-pill');
  if (!animate) pill.style.transition = 'none';
  pill.style.width = `${btn.offsetWidth}px`;
  pill.style.transform = `translateX(${btn.offsetLeft}px)`;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  if (!animate) requestAnimationFrame(() => (pill.style.transition = ''));
}

/** Shared result handling for anything that adds a link (paste, share target, import). */
export function handleResult(res) {
  if (!res) return;
  if (res.handoff) {
    toast('Downloading in Shortcuts. Back here when it’s done?', { icon: 'download', duration: 9000, action: { label: 'Import', fn: runImport } });
  } else if (res.duplicate) {
    const t = res.duplicate;
    toast(`Already saved: ${t.title}`, { icon: 'check', action: { label: 'Play', fn: () => player.load(t.id) } });
  } else if (res.error && !res.job) {
    sfx('error');
    toast(res.error, { icon: 'info' });
  } else if (res.error) {
    sfx('error');
    toast(res.error, { icon: 'info', duration: 7000, action: { label: 'Retry', fn: () => retry(res.job).then(handleResult) } });
  } else if (res.track) {
    const t = res.track;
    if (res.filed) {
      toast(`Saved to ${res.filed.name}`, { icon: 'folder', duration: 5000, action: { label: 'Undo', fn: () => setInPlaylist(t.id, res.filed.id, false) } });
      return;
    }
    const lists = [...state.playlists].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    toast(`Saved — ${t.title}`, {
      icon: 'check',
      duration: 7000,
      action: { label: 'Play', fn: () => player.load(t.id) },
      chips: [
        ...lists.map((p) => ({
          label: p.name,
          icon: 'folder',
          fn: async (btn) => {
            await setInPlaylist(t.id, p.id);
            btn.classList.toggle('on', t.playlists.includes(p.id));
            return true;
          },
        })),
        {
          label: lists.length ? 'New' : 'Add to a playlist',
          icon: 'plus',
          fn: async () => {
            const name = await prompt({ title: 'New playlist', placeholder: 'e.g. Podcasts, Learning, Sleep', ok: 'Create' });
            if (name) {
              const p = await createPlaylist(name);
              await setInPlaylist(t.id, p.id, true);
              toast(`Added to ${p.name}`, { icon: 'folder', duration: 1800 });
            }
          },
        },
      ],
    });
  }
}

/** File picker → library. Must be called straight from a tap. */
export async function runImport() {
  reportImport(await pickFiles());
}

export function reportImport(out) {
  if (!out?.length) return;
  if (out.length === 1) return handleResult(out[0]);
  const ok = out.filter((r) => r.track).length;
  const dupes = out.filter((r) => r.duplicate).length;
  const bad = out.filter((r) => r.error).length;
  toast([`Imported ${ok}`, dupes && `${dupes} already saved`, bad && `${bad} failed`].filter(Boolean).join(' · '), { icon: ok ? 'check' : 'info', duration: 3200 });
}

/** Rows in `list` play on tap; the ⋯ button opens the audio's menu. `ids()` is the play order. */
export function wireRows(list, ids, label) {
  list.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const t = state.byId.get(row.dataset.id);
    if (!t) return;
    if (e.target.closest('.row-more')) {
      const { trackMenu } = await import('./track-actions.js');
      return trackMenu(e.target.closest('.row-more'), t);
    }
    player.playFrom(t.id, ids(), typeof label === 'function' ? label() : label);
  });
}
