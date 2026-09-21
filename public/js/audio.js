/**
 * Procedural audio: everything is synthesised with the Web Audio API, so the page
 * ships no audio assets. Every method is a no-op when muted or when Web Audio is
 * unavailable, which keeps callers free of guards.
 */
export class OracleAudio {
  constructor(storageKey = 'jev_muted') {
    this.storageKey = storageKey;
    this.context = null;
    this.muted = readMuted(storageKey);
  }

  init() {
    if (!this.context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.context = new Ctor();
      } catch (e) {
        return null;
      }
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(this.storageKey, String(this.muted));
    } catch (e) {
      /* storage may be unavailable; mute still applies for this session */
    }
    return this.muted;
  }

  /** One shaped sine/saw blip with an exponential decay. */
  tone({ frequency, type = 'sine', duration = 0.12, gain = 0.12, delay = 0, sweepTo, filter }) {
    if (this.muted) return;
    const context = this.init();
    if (!context) return;
    try {
      const start = context.currentTime + delay;
      const osc = context.createOscillator();
      const amp = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
      amp.gain.setValueAtTime(gain, start);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      let tail = osc;
      if (filter) {
        const biquad = context.createBiquadFilter();
        biquad.type = 'lowpass';
        biquad.frequency.setValueAtTime(filter.from, start);
        biquad.frequency.linearRampToValueAtTime(filter.to, start + duration);
        osc.connect(biquad);
        tail = biquad;
      }
      tail.connect(amp);
      amp.connect(context.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch (e) {
      /* a failed blip must never break the interaction */
    }
  }

  /** Rising metallic sweep while the vessel is being shaken. */
  roll(durationSeconds = 1.2) {
    this.tone({
      frequency: 58,
      sweepTo: 132,
      type: 'sawtooth',
      duration: durationSeconds * 0.7,
      gain: 0.07,
      filter: { from: 420, to: 1100 }
    });
    this.tone({
      frequency: 44,
      sweepTo: 36,
      type: 'triangle',
      duration: durationSeconds,
      gain: 0.05
    });
  }

  /** Chord that lands with the verdict, coloured by sentiment. */
  reveal(sentiment = 'affirmative') {
    const chords = {
      affirmative: [
        [440.0, 0],
        [554.37, 0.075],
        [659.25, 0.15]
      ],
      negative: [
        [329.63, 0],
        [277.18, 0.1],
        [196.0, 0.22]
      ],
      neutral: [
        [392.0, 0],
        [466.16, 0.11]
      ]
    };
    const notes = chords[sentiment] || chords.neutral;
    const type = sentiment === 'negative' ? 'sawtooth' : 'triangle';
    for (const [frequency, delay] of notes) {
      this.tone({ frequency, type, duration: 0.3, gain: 0.11, delay });
    }
  }

  /** Short confirmation used when an answer is copied. */
  blip() {
    this.tone({ frequency: 880, type: 'square', duration: 0.06, gain: 0.05 });
  }

  error() {
    this.tone({ frequency: 180, sweepTo: 120, type: 'square', duration: 0.18, gain: 0.05 });
  }
}

function readMuted(storageKey) {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch (e) {
    return false;
  }
}
