// Home: one field to bring audio in, the record you're on, and what you played lately.
import { state, on, emit, query, continueTrack, progressOf } from '../store.js';
import * as player from '../player.js';
import { addLink, overall, STAGE_LABEL, activeJobs } from '../downloads.js';
import { fetchMode } from '../importer.js';
import { icon } from '../icons.js';
import { nudge, animateList, setText, swap, EASE } from '../anim.js';
import { $, fmtTime, fmtDur, sourceOf, extractUrl, haptic, motionOK } from '../util.js';
import { toast } from './toast.js';
import { disc, rowHTML, wireRows, handleResult, runImport } from './kit.js';
import { openPlayer } from './turntable.js';

export function mount(root) {
  root.innerHTML = `
  <div class="home">
    <form class="intake" id="dkForm" autocomplete="off" novalidate data-st>
      <span class="link-wrap">
        <input id="dkInput" class="link-input" type="url" inputmode="url" placeholder=" " autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Paste a video link">
        <span class="link-ph" aria-hidden="true">Drop a link</span>
      </span>
      <button class="fetch" type="submit" id="dkGo" data-state="idle" data-sfx="press" aria-label="Get the audio">
        <svg class="fetch-svg" viewBox="0 0 32 32" aria-hidden="true">
          <defs><clipPath id="faClip"><rect x="0" y="0" width="32" height="24.6"/></clipPath></defs>
          <g clip-path="url(#faClip)"><g class="fa-arrow"><path d="M16 4.5v15.5"/><path d="M9.8 14.2 16 20.4l6.2-6.2"/></g></g>
          <path class="fa-tray" d="M8 27.4h16"/>
          <path class="fa-fill" d="M8 27.4h16" pathLength="100" stroke-dasharray="0 100"/>
          <path class="fa-check" d="M9.5 15.6l4.6 4.6 8.6-9.2" pathLength="1"/>
        </svg>
        <span class="fetch-label">Fetch</span>
      </button>
      <div class="intake-rule"><i></i><b></b></div>
      <div class="intake-msg" id="dkMsg"></div>
    </form>

    <button class="now press" type="button" id="dkNow" data-sfx="none" data-st>
      <span class="now-disc" id="nowDisc"></span>
      <span class="now-body">
        <span class="now-title" id="nowTitle"></span>
        <span class="now-meta"><span id="nowAt"></span><span id="nowLeft"></span></span>
      </span>
    </button>

    <div class="sub-h" data-st><span>Recent</span><button class="text-btn" type="button" id="dkImport">Import file</button></div>
    <div class="scroll" data-st><ul class="list" id="dkList"></ul><div class="empty" id="dkEmpty" hidden><b>Nothing here yet.</b>Drop a YouTube or X link above, or import an audio file.</div></div>
  </div>`;

  const q = (s) => $(s, root);
  const input = q('#dkInput');
  const form = q('#dkForm');
  const msg = q('#dkMsg');
  const fill = q('.intake-rule i');
  const list = q('#dkList');
  const go = q('#dkGo');
  const tray = q('.fa-fill');
  let nowId = null;
  let discFor = '';
  let justSaved = 0;

  /* ── intake ── */
  const inputUrl = () => extractUrl(input.value);
  function renderIntake() {
    const job = activeJobs()[0];
    const waiting = state.jobs.find((j) => j.stage === 'handoff');
    const url = inputUrl();
    form.classList.toggle('busy', Boolean(job));
    form.classList.toggle('valid', Boolean(url) && !job);
    // The arrow tells the story: idle → ready (a link is in) → busy (it keeps falling, the tray fills) → done.
    go.dataset.state = job ? 'busy' : Date.now() - justSaved < 1700 ? 'done' : url ? 'ready' : 'idle';
    if (job) {
      const p = overall(job);
      tray.setAttribute('stroke-dasharray', `${(Math.max(0.03, p) * 100).toFixed(1)} 100`);
      fill.style.setProperty('--p', p.toFixed(3));
      msg.dataset.s = '';
      setText(msg, `${STAGE_LABEL[job.stage] || 'Working'} · ${Math.round(p * 100)}%`);
      return;
    }
    fill.style.setProperty('--p', '0');
    tray.setAttribute('stroke-dasharray', '0 100');
    const src = url ? sourceOf(url) : null;
    msg.dataset.s = input.value && !url ? 'error' : '';
    setText(msg, src ? src.name : input.value ? 'Not a link' : waiting ? 'Waiting on Shortcuts' : '');
  }

  async function submit() {
    const url = inputUrl();
    if (!url) {
      nudge(form);
      if (!input.value) input.focus();
      return;
    }
    if (fetchMode() === 'server' && state.server.online === false) {
      toast("Can't reach the server", { duration: 5000, action: { label: 'Import', fn: runImport } });
    }
    if (motionOK()) input.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateX(40px)', filter: 'blur(6px)' }], { duration: 320, easing: EASE.out });
    input.value = '';
    input.blur();
    renderIntake();
    haptic(10);
    handleResult(await addLink(url));
  }

  input.addEventListener('input', renderIntake);
  input.addEventListener('paste', (e) => {
    const url = extractUrl(e.clipboardData?.getData('text'));
    if (url && state.settings.autoFetch) {
      e.preventDefault();
      input.value = url;
      submit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // An empty field + the button = paste from the clipboard, so one tap does it.
    if (!input.value && navigator.clipboard?.readText) {
      try {
        const url = extractUrl(await navigator.clipboard.readText());
        if (url) {
          input.value = url;
          renderIntake();
        }
      } catch {}
    }
    submit();
  });
  q('#dkImport').addEventListener('click', runImport);

  /* ── the record you're on ── */
  function renderNow() {
    const t = continueTrack(player.P.id);
    const prev = nowId;
    const changed = (t?.id || null) !== nowId;
    nowId = t?.id || null;
    q('#dkNow').hidden = !t;
    if (!t) return;
    const sig = `${t.id}`;
    if (sig !== discFor) {
      discFor = sig;
      q('#nowDisc').innerHTML = disc({ p: progressOf(t), live: true });
    }
    if (changed && prev) swap(q('#nowTitle'), () => (q('#nowTitle').textContent = t.title));
    else setText(q('#nowTitle'), t.title);
    renderNowTime();
  }
  function renderNowTime() {
    const t = nowId && state.byId.get(nowId);
    if (!t) return;
    const live = player.P.id === t.id;
    const d = live ? player.duration() : t.duration || 0;
    const at = live ? player.time() : t.finished ? d : t.position || 0;
    q('#nowAt').textContent = live ? fmtTime(at) : at > 5 && !t.finished ? `${fmtDur(d - at, true)} left` : fmtDur(d, true);
    q('#nowLeft').textContent = live && d ? `-${fmtTime(Math.max(0, d - at))}` : '';
    const arc = q('#nowDisc .disc-arc');
    if (arc && d) arc.setAttribute('stroke-dasharray', `${((at / d) * 100).toFixed(2)} 100`);
  }
  q('#dkNow').addEventListener('click', () => {
    if (!nowId) return;
    if (player.P.id !== nowId) player.load(nowId);
    openPlayer(q('#nowDisc'));
  });

  /* ── recent ── */
  const recent = () => query({ sort: 'played' }).filter((t) => t.id !== nowId).slice(0, 14);
  function renderList() {
    const items = recent();
    animateList(list, () => (list.innerHTML = items.map((t) => rowHTML(t)).join('')));
    q('#dkEmpty').hidden = state.tracks.length > 0;
    q('.sub-h span', root).hidden = !items.length;
  }
  wireRows(list, () => recent().map((t) => t.id), 'Recent');

  const all = () => {
    renderNow();
    renderList();
  };
  on('tracks', all);
  on('fav', renderList);
  on('jobs', renderIntake);
  on('tracks', (d) => {
    if (!d?.added) return;
    justSaved = Date.now();
    renderIntake();
    setTimeout(renderIntake, 1750);
  });
  on('player:load', all);
  on('player:time', renderNowTime);
  all();
  renderIntake();
  void emit;

  return { enter: all };
}
