import { h, esc } from '../util.js';
import { icon } from '../icons.js';

const MAX = 3;

export function toast(message, { action, chips, icon: ic, duration = 3600, tone = '' } = {}) {
  const root = document.getElementById('toasts');
  const el = h(`
    <div class="toast ${tone}" role="status">
      <div class="toast-row">
        ${ic ? `<span class="toast-ic">${icon(ic)}</span>` : ''}
        <span class="toast-msg">${esc(message)}</span>
        ${action ? `<button class="toast-act press" type="button">${esc(action.label)}</button>` : ''}
      </div>
      ${chips?.length ? `<div class="toast-chips"></div>` : ''}
    </div>`);

  let timer = null;
  let left = duration;
  let started = 0;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('out')) return;
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  const run = () => {
    started = Date.now();
    timer = setTimeout(dismiss, left);
  };
  const pause = () => {
    clearTimeout(timer);
    left -= Date.now() - started;
  };

  if (action) {
    el.querySelector('.toast-act').addEventListener('click', () => {
      action.fn();
      dismiss();
    });
  }
  if (chips?.length) {
    const row = el.querySelector('.toast-chips');
    for (const c of chips) {
      const b = h(`<button type="button" class="chip press ${c.active ? 'on' : ''}">${c.icon ? icon(c.icon) : ''}<span>${esc(c.label)}</span></button>`);
      b.addEventListener('click', async () => {
        const keep = await c.fn(b);
        if (!keep) dismiss();
      });
      row.append(b);
    }
  }

  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', run);
  // Swipe sideways to dismiss.
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  el.addEventListener('pointerup', (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 60) dismiss();
    x0 = null;
  });

  root.append(el);
  const live = [...root.querySelectorAll('.toast:not(.out)')];
  if (live.length > MAX) live.slice(0, live.length - MAX).forEach((t) => t.dispatchEvent(new Event('dismiss')));
  el.addEventListener('dismiss', dismiss);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  if (duration > 0) run();
  return { el, dismiss };
}

// Don't let timers run out while the app is in the background.
document.addEventListener('visibilitychange', () => {
  document.querySelectorAll('.toast').forEach((t) => t.dispatchEvent(new Event(document.hidden ? 'pointerenter' : 'pointerleave')));
});
