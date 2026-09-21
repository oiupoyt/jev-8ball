/**
 * jev8ball client.
 *
 * Wires the DOM to the software-rendered 3D stage, the Jev decisions endpoint, the
 * telemetry readout, the local query log, and the procedural audio. Everything is a
 * small number of pure-ish helpers plus one async orchestration function so the
 * failure modes stay readable.
 */
import { OracleAudio } from './audio.js';
import { OracleBall } from './ball3d.js';
import { ParticleField } from './particles.js';

const MAX_HISTORY = 25;
const QUESTION_LIMIT = 300;
const HISTORY_KEY = 'jev_history';
const MUTED_KEY = 'jev_muted';
const MOTION_KEY = 'jev_motion';
const SENTIMENTS = ['affirmative', 'negative', 'neutral'];

const TONE_HEX = {
  affirmative: '#10b981',
  negative: '#ef4444',
  neutral: '#38bdf8',
  offline: '#8f8f96',
  idle: '#38bdf8'
};

const STAGE_HINTS = {
  idle: 'click the vessel to shake it',
  rolling: 'the oracle is considering…',
  ready: 'click again for another question',
  error: 'the oracle could not be reached — try again'
};

const byId = (id) => document.getElementById(id);

const dom = {
  canvas: byId('oracleCanvas'),
  rollButton: byId('rollButton'),
  stageHint: byId('stageHint'),
  form: byId('askForm'),
  input: byId('questionInput'),
  submit: byId('submitBtn'),
  soundToggle: byId('soundToggle'),
  motionToggle: byId('motionToggle'),
  backendStatus: byId('backendStatus'),
  statusText: byId('statusText'),
  charCount: byId('charCount'),
  card: byId('telemetryCard'),
  badge: byId('telemetryBadge'),
  verdict: byId('tVerdict'),
  noul: byId('tNoul'),
  noulFill: byId('noulFill'),
  confidence: byId('tConfidence'),
  latency: byId('tLatency'),
  cost: byId('tCost'),
  json: byId('jsonDump'),
  historyList: byId('historyList'),
  historyCount: byId('historyCount'),
  historyEmpty: byId('historyEmpty'),
  toast: byId('toast'),
  particles: byId('particles')
};

const audio = new OracleAudio(MUTED_KEY);
const particles = new ParticleField(dom.particles);
const ball = new OracleBall(dom.canvas, { reducedMotion: prefersReducedMotion() });

let busy = false;
let history = loadHistory();
let toastTimer = 0;

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function storedMotionPreference() {
  try {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored === 'reduce') return true;
    if (stored === 'full') return false;
  } catch (e) {
    /* storage unavailable: fall back to the media query */
  }
  return prefersReducedMotion();
}

function setHint(key) {
  dom.stageHint.textContent = STAGE_HINTS[key] || STAGE_HINTS.idle;
}

function showToast(message, kind = 'info', duration = 2400) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.dataset.kind = kind;
  dom.toast.classList.add('active');
  toastTimer = setTimeout(() => dom.toast.classList.remove('active'), duration);
}

function setBusy(next) {
  busy = next;
  document.body.dataset.busy = String(next);
  dom.submit.disabled = next;
  dom.input.disabled = next;
  dom.rollButton.disabled = next;
  for (const pill of document.querySelectorAll('.quick-pill')) pill.disabled = next;
}

/** Reads the log defensively: a stale or hand-edited value must never break the page. */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) => item && typeof item.question === 'string' && typeof item.answer === 'string'
      )
      .slice(0, MAX_HISTORY)
      .map((item) => ({
        question: item.question,
        answer: item.answer,
        sentiment: SENTIMENTS.includes(item.sentiment) ? item.sentiment : 'neutral',
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
        offline: Boolean(item.offline)
      }));
  } catch (e) {
    return [];
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    /* quota or private mode: keep the in-memory log */
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHistory() {
  dom.historyList.innerHTML = '';
  dom.historyCount.textContent = `${history.length} ${history.length === 1 ? 'query' : 'queries'}`;
  dom.historyEmpty.hidden = history.length > 0;

  history.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = 'Copy this fortune';
    li.innerHTML =
      '<div class="history-left">' +
      `<div class="history-q">${escapeHtml(item.question)}</div>` +
      `<div class="history-time">${escapeHtml(item.timestamp)}${item.offline ? ' · offline' : ''}</div>` +
      '</div>' +
      `<div class="history-pill ${item.sentiment}">${escapeHtml(item.answer)}</div>`;

    const copy = () => copyFortune(item);
    li.addEventListener('click', copy);
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        copy();
      }
    });
    dom.historyList.appendChild(li);
  });
}

async function copyFortune(item) {
  const text = `Q: ${item.question}\nA: ${item.answer}`;
  try {
    await navigator.clipboard.writeText(text);
    audio.blip();
    showToast('copied fortune to clipboard');
  } catch (e) {
    showToast('clipboard unavailable in this browser', 'warn');
  }
}

function pushHistory(entry) {
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  persistHistory();
  renderHistory();
}

/* ─── telemetry ─── */

function toneFor(data) {
  if (data.offline) return 'offline';
  return SENTIMENTS.includes(data.sentiment) ? data.sentiment : 'neutral';
}

function setPending() {
  dom.card.dataset.tone = 'pending';
  dom.badge.className = 'telemetry-badge';
  dom.badge.textContent = 'QUERYING';
  dom.verdict.textContent = 'the oracle is considering your question…';
  dom.noul.textContent = '—';
  dom.noulFill.className = 'meter-fill';
  dom.noulFill.style.width = '0%';
  dom.confidence.textContent = '—';
  dom.latency.textContent = '—';
  dom.cost.textContent = '—';
  dom.json.textContent = '// awaiting decision…';
}

function presentError(error) {
  dom.card.dataset.tone = 'error';
  dom.badge.className = 'telemetry-badge error';
  dom.badge.textContent = 'ERROR';
  dom.verdict.textContent = error && error.message ? error.message : 'the request failed';
  dom.noul.textContent = '—';
  dom.noulFill.className = 'meter-fill';
  dom.noulFill.style.width = '0%';
  dom.confidence.textContent = '—';
  dom.latency.textContent = '—';
  dom.cost.textContent = '—';
  dom.json.textContent = '// no decision payload';
  setHint('error');
}

function present(data) {
  const tone = toneFor(data);
  const offline = tone === 'offline';

  ball.answer(data.answer || 'Cannot predict now', tone);
  audio.reveal(offline ? 'neutral' : tone);
  particles.setTone(TONE_HEX[tone]);
  setHint('ready');

  dom.card.dataset.tone = tone;
  dom.badge.className = `telemetry-badge ${tone}`;
  dom.badge.textContent = offline ? 'OFFLINE' : tone.toUpperCase();
  dom.verdict.textContent = data.answer || '—';

  // An offline verdict is a local hash guess: never dress it up as a calibrated one.
  dom.noul.textContent = offline
    ? '—'
    : typeof data.noul === 'number'
      ? data.noul.toFixed(2)
      : '0.50';
  dom.noulFill.className = `meter-fill ${offline ? '' : tone}`.trim();
  dom.noulFill.style.width = offline ? '0%' : `${Math.round((data.noul || 0.5) * 100)}%`;
  dom.confidence.textContent = offline
    ? '—'
    : `${Math.round((data.confidence || 0.8) * 100)}%`;
  dom.latency.textContent = `${data.latency || 0}ms`;
  dom.cost.textContent = offline
    ? '—'
    : typeof data.cost === 'number' && data.cost > 0
      ? `$${data.cost.toFixed(6)}`
      : '< $0.0001';
  dom.json.textContent = stringify(data.raw || data);

  pushHistory({
    question: data.question,
    answer: data.answer,
    sentiment: offline ? 'neutral' : tone,
    offline,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  if (offline) showToast('offline guess — the oracle could not be reached', 'warn', 3200);
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return '// payload could not be serialised';
  }
}

/* ─── orchestration ─── */

function updateCharCount() {
  dom.charCount.textContent = String(dom.input.value.length);
}

function submitQuestion(raw) {
  if (busy) return;
  const question = String(raw || '').trim().slice(0, QUESTION_LIMIT);
  if (!question) {
    showToast('type a question first', 'warn');
    dom.input.focus();
    return;
  }
  dom.input.value = question;
  updateCharCount();
  ask(question);
}

async function ask(question) {
  setBusy(true);
  setPending();
  setHint('rolling');
  audio.roll(ball.rollDuration);
  const roll = ball.roll();

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (e) {
      payload = null;
    }

    // A non-OK status is only usable when the backend shipped a fallback with it.
    if (!response.ok && !(payload && payload.fallback)) {
      throw new Error((payload && payload.error) || `oracle returned HTTP ${response.status}`);
    }
    if (!payload) throw new Error('oracle returned an empty response');

    await roll;
    present(payload.fallback ? { ...payload.fallback, question } : payload);
  } catch (error) {
    await roll; // let the shake finish so the interface never snaps
    console.error('oracle request failed:', error);
    audio.error();
    presentError(error);
    showToast((error && error.message) || 'request failed', 'error', 3200);
  } finally {
    setBusy(false);
  }
}

async function checkStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    dom.backendStatus.classList.remove('online', 'offline', 'degraded');
    dom.backendStatus.classList.add(data.hasKey === false ? 'degraded' : 'online');
    dom.statusText.textContent = data.model || 'online';
    dom.backendStatus.title = `key: ${data.keySource || 'unknown'} — click to re-check`;
  } catch (error) {
    dom.backendStatus.classList.remove('online', 'degraded');
    dom.backendStatus.classList.add('offline');
    dom.statusText.textContent = 'backend offline';
    dom.backendStatus.title = 'Backend unreachable — click to retry';
  }
}

/* ─── preferences ─── */

let reducedMotion = storedMotionPreference();

function applyMotion(reduced, { persist = true, announce = false } = {}) {
  reducedMotion = reduced;
  document.body.dataset.motion = reduced ? 'reduced' : 'full';
  dom.motionToggle.textContent = reduced ? 'motion: reduced' : 'motion: full';
  dom.motionToggle.setAttribute('aria-pressed', String(reduced));
  ball.setReducedMotion(reduced);
  if (persist) {
    try {
      localStorage.setItem(MOTION_KEY, reduced ? 'reduce' : 'full');
    } catch (e) {
      /* private mode: preference applies for this session only */
    }
  }
  if (announce) showToast(reduced ? 'animation reduced' : 'animation restored');
}

/* ─── wiring ─── */

function wire() {
  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitQuestion(dom.input.value);
  });

  // The vessel itself acts as the submit button for the current question.
  dom.rollButton.addEventListener('click', () => submitQuestion(dom.input.value));

  dom.input.addEventListener('input', updateCharCount);

  for (const pill of document.querySelectorAll('.quick-pill')) {
    pill.addEventListener('click', () => submitQuestion(pill.dataset.q));
  }

  dom.soundToggle.addEventListener('click', () => {
    const muted = audio.toggleMute();
    dom.soundToggle.textContent = muted ? 'sound: off' : 'sound: on';
    dom.soundToggle.setAttribute('aria-pressed', String(muted));
    if (!muted) audio.blip();
    showToast(muted ? 'audio muted' : 'audio enabled');
  });

  dom.motionToggle.addEventListener('click', () =>
    applyMotion(!reducedMotion, { announce: true })
  );

  dom.backendStatus.addEventListener('click', () => {
    dom.statusText.textContent = 'checking…';
    checkStatus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      dom.input.focus();
    } else if (event.key === 'r' && !typing && !busy) {
      event.preventDefault();
      submitQuestion(dom.input.value);
    } else if (event.key === 'Escape' && typing) {
      event.target.blur();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) particles.stop();
    else particles.start();
  });

  if (typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event) => {
      let overridden = false;
      try {
        overridden = Boolean(localStorage.getItem(MOTION_KEY));
      } catch (e) {
        overridden = false;
      }
      if (!overridden) applyMotion(event.matches, { persist: false });
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }
}

function init() {
  applyMotion(storedMotionPreference(), { persist: false });
  ball.attach();
  particles.setTone(TONE_HEX.idle);
  particles.start();
  renderHistory();
  updateCharCount();
  setHint('idle');
  wire();
  checkStatus();
}

init();
