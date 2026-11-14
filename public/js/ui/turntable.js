// The player: a record on a platter inside a ring of ticks. The ring is the timeline —
// drag around it to move through the audio. The tone-arm rides inward as it plays.
import { state, on, getPlaylist, getTrack, setSetting } from '../store.js';
import * as player from '../player.js';
import { icon } from '../icons.js';
import { Roller, stagger, setText, swap, dragDismiss, pop } from '../anim.js';
import { $, h, esc, fmtTime, clamp, clockAt, haptic, motionOK } from '../util.js';
import { pushLayer } from '../nav.js';
import { sfx } from '../fx.js';
import { toast } from './toast.js';
import { openSheet, menu, prompt } from './sheet.js';
import { trackMenu, toggleFavorite, shareTrack, playlistPicker } from './track-actions.js';
import { bar, setBar, pp } from './kit.js';

const ARM_REST = -12;
const ARM_IN = 6.7;
const ARM_SWEEP = 24.1;
const fmtRate = (r) => `${Math.round(r * 100) / 100}`;

let sheet;
let R = {};
let isOpen = false;
let closeFn = null;
let spin = null;
let spinRate = 0;
let spinRaf = 0;
let seeking = null;
let panel = null; // the open marks/notes/queue sheet

const discSVG = () => `
  <svg class="tt-svg" id="ttSvg" viewBox="0 0 400 400" role="slider" tabindex="0" aria-label="Position in audio" aria-valuemin="0" aria-valuemax="100">
    <defs><mask id="ttMask" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
      <path id="ttArc" d="M200 22 A178 178 0 0 1 200 378 A178 178 0 0 1 200 22" fill="none" stroke="#fff" stroke-width="24" pathLength="360" stroke-dasharray="0 360"/></mask></defs>
    <circle class="tt-ring-bg" cx="200" cy="200" r="178" stroke-width="14" pathLength="360" stroke-dasharray="1 2"/>
    <circle class="tt-ring-fg" cx="200" cy="200" r="178" stroke-width="14" pathLength="360" stroke-dasharray="1 2" mask="url(#ttMask)"/>
    <g id="ttMarks"></g>
    <g class="tt-knob" id="ttKnob"><line x1="200" y1="8" x2="200" y2="36" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/></g>
    <g class="tt-platter" id="ttPlatter">
      <circle cx="200" cy="200" r="118" fill="#0b0b0b" stroke="rgba(255,255,255,.24)" stroke-width="1.2"/>
      ${[108, 98, 88, 78, 68, 58].map((r) => `<circle cx="200" cy="200" r="${r}" fill="none" stroke="rgba(255,255,255,.07)"/>`).join('')}
      <circle cx="200" cy="200" r="103" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1.4" pathLength="360" stroke-dasharray="30 330" transform="rotate(20 200 200)"/>
      <circle cx="200" cy="200" r="83" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.4" pathLength="360" stroke-dasharray="24 336" transform="rotate(205 200 200)"/>
      <circle cx="200" cy="200" r="93" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.4" pathLength="360" stroke-dasharray="18 342" transform="rotate(118 200 200)"/>
      <circle cx="200" cy="200" r="42" fill="#ff2d2d"/>
      <circle cx="200" cy="200" r="33" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="5" pathLength="360" stroke-dasharray="1.5 6"/>
      <rect x="198.4" y="161" width="3.2" height="13" rx="1.6" fill="#fff"/>
    </g>
    <circle cx="200" cy="200" r="5" fill="#000" stroke="#fff" stroke-width="1.6"/>
    <circle cx="318" cy="96" r="13" fill="#111" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/>
    <g class="tt-arm" id="ttArm">
      <line x1="318" y1="72" x2="318" y2="96" stroke="#8d8d8d" stroke-width="9" stroke-linecap="round"/>
      <line x1="318" y1="96" x2="318" y2="232" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <rect x="311" y="226" width="14" height="22" rx="2.5" fill="#fff"/>
      <rect x="311" y="240" width="14" height="3" fill="#ff2d2d"/>
      <circle cx="318" cy="96" r="4.5" fill="#fff"/>
    </g>
  </svg>`;

export function mountPlayer() {
  sheet = $('#player');
  sheet.innerHTML = `
  <div class="tt">
    <header class="tt-head">
      <button class="icon-btn" type="button" data-a="collapse" data-fx="drop" data-sfx="none" aria-label="Minimise player">${icon('chev-down')}</button>
      <div class="tt-head-mid"><span class="lbl dim">Playing from</span><span class="tt-ctx" id="ttCtx">Library</span></div>
      <button class="icon-btn" type="button" data-a="more" aria-label="More">${icon('more')}</button>
    </header>
    <div class="tt-title-wrap" data-in>
      <h2 class="tt-title" id="ttTitle"></h2>
      <button class="icon-btn fav" type="button" data-a="fav" aria-label="Favourite">${icon('star', 's-a')}${icon('star-fill', 's-b')}</button>
      <div class="tt-tags" id="ttTags"></div>
    </div>
    <div class="tt-stage" data-in>
      ${discSVG()}
      <div class="tt-data">
        <span class="lbl dim">Played</span>
        <div class="num"><span id="ttPct">0</span><small>%</small></div>
        ${bar('ticks', 0, 'live')}
        <span class="lbl dim" id="ttDataSub"></span>
      </div>
    </div>
    <div class="tt-time" data-in>
      <div><span class="num" id="ttCur">0:00</span><span class="of" id="ttOf"></span></div>
      <button class="tt-left press" type="button" data-a="view" data-sfx="tick" aria-label="Switch between record and numbers"><span id="ttLeft"></span><br><span id="ttEnds"></span></button>
    </div>
    <div class="tt-ctl" data-in>
      <button class="icon-btn" type="button" data-a="prev" data-fx="nudge-l" aria-label="Previous">${icon('prev')}</button>
      <button class="icon-btn skip" type="button" data-a="back" data-fx="spin-l" data-sfx="none" aria-label="Skip back">${icon('back')}<b class="n" data-n="back"></b></button>
      <button class="badge tt-play" type="button" data-a="toggle" aria-label="Play or pause">${pp()}</button>
      <button class="icon-btn skip" type="button" data-a="fwd" data-fx="spin-r" data-sfx="none" aria-label="Skip forward">${icon('fwd')}<b class="n" data-n="fwd"></b></button>
      <button class="icon-btn" type="button" data-a="next" data-fx="nudge-r" aria-label="Next">${icon('next')}</button>
    </div>
    <div class="tt-read" data-in>
      <button class="read" type="button" data-a="speed"><span class="lbl dim">Speed</span><span class="read-val"><span id="rdSpeed">1</span>×</span></button>
      <button class="read" type="button" data-a="sleep"><span class="lbl dim">Sleep</span><span class="read-val" id="rdSleep">Off</span></button>
      <button class="read" type="button" data-a="mark" data-sfx="none"><span class="lbl dim">Mark</span><span class="read-val" id="rdMark">+</span></button>
      <button class="read" type="button" data-a="share"><span class="lbl dim">Share</span><span class="read-val">Send</span></button>
    </div>
    <button class="tt-more press" type="button" data-a="panel" data-in><span class="lbl" id="ttCounts"></span>${icon('chev-right')}</button>
  </div>`;

  R = {
    svg: $('#ttSvg'),
    arc: $('#ttArc'),
    knob: $('#ttKnob'),
    marks: $('#ttMarks'),
    platter: $('#ttPlatter'),
    arm: $('#ttArm'),
    title: $('#ttTitle'),
    tags: $('#ttTags'),
    ctx: $('#ttCtx'),
    cur: $('#ttCur'),
    of: $('#ttOf'),
    left: $('#ttLeft'),
    ends: $('#ttEnds'),
    pct: $('#ttPct'),
    dataBar: $('.tt-data .bar', sheet),
    dataSub: $('#ttDataSub'),
    pp: $('.tt-play .pp', sheet),
    fav: $('.fav', sheet),
    sleep: $('#rdSleep'),
    mark: $('#rdMark'),
    counts: $('#ttCounts'),
  };
  R.speed = new Roller($('#rdSpeed'));
  if (state.settings.playerData) sheet.classList.add('data');

  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const t = player.current();
    switch (b.dataset.a) {
      case 'collapse': return closeFn?.();
      case 'toggle': return player.toggle();
      case 'back': return player.skip(-1);
      case 'fwd': return player.skip(1);
      case 'prev': return player.prev();
      case 'next': return player.next();
      case 'fav': return t && toggleFavorite(t, b);
      case 'more': return t && trackMenu(b, t, { inPlayer: true });
      case 'lists': return t && playlistPicker(t);
      case 'speed': return openSpeed();
      case 'sleep': return openSleep();
      case 'mark': return quickMark(b);
      case 'share': return t && shareTrack(b, t);
      case 'panel': return openPanel();
      case 'view': {
        const on = sheet.classList.toggle('data');
        setSetting('playerData', on);
        return;
      }
    }
  });

  wireRing();
  wireDataBar();

  const app = $('#app');
  const centreDist = (pt) => {
    const r = R.svg.getBoundingClientRect();
    return Math.hypot(pt.clientX - r.left - r.width / 2, pt.clientY - r.top - r.height / 2) / (r.width / 400);
  };
  dragDismiss(sheet, {
    mouseHandle: $('.tt-head', sheet),
    canStart: (e) => {
      if (!isOpen || e.target.closest('input, textarea, .tt-data .bar')) return false;
      if (e.target.closest('.tt-svg')) return centreDist(e.touches?.[0] || e) < 150;
      return true;
    },
    onDismiss: () => closeFn?.(),
    onProgress: (p, live) => {
      app.style.transition = live ? 'none' : '';
      app.style.transform = live ? `scale(${0.95 + 0.05 * p})` : '';
      app.style.opacity = live ? String(0.35 + 0.65 * p) : '';
    },
  });

  on('player:load', (t) => {
    if (!t && isOpen) closeFn?.();
    renderTrack();
    renderTime();
    panel?.paint();
  });
  on('player:state', renderState);
  on('player:time', renderTime);
  on('player:rate', renderRate);
  on('player:queue', () => {
    renderCounts();
    panel?.paint();
  });
  on('player:sleep', renderSleep);
  on('player:sleep-tick', renderSleep);
  on('marks', (d) => {
    if (d?.trackId !== player.P.id) return;
    renderMarks();
    renderCounts();
    panel?.paint();
  });
  on('notes', (d) => {
    if (d?.trackId !== player.P.id) return;
    renderCounts();
    panel?.paint();
  });
  on('tracks', renderTrack);
  on('fav', (d) => d?.id === player.P.id && renderTrack());
  on('playlists', renderTrack);
  on('settings', renderSkips);
  document.addEventListener('visibilitychange', () => syncSpin(true));

  renderSkips();
  renderRate();
  renderSleep();
  renderTrack();
}

/* ───────────── open / close ───────────── */

export function openPlayer() {
  if (isOpen || !player.P.id) return;
  isOpen = true;
  renderTrack();
  renderTime();
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.inert = false;
  document.documentElement.classList.add('player-open');
  sfx('open');
  stagger(sheet.querySelectorAll('[data-in]'), { y: 22, step: 42, delay: 110, duration: 600 });
  closeFn = pushLayer(closePlayer, 'player');
  renderState();
}

function closePlayer() {
  isOpen = false;
  closeFn = null;
  sfx('close');
  sheet.classList.remove('open');
  sheet.style.transform = '';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  document.documentElement.classList.remove('player-open');
  setTimeout(() => syncSpin(true), 420);
}

/* ───────────── the record ───────────── */

function ensureSpin() {
  if (spin) return spin;
  spin = R.platter.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1800, iterations: Infinity });
  spin.pause();
  return spin;
}

/** Bring the platter up to speed, or let it coast to a stop. */
function syncSpin(instant = false) {
  const want = isOpen && !document.hidden && player.isPlaying() && motionOK() ? 1 : 0;
  const a = ensureSpin();
  cancelAnimationFrame(spinRaf);
  if (instant || !isOpen) {
    spinRate = want;
    a.playbackRate = Math.max(0.001, want);
    if (want) a.play();
    else a.pause();
    return;
  }
  if (want === Math.round(spinRate) && (spinRate === 0 || spinRate === 1)) return;
  const from = spinRate;
  const t0 = performance.now();
  const dur = want ? 1000 : 1500;
  if (want) a.play();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    spinRate = from + (want - from) * e;
    a.playbackRate = Math.max(0.001, spinRate);
    if (k < 1) spinRaf = requestAnimationFrame(step);
    else if (!want) a.pause();
  };
  spinRaf = requestAnimationFrame(step);
}

function wireRing() {
  const svg = R.svg;
  const at = (e) => {
    const r = svg.getBoundingClientRect();
    const s = 400 / r.width;
    return { x: (e.clientX - r.left) * s - 200, y: (e.clientY - r.top) * s - 200 };
  };
  const frac = ({ x, y }) => (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1;
  let tap = null;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button || !player.P.id) return;
    const p = at(e);
    const d = Math.hypot(p.x, p.y);
    if (d < 124) {
      tap = { x: e.clientX, y: e.clientY };
      return;
    }
    if (d < 150 || d > 222) return;
    e.preventDefault();
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    seeking = { p: frac(p), id: e.pointerId, step: -1 };
    svg.classList.add('seeking');
    renderTime();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!seeking || seeking.id !== e.pointerId) return;
    let p = frac(at(e));
    // Don't wrap past twelve o'clock: the ends of the audio are walls.
    if (Math.abs(p - seeking.p) > 0.5) p = seeking.p > 0.5 ? 0.9995 : 0;
    seeking.p = p;
    const step = Math.floor(p * 120);
    if (step !== seeking.step) {
      seeking.step = step;
      sfx('tick');
    }
    renderTime();
  });
  const end = (e) => {
    if (tap && e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) {
      player.toggle();
      sfx('press');
    }
    tap = null;
    if (!seeking || seeking.id !== e.pointerId) return;
    const p = seeking.p;
    seeking = null;
    svg.classList.remove('seeking');
    if (e.type === 'pointerup') {
      player.seek(p * player.duration());
      haptic(8);
    }
    renderTime();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') player.skip(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') player.skip(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}

function wireDataBar() {
  const el = R.dataBar;
  const frac = (e) => {
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  el.addEventListener('pointerdown', (e) => {
    if (!player.P.id) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    seeking = { p: frac(e), id: e.pointerId, step: -1 };
    renderTime();
  });
  el.addEventListener('pointermove', (e) => {
    if (!seeking || seeking.id !== e.pointerId) return;
    seeking.p = frac(e);
    const step = Math.floor(seeking.p * 60);
    if (step !== seeking.step) {
      seeking.step = step;
      sfx('tick');
    }
    renderTime();
  });
  const end = (e) => {
    if (!seeking || seeking.id !== e.pointerId) return;
    const p = seeking.p;
    seeking = null;
    if (e.type === 'pointerup') player.seek(p * player.duration());
    renderTime();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ───────────── render ───────────── */

function renderSkips() {
  sheet.querySelectorAll('[data-n="back"]').forEach((n) => (n.textContent = state.settings.skipBack));
  sheet.querySelectorAll('[data-n="fwd"]').forEach((n) => (n.textContent = state.settings.skipFwd));
}

function renderTrack() {
  const t = player.current();
  if (!t) return;
  setText(R.title, t.title);
  setText(R.ctx, player.P.context?.label || 'Library');
  R.fav.classList.toggle('on', Boolean(t.favorite));
  const lists = t.playlists.map(getPlaylist).filter(Boolean);
  const html = lists.map((p) => `<span class="lbl dim">${esc(p.name)}</span>`).join('') + `<button class="text-btn ${lists.length ? '' : 'red'}" type="button" data-a="lists">+ Playlist</button>`;
  if (R.tags.dataset.sig !== html) {
    R.tags.dataset.sig = html;
    R.tags.innerHTML = html;
  }
  renderMarks();
  renderCounts();
}

function renderMarks() {
  const t = player.current();
  const d = player.duration();
  if (!t || !d) return (R.marks.innerHTML = '');
  R.marks.innerHTML = t.marks
    .map((m) => {
      const a = (m.t / d) * Math.PI * 2;
      return `<circle cx="${(200 + 194 * Math.sin(a)).toFixed(1)}" cy="${(200 - 194 * Math.cos(a)).toFixed(1)}" r="3.2" fill="${esc(m.color || '#fff')}"/>`;
    })
    .join('');
}

function renderCounts() {
  const t = player.current();
  if (!t) return;
  const m = t.marks.length;
  const n = (t.notes || []).length;
  const q = player.P.queue.length;
  R.counts.innerHTML = `Marks <b>${m}</b> · Notes <b>${n}</b> · Queue <b>${q}</b>`;
  setText(R.mark, m ? `+ ${m}` : '+');
}

function renderState() {
  const playing = player.isPlaying();
  R.pp.dataset.on = playing ? '1' : '0';
  sheet.classList.toggle('playing', playing);
  syncSpin();
  renderTime();
}

let marksFor = '';
function renderTime() {
  if (!player.P.id) return;
  const d = player.duration();
  const t = seeking ? seeking.p * d : player.time();
  const p = d ? clamp(t / d, 0, 1) : 0;
  const deg = (p * 360).toFixed(2);
  R.arc.setAttribute('stroke-dasharray', `${deg} 360`);
  R.knob.style.transform = `rotate(${deg}deg)`;
  R.svg.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  const down = player.isPlaying() || seeking;
  R.arm.style.transform = `rotate(${(down ? ARM_IN + p * ARM_SWEEP : ARM_REST).toFixed(2)}deg)`;
  R.cur.textContent = fmtTime(t, d >= 3600);
  R.of.textContent = d ? `/ ${fmtTime(d)}` : '';
  const left = Math.max(0, d - t);
  const rate = state.settings.speed || 1;
  R.left.textContent = `-${fmtTime(left)}`;
  R.ends.textContent = d ? `Ends ${clockAt((left / rate) * 1000)}` : '';
  R.pct.textContent = String(Math.round(p * 100));
  setBar(R.dataBar, p);
  R.dataSub.textContent = d ? `${fmtTime(t)} of ${fmtTime(d)}` : '';
  // marks sit on the ring by duration, which arrives a moment after the audio loads
  const sig = `${player.P.id}|${Math.round(d)}`;
  if (sig !== marksFor) {
    marksFor = sig;
    renderMarks();
  }
}

function renderRate() {
  const r = state.settings.speed || 1;
  R.speed.set(fmtRate(r));
  R.speed.el.closest('.read').classList.toggle('active', r !== 1);
}

function renderSleep() {
  const s = player.P.sleep;
  const txt = s.mode === 'time' ? fmtTime(player.sleepLeft() / 1000) : s.mode === 'end' ? 'End' : 'Off';
  if (s.mode === 'time') R.sleep.textContent = txt;
  else setText(R.sleep, txt);
  R.sleep.closest('.read').classList.toggle('active', s.mode !== 'off');
}

/* ───────────── marks ───────────── */

async function renameMark(t, id) {
  const m = t.marks.find((x) => x.id === id);
  if (!m) return;
  const name = await prompt({ title: `Mark at ${fmtTime(m.t)}`, value: m.name, ok: 'Save', maxLength: 50 });
  if (name) player.updateMark(t.id, id, { name });
}

function quickMark(btn) {
  const t = player.current();
  const m = t && player.addMark();
  if (!m) return;
  haptic(12);
  if (btn) pop(btn.querySelector('.read-val') || btn, 1.2);
  toast(`Marked ${fmtTime(m.t)}`, { icon: 'mark', duration: 3200, action: { label: 'Name it', fn: () => renameMark(t, m.id) } });
}

/* ───────────── marks · notes · queue ───────────── */

let panelTab = 'marks';
function openPanel() {
  if (panel) return;
  const body = h(`<div><div class="sheet-tabs">${['marks', 'notes', 'queue'].map((k) => `<button class="tab" type="button" data-tab="${k}">${k}</button>`).join('')}</div><div class="pn-body"></div></div>`);
  const box = body.querySelector('.pn-body');
  let noteAt = true;

  const html = () => {
    const t = player.current();
    if (!t) return '';
    if (panelTab === 'marks') {
      return `<button class="add-line press" type="button" data-p="add-mark" data-sfx="none"><span>${icon('mark-plus')}Mark this moment</span><b class="lbl dim">${fmtTime(player.time())}</b></button>
        <ul class="plist">${t.marks
          .map(
            (m) => `<li class="pl-row" data-mid="${m.id}"><i class="mdot" style="--c:${esc(m.color || '#fff')}"></i><button class="name" type="button" data-p="seek" data-t="${m.t}">${esc(m.name)}</button><span class="t">${fmtTime(m.t)}</span><button class="icon-btn sm" type="button" data-p="mark-menu" aria-label="Mark options">${icon('more')}</button></li>`,
          )
          .join('')}</ul>
        ${t.marks.length ? '' : '<p class="note">Marks pin a moment so you can jump back to it. They show as dots on the ring.</p>'}`;
    }
    if (panelTab === 'notes') {
      return `<form class="prompt" data-p="note-form"><textarea class="field" rows="2" maxlength="2000" placeholder="Write a note…"></textarea>
        <div class="prompt-actions"><button class="chip ${noteAt ? 'on' : ''}" type="button" data-p="note-at">${icon('mark')}At ${fmtTime(player.time())}</button><button class="btn solid" type="submit">Add note</button></div></form>
        <div class="plist">${(t.notes || [])
          .slice()
          .reverse()
          .map(
            (n) => `<div class="pl-note" data-nid="${n.id}"><p>${esc(n.text)}</p><div class="pl-note-meta">${n.t != null ? `<button class="text-btn red" type="button" data-p="seek" data-t="${n.t}">▶ ${fmtTime(n.t)}</button>` : ''}<span>${new Date(n.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><button class="text-btn" type="button" data-p="note-del">Delete</button></div></div>`,
          )
          .join('')}</div>`;
    }
    const queued = player.P.queue.map(getTrack).filter(Boolean);
    const after = player.contextPreview(6).map(getTrack).filter(Boolean);
    const row = (x, q) => `<li class="pl-row" data-qid="${x.id}"><i class="mdot" style="--c:${q ? '#ff2d2d' : '#5a5a5a'}"></i><button class="name" type="button" data-p="q-play">${esc(x.title)}</button><span class="t">${x.duration ? fmtTime(x.duration) : ''}</span><button class="icon-btn sm" type="button" data-p="${q ? 'q-x' : 'q-add'}" aria-label="${q ? 'Remove from queue' : 'Play next'}">${icon(q ? 'close' : 'play-next')}</button></li>`;
    return `${queued.length ? `<div class="grp-head"><span class="lbl">Up next</span><button class="text-btn" type="button" data-p="q-clear">Clear</button></div><ul class="plist">${queued.map((x) => row(x, true)).join('')}</ul>` : ''}
      ${after.length ? `<div class="grp-head" style="margin-top:14px"><span class="lbl dim">Then from ${esc(player.P.context?.label || 'Library')}</span></div><ul class="plist">${after.map((x) => row(x, false)).join('')}</ul>` : ''}
      ${queued.length || after.length ? '' : '<p class="note">Nothing lined up. Use “Play next” or “Add to queue” on any audio.</p>'}`;
  };
  const paint = (animate) => {
    body.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === panelTab));
    const typing = box.querySelector('textarea')?.value;
    if (typing) return; // don't wipe a note in progress
    const apply = () => (box.innerHTML = html());
    if (animate) swap(box, apply);
    else apply();
  };

  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const ta = box.querySelector('textarea');
    const t = player.current();
    if (!t || !ta.value.trim()) return;
    player.addNote(t.id, ta.value, noteAt ? player.time() : null);
    ta.value = '';
    sfx('mark');
    paint(true);
  });
  body.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      if (tabBtn.dataset.tab === panelTab) return;
      panelTab = tabBtn.dataset.tab;
      const ta = box.querySelector('textarea');
      if (ta) ta.value = '';
      return paint(true);
    }
    const b = e.target.closest('[data-p]');
    const t = player.current();
    if (!b || !t) return;
    const mid = b.closest('[data-mid]')?.dataset.mid;
    const nid = b.closest('[data-nid]')?.dataset.nid;
    const qid = b.closest('[data-qid]')?.dataset.qid;
    switch (b.dataset.p) {
      case 'add-mark': return quickMark();
      case 'seek':
        player.seek(Number(b.dataset.t));
        if (!player.isPlaying()) player.play();
        return;
      case 'mark-menu':
        return menu(b, [
          { label: 'Rename', icon: 'edit', fn: () => renameMark(t, mid) },
          { label: 'Delete mark', icon: 'trash', danger: true, fn: () => player.removeMark(t.id, mid) },
        ]);
      case 'note-at':
        noteAt = !noteAt;
        return b.classList.toggle('on', noteAt);
      case 'note-del': return player.removeNote(t.id, nid);
      case 'q-play': return player.load(qid, { autoplay: true });
      case 'q-x': return player.removeFromQueue(qid);
      case 'q-add': return player.playNext(qid);
      case 'q-clear': return player.clearQueue();
    }
  });

  const s = openSheet({ title: 'Marks · Notes · Queue', body, onClose: () => (panel = null) });
  panel = { paint: () => paint(false), close: s.close };
  paint(false);
}

/* ───────────── speed & sleep ───────────── */

function openSpeed() {
  const r = state.settings.speed;
  const presets = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const body = h(`
    <div>
      <div class="big-read"><span class="lbl dim">Rate</span><span class="num"><span class="sp-val">${fmtRate(r)}</span><small>×</small></span></div>
      <input class="range" type="range" min="0.5" max="3" step="0.05" value="${r}" aria-label="Playback speed">
      <div class="scale"><span>0.5</span><span>1</span><span>1.5</span><span>2</span><span>2.5</span><span>3</span></div>
      <div class="chips" style="margin-top:16px">${presets.map((v) => `<button type="button" class="chip ${v === r ? 'on' : ''}" data-v="${v}">${v}×</button>`).join('')}</div>
      <p class="note">Pitch stays natural at every speed.</p>
    </div>`);
  const range = body.querySelector('.range');
  const roll = new Roller(body.querySelector('.sp-val'));
  const sync = (v, fromRange) => {
    const up = v >= state.settings.speed;
    player.setSpeed(v);
    roll.set(fmtRate(v), { dir: up ? 1 : -1 });
    if (!fromRange) range.value = v;
    range.style.setProperty('--p', (v - 0.5) / 2.5);
    body.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.v) === Number(v)));
  };
  range.style.setProperty('--p', (r - 0.5) / 2.5);
  range.addEventListener('input', () => sync(Number(range.value), true));
  body.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    sync(Number(c.dataset.v));
    haptic(6);
  });
  openSheet({ title: 'Playback speed', body });
}

let sleepPick = 15;
function openSleep() {
  const body = h(`
    <div>
      <div class="big-read"><span class="lbl dim" id="slStatus"></span><span class="num"><span class="sl-val">${sleepPick}</span><small>min</small></span></div>
      <input class="range" type="range" min="5" max="120" step="5" value="${sleepPick}" aria-label="Sleep timer minutes">
      <div class="scale"><span>5</span><span>30</span><span>60</span><span>90</span><span>120</span></div>
      <div class="chips" style="margin:16px 0"><button type="button" class="chip" data-s="end">End of this audio</button><button type="button" class="chip" data-s="plus">+5 min</button></div>
      <div class="prompt-actions"><button type="button" class="btn ghost" data-s="off">Turn off</button><button type="button" class="btn solid" data-s="start">Start</button></div>
      ${player.P.volumeSupported ? `<label class="ctl-row" style="margin-top:8px"><span>Fade out<small>Volume eases down over the last 30 seconds</small></span><span class="switch"><input type="checkbox" ${state.settings.sleepFade ? 'checked' : ''}><i></i></span></label>` : ''}
    </div>`);
  const range = body.querySelector('.range');
  const roll = new Roller(body.querySelector('.sl-val'));
  const status = body.querySelector('#slStatus');
  const paintRange = () => range.style.setProperty('--p', (range.value - 5) / 115);
  const paint = () => {
    const sl = player.P.sleep;
    body.querySelector('[data-s="end"]').classList.toggle('on', sl.mode === 'end');
    body.querySelector('[data-s="plus"]').hidden = sl.mode !== 'time';
    status.textContent = sl.mode === 'time' ? `${fmtTime(player.sleepLeft() / 1000)} left · ${clockAt(player.sleepLeft())}` : sl.mode === 'end' ? 'Pauses at the end' : 'Pause after';
  };
  paintRange();
  paint();
  range.addEventListener('input', () => {
    const v = Number(range.value);
    roll.set(String(v), { dir: v > sleepPick ? 1 : -1 });
    sleepPick = v;
    paintRange();
  });
  const timer = setInterval(paint, 1000);
  const s = openSheet({ title: 'Sleep timer', body, onClose: () => clearInterval(timer) });
  body.addEventListener('click', (e) => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (!k) return;
    if (k === 'plus') {
      player.extendSleep(5);
      return paint();
    }
    if (k === 'start') {
      player.setSleep(sleepPick);
      toast(`Sleeping in ${sleepPick} min`, { icon: 'moon', duration: 2000 });
    } else if (k === 'end') {
      player.setSleep('end');
      toast('Pauses when this audio ends', { icon: 'moon', duration: 2000 });
    } else player.setSleep(0);
    s.close();
  });
  body.addEventListener('change', (e) => e.target.matches('.switch input') && setSetting('sleepFade', e.target.checked));
}
