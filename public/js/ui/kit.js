// Small shared pieces: the tick/dash/dot bars, list rows, and what happens after a link is added.
import { state, progressOf, setInPlaylist, createPlaylist } from '../store.js';
import * as player from '../player.js';
import { retry } from '../downloads.js';
import { pickFiles } from '../importer.js';
import { icon } from '../icons.js';
import { esc, fmtTime, clamp, relDay } from '../util.js';
import { toast } from './toast.js';
import { prompt } from './sheet.js';
import { sfx } from '../fx.js';

/** kind: ticks | dashes | dots */
export const bar = (kind, p = 0, cls = '') => `<i class="bar ${kind} ${cls}" style="--p:${clamp(p || 0, 0, 1).toFixed(4)}" aria-hidden="true"></i>`;
export const setBar = (el, p) => el && el.style.setProperty('--p', clamp(p || 0, 0, 1).toFixed(4));

export const pp = () => `<span class="pp" data-on="0">${icon('play', 'pp-a')}${icon('pause', 'pp-b')}</span>`;

/** A tiny record. `.spin` turns while the app is playing. */
export const discMini = () => `
  <svg class="disc-mini" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="19" fill="#0d0d0d" stroke="rgba(255,255,255,.3)"/>
    <g class="spin"><circle cx="20" cy="20" r="14" fill="none" stroke="rgba(255,255,255,.14)"/><circle cx="20" cy="20" r="10.5" fill="none" stroke="rgba(255,255,255,.1)"/>
    <circle cx="20" cy="20" r="6.5" fill="#ff2d2d"/><rect x="19.2" y="2.5" width="1.6" height="6" rx=".8" fill="#fff"/></g>
    <circle cx="20" cy="20" r="1.6" fill="#000"/>
  </svg>`;

export function timeLabel(t) {
  if (!t.finished && t.position > 5 && t.duration) return `-${fmtTime(t.duration - t.position)}`;
  return t.duration ? fmtTime(t.duration) : '—';
}

export function metaLine(t) {
  const p = progressOf(t);
  const bits = [t.finished ? 'Done' : p > 0.005 ? `${Math.round(p * 100)}%` : 'New', t.uploader, relDay(t.addedAt)];
  return bits.filter(Boolean).join(' · ');
}

export const two = (n) => String(n).padStart(2, '0');

export function rowHTML(t, i, cls = '') {
  const cur = player.P.id === t.id;
  return `<li class="row ${cls} ${cur ? 'is-current' : ''}" data-id="${t.id}" role="button" tabindex="0">
    <span class="row-ix">${two(i + 1)}</span>
    <span class="row-main"><span class="row-title">${esc(t.title)}</span><span class="row-meta">${esc(metaLine(t))}</span></span>
    <span class="row-end">${t.favorite ? `<span class="row-fav">${icon('star-fill')}</span>` : ''}<span class="row-time">${timeLabel(t)}</span>
    <button class="icon-btn sm row-more" type="button" aria-label="More">${icon('more')}</button></span>
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
