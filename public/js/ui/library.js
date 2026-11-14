// Library: search, filters and playlists as tabs, three densities, sort.
import { state, on, query, progressOf, setSetting, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist, playlistTracks } from '../store.js';
import * as player from '../player.js';
import { icon } from '../icons.js';
import { animateList, setText, swap } from '../anim.js';
import { $, esc, fmtDur, debounce } from '../util.js';
import { menu, prompt, confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { rowHTML, wireRows, timeLabel, metaLine, two, bar } from './kit.js';

const FILTERS = [
  ['all', 'All'],
  ['progress', 'In progress'],
  ['new', 'New'],
  ['fav', 'Favourites'],
  ['done', 'Finished'],
];
const SORTS = [
  ['recent', 'Newest first'],
  ['played', 'Recently played'],
  ['title', 'Title'],
  ['longest', 'Longest'],
  ['shortest', 'Shortest'],
];
const VIEWS = [
  ['list', 'v-list'],
  ['tiles', 'v-tiles'],
  ['compact', 'v-compact'],
];

export function mount(root) {
  let filter = 'all';
  let search = '';
  root.innerHTML = `
    <header class="pg-head" data-st><h1 class="pg-title">Library</h1><span class="pg-sub" id="lbSub"></span></header>
    <label class="search" data-st>${icon('search')}<input id="lbSearch" type="search" placeholder="Search" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search library"></label>
    <div class="tabs" id="lbTabs" data-st></div>
    <div class="tools" data-st>
      <button class="text-btn" type="button" id="lbSort"></button>
      <span class="tools-r">
        <button class="icon-btn sm" type="button" id="lbList" aria-label="Playlist options" hidden>${icon('more')}</button>
        ${VIEWS.map(([k, ic]) => `<button class="icon-btn sm" type="button" data-view="${k}" aria-label="${k} view">${icon(ic)}</button>`).join('')}
      </span>
    </div>
    <div class="scroll" data-st><ul class="list" id="lbItems"></ul><div class="empty" id="lbEmpty" hidden></div></div>`;
  const q = (s) => $(s, root);
  const items = q('#lbItems');
  const tabs = q('#lbTabs');

  const view = () => (VIEWS.some(([k]) => k === state.settings.viewMode) ? state.settings.viewMode : 'list');
  const sort = () => state.settings.sort || 'recent';
  const results = () => query({ filter, search, sort: sort() });
  const label = () => (filter.startsWith('pl:') ? getPlaylist(filter.slice(3))?.name : FILTERS.find(([k]) => k === filter)?.[1]) || 'Library';

  function renderTabs() {
    if (filter.startsWith('pl:') && !getPlaylist(filter.slice(3))) filter = 'all';
    const html =
      FILTERS.map(([k, l]) => `<button class="tab ${k === filter ? 'on' : ''}" type="button" data-f="${k}">${l}</button>`).join('') +
      state.playlists.map((p) => `<button class="tab ${filter === `pl:${p.id}` ? 'on' : ''}" type="button" data-f="pl:${p.id}">${esc(p.name)}</button>`).join('') +
      `<button class="tab" type="button" data-f="+" data-sfx="tap">+ Playlist</button>`;
    if (tabs.dataset.sig !== html) {
      tabs.dataset.sig = html;
      tabs.innerHTML = html;
    }
    q('#lbList').hidden = !filter.startsWith('pl:');
  }

  const cellHTML = (t, i) => `<li class="cell ${player.P.id === t.id ? 'is-current' : ''}" data-id="${t.id}" role="button" tabindex="0">
      <span class="row-ix">${two(i + 1)}</span><span class="num">${timeLabel(t)}</span>
      ${bar('dashes', progressOf(t))}<span class="cell-title">${esc(t.title)}</span><span class="row-meta">${esc(metaLine(t))}</span></li>`;

  function render(animate = true) {
    const list = results();
    const v = view();
    const paint = () => {
      items.className = v === 'tiles' ? 'list grid' : 'list';
      items.innerHTML = list.map((t, i) => (v === 'tiles' ? cellHTML(t, i) : rowHTML(t, i, v === 'compact' ? 'dense' : ''))).join('');
    };
    if (animate && items.dataset.v === v) animateList(items, paint);
    else if (animate && items.dataset.v) swap(items, paint);
    else paint();
    items.dataset.v = v;
    const total = list.reduce((s, t) => s + (t.duration || 0), 0);
    setText(q('#lbSub'), `${list.length} · ${total ? fmtDur(total, true) : '0m'}`);
    setText(q('#lbSort'), `Sort · ${SORTS.find(([k]) => k === sort())?.[1] || 'Newest first'}`);
    root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    const empty = q('#lbEmpty');
    empty.hidden = list.length > 0;
    if (!list.length) empty.innerHTML = search ? `<b>No match.</b>Nothing here for “${esc(search)}”.` : filter === 'all' ? '<b>Nothing saved yet.</b>Paste a link on the Deck to keep its audio.' : '<b>Empty.</b>Nothing in this section yet.';
  }

  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    if (b.dataset.f === '+') {
      const name = await prompt({ title: 'New playlist', placeholder: 'e.g. Podcasts, Learning, Sleep', ok: 'Create' });
      if (!name) return;
      const p = await createPlaylist(name);
      filter = `pl:${p.id}`;
    } else if (b.dataset.f === filter) return;
    else filter = b.dataset.f;
    renderTabs();
    render();
    tabs.querySelector('.tab.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });
  q('#lbSearch').addEventListener(
    'input',
    debounce((e) => {
      search = e.target.value.trim();
      render();
    }, 140),
  );
  q('#lbSort').addEventListener('click', (e) =>
    menu(
      e.currentTarget,
      SORTS.map(([k, l]) => ({ label: l, icon: 'sort', checked: sort() === k, fn: () => setSetting('sort', k) })),
      { title: 'Sort by' },
    ),
  );
  root.querySelector('.tools-r').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b && b.dataset.view !== view()) setSetting('viewMode', b.dataset.view);
  });
  q('#lbList').addEventListener('click', (e) => {
    const p = getPlaylist(filter.slice(3));
    if (!p) return;
    const ids = playlistTracks(p.id).map((t) => t.id);
    menu(
      e.currentTarget,
      [
        ids.length && { label: 'Play all', icon: 'play', fn: () => player.playFrom(ids[0], ids, p.name) },
        ids.length && {
          label: 'Queue all',
          icon: 'queue',
          fn: () => {
            ids.forEach((id) => player.addToQueue(id));
            toast('Added to queue', { icon: 'queue' });
          },
        },
        {
          label: 'Rename',
          icon: 'edit',
          fn: async () => {
            const name = await prompt({ title: 'Rename playlist', value: p.name, ok: 'Save' });
            if (name) updatePlaylist(p.id, { name });
          },
        },
        '-',
        {
          label: 'Delete playlist',
          icon: 'trash',
          danger: true,
          fn: async () => {
            if (await confirmSheet({ title: `Delete “${p.name}”?`, message: 'The audio stays in your library.', ok: 'Delete' })) deletePlaylist(p.id);
          },
        },
      ],
      { title: p.name },
    );
  });
  wireRows(items, () => results().map((t) => t.id), label);

  const live = (fn) => () => !root.hidden && fn();
  on('tracks', live(() => render()));
  on('fav', live(() => render()));
  on('playlists', live(() => (renderTabs(), render())));
  on('player:load', live(() => render(false)));
  on('settings', live((d) => render()));
  renderTabs();
  render(false);

  return {
    enter(opts) {
      if (opts?.filter) filter = opts.filter;
      renderTabs();
      render(false);
    },
  };
}
