// Marks: every pinned moment and note, grouped by audio. Tap one to land there.
import { state, on } from '../store.js';
import * as player from '../player.js';
import { animateList, Roller } from '../anim.js';
import { $, esc, fmtTime } from '../util.js';
import { openPlayer } from './turntable.js';

export function mount(root) {
  let mode = 'marks';
  root.innerHTML = `
    <header class="pg-head" data-st><h1 class="pg-title">Marks<span class="num" id="mkCount">0</span></h1></header>
    <div class="tabs" id="mkTabs" data-st><button class="tab on" type="button" data-m="marks">Moments</button><button class="tab" type="button" data-m="notes">Notes</button></div>
    <div class="scroll" data-st><div id="mkBody"></div><div class="empty" id="mkEmpty" hidden></div></div>`;
  const body = $('#mkBody', root);
  const count = new Roller($('#mkCount', root));

  function render() {
    const groups = state.tracks
      .map((t) => ({ t, items: mode === 'marks' ? t.marks || [] : (t.notes || []).slice().sort((a, b) => (a.t ?? 1e12) - (b.t ?? 1e12)) }))
      .filter((g) => g.items.length)
      .sort((a, b) => (b.t.lastPlayedAt || b.t.addedAt) - (a.t.lastPlayedAt || a.t.addedAt));
    const n = groups.reduce((s, g) => s + g.items.length, 0);
    count.set(String(n));
    animateList(
      body,
      () =>
        (body.innerHTML = groups
          .map(
            ({ t, items }) => `<section class="grp" data-id="${t.id}">
          <div class="grp-title">${esc(t.title)}</div>
          ${items
            .map((m) =>
              mode === 'marks'
                ? `<button class="mrow" type="button" data-t="${m.t}"><span class="mrow-t">${fmtTime(m.t)}</span><span class="mrow-name">${esc(m.name)}</span></button>`
                : `<button class="mrow" type="button" ${m.t != null ? `data-t="${m.t}"` : ''}><span class="mrow-t">${m.t != null ? fmtTime(m.t) : ''}</span><span class="mrow-note">${esc(m.text)}</span></button>`,
            )
            .join('')}
        </section>`,
          )
          .join('')),
      { selector: '.grp' },
    );
    const empty = $('#mkEmpty', root);
    empty.hidden = n > 0;
    empty.innerHTML = mode === 'marks' ? '<b>No moments yet.</b>Tap the bookmark while listening to pin one.' : '<b>No notes yet.</b>Write them from the player.';
  }

  $('#mkTabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.dataset.m === mode) return;
    mode = b.dataset.m;
    root.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  body.addEventListener('click', (e) => {
    const row = e.target.closest('.mrow');
    const id = row?.closest('[data-id]')?.dataset.id;
    if (!id) return;
    const at = row.dataset.t != null ? Number(row.dataset.t) : null;
    if (player.P.id === id) {
      if (at != null) player.seek(at);
      if (!player.isPlaying()) player.play();
    } else player.load(id, { autoplay: true, at });
    openPlayer();
  });

  const live = () => !root.hidden && render();
  on('marks', live);
  on('notes', live);
  on('tracks', live);
  render();
  return { enter: render };
}
