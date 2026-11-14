// Setup: one screen, no scrolling. Each row is a readout; tapping it opens its sheet.
import { state, on, emit, setSetting, deleteTrack } from '../store.js';
import * as player from '../player.js';
import * as api from '../api.js';
import { icon } from '../icons.js';
import { Roller, setText, swap } from '../anim.js';
import { $, h, esc, device, fmtBytes, haptic, BUILD } from '../util.js';
import { openSheet, confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { fetchMode, NAME_TEMPLATE } from '../importer.js';
import { placeSeg } from './kit.js';
import { sfx } from '../fx.js';

const SETUP_CMD = 'pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi';
const shortcutCmd = () =>
  ['mkdir -p ~/Documents/Earmark', 'cd ~/Documents/Earmark', `yt-dlp --no-playlist -f "bestaudio[ext=m4a]/bestaudio/best" -o "${NAME_TEMPLATE}" "LINK"`].join('\n');
const codeBlock = (text) => `<div class="code"><pre>${esc(text)}</pre><button class="icon-btn sm" type="button" data-copy aria-label="Copy">${icon('clip')}</button></div>`;
const QUALITY = { low: '64k', standard: '128k', high: '192k' };

const ROWS = [
  ['skip', 'back', 'Skip'],
  ['play', 'gauge', 'Playback'],
  ['via', 'server', 'Source'],
  ['dl', 'download', 'Quality'],
  ['ios', 'phone', 'iPhone setup'],
  ['install', 'add-box', 'Install'],
  ['store', 'folder', 'Storage'],
  ['about', 'info', 'About'],
];

export function mount(root) {
  root.innerHTML = `
    <header class="pg-head" data-st><h1 class="pg-title">Setup</h1><span class="pg-sub">Saved instantly</span></header>
    <div class="setup-list" id="suList">${ROWS.map(
      ([k, ic, l]) => `<button class="srow" type="button" data-open="${k}" data-st>${icon(ic)}<span class="srow-txt"><span class="lbl">${l}</span><small id="su-${k}-s"></small></span><span class="srow-val" id="su-${k}"></span>${icon('chev-right', 'chev')}</button>`,
    ).join('')}</div>`;
  const q = (s) => $(s, root);

  async function renderRows() {
    const s = state.settings;
    setText(q('#su-skip'), s.skipBack === s.skipFwd ? `${s.skipBack}s` : `${s.skipBack}/${s.skipFwd}s`);
    setText(q('#su-skip-s'), 'Back · forward · lock screen');
    setText(q('#su-play'), `${Math.round(s.speed * 100) / 100}×`);
    setText(q('#su-play-s'), [s.sfx ? 'Sounds on' : 'Sounds off', s.autoplay ? 'autoplay' : 'one at a time'].join(' · '));
    const v = s.fetchVia || 'auto';
    setText(q('#su-via'), v === 'shortcut' ? 'Shortcut' : v === 'server' ? 'Server' : 'Auto');
    setText(q('#su-via-s'), fetchMode() === 'shortcut' ? 'iPhone Shortcut downloads' : state.server.online ? 'Server connected' : 'Server not reachable');
    setText(q('#su-dl'), QUALITY[s.quality] || '128k');
    setText(q('#su-dl-s'), s.autoFetch ? 'Fetches on paste' : 'Tap to fetch');
    setText(q('#su-ios'), '5 steps');
    setText(q('#su-ios-s'), 'a-Shell + Shortcut · no computer');
    setText(q('#su-install'), device.standalone ? 'Done' : 'Add');
    setText(q('#su-install-s'), device.standalone ? 'Running as an app' : 'Home Screen app');
    const mine = [...state.blobs.values()].reduce((n, b) => n + (b?.size || 0), 0);
    setText(q('#su-store'), fmtBytes(mine));
    setText(q('#su-store-s'), `${state.tracks.length} audio${state.tracks.length === 1 ? '' : 's'} on this device`);
    setText(q('#su-about'), `B${BUILD}`);
    setText(q('#su-about-s'), 'Report · keys');
  }

  q('#suList').addEventListener('click', (e) => {
    const k = e.target.closest('[data-open]')?.dataset.open;
    if (k) SHEETS[k]();
  });

  on('settings', renderRows);
  on('server', renderRows);
  on('tracks', renderRows);
  renderRows();
  return { enter: renderRows };
}

/* ───────────── sheets ───────────── */

function sheet(title, html, wire) {
  const body = h(`<div>${html}</div>`);
  const s = openSheet({ title, body });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const pre = b.parentElement.querySelector('pre');
    try {
      await navigator.clipboard.writeText(pre.textContent);
      b.innerHTML = icon('check');
      setTimeout(() => (b.innerHTML = icon('clip')), 1400);
      toast('Copied', { icon: 'check', duration: 1400 });
    } catch {
      const r = document.createRange();
      r.selectNodeContents(pre);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Selected. Tap Copy.', { icon: 'clip', duration: 2000 });
    }
  });
  body.addEventListener('change', (e) => {
    const k = e.target.dataset?.k;
    if (k) setSetting(k, e.target.checked).then(() => k === 'sfx' && e.target.checked && sfx('on'));
  });
  wire?.(body, s);
  requestAnimationFrame(() => body.querySelectorAll('.seg').forEach((seg) => placeSeg(seg, seg.querySelector('button.on'), false)));
  return s;
}
const toggle = (k, title, sub) =>
  `<label class="ctl-row"><span>${title}<small>${sub}</small></span><span class="switch"><input type="checkbox" data-k="${k}" ${state.settings[k] ? 'checked' : ''}><i></i></span></label>`;
const seg = (id, items, on) =>
  `<div class="seg" id="${id}"><i class="seg-pill" aria-hidden="true"></i>${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === on ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const wireSeg = (body, id, fn) =>
  body.querySelector(`#${id}`)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    placeSeg(b.parentElement, b);
    fn(b.dataset.v);
  });

const SHEETS = {
  skip() {
    const s = state.settings;
    const row = (k, l, v) => `<div class="big-read"><span class="lbl dim">${l}</span><span class="num"><span id="${k}V">${v}</span><small>s</small></span></div>
      <input class="range" type="range" min="3" max="30" step="1" value="${v}" data-r="${k}" aria-label="${l} seconds">`;
    sheet('Skip buttons', `${row('skipBack', 'Back', s.skipBack)}${row('skipFwd', 'Forward', s.skipFwd)}<div class="scale"><span>3s</span><span>10s</span><span>20s</span><span>30s</span></div>
      <p class="note">Used in the app, on the lock screen and with headphones.</p>`, (body) => {
      body.querySelectorAll('[data-r]').forEach((r) => {
        const k = r.dataset.r;
        const roll = new Roller(body.querySelector(`#${k}V`));
        const paint = () => r.style.setProperty('--p', (r.value - 3) / 27);
        paint();
        let last = Number(r.value);
        r.addEventListener('input', () => {
          const v = Number(r.value);
          roll.set(String(v), { dir: v > last ? 1 : -1 });
          if (v % 5 === 0) haptic(4);
          last = v;
          paint();
          setSetting(k, v);
        });
      });
    });
  },
  play() {
    const s = state.settings;
    sheet(
      'Playback',
      `${toggle('autoplay', 'Autoplay next', 'Keep going when one ends')}
      ${toggle('sfx', 'Sound effects', 'Tactile clicks as you tap')}
      ${player.P.volumeSupported ? toggle('sleepFade', 'Fade on sleep', 'Volume eases down in the last 30 s') : ''}
      ${device.os === 'ios' ? `<div class="ctl-row col"><span>Lock screen buttons<small>iPhone shows one pair beside play</small></span>${seg('suLock', [['skip', 'Skip'], ['tracks', 'Prev / Next']], s.lockButtons === 'tracks' ? 'tracks' : 'skip')}</div>` : ''}
      <div class="ctl-row col"><span>Speed<small>Applies to everything you play</small></span>${seg('suSpeed', [['1', '1×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']], String(s.speed))}</div>`,
      (body) => {
        wireSeg(body, 'suLock', (v) => setSetting('lockButtons', v));
        wireSeg(body, 'suSpeed', (v) => player.setSpeed(Number(v)));
      },
    );
  },
  dl() {
    sheet(
      'Downloads',
      `<div class="ctl-row col"><span>Audio quality<small>Smaller files fit more on your phone</small></span>${seg('suQual', [['low', 'Saver'], ['standard', 'Standard'], ['high', 'High']], state.settings.quality)}</div>
      ${toggle('autoFetch', 'Fetch on paste', 'Start the moment a link lands')}
      ${toggle('autoFile', 'Auto-file by channel', 'New audio joins the playlist its channel goes in')}`,
      (body) => wireSeg(body, 'suQual', (v) => setSetting('quality', v)),
    );
  },
  via() {
    const s = state.settings;
    const hint = () => {
      const set = state.settings.fetchVia || 'auto';
      return set === 'shortcut'
        ? 'Links open your Shortcut, which downloads on this phone. Then tap Import.'
        : set === 'server'
          ? 'A computer running the server does the downloading.'
          : `Server when one answers, otherwise the iPhone Shortcut. Now: ${fetchMode() === 'shortcut' ? 'Shortcut' : 'server'}.`;
    };
    const status = () => {
      const sv = state.server;
      if (sv.online === null) return 'Checking…';
      if (!sv.online) return 'Server not reachable';
      const ok = (sv.ytdlp || sv.demo) && (!sv.locked || sv.authorized);
      return ok ? `Connected${sv.ytdlp ? ` · yt-dlp ${esc(sv.ytdlp)}` : ''}` : sv.locked && !sv.authorized ? 'Needs the access key' : 'Connected · yt-dlp missing';
    };
    const s2 = sheet(
      'Source',
      `${seg('suVia', [['auto', 'Auto'], ['shortcut', 'Shortcut'], ['server', 'Server']], s.fetchVia || 'auto')}
      <p class="note" id="suViaHint">${hint()}</p>
      <div class="ctl-row col"><span>Shortcut name</span><input class="field" id="suSc" value="${esc(s.shortcutName)}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done"></div>
      <div class="ctl-row col"><span>Server<small id="suSrv">${status()}</small></span>
        <input class="field" id="suUrl" type="url" inputmode="url" placeholder="Same as this page" value="${esc(s.server)}" autocapitalize="none" autocorrect="off" spellcheck="false">
        <input class="field" id="suKey" type="password" placeholder="Access key (only if asked)" value="${esc(s.accessKey)}" autocomplete="off">
        <div class="prompt-actions"><button class="btn ghost sm" type="button" id="suCheck">Check</button><button class="btn ghost sm" type="button" id="suUpd">Update yt-dlp</button></div></div>`,
      (body) => {
        wireSeg(body, 'suVia', async (v) => {
          await setSetting('fetchVia', v);
          swap(body.querySelector('#suViaHint'), () => (body.querySelector('#suViaHint').textContent = hint()));
          emit('server:recheck');
        });
        body.querySelector('#suSc').addEventListener('change', (e) => setSetting('shortcutName', e.target.value.trim() || 'Earmark'));
        const save = async () => {
          await setSetting('server', body.querySelector('#suUrl').value.trim());
          await setSetting('accessKey', body.querySelector('#suKey').value.trim());
          emit('server:recheck');
        };
        body.querySelector('#suUrl').addEventListener('change', save);
        body.querySelector('#suKey').addEventListener('change', save);
        body.querySelector('#suCheck').addEventListener('click', () => emit('server:recheck'));
        body.querySelector('#suUpd').addEventListener('click', async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            const r = await api.updateDownloader();
            toast(r.ok ? `Downloader up to date (${r.version})` : 'Update failed', { icon: r.ok ? 'check' : 'info' });
          } catch (err) {
            toast(err.message, { icon: 'info' });
          }
          b.disabled = false;
        });
        const off = on('server', () => setText(body.querySelector('#suSrv'), status()));
        body.closest('.sheet').addEventListener('transitionend', () => !body.isConnected && off());
      },
    );
    void s2;
  },
  ios() {
    const n = esc(state.settings.shortcutName || 'Earmark');
    sheet(
      'iPhone downloader',
      `<ol class="steps">
        <li><b>Get a-Shell</b>Free on the App Store. It runs the downloader on your iPhone. <a class="text-btn red" href="https://apps.apple.com/app/id1473805438" target="_blank" rel="noopener">Open App Store →</a></li>
        <li><b>Install the downloader</b>Open a-Shell, paste this, press return.${codeBlock(SETUP_CMD)}</li>
        <li><b>Make a Shortcut called “${n}”</b>Shortcuts → + → a-Shell “Execute Command”, paste this, replace LINK with Shortcut Input.${codeBlock(shortcutCmd())}</li>
        <li><b>Share Sheet (optional)</b>In the Shortcut’s ⓘ turn on “Show in Share Sheet”.</li>
        <li><b>Paste, then Import</b>Paste a link on the Deck. When Shortcuts is done, tap Import and pick the file from a-Shell › Earmark.</li>
      </ol><p class="note">If YouTube stops working, run step 2 again.</p>`,
    );
  },
  install() {
    const ios = device.os !== 'android';
    sheet(
      'Add to Home Screen',
      `${device.standalone ? '<p class="note">Running as an app already.</p>' : ''}
      <ol class="steps">${(ios
        ? [
            ['Tap Share', 'In Safari, the square with an arrow. On iOS 26 it’s inside the ••• menu.'],
            ['Add to Home Screen', 'Scroll the share list and choose it.'],
            ['Keep “Open as Web App” on', 'Then tap Add.'],
            ['Open it from the Home Screen', 'Full screen, plays on the lock screen.'],
          ]
        : [
            ['Open Chrome’s menu', 'Tap ⋮ at the top right.'],
            ['Install app', 'Choose “Add to Home screen”, then Install.'],
            ['Share links in', 'From YouTube or X: Share → Redline.'],
          ]
      )
        .map(([t, d]) => `<li><b>${t}</b>${d}</li>`)
        .join('')}</ol>
      ${window.__installPrompt ? '<button class="btn solid" type="button" id="suInst" style="width:100%;margin-top:14px">Install now</button>' : ''}`,
      (body) =>
        body.querySelector('#suInst')?.addEventListener('click', async () => {
          const p = window.__installPrompt;
          if (!p) return;
          p.prompt();
          await p.userChoice.catch(() => null);
          window.__installPrompt = null;
        }),
    );
  },
  async store() {
    const mine = [...state.blobs.values()].reduce((n, b) => n + (b?.size || 0), 0);
    let quota = 0;
    let persisted = false;
    try {
      quota = (await navigator.storage?.estimate?.())?.quota || 0;
      persisted = (await navigator.storage?.persisted?.()) || false;
    } catch {}
    const p = quota ? Math.min(1, Math.max(0.01, mine / quota)) : 0.01;
    sheet(
      'Storage',
      `<div class="big-read"><span class="lbl dim">On this device</span><span class="num">${fmtBytes(mine).replace(/ (\w+)$/, '<small>$1</small>')}</span></div>
      <i class="bar ticks" style="--p:${p.toFixed(4)};height:22px;display:block;margin:10px 0"></i>
      <p class="note">${state.tracks.length} audios${quota ? ` · about ${fmtBytes(Math.max(0, quota - mine))} free for the app` : ''}${persisted ? ' · protected from cleanup' : ''}</p>
      <div class="prompt-actions" style="margin-top:16px">
        ${!persisted && navigator.storage?.persist ? '<button class="btn ghost" type="button" id="suPersist">Protect</button>' : '<span></span>'}
        <button class="btn danger" type="button" id="suClean">Remove finished</button></div>`,
      (body, s) => {
        body.querySelector('#suPersist')?.addEventListener('click', async () => {
          const ok = await navigator.storage.persist().catch(() => false);
          toast(ok ? 'Storage protected' : 'Not yet — installing the app usually helps', { icon: ok ? 'check' : 'info' });
        });
        body.querySelector('#suClean').addEventListener('click', async () => {
          const done = state.tracks.filter((t) => t.finished);
          if (!done.length) return toast('Nothing finished to remove', { icon: 'info', duration: 1800 });
          const size = done.reduce((n, t) => n + (state.blobs.get(t.id)?.size || 0), 0);
          s.close();
          if (!(await confirmSheet({ title: `Remove ${done.length} finished?`, message: `Frees ${fmtBytes(size)}. Their marks and notes go too.`, ok: 'Remove' }))) return;
          for (const t of done) {
            if (player.P.id === t.id) player.unload();
            player.removeFromQueue(t.id);
            await deleteTrack(t.id);
          }
          toast(`Removed ${done.length}`, { icon: 'trash', duration: 1800 });
        });
      },
    );
  },
  about() {
    sheet(
      'Redline',
      `<p class="prompt-msg">Paste a link, keep the audio, listen like a podcast. Library, marks and notes stay on this device, shared with Earmark on the same site.</p>
      ${device.os === 'desktop' ? '<p class="note">Keys: Space play · ← → skip · Shift → next · M mark · F favourite · P player</p>' : ''}
      <div class="prompt-actions" style="margin-top:16px"><button class="btn ghost" type="button" id="suReport">Copy report</button><span class="lbl dim" style="align-self:center;text-align:right">Build ${BUILD}</span></div>`,
      (body) =>
        body.querySelector('#suReport').addEventListener('click', async () => {
          const text = `Redline build ${BUILD} · ${navigator.userAgent}\n${player.report()}`;
          try {
            await navigator.clipboard.writeText(text);
            toast('Report copied', { icon: 'check', duration: 2200 });
          } catch {
            openSheet({ title: 'Player report', body: h(`<pre class="report">${esc(text)}</pre>`) });
          }
        }),
    );
  },
};
