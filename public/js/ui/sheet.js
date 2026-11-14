// Bottom sheets on touch, origin-aware popovers / centred dialogs with a mouse.
import { h, esc, device } from '../util.js';
import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { dragDismiss } from '../anim.js';
import { sfx } from '../fx.js';

const wide = () => !device.coarse && innerWidth >= 700;

export function openSheet({ title = '', body = '', className = '', onClose, onOpen } = {}) {
  const scrim = h('<div class="scrim"></div>');
  const el = h(`
    <div class="sheet ${className}" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
      <div class="sheet-grab" aria-hidden="true"><i></i></div>
      ${title ? `<div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn press sheet-x" type="button" aria-label="Close">${icon('close')}</button></div>` : ''}
      <div class="sheet-body"></div>
    </div>`);
  const bodyEl = el.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);

  document.body.append(scrim, el);
  const opener = document.activeElement;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    el.classList.remove('open');
    scrim.classList.remove('open');
    el.style.transform = '';
    setTimeout(() => {
      scrim.remove();
      el.remove();
    }, 420);
    sfx('close');
    onClose?.();
    if (opener && opener.isConnected && !device.coarse) opener.focus?.({ preventScroll: true });
  };
  const close = pushLayer(finish, 'sheet');
  sfx('open');

  scrim.addEventListener('click', close);
  el.querySelector('.sheet-x')?.addEventListener('click', close);
  // Pull it down from anywhere (a scrolled list inside still scrolls first).
  dragDismiss(el, {
    mouseHandle: el.querySelector('.sheet-grab'),
    onDismiss: close,
    canStart: (e) => !e.target.closest('input, textarea, select, .dial, .scrub'),
  });

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.classList.add('open');
      scrim.classList.add('open');
      onOpen?.(el);
    }),
  );
  return { el, body: bodyEl, close };
}

/**
 * items: [{ label, icon, fn, danger, checked, hint }] or '-' for a divider.
 */
export function menu(anchor, items, { title = '' } = {}) {
  const build = (close) => {
    const list = h('<div class="menu-list" role="menu"></div>');
    for (const it of items) {
      if (!it) continue;
      if (it === '-') {
        list.append(h('<div class="menu-sep" role="separator"></div>'));
        continue;
      }
      const b = h(`
        <button class="menu-item press ${it.danger ? 'danger' : ''}" type="button" role="menuitem">
          <span class="mi-ic">${it.icon ? icon(it.icon) : ''}</span>
          <span class="mi-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}
          ${it.checked !== undefined ? `<span class="mi-check ${it.checked ? 'on' : ''}">${icon('check')}</span>` : ''}
        </button>`);
      b.addEventListener('click', () => {
        close();
        setTimeout(() => it.fn?.(), wide() ? 0 : 120);
      });
      list.append(b);
    }
    return list;
  };

  if (!wide() || !anchor) {
    let s;
    s = openSheet({ title, body: build(() => s.close()), className: 'sheet-menu' });
    return s;
  }

  // Popover anchored to its trigger, scaling out of the corner it's attached to.
  const pop = h(`<div class="popover" role="dialog">${title ? `<div class="pop-title">${esc(title)}</div>` : ''}</div>`);
  const scrim = h('<div class="scrim clear"></div>');
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    pop.classList.remove('open');
    setTimeout(() => {
      pop.remove();
      scrim.remove();
    }, 180);
  };
  const close = pushLayer(finish, 'popover');
  pop.append(build(close));
  document.body.append(scrim, pop);

  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const below = r.bottom + 8 + ph < innerHeight - 8;
  const alignRight = r.right - pw > 8;
  const left = alignRight ? r.right - pw : Math.min(r.left, innerWidth - pw - 8);
  const top = below ? r.bottom + 6 : Math.max(8, r.top - ph - 6);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;
  pop.style.transformOrigin = `${alignRight ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;
  scrim.addEventListener('pointerdown', close);
  requestAnimationFrame(() => pop.classList.add('open'));
  pop.querySelector('.menu-item')?.focus({ preventScroll: true });
  return { el: pop, close };
}

export function prompt({ title, value = '', placeholder = '', ok = 'Save', multiline = false, maxLength = 80 }) {
  return new Promise((resolve) => {
    let result = null;
    const form = h(`
      <form class="prompt">
        ${multiline ? `<textarea class="field" rows="3" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="field" maxlength="${maxLength}" placeholder="${esc(placeholder)}" value="${esc(value)}" enterkeyhint="done" autocomplete="off">`}
        <div class="prompt-actions">
          <button class="btn ghost press" type="button" data-cancel>Cancel</button>
          <button class="btn solid press" type="submit">${esc(ok)}</button>
        </div>
      </form>`);
    const s = openSheet({
      title,
      body: form,
      className: 'sheet-prompt',
      onClose: () => resolve(result),
      onOpen: () => {
        const f = form.querySelector('.field');
        f.focus({ preventScroll: true });
        f.select?.();
      },
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => s.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result = form.querySelector('.field').value.trim();
      s.close();
    });
  });
}

export function confirmSheet({ title, message = '', ok = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const body = h(`
      <div class="prompt">
        ${message ? `<p class="prompt-msg">${esc(message)}</p>` : ''}
        <div class="prompt-actions">
          <button class="btn ghost press" type="button" data-cancel>Cancel</button>
          <button class="btn ${danger ? 'danger' : 'solid'} press" type="button" data-ok>${esc(ok)}</button>
        </div>
      </div>`);
    const s = openSheet({ title, body, className: 'sheet-prompt', onClose: () => resolve(result) });
    body.querySelector('[data-cancel]').addEventListener('click', () => s.close());
    body.querySelector('[data-ok]').addEventListener('click', () => {
      result = true;
      s.close();
    });
  });
}
