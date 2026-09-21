/**
 * Ambient particle field behind the interface.
 *
 * Cheap by construction: a small fixed particle count, device-pixel-ratio aware,
 * paused whenever the tab is hidden, and drawn as plain rects so there is no
 * per-particle path allocation.
 */
export class ParticleField {
  constructor(canvas, { count = 46, tone = '#38bdf8' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.count = count;
    this.tone = tone;
    this.particles = [];
    this.running = false;
    this.raf = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.clock = 0;
    this.last = 0;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.seed();
  };

  seed() {
    this.particles = Array.from({ length: this.count }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      size: Math.random() * 1.6 + 0.5,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      alpha: Math.random() * 0.3 + 0.08,
      phase: Math.random() * Math.PI * 2
    }));
  }

  setTone(tone) {
    this.tone = tone;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  frame = (now) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (!document.hidden) {
      this.clock += dt;
      this.update(dt);
      this.draw();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  update(dt) {
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.x < -4) particle.x = this.width + 4;
      if (particle.x > this.width + 4) particle.x = -4;
      if (particle.y < -4) particle.y = this.height + 4;
      if (particle.y > this.height + 4) particle.y = -4;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.tone;
    for (const particle of this.particles) {
      const twinkle = 0.72 + Math.sin(this.clock * 0.9 + particle.phase) * 0.28;
      ctx.globalAlpha = particle.alpha * twinkle;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }
}
