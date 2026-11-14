/** Shown in Settings → About, so it's easy to tell which build a phone is running. Matches sw.js. */
export const BUILD = 4;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

export function fmtTime(sec, forceHours = false) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  if (h || forceHours) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function fmtDur(sec, short = false) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const m = Math.round(sec / 60);
  if (m < 1) return `${Math.round(sec)}s`;
  if (m < 60) return short ? `${m}m` : `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtBytes(b) {
  if (!b) return '0 MB';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function relDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const day = 86400000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return 'Today';
  if (ts >= start - day) return 'Yesterday';
  if (ts >= start - 6 * day) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function clockAt(msFromNow) {
  return new Date(Date.now() + msFromNow).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    pendingArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...pendingArgs);
      }, ms - (now - last));
    }
  };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const ua = navigator.userAgent;
export const device = {
  ios: /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /Android/i.test(ua),
  get standalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },
  get coarse() {
    return matchMedia('(pointer: coarse)').matches;
  },
};
device.os = device.ios ? 'ios' : device.android ? 'android' : 'desktop';

export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

const SOURCES = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|music\.youtube/, 'youtube', 'YouTube'],
  [/(^|\.)(twitter|x)\.com$|(^|\.)t\.co$/, 'x', 'X'],
  [/(^|\.)instagram\.com$/, 'instagram', 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok', 'TikTok'],
  [/(^|\.)soundcloud\.com$/, 'soundcloud', 'SoundCloud'],
  [/(^|\.)vimeo\.com$/, 'vimeo', 'Vimeo'],
  [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, 'reddit', 'Reddit'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.watch$/, 'facebook', 'Facebook'],
  [/(^|\.)twitch\.tv$/, 'twitch', 'Twitch'],
  [/(^|\.)bsky\.app$/, 'bluesky', 'Bluesky'],
  [/(^|\.)threads\.net$/, 'threads', 'Threads'],
  [/(^|\.)dailymotion\.com$/, 'dailymotion', 'Dailymotion'],
  [/(^|\.)bandcamp\.com$/, 'bandcamp', 'Bandcamp'],
];

export function sourceOf(url) {
  if (typeof url === 'string' && url.startsWith('demo:')) return { key: 'demo', name: 'Demo' };
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    for (const [re, key, name] of SOURCES) if (re.test(host)) return { key, name };
    return { key: 'web', name: host.split('.').slice(-2, -1)[0]?.replace(/^\w/, (c) => c.toUpperCase()) || 'Link' };
  } catch {
    return null;
  }
}

/** Finds a link inside arbitrary pasted/shared text. */
export function extractUrl(text) {
  if (!text) return null;
  text = String(text).trim();
  if (text.startsWith('demo:')) return text;
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.;!?]+$/, '');
  if (/^(www\.)?[\w-]+(\.[\w-]+)+\/\S+$/i.test(text)) return `https://${text}`;
  return null;
}

/** Stable identity of a piece of media, so the same video isn't saved twice. */
export function mediaKey(url) {
  if (!url) return null;
  if (url.startsWith('demo:')) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') return `yt:${u.pathname.slice(1, 12)}`;
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|live|embed|v)\/([\w-]{11})/)?.[1];
      if (v) return `yt:${v}`;
    }
    if (/(^|\.)(twitter|x)\.com$/.test(host)) {
      const id = u.pathname.match(/status(?:es)?\/(\d+)/)?.[1];
      if (id) return `x:${id}`;
    }
    ['utm_source', 'utm_medium', 'utm_campaign', 'si', 'feature', 'igsh', 's', 't'].forEach((p) => u.searchParams.delete(p));
    return `${host}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

export function once(target, event) {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

/** Simple fraction like ¼, ⅓ or 3/11. */
export function prettyFraction(n, d) {
  if (!d) return '0';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(n, d) || 1;
  const a = n / g;
  const b = d / g;
  const glyph = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘', '1/8': '⅛' }[`${a}/${b}`];
  if (a === 0) return '0';
  if (a === b) return '1';
  return glyph || `${n}/${d}`;
}
