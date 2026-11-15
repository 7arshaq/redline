// Pop-ups. One per kind: if the same one is asked for again while it's showing (a spammed
// button, a toggled favourite), the one on screen updates in place, bumps, and counts.
import { h, esc, motionOK } from '../util.js';
import { icon } from '../icons.js';

const MAX = 2;
const live = new Map(); // key → handle

export function toast(message, { action, chips, icon: ic, duration = 3200, tone = '', key = message } = {}) {
  const prev = live.get(key);
  if (prev?.alive()) {
    prev.update(message, { icon: ic, action });
    return prev;
  }
  const root = document.getElementById('toasts');
  const el = h(`
    <div class="toast ${tone}" role="status">
      <div class="toast-row">
        <span class="toast-ic">${ic ? icon(ic) : '<i></i>'}</span>
        <span class="toast-msg"></span>
        <b class="toast-n" hidden></b>
        <button class="toast-act" type="button" hidden></button>
      </div>
      ${chips?.length ? `<div class="toast-chips"></div>` : ''}
    </div>`);
  const msgEl = el.querySelector('.toast-msg');
  const icEl = el.querySelector('.toast-ic');
  const nEl = el.querySelector('.toast-n');
  const actEl = el.querySelector('.toast-act');
  msgEl.textContent = message;
  let act = action;
  let count = 1;
  let shown = message;

  const setAction = (a) => {
    act = a;
    actEl.hidden = !a;
    if (a) actEl.textContent = a.label;
  };
  setAction(action);

  let timer = null;
  let left = duration;
  let started = 0;
  let gone = false;
  const dismiss = () => {
    clearTimeout(timer);
    if (gone) return;
    gone = true;
    if (live.get(key) === handle) live.delete(key);
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 280);
  };
  const run = () => {
    clearTimeout(timer);
    started = Date.now();
    if (duration > 0) timer = setTimeout(dismiss, left);
  };
  const pause = () => {
    clearTimeout(timer);
    left -= Date.now() - started;
  };

  actEl.addEventListener('click', () => {
    act?.fn();
    dismiss();
  });
  if (chips?.length) {
    const row = el.querySelector('.toast-chips');
    for (const c of chips) {
      const b = h(`<button type="button" class="chip ${c.active ? 'on' : ''}">${c.icon ? icon(c.icon) : ''}<span>${esc(c.label)}</span></button>`);
      b.addEventListener('click', async () => {
        const keep = await c.fn(b);
        if (!keep) dismiss();
      });
      row.append(b);
    }
  }

  /** The same pop-up again: swap the words if they changed, count repeats, and bump. */
  function update(next, { icon: nextIc, action: nextAct } = {}) {
    if (next === shown) {
      count += 1;
      nEl.hidden = false;
      nEl.textContent = `×${count}`;
      if (motionOK()) nEl.animate([{ transform: 'scale(1.6)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' });
    } else {
      shown = next;
      count = 1;
      nEl.hidden = true;
      if (motionOK()) {
        msgEl.animate([{ opacity: 0, filter: 'blur(4px)', transform: 'translateY(5px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      }
      msgEl.textContent = next;
    }
    if (nextIc) icEl.innerHTML = icon(nextIc);
    if (nextAct !== undefined) setAction(nextAct);
    if (motionOK()) {
      el.animate(
        [
          { transform: 'none' },
          { transform: 'scale(1.045) translateX(-3px)', offset: 0.25 },
          { transform: 'scale(0.99) translateX(3px)', offset: 0.55 },
          { transform: 'none' },
        ],
        { duration: 380, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' },
      );
      icEl.animate([{ boxShadow: '0 0 0 0 var(--red-glow)' }, { boxShadow: '0 0 0 9px transparent' }], { duration: 520, easing: 'ease-out' });
    }
    left = duration;
    run();
  }

  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', run);
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  el.addEventListener('pointerup', (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 50) dismiss();
    x0 = null;
  });

  const handle = { el, dismiss, update, alive: () => !gone && el.isConnected };
  live.set(key, handle);
  root.append(el);
  const showing = [...root.querySelectorAll('.toast:not(.out)')];
  if (showing.length > MAX) showing.slice(0, showing.length - MAX).forEach((t) => t.dispatchEvent(new Event('dismiss')));
  el.addEventListener('dismiss', dismiss);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  run();
  return handle;
}

// Don't let timers run out while the app is in the background.
document.addEventListener('visibilitychange', () => {
  document.querySelectorAll('.toast').forEach((t) => t.dispatchEvent(new Event(document.hidden ? 'pointerenter' : 'pointerleave')));
});
