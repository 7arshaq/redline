// Motion toolkit. Rules: transform/opacity/clip-path only, custom curves, exits faster than entrances,
// everything interruptible, and reduced-motion users get fades instead of movement.
import { motionOK } from './util.js';

export const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  pop: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
};

/** Odometer-style text: changed digits roll in instead of snapping. */
export class Roller {
  constructor(el, { dir = 1 } = {}) {
    this.el = el;
    this.dir = dir;
    this.value = el.textContent || '';
    el.classList.add('roller');
  }
  set(text, { animate = true, dir = this.dir } = {}) {
    text = String(text);
    if (text === this.value) return;
    const prev = this.value;
    this.value = text;
    const el = this.el;
    if (!animate || !prev || !motionOK() || !el.isConnected || document.hidden) {
      el.textContent = text;
      return;
    }
    const frag = document.createDocumentFragment();
    const n = text.length;
    const m = prev.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      const pc = prev[m - (n - i)];
      const cell = document.createElement('span');
      cell.className = 'rc';
      cell.textContent = c;
      frag.append(cell);
      if (c !== pc) {
        cell.animate(
          [
            { transform: `translateY(${dir * 0.42}em)`, opacity: 0, filter: 'blur(2px)' },
            { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' },
          ],
          { duration: 280, easing: EASE.out, delay: Math.max(0, (n - i - 1) * -12) },
        );
      }
    }
    el.replaceChildren(frag);
  }
}

/* ───────────── views grow out of the thing that opened them ─────────────
   A surface in the source's colour travels from the button to the stage.
   The real view fades in on top.
   The source can sit outside the stage (the bottom nav row), so the travelling parts are
   viewport-fixed and the view itself is clipped to the part of the path inside the stage. */

const visibleRect = (el) => (el && el.isConnected && el.getClientRects().length ? el.getBoundingClientRect() : null);
const solid = (c) => (c && !/rgba\(.*,\s*0\)$|transparent/.test(c) ? c : null);

function insetFor(r, box, radius) {
  const t = Math.min(box.height, Math.max(0, r.top - box.top));
  const l = Math.min(box.width, Math.max(0, r.left - box.left));
  const rr = Math.min(box.width, Math.max(0, box.right - r.right));
  const b = Math.min(box.height, Math.max(0, box.bottom - r.bottom));
  return `inset(${t}px ${rr}px ${b}px ${l}px round ${radius}px)`;
}
const viewInset = (r, radius) => `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round ${radius}px)`;

/**
 * Clip keyframes for the view itself: the part of the travelling rectangle that is inside
 * the stage. While the rectangle is still below (or beside) the stage that part is empty,
 * so an edge only starts moving at the moment the rectangle crosses in — hence the extra
 * keyframes at those crossing points. With them the view's edges sit exactly on the
 * surface's edges for the whole trip.
 */
function clipKeyframes(src, box, rSrc, rBox) {
  const pts = [0, 1];
  const cross = (num, den) => {
    const p = den ? num / den : 0;
    if (p > 0.001 && p < 0.999) pts.push(p);
  };
  if (src.top > box.bottom) cross(src.top - box.bottom, src.top - box.top);
  if (src.bottom < box.top) cross(box.top - src.bottom, box.bottom - src.bottom);
  if (src.left > box.right) cross(src.left - box.right, src.left - box.left);
  if (src.right < box.left) cross(box.left - src.right, box.right - src.right);
  const mix = (a, b, p) => a + (b - a) * p;
  return pts
    .sort((a, b) => a - b)
    .map((p) => ({
      offset: p,
      clipPath: insetFor({ top: mix(src.top, box.top, p), left: mix(src.left, box.left, p), right: mix(src.right, box.right, p), bottom: mix(src.bottom, box.bottom, p) }, box, mix(rSrc, rBox, p)),
    }));
}
function ghosts(el) {
  const surf = document.createElement('i');
  surf.className = 'xp-surf';
  surf.style.zIndex = el.style.zIndex || '20';
  el.before(surf);
  return { surf };
}

export function expandFrom(el, fromEl, box, radius = 10) {
  const from = visibleRect(fromEl);
  if (!from || !motionOK()) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }).finished;
  }
  const cs = getComputedStyle(fromEl);
  const bg = getComputedStyle(el).backgroundColor;
  const fromBg = solid(cs.backgroundColor) || bg;
  const fromR = parseFloat(cs.borderTopLeftRadius) || radius;
  const { surf } = ghosts(el);
  const opts = { duration: 540, easing: EASE.drawer, fill: 'both' };
  surf.animate(
    [
      { clipPath: viewInset(from, fromR), backgroundColor: fromBg },
      { backgroundColor: bg, offset: 0.4 },
      { clipPath: viewInset(box, radius), backgroundColor: bg },
    ],
    opts,
  );
  const clip = el.animate(clipKeyframes(from, box, fromR, radius), opts);
  const done = el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.42 }, { opacity: 1 }], { duration: 540, easing: 'ease-out', fill: 'backwards' }).finished;
  const clean = () => {
    surf.remove();
    clip.cancel();
  };
  return done.then(clean, clean);
}

export function collapseTo(el, toEl, box, radius = 10) {
  const to = visibleRect(toEl);
  if (!to || !motionOK()) {
    return el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(16px) scale(.985)' }], {
      duration: 220,
      easing: EASE.out,
      fill: 'forwards',
    }).finished;
  }
  const cs = getComputedStyle(toEl);
  const bg = getComputedStyle(el).backgroundColor;
  const toBg = solid(cs.backgroundColor) || bg;
  const toR = parseFloat(cs.borderTopLeftRadius) || radius;
  const { surf } = ghosts(el);
  const opts = { duration: 400, easing: EASE.drawer, fill: 'both' };
  surf.animate(
    [
      { clipPath: viewInset(box, radius), backgroundColor: bg },
      { backgroundColor: bg, offset: 0.5 },
      { clipPath: viewInset(to, toR), backgroundColor: toBg },
    ],
    opts,
  );
  el.animate(
    clipKeyframes(to, box, toR, radius)
      .map((k) => ({ ...k, offset: 1 - k.offset }))
      .reverse(),
    opts,
  );
  const done = el.animate([{ opacity: 1 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration: 400, easing: 'ease-out', fill: 'forwards' }).finished;
  const clean = () => {
    surf.remove();
  };
  return done.then(clean, clean);
}

/** Cascade a group in. Decorative only: never blocks input. */
export function stagger(els, { y = 10, step = 34, duration = 420, delay = 0, scale = 1, max = 14 } = {}) {
  const list = [...els].filter(Boolean);
  if (!motionOK()) {
    list.forEach((e) => e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' }));
    return;
  }
  list.forEach((e, i) => {
    e.animate(
      [
        { opacity: 0, transform: `translateY(${y}px) scale(${scale})` },
        { opacity: 1, transform: 'none' },
      ],
      { duration, easing: EASE.out, delay: delay + Math.min(i, max) * step, fill: 'backwards' },
    );
  });
}

/** FLIP: animate elements from where they were to where a DOM change put them. */
export function flip(els, mutate, { duration = 440, easing = EASE.inOut, scale = false } = {}) {
  const list = [...els];
  const first = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  mutate();
  if (!motionOK()) return;
  for (const e of list) {
    const a = first.get(e);
    const b = e.getBoundingClientRect();
    if (!a.width || !b.width) continue;
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    const sx = scale ? a.width / b.width : 1;
    const sy = scale ? a.height / b.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    e.animate(
      [
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration, easing },
    );
  }
}

/**
 * Re-render a list without a hard cut: rows that stay glide to their new place, new rows
 * ease in, rows that left fade out where they stood, rows whose text changed breathe once.
 */
export function animateList(container, render, { selector = '[data-id]', key = (e) => e.dataset.id, y = 8, max = 160 } = {}) {
  const live = () => [...container.querySelectorAll(selector)].filter((e) => !e.dataset.ghost);
  const old = motionOK() && container.isConnected && !document.hidden && container.getClientRects().length ? live() : null;
  if (!old || old.length > max) return render();
  const before = new Map(old.map((e) => [key(e), { rect: e.getBoundingClientRect(), node: e, text: e.textContent }]));
  render();
  const now = live();
  if (now.length > max) return;
  const seen = new Set();
  let fresh = 0;
  for (const e of now) {
    const k = key(e);
    seen.add(k);
    const was = before.get(k);
    if (!was) {
      if (before.size || fresh < 12) {
        e.animate(
          [
            { opacity: 0, transform: `translateY(${y}px) scale(0.985)` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 340, easing: EASE.out, delay: Math.min(fresh, 10) * 26, fill: 'backwards' },
        );
      }
      fresh++;
      continue;
    }
    const r = e.getBoundingClientRect();
    const dx = was.rect.left - r.left;
    const dy = was.rect.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: EASE.inOut });
    else if (was.text !== e.textContent) e.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 280, easing: EASE.out });
  }
  for (const [k, was] of before) {
    if (seen.has(k) || !was.rect.width) continue;
    const g = was.node;
    g.dataset.ghost = '1';
    g.inert = true;
    Object.assign(g.style, { position: 'fixed', left: `${was.rect.left}px`, top: `${was.rect.top}px`, width: `${was.rect.width}px`, height: `${was.rect.height}px`, margin: '0', pointerEvents: 'none' });
    container.append(g);
    const gone = () => g.remove();
    g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 190, easing: 'ease-out', fill: 'forwards' }).finished.then(gone, gone);
  }
}

/** Show or hide an element (the `hidden` attribute) with a fade instead of a blink. */
export function reveal(el, show) {
  if (!el || show === !el.hidden) return;
  el.getAnimations().forEach((a) => a.cancel());
  if (!motionOK() || !el.isConnected) {
    el.hidden = !show;
    return;
  }
  if (show) {
    el.hidden = false;
    el.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE.out });
  } else {
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 150, easing: 'ease-out' }).finished.then(
      () => (el.hidden = true),
      () => {},
    );
  }
}

/** Swap a small glyph / short label in place with a quick settle. */
export function setHTML(el, html) {
  if (!el || el.innerHTML === html) return false;
  el.innerHTML = html;
  if (motionOK() && el.isConnected && !document.hidden) el.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE.out });
  return true;
}

/** Layout morph: View Transitions where available, FLIP otherwise. */
export function morph(mutate, fallbackEls = []) {
  if (!motionOK()) return mutate();
  if (document.startViewTransition) {
    document.documentElement.classList.add('vt-morph');
    const vt = document.startViewTransition(mutate);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => document.documentElement.classList.remove('vt-morph'));
    return vt.updateCallbackDone;
  }
  flip(fallbackEls, mutate, { scale: true });
}

/** Blur-crossfade a piece of content while it changes. */
export async function swap(el, update) {
  if (!motionOK() || !el.isConnected || document.hidden) return update();
  try {
    await el.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 110, easing: 'ease-out', fill: 'forwards' }).finished;
  } catch {
    // A newer swap on the same element cancelled this fade: carry on, the update still applies.
  }
  update();
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 220, easing: EASE.out });
}

/** Text that changes now and then (a label, a title): crossfade only when it really changed. */
const nextText = new WeakMap();
export function setText(el, text) {
  if (!el) return;
  text = String(text ?? '');
  if ((nextText.get(el) ?? el.textContent) === text) return;
  if (!el.textContent || !motionOK() || !el.isConnected || document.hidden) {
    nextText.delete(el);
    el.textContent = text;
    return;
  }
  const busy = nextText.has(el);
  nextText.set(el, text);
  if (busy) return; // the fade already running will land on the newest text
  swap(el, () => {
    el.textContent = nextText.get(el) ?? text;
    nextText.delete(el);
  });
}

export async function collapseOut(el) {
  if (!motionOK()) return el.remove();
  const h = el.offsetHeight;
  el.style.overflow = 'hidden';
  await el.animate(
    [
      { height: `${h}px`, opacity: 1, transform: 'none' },
      { height: '0px', opacity: 0, transform: 'translateX(-12px)', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
    ],
    { duration: 280, easing: EASE.inOut, fill: 'forwards' },
  ).finished;
  el.remove();
}

export function pop(el, amount = 1.25) {
  if (!motionOK() || !el) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${amount})`, offset: 0.35 }, { transform: 'scale(1)' }], {
    duration: 420,
    easing: EASE.out,
  });
}

export function nudge(el, x = 6) {
  if (!motionOK()) return;
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${-x}px)` }, { transform: `translateX(${x}px)` }, { transform: `translateX(${-x / 2}px)` }, { transform: 'translateX(0)' }],
    { duration: 360, easing: 'ease-out' },
  );
}

/* Small, balanced answers to a tap: the icon does the thing its button stands for. */
const TAP = {
  'spin-l': [[{ transform: 'rotate(0deg)' }, { transform: 'rotate(-62deg)', offset: 0.3 }, { transform: 'rotate(0deg)' }], 460],
  'spin-r': [[{ transform: 'rotate(0deg)' }, { transform: 'rotate(62deg)', offset: 0.3 }, { transform: 'rotate(0deg)' }], 460],
  'nudge-l': [[{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)', offset: 0.3 }, { transform: 'translateX(0)' }], 380],
  'nudge-r': [[{ transform: 'translateX(0)' }, { transform: 'translateX(6px)', offset: 0.3 }, { transform: 'translateX(0)' }], 380],
  drop: [[{ transform: 'translateY(0)' }, { transform: 'translateY(4px)', offset: 0.3 }, { transform: 'translateY(0)' }], 360],
  lift: [[{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)', offset: 0.3 }, { transform: 'translateY(0)' }], 400],
  stamp: [[{ transform: 'scale(1)' }, { transform: 'scale(1.28) translateY(-2px)', offset: 0.25 }, { transform: 'scale(0.9)', offset: 0.55 }, { transform: 'scale(1)' }], 460],
  wiggle: [[{ transform: 'rotate(0deg)' }, { transform: 'rotate(-16deg)', offset: 0.25 }, { transform: 'rotate(11deg)', offset: 0.6 }, { transform: 'rotate(0deg)' }], 460],
  tilt: [[{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)', offset: 0.3 }, { transform: 'rotate(0deg)' }], 440],
  pop: [[{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.3 }, { transform: 'scale(1)' }], 380],
};
export function tapFx(target, kind) {
  const spec = TAP[kind];
  if (!spec || !target || !motionOK()) return;
  target.animate(spec[0], { duration: spec[1], easing: EASE.out });
}

/**
 * Pull a sheet down to dismiss it — from anywhere on it. If the finger starts on something
 * scrollable that isn't at its top, the scroll wins; otherwise a downward pull moves the
 * sheet. A flick is enough (velocity), pulling upward rubber-bands. With a mouse only
 * `mouseHandle` drags, so clicks and text selection elsewhere stay normal.
 */
export function dragDismiss(el, { handle = el, mouseHandle = null, onDismiss, onProgress, canStart = () => true, distance = 0.22 } = {}) {
  let a = null; // the gesture in progress

  const scrolledAbove = (target) => {
    for (let n = target; n && n !== el.parentElement; n = n.parentElement) if (n.scrollTop > 0) return true;
    return false;
  };
  const begin = (x, y, target) => ({ x0: x, y0: y, dy: 0, dragging: false, target, samples: [{ y, t: performance.now() }] });
  const startDrag = () => {
    a.dragging = true;
    el.style.transition = 'none';
    el.classList.add('dragging');
  };
  const moveTo = (y) => {
    const d = y - a.y0;
    a.dy = d;
    const shown = d > 0 ? d : -Math.pow(-d, 0.7);
    el.style.transform = `translate3d(0, ${shown}px, 0)`;
    onProgress?.(Math.min(1, Math.max(0, shown / (el.offsetHeight || 1))), true);
    a.samples.push({ y, t: performance.now() });
    if (a.samples.length > 6) a.samples.shift();
  };
  const finish = (cancelled) => {
    const g = a;
    a = null;
    if (!g?.dragging) return;
    el.classList.remove('dragging');
    el.style.transition = '';
    const s0 = g.samples[0];
    const s1 = g.samples[g.samples.length - 1];
    const v = (s1.y - s0.y) / Math.max(1, s1.t - s0.t);
    onProgress?.(0, false);
    if (!cancelled && (g.dy > el.offsetHeight * distance || (v > 0.45 && g.dy > 24))) onDismiss?.({ fromDrag: true, dy: g.dy });
    else el.style.transform = '';
    // Swallow the click that can follow a drag.
    const stop = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    handle.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => handle.removeEventListener('click', stop, { capture: true }), 80);
  };

  // touch
  handle.addEventListener(
    'touchstart',
    (e) => {
      if (a || e.touches.length !== 1 || !canStart(e)) return;
      const t = e.touches[0];
      a = begin(t.clientX, t.clientY, e.target);
      a.touch = t.identifier;
    },
    { passive: true },
  );
  handle.addEventListener(
    'touchmove',
    (e) => {
      if (!a || a.touch === undefined) return;
      const t = [...e.touches].find((x) => x.identifier === a.touch);
      if (!t) return;
      if (!a.dragging) {
        const dx = t.clientX - a.x0;
        const dy = t.clientY - a.y0;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        // Decide once, on the first real movement, before the browser starts a scroll.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || scrolledAbove(a.target)) {
          a = null;
          return;
        }
        startDrag();
      }
      if (e.cancelable) e.preventDefault();
      moveTo(t.clientY);
    },
    { passive: false },
  );
  handle.addEventListener('touchend', () => a?.touch !== undefined && finish(false));
  handle.addEventListener('touchcancel', () => a?.touch !== undefined && finish(true));

  // mouse / pen
  const grip = mouseHandle || handle;
  grip.addEventListener('pointerdown', (e) => {
    if (a || e.pointerType === 'touch' || e.button !== 0 || !canStart(e)) return;
    a = begin(e.clientX, e.clientY, e.target);
    a.pid = e.pointerId;
  });
  grip.addEventListener('pointermove', (e) => {
    if (!a || a.pid !== e.pointerId) return;
    if (!a.dragging) {
      if (Math.abs(e.clientY - a.y0) < 6) return;
      startDrag();
      try {
        grip.setPointerCapture(a.pid);
      } catch {}
    }
    moveTo(e.clientY);
  });
  const up = (e) => a && a.pid === e.pointerId && finish(e.type === 'pointercancel');
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}
