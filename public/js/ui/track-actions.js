// Everything you can do to a single audio, shared by home, library and the player.
import { state, emit, getPlaylist, createPlaylist, setInPlaylist, updateTrack, deleteTrack } from '../store.js';
import * as player from '../player.js';
import { h, esc, fmtTime, mediaKey } from '../util.js';
import { icon } from '../icons.js';
import { menu, openSheet, prompt, confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { pop } from '../anim.js';

export function trackMenu(anchor, t, { inPlayer = false } = {}) {
  const isCur = player.P.id === t.id;
  const lists = t.playlists.map(getPlaylist).filter(Boolean).map((p) => p.name);
  menu(
    anchor,
    [
      !inPlayer && { label: isCur && player.isPlaying() ? 'Pause' : 'Play', icon: isCur && player.isPlaying() ? 'pause' : 'play', fn: () => (isCur ? player.toggle() : player.load(t.id)) },
      !isCur && {
        label: 'Play next',
        icon: 'play-next',
        fn: () => {
          player.playNext(t.id);
          toast(player.P.id ? 'Plays next' : 'Queued', { icon: 'play-next' });
        },
      },
      !isCur && {
        label: 'Add to queue',
        icon: 'queue',
        fn: () => {
          player.addToQueue(t.id);
          toast('Added to queue', { icon: 'queue' });
        },
      },
      { label: 'Playlists', icon: 'folder-plus', hint: lists.length ? lists.join(', ') : '', fn: () => playlistPicker(t) },
      { label: t.favorite ? 'Unfavourite' : 'Favourite', icon: t.favorite ? 'star-fill' : 'star', fn: () => toggleFavorite(t) },
      { label: 'Rename', icon: 'edit', fn: () => renameTrack(t) },
      { label: 'Share', icon: 'share', fn: () => shareTrack(anchor, t) },
      t.url && !t.url.startsWith('demo:') && { label: 'Open original', icon: 'external', fn: () => open(t.url, '_blank', 'noopener') },
      {
        label: t.finished ? 'Mark as unplayed' : 'Mark as finished',
        icon: 'check',
        fn: () => updateTrack(t.id, t.finished ? { finished: false, position: 0 } : { finished: true, position: 0 }),
      },
      '-',
      { label: 'Delete from device', icon: 'trash', danger: true, fn: () => deleteFlow(t) },
    ],
    { title: t.title },
  );
}

export async function toggleFavorite(t, btn) {
  await updateTrack(t.id, { favorite: !t.favorite });
  if (btn) pop(btn, 1.3);
  emit('fav', { id: t.id });
  toast(t.favorite ? 'Added to favourites' : 'Removed from favourites', { icon: t.favorite ? 'star-fill' : 'star', duration: 1800 });
}

export async function renameTrack(t) {
  const name = await prompt({ title: 'Rename', value: t.title, placeholder: t.originalTitle || 'Short name', maxLength: 60 });
  if (name && name !== t.title) {
    await updateTrack(t.id, { title: name });
    if (player.P.id === t.id) player.setMetadata(t);
  }
}

export async function deleteFlow(t) {
  const ok = await confirmSheet({ title: 'Delete this audio?', message: `“${t.title}” will be removed from this device, with its marks and notes.`, ok: 'Delete' });
  if (!ok) return;
  if (player.P.id === t.id) {
    if (!player.next()) player.unload();
  }
  player.removeFromQueue(t.id);
  await deleteTrack(t.id);
  toast('Deleted', { icon: 'trash', duration: 1800 });
}

const ytAt = (url, sec) => {
  const k = mediaKey(url);
  if (!k?.startsWith('yt:')) return null;
  return `https://youtu.be/${k.slice(3)}?t=${Math.floor(sec)}`;
};

export function shareTrack(anchor, t) {
  const blob = state.blobs.get(t.id);
  const fileName = `${t.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'audio'}.mp3`;
  const file = blob ? new File([blob], fileName, { type: 'audio/mpeg' }) : null;
  const realUrl = t.url && !t.url.startsWith('demo:') ? t.url : null;
  const at = player.P.id === t.id ? player.time() : 0;
  const atUrl = realUrl && at > 5 ? ytAt(realUrl, at) : null;
  const items = [
    realUrl && navigator.share && { label: 'Share link', icon: 'link', fn: () => navigator.share({ title: t.title, url: realUrl }).catch(() => {}) },
    atUrl && navigator.share && { label: `Share from ${fmtTime(at)}`, icon: 'link', fn: () => navigator.share({ title: t.title, url: atUrl }).catch(() => {}) },
    file && navigator.canShare?.({ files: [file] }) && { label: 'Share audio file', icon: 'share', fn: () => navigator.share({ files: [file], title: t.title }).catch(() => {}) },
    realUrl && {
      label: atUrl ? `Copy link at ${fmtTime(at)}` : 'Copy link',
      icon: 'clip',
      fn: () => navigator.clipboard?.writeText(atUrl || realUrl).then(() => toast('Link copied', { icon: 'check', duration: 1600 })),
    },
    blob && {
      label: 'Save MP3',
      icon: 'download',
      fn: () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      },
    },
  ];
  menu(anchor, items, { title: 'Share' });
}

/** Toggle playlists for one audio, create one inline. Instant, no save button. */
export function playlistPicker(t) {
  const body = h(`
    <div class="picker">
      <form class="picker-new">
        <input class="field" placeholder="New playlist" maxlength="40" enterkeyhint="done" autocomplete="off">
        <button class="btn solid press" type="submit">${icon('plus')}</button>
      </form>
      <div class="picker-list"></div>
    </div>`);
  const list = body.querySelector('.picker-list');
  const render = (fresh) => {
    if (!state.playlists.length) {
      list.innerHTML = `<p class="picker-empty">No playlists yet. Name one above — it'll hold this audio right away.</p>`;
      return;
    }
    list.innerHTML = state.playlists
      .map((p) => {
        const on = t.playlists.includes(p.id);
                return `<button type="button" class="pick ${on ? 'on' : ''} ${p.id === fresh ? 'fresh' : ''}" data-id="${p.id}">
          <i class="pick-sw"></i><span class="pick-name">${esc(p.name)}</span>
          <span class="pick-box">${icon('check')}</span></button>`;
      })
      .join('');
  };
  render();
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    await setInPlaylist(t.id, b.dataset.id);
    b.classList.toggle('on', t.playlists.includes(b.dataset.id));
    pop(b.querySelector('.pick-box'), 1.2);
  });
  body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = body.querySelector('input');
    const name = input.value.trim();
    if (!name) return input.focus();
    const p = await createPlaylist(name);
    await setInPlaylist(t.id, p.id, true);
    input.value = '';
    render(p.id);
  });
  openSheet({ title: 'Playlists', body, className: 'sheet-picker' });
}
