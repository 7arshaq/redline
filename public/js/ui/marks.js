// Marks: every pinned moment and note across the library, grouped by audio. Tap to jump there.
import { state, on } from '../store.js';
import * as player from '../player.js';
import { animateList, setText } from '../anim.js';
import { $, esc, fmtTime } from '../util.js';
import { bar } from './kit.js';
import { openPlayer } from './turntable.js';

export function mount(root) {
  let mode = 'marks';
  root.innerHTML = `
    <header class="pg-head" data-st><h1 class="pg-title">Marks</h1><span class="pg-sub" id="mkSub"></span></header>
    <div class="tabs" id="mkTabs" data-st><button class="tab on" type="button" data-m="marks">Marks</button><button class="tab" type="button" data-m="notes">Notes</button></div>
    <div class="rule" data-st></div>
    <div class="scroll" data-st><div id="mkBody"></div><div class="empty" id="mkEmpty" hidden></div></div>`;
  const body = $('#mkBody', root);

  function render() {
    const groups = state.tracks
      .map((t) => ({ t, items: mode === 'marks' ? t.marks || [] : (t.notes || []).slice().sort((a, b) => (a.t ?? 1e12) - (b.t ?? 1e12)) }))
      .filter((g) => g.items.length)
      .sort((a, b) => (b.t.lastPlayedAt || b.t.addedAt) - (a.t.lastPlayedAt || a.t.addedAt));
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    setText($('#mkSub', root), `${count} across ${groups.length}`);
    animateList(
      body,
      () =>
        (body.innerHTML = groups
          .map(
            ({ t, items }) => `<section class="grp" data-id="${t.id}">
          <div class="grp-head"><span class="lbl">${esc(t.title)}</span><span class="lbl dim">${items.length}</span></div>
          ${bar('dots', t.duration ? Math.max(...items.map((m) => m.t || 0)) / t.duration : 0)}
          ${items
            .map((m) =>
              mode === 'marks'
                ? `<button class="mrow" type="button" data-t="${m.t}"><i class="mdot" style="--c:${esc(m.color || '#fff')}"></i><span class="mrow-name">${esc(m.name)}</span><span class="mrow-t">${fmtTime(m.t)}</span></button>`
                : `<button class="mrow" type="button" ${m.t != null ? `data-t="${m.t}"` : ''}><i class="mdot" style="--c:#ff2d2d"></i><span class="mrow-note">${esc(m.text)}</span><span class="mrow-t">${m.t != null ? fmtTime(m.t) : '—'}</span></button>`,
            )
            .join('')}
        </section>`,
          )
          .join('')),
      { selector: '.grp' },
    );
    const empty = $('#mkEmpty', root);
    empty.hidden = count > 0;
    empty.innerHTML = mode === 'marks' ? '<b>No marks yet.</b>In the player, tap Mark to pin a moment. It lands here.' : '<b>No notes yet.</b>Write notes from the player. They can remember the moment too.';
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
