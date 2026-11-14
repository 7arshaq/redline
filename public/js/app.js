import { sprite, icon } from './icons.js';
import { load, state, on, emit, updateTrack } from './store.js';
import * as player from './player.js';
import * as api from './api.js';
import { initNav, closeTop } from './nav.js';
import { restorePending, pendingLinks, fetchMode } from './importer.js';
import { repairLibrary, repairTrack, tidyTitles } from './repair.js';
import { initFx, sfx } from './fx.js';
import { addLink } from './downloads.js';
import { EASE, stagger, setText } from './anim.js';
import { extractUrl, fmtTime, $, $$, motionOK, BUILD } from './util.js';
import { toast } from './ui/toast.js';
import { handleResult, runImport, line, setLine, pp, disc } from './ui/kit.js';
import { mountPlayer, openPlayer } from './ui/turntable.js';
import * as deck from './ui/deck.js';
import * as library from './ui/library.js';
import * as marks from './ui/marks.js';
import * as setup from './ui/setup.js';

document.body.insertAdjacentHTML('afterbegin', sprite());
initNav();

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  emit('installable');
});
addEventListener('appinstalled', () => {
  window.__installPrompt = null;
  emit('installable');
});

/* ───────────── pages + dock ───────────── */

const PAGES = [
  { id: 'deck', label: 'Home', ic: 'home', mod: deck },
  { id: 'library', label: 'Library', ic: 'stack', mod: library },
  { id: 'marks', label: 'Marks', ic: 'mark', mod: marks },
  { id: 'setup', label: 'Setup', ic: 'sliders', mod: setup },
];
let cur = 0;
const wideQ = matchMedia('(min-width: 900px) and (min-height: 560px)');

/** The red dot under the active tab. It stretches toward where it's going, then gathers up,
 *  like a drop of liquid sliding across. */
function placeIndicator(from = null) {
  const ind = $('.dock-ind');
  const btn = $$('.dock-btn')[cur];
  if (!ind || !btn) return;
  const vertical = wideQ.matches;
  const pos = (i) => (vertical ? `translateY(${$$('.dock-btn')[i].offsetTop}px)` : `translateX(${i * 100}%)`);
  ind.style.transform = pos(cur);
  const dot = ind.firstElementChild;
  if (from == null || from === cur || !motionOK()) return;
  const w = Math.abs(cur - from);
  const stretch = vertical ? `scaleY(${1 + 7 * w})` : `scaleX(${1 + 9 * w})`;
  ind.animate([{ transform: pos(from) }, { transform: pos(cur) }], { duration: 520, easing: 'cubic-bezier(0.65, 0, 0.2, 1)' });
  dot.animate([{ transform: 'none' }, { transform: stretch, offset: 0.45 }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
}

function mountDock() {
  const dock = $('#dock');
  dock.innerHTML =
    PAGES.map((p, i) => `<button class="dock-btn ${i === 0 ? 'on' : ''}" type="button" data-page="${p.id}" aria-label="${p.label}">${icon(p.ic)}</button>`).join('') +
    '<span class="dock-ind" aria-hidden="true"><i></i></span>';
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) show(b.dataset.page);
  });
  addEventListener('resize', () => placeIndicator());
  placeIndicator();
}

/** Tabs are peers: they cross-fade in place, never slide. */
function show(id, opts) {
  const i = PAGES.findIndex((p) => p.id === id);
  if (i < 0) return;
  const page = PAGES[i];
  if (i === cur) {
    page.api?.enter?.(opts);
    return;
  }
  const from = PAGES[cur].el;
  const to = page.el;
  const was = cur;
  cur = i;
  [from, to].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  to.hidden = false;
  page.api?.enter?.(opts);
  $$('.dock-btn').forEach((b, k) => b.classList.toggle('on', k === i));
  placeIndicator(was);
  if (!motionOK()) {
    from.hidden = true;
    return;
  }
  const out = from.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(4px)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  out.finished.then(
    () => {
      from.hidden = true;
      out.cancel();
    },
    () => {},
  );
  to.animate([{ opacity: 0, filter: 'blur(4px)', transform: 'scale(0.99)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 380, delay: 60, easing: EASE.out, fill: 'backwards' });
}

/* ───────────── strip (mini player) ───────────── */

function mountStrip() {
  const strip = $('#strip');
  strip.innerHTML = `
    ${line(0, 'live')}
    <button class="strip-disc" type="button" data-a="open" data-sfx="none" aria-label="Open player">${disc({ live: true })}</button>
    <button class="strip-main" type="button" data-a="open" data-sfx="none" aria-label="Open player">
      <span class="strip-title" id="stripTitle"></span>
      <span class="strip-time" id="stripTime"></span>
    </button>
    <span class="strip-ctl">
      <button class="icon-btn" type="button" data-a="toggle" data-sfx="press" aria-label="Play or pause">${pp()}</button>
      <button class="icon-btn dim" type="button" data-a="next" data-sfx="skip" data-fx="nudge-r" aria-label="Next audio">${icon('next')}</button>
    </span>`;
  const title = $('#stripTitle');
  const time = $('#stripTime');
  const fill = $('.line', strip);
  const ppEl = $('.pp', strip);
  const root = document.documentElement;

  const renderTime = () => {
    const d = player.duration();
    const t = player.time();
    setLine(fill, d ? t / d : 0);
    time.textContent = d ? `${fmtTime(t)} / ${fmtTime(d)}` : '';
  };
  const renderTrack = () => {
    const t = player.current();
    $('#stripWrap').classList.toggle('show', Boolean(t));
    root.classList.toggle('has-strip', Boolean(t));
    if (t) setText(title, t.title);
    renderTime();
  };
  const renderState = () => {
    const on = player.isPlaying();
    ppEl.dataset.on = on ? '1' : '0';
    root.classList.toggle('playing', on);
  };
  strip.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'open') openPlayer();
    else if (a === 'toggle') player.toggle();
    else if (a === 'next') player.next();
  });
  // A flick up opens the player.
  let y0 = null;
  strip.addEventListener('touchstart', (e) => (y0 = e.touches[0].clientY), { passive: true });
  strip.addEventListener('touchend', (e) => {
    if (y0 !== null && y0 - e.changedTouches[0].clientY > 28) openPlayer();
    y0 = null;
  });
  on('player:load', renderTrack);
  on('player:state', renderState);
  on('player:time', renderTime);
  on('tracks', renderTrack);
  renderTrack();
  renderState();
}

/* ───────────── server ───────────── */

// On plain static hosting there is no /api: stop asking after the first 404.
let noServerHere = false;
async function checkServer(force = false) {
  if (state.settings.fetchVia === 'shortcut' && !state.settings.server) {
    state.server = { online: false, skipped: true };
    emit('server');
    return;
  }
  if (noServerHere && !force && !state.settings.server) return;
  try {
    const r = await api.health();
    state.server = { ...r, online: true };
    noServerHere = false;
  } catch (err) {
    if (/ 404$/.test(err?.message || '') && !state.settings.server) noServerHere = true;
    state.server = { online: false };
  }
  emit('server');
}

function handleIncoming() {
  const q = new URLSearchParams(location.search);
  const raw = [q.get('url'), q.get('text'), q.get('add'), q.get('title')].filter(Boolean).join(' ');
  if (!raw) return;
  history.replaceState({ em: 0 }, '', location.pathname);
  const url = extractUrl(raw);
  if (url) addLink(url).then(handleResult);
  else toast("That share didn't include a link", { icon: 'info' });
}

function keyboard() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.matches?.('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.key === 'Escape') return closeTop();
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"]')) {
      e.preventDefault();
      return t.click();
    }
    if (!player.P.id) return;
    switch (e.key) {
      case ' ':
      case 'k':
        if (t.closest?.('button') && e.key === ' ') return;
        e.preventDefault();
        player.toggle();
        break;
      case 'ArrowLeft':
      case 'j':
        e.preventDefault();
        player.skip(-1);
        break;
      case 'ArrowRight':
      case 'l':
        e.preventDefault();
        if (e.shiftKey) player.next();
        else player.skip(1);
        break;
      case 'm': {
        const m = player.addMark();
        if (m) toast(`Marked ${fmtTime(m.t)}`, { icon: 'mark', duration: 1600 });
        break;
      }
      case 'f': {
        const c = player.current();
        if (c) updateTrack(c.id, { favorite: !c.favorite }).then(() => emit('fav', { id: c.id }));
        break;
      }
      case 'p':
        openPlayer();
        break;
    }
  });
}

/* An installed iPhone app usually resumes the old page from memory instead of reloading,
   so it would keep showing an old version. Look for a newer build whenever the app comes
   back, and swap to it with a quiet fade — never in the middle of listening. */
let updating = false;
async function checkUpdate() {
  if (updating || !navigator.onLine) return;
  try {
    const txt = await (await fetch(`js/util.js?build=${Date.now()}`, { cache: 'no-store' })).text();
    const live = Number(txt.match(/BUILD = (\d+)/)?.[1]);
    if (!live || live <= BUILD) return;
    updating = true;
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    const go = () => {
      document.documentElement.classList.add('updating');
      setTimeout(() => location.reload(), 320);
    };
    if (!player.isPlaying()) go();
    else {
      const off = on('player:state', () => {
        if (player.isPlaying()) return;
        off();
        go();
      });
    }
  } catch {}
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (secure) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    toast('Storage is unavailable here (private browsing?). Audio won’t be kept.', { icon: 'info', duration: 8000 });
  }
  initFx();
  mountDock();
  for (const p of PAGES) {
    p.el = $(`#pg-${p.id}`);
    p.api = p.mod.mount(p.el) || {};
  }
  mountStrip();
  mountPlayer();
  player.restore();
  on('go', (d) => d?.page && show(d.page, d));
  document.documentElement.classList.add('ready');
  stagger($$('[data-st]', PAGES[0].el), { y: 18, step: 70, duration: 720, delay: 80 });

  // iOS often reloads the app while you're in Shortcuts: pick the hand-off back up.
  await restorePending();
  const waiting = pendingLinks()[0];
  if (waiting && Date.now() - waiting.at < 3600e3) {
    toast('Got the audio from Shortcuts?', { icon: 'download', duration: 9000, action: { label: 'Import', fn: runImport } });
  }

  checkServer();
  setInterval(checkServer, 45000);
  on('server:recheck', () => checkServer(true));
  addEventListener('online', checkServer);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkServer();
  });

  handleIncoming();
  keyboard();
  registerSW();
  setTimeout(checkUpdate, 4000);
  document.addEventListener('visibilitychange', () => !document.hidden && checkUpdate());

  tidyTitles().catch(() => {});
  repairLibrary(state.session.lastId)
    .then((n) => n && toast(n === 1 ? 'Skipping now works on your saved audio' : `Skipping now works on ${n} saved audios`, { icon: 'check', duration: 4200 }))
    .catch(() => {});
  on('player:noseek', async ({ id }) => {
    const fixed = await repairTrack(id, { force: true });
    if (!fixed) toast('Couldn’t jump in this audio. Close the app fully and open it again.', { icon: 'info', duration: 6000 });
  });
  on('player:sleep-done', () => toast('Sleep timer: paused. Good night.', { icon: 'moon', duration: 5000 }));
  on('player:end-of-queue', () => toast("That's the end. Nothing queued after this.", { icon: 'queue', duration: 2400 }));
  on('player:blocked', () => toast('Tap play to start', { icon: 'play', duration: 2400 }));
  on('player:error', (d) => toast(d?.message || 'Playback error', { icon: 'info' }));
  void sfx;
}

boot();
