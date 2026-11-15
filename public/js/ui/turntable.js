// The player: a record on a platter inside a ring of hairline ticks. The ring is the
// timeline — drag around it to move through the audio. The tone-arm rides inward as it
// plays and lifts when it stops. Opening it, the small record flies up and becomes this one.
import { state, on, getPlaylist, getTrack, setSetting } from '../store.js';
import * as player from '../player.js';
import { icon } from '../icons.js';
import { Roller, setText, swap, dragDismiss, pop, EASE } from '../anim.js';
import { $, h, esc, fmtTime, clamp, clockAt, haptic, motionOK } from '../util.js';
import { pushLayer } from '../nav.js';
import { sfx } from '../fx.js';
import { toast } from './toast.js';
import { openSheet, menu, prompt } from './sheet.js';
import { trackMenu, toggleFavorite, shareTrack } from './track-actions.js';
import { pp, holdToScrub } from './kit.js';

const ARM_REST = -4;
const ARM_IN = 6.7;
const ARM_SWEEP = 24.1;
const PLATTER = 118 / 200; // platter radius as a share of the svg's half-width
const fmtRate = (r) => `${Math.round(r * 100) / 100}`;

let sheet;
let R = {};
let isOpen = false;
let closeFn = null;
let spin = null;
let spinRate = 0;
let spinRaf = 0;
let seeking = null;
let panel = null;
let scrubDir = 0;
let armHeld = false;
let armPreview = null;

const grooves = [110, 102, 95, 88, 80, 72, 64, 56].map((r, i) => `<circle cx="200" cy="200" r="${r}" fill="none" stroke="rgba(242,239,233,${i % 2 ? 0.045 : 0.07})"/>`).join('');

const discSVG = () => `
  <svg class="tt-svg" id="ttSvg" viewBox="0 0 400 400" role="slider" tabindex="0" aria-label="Position in audio" aria-valuemin="0" aria-valuemax="100">
    <defs>
      <mask id="ttMask" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
        <path id="ttArc" d="M200 22 A178 178 0 0 1 200 378 A178 178 0 0 1 200 22" fill="none" stroke="#fff" stroke-width="30" pathLength="360" stroke-dasharray="0 360"/>
      </mask>
      <radialGradient id="ttVinyl" cx="50%" cy="50%" r="50%"><stop offset="0.3" stop-color="#151515"/><stop offset="1" stop-color="#0b0b0b"/></radialGradient>
      <linearGradient id="ttSheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <g class="tt-ring">
      <circle class="tt-ticks" cx="200" cy="200" r="178" fill="none" stroke-width="16" pathLength="360" stroke-dasharray="0.45 2.55"/>
      <circle class="tt-ticks-on" cx="200" cy="200" r="178" fill="none" stroke-width="16" pathLength="360" stroke-dasharray="0.45 2.55" mask="url(#ttMask)"/>
      <g id="ttMarks"></g>
      <g class="tt-knob" id="ttKnob"><circle cx="200" cy="22" r="4.5" fill="#f2efe9"/></g>
    </g>
    <g class="tt-platter" id="ttPlatter">
      <circle cx="200" cy="200" r="118" fill="url(#ttVinyl)"/>
      <circle cx="200" cy="200" r="117.5" fill="none" stroke="rgba(242,239,233,.12)"/>
      ${grooves}
      <path d="M200 86 A114 114 0 0 1 300 140 L200 200 Z" fill="url(#ttSheen)"/>
      <path d="M200 314 A114 114 0 0 1 100 260 L200 200 Z" fill="url(#ttSheen)"/>
      <circle cx="200" cy="200" r="40" style="fill:var(--red)"/>
      <circle cx="200" cy="200" r="31" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="0.8"/>
      <rect x="199.2" y="167" width="1.6" height="9" rx="0.8" fill="#fff" opacity=".85"/>
    </g>
    <circle cx="200" cy="200" r="4" fill="#080808" stroke="rgba(242,239,233,.5)" stroke-width="1"/>
    <g class="tt-arm-wrap">
      <circle cx="318" cy="96" r="14" fill="#121212" stroke="rgba(242,239,233,.16)"/>
      <g class="tt-arm" id="ttArm">
        <line x1="318" y1="74" x2="318" y2="96" stroke="rgba(242,239,233,.4)" stroke-width="6" stroke-linecap="round"/>
        <line x1="318" y1="96" x2="318" y2="230" stroke="#f2efe9" stroke-width="2" stroke-linecap="round"/>
        <rect x="312" y="226" width="12" height="20" rx="3" fill="#f2efe9"/>
        <circle cx="318" cy="96" r="4" fill="#f2efe9"/>
      </g>
    </g>
  </svg>`;

export function mountPlayer() {
  sheet = $('#player');
  sheet.innerHTML = `
  <div class="player-bg"></div>
  <div class="tt">
    <header class="tt-head" data-in>
      <button class="icon-btn" type="button" data-a="collapse" data-fx="drop" data-sfx="none" aria-label="Close player">${icon('chev-down')}</button>
      <span class="tt-head-r">
        <button class="icon-btn" type="button" data-a="panel" aria-label="Marks, notes and queue">${icon('queue')}</button>
        <button class="icon-btn" type="button" data-a="more" aria-label="More">${icon('more')}</button>
      </span>
    </header>
    <div class="tt-stage">${discSVG()}</div>
    <div class="tt-info" data-in>
      <h2 class="tt-title" id="ttTitle"></h2>
      <button class="icon-btn fav" type="button" data-a="fav" aria-label="Favourite">${icon('star', 's-a')}${icon('star-fill', 's-b')}</button>
      <span class="tt-sub" id="ttSub"></span>
    </div>
    <div class="tt-time" data-in>
      <span class="num" id="ttCur">0:00</span>
      <span class="tt-left" id="ttLeft"></span>
    </div>
    <div class="tt-ctl" data-in>
      <button class="icon-btn" type="button" data-a="prev" data-fx="nudge-l" aria-label="Previous">${icon('prev')}</button>
      <button class="icon-btn skip" type="button" data-a="back" data-fx="spin-l" data-sfx="none" aria-label="Skip back">${icon('back')}<b class="n" data-n="back"></b></button>
      <button class="metal" type="button" data-a="toggle" data-sfx="press" aria-label="Play or pause">${pp()}</button>
      <button class="icon-btn skip" type="button" data-a="fwd" data-fx="spin-r" data-sfx="none" aria-label="Skip forward">${icon('fwd')}<b class="n" data-n="fwd"></b></button>
      <button class="icon-btn" type="button" data-a="next" data-fx="nudge-r" aria-label="Next">${icon('next')}</button>
    </div>
    <div class="tt-acts" data-in>
      <button class="act" type="button" data-a="speed" data-fx="wiggle" aria-label="Speed">${icon('gauge')}<b id="rdSpeed"></b></button>
      <button class="act" type="button" data-a="sleep" data-fx="tilt" aria-label="Sleep timer">${icon('moon')}<b id="rdSleep"></b></button>
      <button class="act" type="button" data-a="mark" data-fx="stamp" data-sfx="none" aria-label="Mark this moment">${icon('mark-plus')}<b id="rdMark"></b></button>
      <button class="act" type="button" data-a="notes" aria-label="Notes">${icon('note')}<b id="rdNotes"></b></button>
    </div>
  </div>`;

  R = {
    svg: $('#ttSvg'),
    ring: $('.tt-ring', sheet),
    arm: $('#ttArm'),
    armWrap: $('.tt-arm-wrap', sheet),
    arc: $('#ttArc'),
    knob: $('#ttKnob'),
    marks: $('#ttMarks'),
    platter: $('#ttPlatter'),
    title: $('#ttTitle'),
    sub: $('#ttSub'),
    cur: $('#ttCur'),
    left: $('#ttLeft'),
    pp: $('.metal .pp', sheet),
    fav: $('.fav', sheet),
    sleep: $('#rdSleep'),
    mark: $('#rdMark'),
    notes: $('#rdNotes'),
    speedBtn: $('[data-a="speed"]', sheet),
  };
  R.speed = $('#rdSpeed');

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
      case 'speed': return openSpeed();
      case 'sleep': return openSleep();
      case 'mark': return quickMark(b);
      case 'notes': return openPanel('notes');
      case 'share': return t && shareTrack(b, t);
      case 'panel': return openPanel(panelTab === 'notes' ? 'marks' : panelTab);
    }
  });

  wireRing();
  wireArm();
  holdToScrub($('[data-a="prev"]', sheet), -1);
  holdToScrub($('[data-a="next"]', sheet), 1);
  holdToScrub($('[data-a="back"]', sheet), -1);
  holdToScrub($('[data-a="fwd"]', sheet), 1);
  on('player:scrub', ({ dir }) => {
    scrubDir = dir;
    const a = ensureSpin();
    cancelAnimationFrame(spinRaf);
    if (dir && isOpen && motionOK()) {
      a.play();
      a.playbackRate = dir * 7; // the record whirs forward or back while you hold
    } else syncSpin(true);
    renderTime();
  });

  const app = $('#app');
  const centreDist = (pt) => {
    const r = R.svg.getBoundingClientRect();
    return Math.hypot(pt.clientX - r.left - r.width / 2, pt.clientY - r.top - r.height / 2) / (r.width / 400);
  };
  dragDismiss(sheet, {
    mouseHandle: $('.tt-head', sheet),
    canStart: (e) => {
      if (!isOpen || e.target.closest('input, textarea, .tt-arm')) return false;
      if (e.target.closest('.tt-svg')) return centreDist(e.touches?.[0] || e) < 150;
      return true;
    },
    onDismiss: () => closeFn?.(),
    onProgress: (p, live) => {
      app.style.transition = live ? 'none' : '';
      app.style.opacity = live ? String(p * 0.9) : '';
      app.style.transform = live ? `scale(${0.94 + 0.06 * p})` : '';
    },
  });

  on('player:load', (t) => {
    if (!t && isOpen) closeFn?.();
    renderTrack(true);
    renderTime();
    panel?.paint();
  });
  on('player:state', renderState);
  on('player:time', renderTime);
  on('player:rate', renderRate);
  on('player:queue', () => panel?.paint());
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
  on('tracks', () => renderTrack());
  on('fav', (d) => d?.id === player.P.id && renderTrack());
  on('playlists', () => renderTrack());
  on('settings', renderSkips);
  document.addEventListener('visibilitychange', () => syncSpin(true));

  renderSkips();
  renderRate();
  renderSleep();
  renderTrack();
}

/* ───────────── open / close: the record flies between the mini player and here ───────────── */

/** Where an element sits once the app behind the player has scaled back to normal. */
function restingRect(el) {
  const r = el.getBoundingClientRect();
  if (!document.documentElement.classList.contains('player-open')) return r;
  const k = 0.94;
  const ox = innerWidth / 2;
  const oy = innerHeight * 0.3;
  return { left: ox + (r.left - ox) / k, top: oy + (r.top - oy) / k, width: r.width / k, height: r.height / k };
}

/** Transform that puts the big platter exactly over `rect`. */
function platterOver(rect) {
  const s = R.svg.getBoundingClientRect();
  const size = s.width * PLATTER * 2;
  const k = rect.width / size;
  const dx = rect.left + rect.width / 2 - (s.left + s.width / 2);
  const dy = rect.top + rect.height / 2 - (s.top + s.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${k})`;
}

const visible = (el) => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;

// The small record the big one came from. It hides while the big one is out, so there is
// only ever one record on screen.
let source = null;
const hideSource = (el) => {
  if (source && source !== el) source.style.visibility = '';
  source = el || null;
  if (source) source.style.visibility = 'hidden';
};
let flight = 0;
const stopFlight = () => sheet.getAnimations({ subtree: true }).forEach((a) => a.id === 'fly' && a.cancel());

export function openPlayer(fromEl) {
  if (isOpen || !player.P.id) return;
  const from = [fromEl, $('.strip-disc')].find(visible);
  const fromRect = from && motionOK() ? from.getBoundingClientRect() : null;
  isOpen = true;
  flight += 1;
  stopFlight();
  sheet.style.transform = '';
  sheet.style.visibility = '';
  renderTrack();
  renderTime();
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.inert = false;
  document.documentElement.classList.add('player-open');
  sfx('open');
  closeFn = pushLayer(closePlayer, 'player');
  renderState();
  if (!motionOK()) return;
  if (fromRect) hideSource(from);
  sheet.querySelectorAll('[data-in]').forEach((el, i) => {
    const an = el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160 + i * 40, easing: EASE.out, fill: 'backwards' });
    an.id = 'fly';
  });
  if (fromRect) {
    R.svg.animate([{ transform: platterOver(fromRect) }, { transform: 'none' }], { duration: 640, easing: 'cubic-bezier(0.2, 0.85, 0.1, 1)' }).id = 'fly';
    for (const el of [R.ring, R.armWrap]) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 460, delay: 300, easing: 'ease-out', fill: 'backwards' }).id = 'fly';
  } else {
    R.svg.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE.out }).id = 'fly';
  }
}

function closePlayer() {
  isOpen = false;
  closeFn = null;
  const mine = ++flight;
  sfx('close');
  const to = $('.strip-disc');
  const toRect = visible(to) && motionOK() ? restingRect(to) : null;
  // the record lands on the mini player's disc: that one stays hidden until it does
  if (toRect) hideSource(to);
  else hideSource(null);
  document.documentElement.classList.remove('player-open');
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  const done = () => {
    if (mine !== flight || isOpen) return;
    sheet.style.visibility = 'hidden'; // hide the flown record and the reveal the mini one in the same frame
    hideSource(null);
    requestAnimationFrame(() => {
      if (mine !== flight || isOpen) return;
      stopFlight();
      sheet.style.transform = '';
      syncSpin(true);
    });
  };
  if (!motionOK()) return done();
  sheet.querySelectorAll('[data-in]').forEach((el) => (el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 150, easing: 'ease-out', fill: 'forwards' }).id = 'fly'));
  for (const el of [R.ring, R.armWrap]) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).id = 'fly';
  const from = getComputedStyle(R.svg).transform;
  const fly = toRect
    ? R.svg.animate([{ transform: from === 'none' ? 'none' : from }, { transform: platterOver(toRect) }], { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' })
    : R.svg.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.92)' }], { duration: 220, fill: 'forwards' });
  fly.id = 'fly';
  fly.finished.then(done, done);
}

/* ───────────── the record ───────────── */

function ensureSpin() {
  if (spin) return spin;
  spin = R.platter.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1800, iterations: Infinity });
  spin.pause();
  return spin;
}

/** Bring the platter up to speed, or let it coast down. */
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
  if (want === spinRate) return;
  const from = spinRate;
  const t0 = performance.now();
  const dur = want ? 1100 : 1700;
  if (want) a.play();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    spinRate = from + (want - from) * e;
    a.playbackRate = Math.max(0.001, spinRate);
    if (k < 1) spinRaf = requestAnimationFrame(step);
    else {
      spinRate = want;
      if (!want) a.pause();
    }
  };
  spinRaf = requestAnimationFrame(step);
}

/* Pick the tone-arm up. A tap plays or pauses. Drop it on the record and the audio jumps to
   where the needle landed (further in = later); drop it off the record and it stops, and the
   arm swings back to its rest. */
function wireArm() {
  const arm = R.arm;
  arm.insertAdjacentHTML('afterbegin', '<line class="tt-arm-grip" x1="318" y1="78" x2="318" y2="252" stroke="transparent" stroke-width="28" stroke-linecap="round"/>');
  const L = 150; // pivot to needle
  const pivot = () => {
    const r = R.svg.getBoundingClientRect();
    const k = r.width / 400;
    return { x: r.left + 318 * k, y: r.top + 96 * k };
  };
  const angleAt = (e) => {
    const p = pivot();
    return (Math.atan2(-(e.clientX - p.x), e.clientY - p.y) * 180) / Math.PI;
  };
  const onRecord = (deg) => {
    const a = (deg * Math.PI) / 180;
    const r = Math.hypot(318 - L * Math.sin(a) - 200, 96 + L * Math.cos(a) - 200);
    return r > 46 && r < 124;
  };
  const progressAt = (deg) => clamp((deg - ARM_IN) / ARM_SWEEP, 0, 1);
  const restingDeg = () => {
    const d = player.duration();
    const p = d ? clamp(player.time() / d, 0, 1) : 0;
    return player.isPlaying() ? ARM_IN + p * ARM_SWEEP : ARM_REST;
  };
  let g = null;
  arm.addEventListener('pointerdown', (e) => {
    if (e.button || !player.P.id) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      arm.setPointerCapture(e.pointerId);
    } catch {}
    const start = restingDeg();
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, off: angleAt(e) - start, deg: start, moved: false, lastOn: null };
  });
  arm.addEventListener('pointermove', (e) => {
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
    if (!g.moved) {
      g.moved = true;
      armHeld = true;
      arm.classList.add('held');
      haptic(8);
      sfx('tick');
    }
    let deg = angleAt(e) - g.off;
    // soft stops: it can swing well past either side, but resists more the further it goes
    const lo = -26;
    const hi = 44;
    if (deg < lo) deg = lo - Math.sqrt(lo - deg) * 2;
    if (deg > hi) deg = hi + Math.sqrt(deg - hi) * 2;
    g.deg = deg;
    arm.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    const on = onRecord(deg);
    if (on !== g.lastOn) {
      g.lastOn = on;
      R.svg.classList.toggle('arm-over', on);
      if (g.lastOn !== null) sfx('tick');
    }
    armPreview = on ? progressAt(deg) : null;
    renderTime();
  });
  const end = (e) => {
    if (!g || g.id !== e.pointerId) return;
    const was = g;
    g = null;
    armHeld = false;
    armPreview = null;
    arm.classList.remove('held');
    R.svg.classList.remove('arm-over');
    if (!was.moved) {
      if (e.type === 'pointerup') {
        player.toggle();
        sfx('press');
      }
      return renderTime();
    }
    if (e.type === 'pointerup' && onRecord(was.deg)) {
      const d = player.duration();
      if (d) player.seek(progressAt(was.deg) * d);
      if (!player.isPlaying()) player.play();
      sfx('press');
      haptic(10);
    } else if (e.type === 'pointerup') {
      if (player.isPlaying()) player.pause();
      sfx('off');
    }
    renderTime();
  };
  arm.addEventListener('pointerup', end);
  arm.addEventListener('pointercancel', end);
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
    if (d < 146 || d > 226) return;
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
    // The top of the ring is a wall: no wrapping from the end back to the start.
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

/* ───────────── render ───────────── */

function renderSkips() {
  sheet.querySelectorAll('[data-n="back"]').forEach((n) => (n.textContent = state.settings.skipBack));
  sheet.querySelectorAll('[data-n="fwd"]').forEach((n) => (n.textContent = state.settings.skipFwd));
}

let titleFor = '';
function renderTrack(fresh = false) {
  const t = player.current();
  if (!t) return;
  if (fresh && titleFor && titleFor !== t.id && isOpen) swap(R.title, () => (R.title.textContent = t.title));
  else setText(R.title, t.title);
  titleFor = t.id;
  const lists = t.playlists.map(getPlaylist).filter(Boolean).map((p) => p.name);
  setText(R.sub, [t.uploader, ...lists].filter(Boolean).join(' · '));
  R.fav.classList.toggle('on', Boolean(t.favorite));
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
      return `<circle cx="${(200 + 197 * Math.sin(a)).toFixed(1)}" cy="${(200 - 197 * Math.cos(a)).toFixed(1)}" r="2.6" style="fill:var(--red)"/>`;
    })
    .join('');
}

function renderCounts() {
  const t = player.current();
  if (!t) return;
  setText(R.mark, t.marks.length ? String(t.marks.length) : '');
  setText(R.notes, (t.notes || []).length ? String(t.notes.length) : '');
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
  const t = seeking ? seeking.p * d : armPreview != null ? armPreview * d : player.time();
  const p = d ? clamp(t / d, 0, 1) : 0;
  const deg = (p * 360).toFixed(2);
  R.arc.setAttribute('stroke-dasharray', `${deg} 360`);
  R.knob.style.transform = `rotate(${deg}deg)`;
  R.svg.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  const down = player.isPlaying() || seeking || scrubDir;
  if (!armHeld) R.arm.style.transform = `rotate(${(down ? ARM_IN + p * ARM_SWEEP : ARM_REST).toFixed(2)}deg)`;
  R.cur.textContent = fmtTime(t, d >= 3600);
  const left = Math.max(0, d - t);
  R.left.textContent = d ? `-${fmtTime(left)}` : '';
  const sig = `${player.P.id}|${Math.round(d)}`;
  if (sig !== marksFor) {
    marksFor = sig;
    renderMarks();
  }
}

function renderRate() {
  const r = state.settings.speed || 1;
  setText(R.speed, r === 1 ? '' : `${fmtRate(r)}×`);
  R.speedBtn.classList.toggle('active', r !== 1);
}

function renderSleep() {
  const s = player.P.sleep;
  const txt = s.mode === 'time' ? fmtTime(player.sleepLeft() / 1000) : s.mode === 'end' ? 'End' : '';
  if (s.mode === 'time') R.sleep.textContent = txt;
  else setText(R.sleep, txt);
  R.sleep.closest('.act').classList.toggle('active', s.mode !== 'off');
}

/* ───────────── marks ───────────── */

async function renameMark(t, id) {
  const m = t.marks.find((x) => x.id === id);
  if (!m) return;
  const name = await prompt({ title: `Moment at ${fmtTime(m.t)}`, value: m.name, ok: 'Save', maxLength: 50 });
  if (name) player.updateMark(t.id, id, { name });
}

function quickMark(btn) {
  const t = player.current();
  const m = t && player.addMark();
  if (!m) return;
  haptic(12);
  if (btn) pop(btn.querySelector('svg') || btn, 1.25);
  toast(`Marked ${fmtTime(m.t)}`, { duration: 3200, action: { label: 'Name', fn: () => renameMark(t, m.id) } });
}

/* ───────────── marks · notes · queue ───────────── */

let panelTab = 'marks';
const TABS = [
  ['marks', 'Moments'],
  ['notes', 'Notes'],
  ['queue', 'Up next'],
];
function openPanel(tab = panelTab) {
  panelTab = tab;
  if (panel) return panel.paint(true);
  const body = h(`<div><div class="sheet-tabs">${TABS.map(([k, l]) => `<button class="tab" type="button" data-tab="${k}">${l}</button>`).join('')}</div><div class="pn-body"></div></div>`);
  const box = body.querySelector('.pn-body');
  let noteAt = true;

  const html = () => {
    const t = player.current();
    if (!t) return '';
    if (panelTab === 'marks') {
      return `<button class="add-line press" type="button" data-p="add-mark" data-sfx="none"><span>${icon('mark-plus')}Mark this moment</span><b>${fmtTime(player.time())}</b></button>
        <ul class="plist">${t.marks
          .map(
            (m) => `<li class="pl-row" data-mid="${m.id}"><button class="t" type="button" data-p="seek" data-t="${m.t}">${fmtTime(m.t)}</button><button class="name" type="button" data-p="seek" data-t="${m.t}">${esc(m.name)}</button><button class="icon-btn sm dim" type="button" data-p="mark-menu" aria-label="Options">${icon('more')}</button></li>`,
          )
          .join('')}</ul>`;
    }
    if (panelTab === 'notes') {
      return `<form class="prompt" data-p="note-form"><textarea class="field" rows="2" maxlength="2000" placeholder="Write a note"></textarea>
        <div class="prompt-actions"><button class="chip ${noteAt ? 'on' : ''}" type="button" data-p="note-at">At ${fmtTime(player.time())}</button><button class="btn solid" type="submit">Save</button></div></form>
        <div class="plist">${(t.notes || [])
          .slice()
          .reverse()
          .map(
            (n) => `<div class="pl-note" data-nid="${n.id}"><p>${esc(n.text)}</p><div class="pl-note-meta">${n.t != null ? `<button class="text-btn" style="color:var(--red)" type="button" data-p="seek" data-t="${n.t}">${fmtTime(n.t)}</button>` : ''}<button class="text-btn" type="button" data-p="note-del">Delete</button></div></div>`,
          )
          .join('')}</div>`;
    }
    const queued = player.P.queue.map(getTrack).filter(Boolean);
    const after = player.contextPreview(6).map(getTrack).filter(Boolean);
    const row = (x, q) => `<li class="pl-row q" data-qid="${x.id}"><span class="t">${x.duration ? fmtTime(x.duration) : ''}</span><button class="name" type="button" data-p="q-play">${esc(x.title)}</button><button class="icon-btn sm dim" type="button" data-p="${q ? 'q-x' : 'q-add'}" aria-label="${q ? 'Remove' : 'Play next'}">${icon(q ? 'close' : 'play-next')}</button></li>`;
    return `${queued.length ? `<ul class="plist">${queued.map((x) => row(x, true)).join('')}</ul><button class="text-btn" type="button" data-p="q-clear">Clear queue</button>` : ''}
      ${after.length ? `<span class="sub-note">Then</span><ul class="plist">${after.map((x) => row(x, false)).join('')}</ul>` : ''}
      ${queued.length || after.length ? '' : '<p class="note">Nothing lined up.</p>'}`;
  };
  const paint = (animate) => {
    body.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === panelTab));
    if (box.querySelector('textarea')?.value) return; // don't wipe a note being written
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
          { label: 'Delete', icon: 'trash', danger: true, fn: () => player.removeMark(t.id, mid) },
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

  const s = openSheet({ body, onClose: () => (panel = null) });
  panel = { paint, close: s.close };
  paint(false);
}

/* ───────────── speed & sleep ───────────── */

function openSpeed() {
  const r = state.settings.speed;
  const presets = [0.75, 1, 1.25, 1.5, 2, 2.5];
  const body = h(`
    <div>
      <div class="big-read"><span class="num"><span class="sp-val">${fmtRate(r)}</span><small>×</small></span></div>
      <input class="range" type="range" min="0.5" max="3" step="0.05" value="${r}" aria-label="Playback speed">
      <div class="scale"><span>0.5</span><span>1</span><span>1.5</span><span>2</span><span>2.5</span><span>3</span></div>
      <div class="chips" style="margin-top:18px">${presets.map((v) => `<button type="button" class="chip ${v === r ? 'on' : ''}" data-v="${v}">${v}×</button>`).join('')}</div>
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
  openSheet({ title: 'Speed', body });
}

let sleepPick = 15;
function openSleep() {
  const body = h(`
    <div>
      <div class="big-read"><span class="num"><span class="sl-val">${sleepPick}</span><small>min</small></span><span class="cap" id="slStatus"></span></div>
      <input class="range" type="range" min="5" max="120" step="5" value="${sleepPick}" aria-label="Sleep timer minutes">
      <div class="scale"><span>5</span><span>30</span><span>60</span><span>90</span><span>120</span></div>
      <div class="chips" style="margin:18px 0"><button type="button" class="chip" data-s="end">End of audio</button><button type="button" class="chip" data-s="plus">+5 min</button></div>
      <div class="prompt-actions"><button type="button" class="btn ghost" data-s="off">Off</button><button type="button" class="btn solid" data-s="start">Start</button></div>
      ${player.P.volumeSupported ? `<label class="ctl-row" style="margin-top:10px"><span>Fade out</span><span class="switch"><input type="checkbox" ${state.settings.sleepFade ? 'checked' : ''}><i></i></span></label>` : ''}
    </div>`);
  const range = body.querySelector('.range');
  const roll = new Roller(body.querySelector('.sl-val'));
  const status = body.querySelector('#slStatus');
  const paintRange = () => range.style.setProperty('--p', (range.value - 5) / 115);
  const paint = () => {
    const sl = player.P.sleep;
    body.querySelector('[data-s="end"]').classList.toggle('on', sl.mode === 'end');
    body.querySelector('[data-s="plus"]').hidden = sl.mode !== 'time';
    status.textContent = sl.mode === 'time' ? `stops ${clockAt(player.sleepLeft())}` : sl.mode === 'end' ? 'at the end' : '';
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
  const s = openSheet({ title: 'Sleep', body, onClose: () => clearInterval(timer) });
  body.addEventListener('click', (e) => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (!k) return;
    if (k === 'plus') {
      player.extendSleep(5);
      return paint();
    }
    if (k === 'start') player.setSleep(sleepPick);
    else if (k === 'end') player.setSleep('end');
    else player.setSleep(0);
    s.close();
  });
  body.addEventListener('change', (e) => e.target.matches('.switch input') && setSetting('sleepFade', e.target.checked));
}
