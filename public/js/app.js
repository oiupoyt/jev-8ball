/**
 * jev8ball // Neural Decision Oracle Client
 * Pure vanilla ES6+, HTML5 Canvas, Web Audio API
 */

(function () {
  'use strict';

  // ─── AMBIENT PARTICLES (katdrop style) ───
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 1.5 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.25;
      this.speedY = (Math.random() - 0.5) * 0.25;
      this.alpha = Math.random() * 0.35 + 0.1;
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
        this.reset();
      }
    }
    draw() {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha})`;
      ctx.fillRect(this.x, this.y, this.size, this.size);
    }
  }

  function initParticles(count = 45) {
    particles = Array.from({ length: count }, () => new Particle());
  }
  initParticles();

  function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.update();
      p.draw();
    }
    requestAnimationFrame(animateParticles);
  }
  requestAnimationFrame(animateParticles);

  // ─── AUDIO SYNTHESIZER ───
  class OracleAudio {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem('jev_muted') === 'true';
    }
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }
    toggleMute() {
      this.muted = !this.muted;
      localStorage.setItem('jev_muted', this.muted);
      return this.muted;
    }
    playTone(freq, type = 'sine', duration = 0.1, vol = 0.1) {
      if (this.muted) return;
      try {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {}
    }
    rollSound() {
      if (this.muted) return;
      try {
        this.init();
        if (!this.ctx) return;
        // Whirring resonant gyroscopic roll sweep
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(60, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(240, this.ctx.currentTime + 0.4);
        osc.frequency.exponentialRampToValueAtTime(95, this.ctx.currentTime + 1.1);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, this.ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(900, this.ctx.currentTime + 0.5);
        filter.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 1.1);

        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.16, this.ctx.currentTime + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.15);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 1.15);
      } catch (e) {}
    }
    revealChime(sentiment = 'affirmative') {
      if (this.muted) return;
      if (sentiment === 'affirmative') {
        this.playTone(440, 'triangle', 0.12, 0.15);
        setTimeout(() => this.playTone(554.37, 'triangle', 0.15, 0.15), 80);
        setTimeout(() => this.playTone(659.25, 'triangle', 0.25, 0.18), 160);
      } else if (sentiment === 'negative') {
        this.playTone(329.63, 'sawtooth', 0.14, 0.12);
        setTimeout(() => this.playTone(277.18, 'sawtooth', 0.22, 0.14), 100);
      } else {
        this.playTone(392.00, 'sine', 0.18, 0.14);
        setTimeout(() => this.playTone(440.00, 'sine', 0.22, 0.14), 110);
      }
    }
  }
  const audio = new OracleAudio();

  // ─── DOM ELEMENTS ───
  const ballWrapper = document.getElementById('ballWrapper');
  const ballSphere = document.getElementById('ballSphere');
  const ballShadow = document.getElementById('ballShadow');
  const floatingDie = document.getElementById('floatingDie');
  const dieText = document.getElementById('dieText');
  const askForm = document.getElementById('askForm');
  const questionInput = document.getElementById('questionInput');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const soundToggle = document.getElementById('soundToggle');
  const backendStatus = document.getElementById('backendStatus');
  const statusText = document.getElementById('statusText');

  const telemetryCard = document.getElementById('telemetryCard');
  const telemetryBadge = document.getElementById('telemetryBadge');
  const tVerdict = document.getElementById('tVerdict');
  const tNoul = document.getElementById('tNoul');
  const noulFill = document.getElementById('noulFill');
  const tConfidence = document.getElementById('tConfidence');
  const tLatency = document.getElementById('tLatency');
  const tCost = document.getElementById('tCost');
  const jsonDump = document.getElementById('jsonDump');

  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const toast = document.getElementById('toast');

  let isSubmitting = false;
  let historyData = loadHistory();

  // Read the stored log defensively: a stale, hand-edited or truncated value must never
  // break the interface, so anything that is not a well formed entry is dropped.
  function loadHistory() {
    const sentiments = ['affirmative', 'negative', 'neutral'];
    try {
      const saved = localStorage.getItem('jev_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) => item && typeof item.question === 'string' && typeof item.answer === 'string'
        )
        .slice(0, 25)
        .map((item) => ({
          question: item.question,
          answer: item.answer,
          sentiment: sentiments.includes(item.sentiment) ? item.sentiment : 'neutral',
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : ''
        }));
    } catch (e) {
      return [];
    }
  }

  // ─── SOUND TOGGLE ───
  function updateSoundUI() {
    soundToggle.textContent = audio.muted ? 'sound: off' : 'sound: on';
  }
  updateSoundUI();
  soundToggle.addEventListener('click', () => {
    audio.toggleMute();
    updateSoundUI();
    showToast(audio.muted ? 'Audio muted' : 'Audio enabled');
  });

  // ─── TOAST NOTIFICATION ───
  let toastTimer = null;
  function showToast(msg) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('active');
    toastTimer = setTimeout(() => {
      toast.classList.remove('active');
    }, 2200);
  }

  // ─── 3D PARALLAX TILT ON HOVER ───
  window.addEventListener('pointermove', (e) => {
    if (isSubmitting) return;
    const rect = ballWrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = (e.clientX - centerX) / (window.innerWidth / 2);
    const deltaY = (e.clientY - centerY) / (window.innerHeight / 2);

    const tiltX = Math.max(-14, Math.min(14, -deltaY * 16));
    const tiltY = Math.max(-14, Math.min(14, deltaX * 16));

    ballSphere.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
  });

  ballWrapper.addEventListener('mouseleave', () => {
    if (!isSubmitting) {
      ballSphere.style.transform = 'rotateX(0deg) rotateY(0deg)';
    }
  });

  // Clicking hexagonal figure rolls it if input is non-empty, or prompts user
  ballWrapper.addEventListener('click', () => {
    if (isSubmitting) return;
    if (questionInput.value.trim()) {
      handleAsk(questionInput.value.trim());
    } else {
      questionInput.focus();
      showToast('Type a question to consult Jev');
    }
  });

  // ─── STATUS CHECK ───
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        backendStatus.classList.add('online');
        statusText.textContent = data.model;
      } else {
        backendStatus.classList.remove('online');
        statusText.textContent = 'status error';
      }
    } catch (e) {
      backendStatus.classList.remove('online');
      statusText.textContent = 'offline';
    }
  }
  checkStatus();
  backendStatus.addEventListener('click', () => {
    showToast('Checking Jev backend status...');
    checkStatus();
  });

  // ─── QUICK PROMPTS ───
  document.querySelectorAll('.quick-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      if (isSubmitting) return;
      const q = pill.getAttribute('data-q');
      questionInput.value = q;
      handleAsk(q);
    });
  });

  // ─── FORM SUBMISSION ───
  askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = questionInput.value.trim();
    if (q) handleAsk(q);
  });

  async function handleAsk(question) {
    if (isSubmitting) return;
    isSubmitting = true;

    // UI Loading state
    submitBtn.disabled = true;
    questionInput.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-block';

    // 1. Roll Hexagonal Figure in Place & Submerge Die
    ballSphere.classList.add('rolling');
    if (ballShadow) ballShadow.classList.add('rolling-shadow');
    floatingDie.className = 'floating-die submerged';
    audio.rollSound();

    const minRollTime = new Promise(resolve => setTimeout(resolve, 1250));

    try {
      // 2. Call /api/ask
      const apiCall = fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      }).then(async (response) => {
        let payload = null;
        try {
          payload = await response.json();
        } catch (e) {
          payload = null;
        }
        // A non-OK status is only usable when the backend shipped a fallback with it.
        if (!response.ok && !(payload && payload.fallback)) {
          throw new Error(
            (payload && payload.error) || `Oracle returned HTTP ${response.status}`
          );
        }
        return payload;
      });

      const [_, result] = await Promise.all([minRollTime, apiCall]);

      // Remove rolling classes
      ballSphere.classList.remove('rolling');
      if (ballShadow) ballShadow.classList.remove('rolling-shadow');
      ballSphere.style.transform = 'rotateX(0deg) rotateY(0deg)';

      if (!result) {
        throw new Error('Oracle returned an empty response.');
      }

      if (result.error && !result.fallback) {
        showToast(result.error || 'Decision failed');
        dieText.innerHTML = 'CANNOT<br>PREDICT';
        floatingDie.className = 'floating-die surfacing';
        return;
      }

      const data = result.fallback ? { ...result.fallback, question } : result;
      displayOracleAnswer(data);

    } catch (err) {
      console.error('Request failed:', err);
      ballSphere.classList.remove('rolling');
      if (ballShadow) ballShadow.classList.remove('rolling-shadow');
      ballSphere.style.transform = 'rotateX(0deg) rotateY(0deg)';
      // Never show an affirmative prophecy for a request that failed.
      dieText.innerHTML = 'CANNOT<br>PREDICT';
      floatingDie.className = 'floating-die surfacing';
      telemetryBadge.className = 'telemetry-badge neutral';
      telemetryBadge.textContent = 'ERROR';
      showToast(err && err.message ? err.message : 'Request failed. Please retry.');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      questionInput.disabled = false;
      btnText.style.display = 'inline';
      btnSpinner.style.display = 'none';
      questionInput.focus();
    }
  }

  function displayOracleAnswer(data) {
    const formattedText = String(data.answer || 'Cannot predict now')
      .replace(/\s+/g, ' ')
      .toUpperCase();
    const words = formattedText.split(' ');
    let htmlAnswer = formattedText;
    if (words.length > 2) {
      const mid = Math.ceil(words.length / 2);
      htmlAnswer = words.slice(0, mid).join(' ') + '<br>' + words.slice(mid).join(' ');
    }

    dieText.innerHTML = htmlAnswer;
    floatingDie.className = 'floating-die surfacing';

    // Audio chime
    audio.revealChime(data.sentiment);

    // Update Telemetry. An offline fallback is a local hash guess, so it is labelled and
    // must not be shown with the calibrated probability and confidence of a real decision.
    const offline = Boolean(data.offline);
    const sentiment = offline ? 'neutral' : (data.sentiment || 'neutral');
    telemetryBadge.className = `telemetry-badge ${offline ? 'offline' : sentiment}`;
    telemetryBadge.textContent = offline ? 'OFFLINE' : sentiment.toUpperCase();

    tVerdict.textContent = data.answer;
    tNoul.textContent = offline ? '—' : (data.noul !== undefined ? data.noul.toFixed(2) : '0.50');

    noulFill.className = `meter-fill ${sentiment}`;
    noulFill.style.width = offline ? '0%' : `${Math.round((data.noul || 0.5) * 100)}%`;

    tConfidence.textContent = offline ? '—' : `${Math.round((data.confidence || 0.8) * 100)}%`;
    tLatency.textContent = `${data.latency || 320}ms`;
    tCost.textContent = offline ? '—' : data.cost ? `$${data.cost.toFixed(6)}` : '< $0.0001';

    jsonDump.textContent = JSON.stringify(data.raw || data, null, 2);

    // Append to History
    addHistoryItem({
      question: data.question,
      answer: data.answer,
      sentiment: data.sentiment,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (offline) showToast('Offline guess — the oracle could not be reached');
  }

  function addHistoryItem(item) {
    historyData.unshift(item);
    if (historyData.length > 25) historyData.pop();
    try {
      localStorage.setItem('jev_history', JSON.stringify(historyData));
    } catch (e) {}
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    historyCount.textContent = `${historyData.length} ${historyData.length === 1 ? 'query' : 'queries'}`;

    historyData.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.innerHTML = `
        <div class="history-left">
          <div class="history-q" title="${escapeHtml(item.question)}">${escapeHtml(item.question)}</div>
          <div class="history-time">${item.timestamp}</div>
        </div>
        <div class="history-pill ${item.sentiment}">
          ${escapeHtml(item.answer)}
        </div>
      `;
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        navigator.clipboard.writeText(`Q: ${item.question}\nA: ${item.answer}`).then(() => {
          showToast('Copied fortune to clipboard');
        });
      });
      historyList.appendChild(li);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  renderHistory();

})();
