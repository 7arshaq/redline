// Deck: intake (paste → audio), three readouts, what's on the platter, the week's trace, recents.
import { state, on, emit, query, continueTrack, progressOf } from '../store.js';
import * as player from '../player.js';
import { addLink, overall, STAGE_LABEL, activeJobs } from '../downloads.js';
import { fetchMode } from '../importer.js';
import { icon } from '../icons.js';
import { Roller, nudge, animateList, setText, EASE } from '../anim.js';
import { $, esc, fmtTime, sourceOf, extractUrl, dayKey, haptic, motionOK } from '../util.js';
import { toast } from './toast.js';
import { bar, setBar, pp, rowHTML, wireRows, handleResult, runImport } from './kit.js';
import { openPlayer } from './turntable.js';

const IDLE = 'YouTube · X · more';

export function mount(root) {
  root.innerHTML = `
  <div class="deck">
    <section class="sec" data-st>
      <div class="sec-head"><span class="lbl">Intake</span><button class="text-btn" type="button" id="dkImport">Import file</button></div>
      <form class="intake" id="dkForm" autocomplete="off" novalidate>
        <div class="intake-field">
          <input id="dkInput" class="link-input" type="url" inputmode="url" placeholder="Paste a link" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Video link">
          ${bar('ticks', 0, 'thin')}
          <div class="intake-meta"><span class="intake-msg" id="dkMsg">${IDLE}</span><button class="text-btn" type="button" id="dkPaste">Paste</button></div>
        </div>
        <button class="badge go" type="submit" id="dkGo" data-state="idle" aria-label="Fetch audio">${icon('download')}</button>
      </form>
    </section>

    <section class="sec stats" data-st>
      <div class="stat"><span class="lbl">Today</span><span class="num"><span id="stToday">0</span><small>min</small></span>${bar('dashes', 0)}</div>
      <button class="stat press" type="button" id="stLibBtn"><span class="lbl">Library</span><span class="num"><span id="stLib">0</span><small>saved</small></span>${bar('ticks', 0, 'thin white')}</button>
      <div class="stat"><span class="lbl">Left</span><span class="num"><span id="stLeft">0</span><small id="stLeftU">h</small></span>${bar('dots', 0)}</div>
    </section>

    <section class="sec" data-st>
      <div class="now" id="dkNow">
        <button class="now-main press" type="button" data-a="open" data-sfx="none">
          <span class="lbl"><span class="red">●</span> <span id="nowKick">Continue</span></span>
          <span class="now-title" id="nowTitle">Nothing on the platter</span>
          ${bar('ticks', 0, 'live')}
          <span class="now-foot"><span id="nowAt">Paste a link to begin</span><span id="nowLeft"></span></span>
        </button>
        <button class="badge" type="button" data-a="play" aria-label="Play or pause">${pp()}</button>
      </div>
    </section>

    <section class="sec chart-sec" data-st>
      <div><div class="sec-head"><span class="lbl">Seven day trace</span><span class="lbl dim" id="chDelta"></span></div><svg class="chart" id="dkChart" aria-hidden="true"></svg></div>
      <div class="chart-side"><span class="lbl dim">This week</span><div class="num"><span id="chTotal">0</span><small id="chUnit">min</small></div></div>
    </section>

    <section class="sec recent" data-st>
      <div class="sec-head"><span class="lbl">Recent</span><button class="text-btn" type="button" id="dkAll">All →</button></div>
      <div class="scroll"><ul class="list" id="dkList"></ul><div class="empty" id="dkEmpty" hidden><b>Empty deck.</b>Paste a link above, or import an audio file.</div></div>
    </section>
  </div>`;

  const q = (s) => $(s, root);
  const input = q('#dkInput');
  const form = q('#dkForm');
  const msg = q('#dkMsg');
  const go = q('#dkGo');
  const jobBar = form.querySelector('.bar');
  const rolls = { today: new Roller(q('#stToday')), lib: new Roller(q('#stLib')), left: new Roller(q('#stLeft')), total: new Roller(q('#chTotal')) };
  const [bToday, bLib, bLeft] = root.querySelectorAll('.stats .bar');
  const nowBar = q('#dkNow .bar');
  const nowPP = q('#dkNow .pp');
  const list = q('#dkList');
  let nowId = null;

  /* ── intake ── */
  const inputUrl = () => extractUrl(input.value);
  function renderIntake() {
    const job = activeJobs()[0];
    const waiting = state.jobs.find((j) => j.stage === 'handoff');
    go.dataset.state = job ? 'busy' : 'idle';
    if (job) {
      const p = overall(job);
      setBar(jobBar, p);
      setText(msg, `${STAGE_LABEL[job.stage] || 'Working'} · ${Math.round(p * 100)}%${job.meta?.title ? ` · ${job.meta.title}` : ''}`);
      return;
    }
    setBar(jobBar, 0);
    const url = inputUrl();
    const src = url ? sourceOf(url) : null;
    setText(msg, src ? `${src.name} → audio` : input.value ? 'Not a link yet' : waiting ? 'In Shortcuts · import when done' : IDLE);
  }

  async function submit() {
    const url = inputUrl();
    if (!url) {
      nudge(form);
      if (input.value) toast("That doesn't look like a link", { icon: 'info', duration: 2200 });
      else input.focus();
      return;
    }
    if (fetchMode() === 'server' && state.server.online === false) {
      toast("Can't reach the server. Listening still works, or import a file.", { icon: 'server', duration: 6000, action: { label: 'Import', fn: runImport } });
    }
    if (motionOK()) input.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateX(26px)', filter: 'blur(3px)' }], { duration: 240, easing: EASE.out });
    input.value = '';
    input.blur();
    renderIntake();
    haptic(10);
    handleResult(await addLink(url));
  }

  async function fromClipboard() {
    try {
      const url = extractUrl(await navigator.clipboard.readText());
      if (url) {
        input.value = url;
        renderIntake();
        if (state.settings.autoFetch) submit();
        else input.focus();
      } else {
        toast('No link on the clipboard', { icon: 'clip', duration: 2200 });
        input.focus();
      }
    } catch {
      input.focus();
      toast('Long-press the box and choose Paste', { icon: 'clip', duration: 2600 });
    }
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
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  q('#dkPaste').addEventListener('click', fromClipboard);
  q('#dkImport').addEventListener('click', runImport);
  q('#dkAll').addEventListener('click', () => emit('go', { page: 'library' }));
  q('#stLibBtn').addEventListener('click', () => emit('go', { page: 'library' }));

  /* ── readouts ── */
  const weekDays = (offset = 0) =>
    [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i) - offset);
      return state.stats.days[dayKey(d)] || 0;
    });

  function renderStats() {
    const days = weekDays();
    const today = days[6];
    rolls.today.set(String(Math.round(today / 60)));
    setBar(bToday, today / Math.max(1800, ...days));
    const n = state.tracks.length;
    rolls.lib.set(String(n));
    setBar(bLib, n ? state.tracks.filter((t) => t.finished).length / n : 0);
    const total = state.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const left = state.tracks.reduce((s, t) => s + (t.finished ? 0 : Math.max(0, (t.duration || 0) - (t.position || 0))), 0);
    const hours = left >= 3600;
    rolls.left.set(hours ? (left / 3600).toFixed(left >= 36000 ? 0 : 1) : String(Math.round(left / 60)));
    q('#stLeftU').textContent = hours ? 'h' : 'min';
    setBar(bLeft, total ? 1 - left / total : 0);
  }

  function renderChart(draw = false) {
    const svg = q('#dkChart');
    const W = Math.max(160, svg.clientWidth || 300);
    const H = 74;
    const days = weekDays();
    const sum = days.reduce((a, b) => a + b, 0);
    const prev = weekDays(7).reduce((a, b) => a + b, 0);
    const max = Math.max(900, ...days);
    const x = (i) => 5 + (i * (W - 10)) / 6;
    const y = (v) => H - 6 - (v / max) * (H - 16);
    const pts = days.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs><linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2d2d" stop-opacity=".55"/><stop offset="1" stop-color="#ff2d2d" stop-opacity="0"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((f) => `<line class="chart-grid" x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('')}
      <path class="chart-fill" d="M${pts.join(' L')} L${x(6)} ${H} L${x(0)} ${H} Z"/>
      <path class="chart-line" pathLength="1" d="M${pts.join(' L')}"/>
      <circle class="chart-dot" cx="${x(6)}" cy="${y(days[6]).toFixed(1)}" r="4"/>`;
    const hrs = sum >= 3600;
    rolls.total.set(hrs ? (sum / 3600).toFixed(1) : String(Math.round(sum / 60)));
    q('#chUnit').textContent = hrs ? 'h' : 'min';
    setText(q('#chDelta'), prev ? `${sum >= prev ? '▲' : '▼'} ${Math.min(999, Math.round((Math.abs(sum - prev) / prev) * 100))}% vs last` : '');
    if (draw && motionOK()) {
      const line = svg.querySelector('.chart-line');
      line.style.strokeDasharray = '1';
      line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 900, easing: EASE.out, delay: 120, fill: 'backwards' });
      svg.querySelector('.chart-fill').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 360, fill: 'backwards', easing: 'ease-out' });
      svg.querySelector('.chart-dot').animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 820, fill: 'backwards', easing: EASE.out });
    }
  }

  /* ── on the platter ── */
  function renderNow() {
    const t = continueTrack(player.P.id);
    nowId = t?.id || null;
    const live = t && player.P.id === t.id;
    setText(q('#nowKick'), live ? (player.isPlaying() ? 'Now playing' : 'Paused') : t ? (t.position > 5 && !t.finished ? 'Continue' : 'Up next') : 'Standby');
    setText(q('#nowTitle'), t ? t.title : 'Nothing on the platter');
    nowPP.dataset.on = live && player.isPlaying() ? '1' : '0';
    renderNowTime();
  }
  function renderNowTime() {
    const t = nowId && state.byId.get(nowId);
    if (!t) {
      setBar(nowBar, 0);
      q('#nowAt').textContent = 'Paste a link to begin';
      q('#nowLeft').textContent = '';
      return;
    }
    const live = player.P.id === t.id;
    const d = live ? player.duration() : t.duration || 0;
    const at = live ? player.time() : t.finished ? d : t.position || 0;
    setBar(nowBar, d ? at / d : progressOf(t));
    q('#nowAt').textContent = fmtTime(at);
    q('#nowLeft').textContent = d ? `-${fmtTime(Math.max(0, d - at))}` : '';
  }
  q('#dkNow').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (!nowId) return input.focus();
    if (player.P.id === nowId) return a === 'open' ? openPlayer() : player.toggle();
    player.load(nowId);
    if (a === 'open') openPlayer();
  });

  /* ── recents ── */
  const recent = () => query({ sort: 'played' }).slice(0, 12);
  function renderList() {
    const items = recent();
    animateList(list, () => (list.innerHTML = items.map((t, i) => rowHTML(t, i)).join('')));
    q('#dkEmpty').hidden = items.length > 0;
  }
  wireRows(list, () => recent().map((t) => t.id), 'Recent');

  const all = () => {
    renderStats();
    renderNow();
    renderList();
  };
  on('tracks', all);
  on('fav', renderList);
  on('stats', () => {
    renderStats();
    renderChart();
  });
  on('jobs', renderIntake);
  on('player:load', () => {
    renderNow();
    renderList();
  });
  on('player:state', renderNow);
  on('player:time', renderNowTime);
  addEventListener('resize', () => !root.hidden && renderChart());
  all();
  renderIntake();
  requestAnimationFrame(() => renderChart(true));

  return {
    enter() {
      all();
      renderChart(true);
    },
  };
}
