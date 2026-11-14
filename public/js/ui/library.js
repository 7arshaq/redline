// Library: search, sections and playlists as quiet tabs, list or records.
import { state, on, query, setSetting, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist, playlistTracks } from '../store.js';
import * as player from '../player.js';
import { icon } from '../icons.js';
import { animateList, swap, Roller } from '../anim.js';
import { $, esc, debounce } from '../util.js';
import { menu, prompt, confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { rowHTML, cellHTML, wireRows } from './kit.js';

const FILTERS = [
  ['all', 'All'],
  ['progress', 'Started'],
  ['new', 'New'],
  ['fav', 'Favourites'],
  ['done', 'Played'],
];
const SORTS = [
  ['recent', 'Newest'],
  ['played', 'Recently played'],
  ['title', 'Title'],
  ['longest', 'Longest'],
  ['shortest', 'Shortest'],
];

export function mount(root) {
  let filter = 'all';
  let search = '';
  root.innerHTML = `
    <header class="pg-head" data-st>
      <h1 class="pg-title">Library<span class="num" id="lbCount">0</span></h1>
      <span class="pg-tools">
        <button class="icon-btn dim" type="button" id="lbList" aria-label="Playlist options" hidden>${icon('more')}</button>
        <button class="icon-btn dim" type="button" id="lbSort" aria-label="Sort">${icon('sort')}</button>
        <button class="icon-btn dim" type="button" id="lbView" aria-label="Switch view">${icon('v-tiles')}</button>
      </span>
    </header>
    <label class="search" data-st>${icon('search')}<input id="lbSearch" type="search" placeholder="Search" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search library"></label>
    <div class="tabs" id="lbTabs" data-st></div>
    <div class="scroll" data-st><ul class="list" id="lbItems"></ul><div class="empty" id="lbEmpty" hidden></div></div>`;
  const q = (s) => $(s, root);
  const items = q('#lbItems');
  const tabs = q('#lbTabs');
  const count = new Roller(q('#lbCount'));

  const view = () => (state.settings.viewMode === 'tiles' ? 'tiles' : 'list');
  const sort = () => state.settings.sort || 'recent';
  const results = () => query({ filter, search, sort: sort() });
  const label = () => (filter.startsWith('pl:') ? getPlaylist(filter.slice(3))?.name : FILTERS.find(([k]) => k === filter)?.[1]) || 'Library';

  function renderTabs() {
    if (filter.startsWith('pl:') && !getPlaylist(filter.slice(3))) filter = 'all';
    const html =
      FILTERS.map(([k, l]) => `<button class="tab ${k === filter ? 'on' : ''}" type="button" data-f="${k}">${l}</button>`).join('') +
      state.playlists.map((p) => `<button class="tab ${filter === `pl:${p.id}` ? 'on' : ''}" type="button" data-f="pl:${p.id}">${esc(p.name)}</button>`).join('') +
      `<button class="tab" type="button" data-f="+" data-sfx="tap" aria-label="New playlist">+</button>`;
    if (tabs.dataset.sig !== html) {
      tabs.dataset.sig = html;
      tabs.innerHTML = html;
    } else tabs.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
    q('#lbList').hidden = !filter.startsWith('pl:');
  }

  function render(animate = true) {
    const list = results();
    const v = view();
    const paint = () => {
      items.className = v === 'tiles' ? 'list grid' : 'list';
      items.innerHTML = list.map((t) => (v === 'tiles' ? cellHTML(t) : rowHTML(t))).join('');
    };
    if (animate && items.dataset.v === v) animateList(items, paint);
    else if (animate && items.dataset.v) swap(items, paint);
    else paint();
    items.dataset.v = v;
    count.set(String(list.length));
    q('#lbView').innerHTML = icon(v === 'tiles' ? 'v-list' : 'v-tiles');
    const empty = q('#lbEmpty');
    empty.hidden = list.length > 0;
    if (!list.length) empty.innerHTML = search ? `<b>No match.</b>Nothing for “${esc(search)}”.` : filter === 'all' ? '<b>Nothing saved yet.</b>Paste a link on Home.' : '<b>Empty.</b>';
  }

  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    if (b.dataset.f === '+') {
      const name = await prompt({ title: 'New playlist', placeholder: 'Name', ok: 'Create' });
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
      SORTS.map(([k, l]) => ({ label: l, checked: sort() === k, fn: () => setSetting('sort', k) })),
      { title: 'Sort' },
    ),
  );
  q('#lbView').addEventListener('click', () => setSetting('viewMode', view() === 'tiles' ? 'list' : 'tiles'));
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
            toast('Queued');
          },
        },
        {
          label: 'Rename',
          icon: 'edit',
          fn: async () => {
            const name = await prompt({ title: 'Rename', value: p.name, ok: 'Save' });
            if (name) updatePlaylist(p.id, { name });
          },
        },
        '-',
        {
          label: 'Delete playlist',
          icon: 'trash',
          danger: true,
          fn: async () => {
            if (await confirmSheet({ title: `Delete ${p.name}?`, message: 'The audio stays in your library.', ok: 'Delete' })) deletePlaylist(p.id);
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
  on('settings', live(() => render()));
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
