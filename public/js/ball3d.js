/**
 * Software 3D renderer + animation state machine for the oracle vessel.
 *
 * Deliberately Canvas 2D rather than WebGL: the scene is a low-poly hexagonal prism
 * plus a hexagonal plate, so painter's-algorithm depth sorting with per-face lighting
 * costs almost nothing, and it renders identically on machines with no GL drivers
 * (headless browsers, VMs, older devices) where a WebGL context cannot be created.
 *
 * The vessel is convex and the plate floats inside it, so sorting faces by camera
 * distance and drawing back-to-front is sufficient: no z-buffer needed.
 */

import {
  affineFromThreePoints,
  clamp,
  dot,
  hexToRgb,
  lerp,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Translate,
  mixRgb,
  normalize,
  projectToScreen,
  rgbCss,
  smoothstep,
  transformDir,
  transformPoint
} from './math3d.js';
import { createPlate, createVessel } from './meshes.js';

const TAU = Math.PI * 2;
const LIGHT = normalize([-0.42, 0.7, 0.86]);
const VIEW = [0, 0, 1];

const BODY_BASE = hexToRgb('#191919');
const BODY_EDGE = hexToRgb('#2b2b30');
const CHAMBER_RGB = hexToRgb('#07070b');
const PLATE_BASE = hexToRgb('#1b1b1f');
const SPECULAR = [236, 245, 255];

const TONES = {
  affirmative: hexToRgb('#10b981'),
  negative: hexToRgb('#ef4444'),
  neutral: hexToRgb('#38bdf8'),
  offline: hexToRgb('#8f8f96'),
  idle: hexToRgb('#38bdf8')
};

// Two slightly perturbed lights give the large faces a soft falloff without the cost
// of per-vertex normals. Faceted faces stay flat so the silhouette reads as machined.
const LIGHT_NEAR = normalize([LIGHT[0] - 0.35, LIGHT[1] + 0.32, LIGHT[2]]);
const LIGHT_FAR = normalize([LIGHT[0] + 0.32, LIGHT[1] - 0.36, LIGHT[2]]);
const FONT_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Phases: rolling -> (answer arrives) -> revealing -> ready -> idle. */
export class OracleBall {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reducedMotion = reducedMotion;
    this.vessel = createVessel();
    this.plate = createPlate();
    this.radiusCss = 172;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.clock = 0;
    this.lastFrame = 0;
    this.running = false;
    this.raf = 0;
    this.visible = true;

    this.phase = 'idle';
    this.rollStart = 0;
    this.revealStart = 0;
    this.holdTime = 0;
    this.rollDuration = 1.25;
    this.revealDuration = 0.9;

    this.answerLines = ['CONCENTRATE', '& ASK'];
    this.tone = 'idle';
    this.pendingAnswer = null;

    this.pointer = { x: 0, y: 0 };
    this.tilt = { x: 0, y: 0 };
    this.shake = 0;
    this.glow = 0;
    this.resolveRoll = null;
  }

  /* ─── public API ─── */

  /** Starts the render loop, sizing, and pointer parallax. Safe to call twice. */
  attach() {
    if (this.running || !this.ctx) return;
    this.running = true;
    this._resize();
    this._observeSize();
    this._observeVisibility();
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this._frame);
  }

  detach() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
  }

  /** Resolves once the shake animation has played. */
  roll() {
    this.phase = 'rolling';
    this.rollStart = this.clock;
    this.holdTime = 0;
    this.glow = 0;
    this.answerLines = null;
    return new Promise((resolve) => {
      // Backstop so a paused render loop (hidden tab, off-screen canvas) can never
      // leave the caller waiting forever.
      setTimeout(() => {
        if (this.resolveRoll === resolve) {
          this.resolveRoll = null;
          resolve();
        }
      }, Math.round(this.rollDuration * 1000) + 500);
      this.resolveRoll = resolve;
    });
  }

  /** Surfaces the die with the verdict text; ignored before a roll. */
  answer(text, tone = 'neutral') {
    const lines = wrapAnswer(text);
    this.pendingAnswer = { lines, tone };
    this.answerLines = lines;
    this.tone = tone;
    this.revealStart = this.clock;
    this.tumbleAtReveal = this.platePose ? { ...this.platePose } : { rx: 0, ry: 0, rz: 0, y: -0.5 };
    this.phase = 'revealing';
  }

  /** Returns the vessel to the resting state and clears the verdict. */
  reset() {
    this.answerLines = ['CONCENTRATE', '& ASK'];
    this.tone = 'idle';
    this.phase = 'idle';
    this.glow = 0;
    this.pendingAnswer = null;
  }

  /* ─── wiring ─── */

  _onPointerMove = (event) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    this.pointer.y = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  };

  _onPointerLeave = () => {
    this.pointer.x = 0;
    this.pointer.y = 0;
  };

  _observeSize() {
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    }
    window.addEventListener('resize', this._onWindowResize);
  }

  _onWindowResize = () => this._resize();

  _observeVisibility() {
    if (typeof IntersectionObserver === 'function') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
      });
      this.intersectionObserver.observe(this.canvas);
    }
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(160, Math.min(rect.width || 344, 460));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = size;
    this.height = size;
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.radiusCss = size;
  }

  /* ─── per-frame simulation ─── */

  _frame = (now) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    // Freeze the clock while hidden or scrolled away so nothing jumps on return.
    if (this.visible && !document.hidden) {
      this.clock += dt;
      this._update(dt);
      this._render();
    }
    this.raf = requestAnimationFrame(this._frame);
  };

  _update(dt) {
    const ease = Math.min(1, dt * 6);
    this.tilt.x += ((this.reducedMotion ? 0 : this.pointer.y * 0.2) - this.tilt.x) * ease;
    this.tilt.y += ((this.reducedMotion ? 0 : this.pointer.x * 0.3) - this.tilt.y) * ease;

    const elapsed = this.clock - this.rollStart;

    if (this.phase === 'rolling') {
      this.rollProgress = this.reducedMotion ? 1 : clamp(elapsed / this.rollDuration, 0, 1);
      this.shake = this.reducedMotion
        ? 0
        : (1 - this.rollProgress * 0.6) * Math.sin(elapsed * 24) * 0.42;
      this.liquidSlosh = this.reducedMotion ? 0 : 1;
      if (elapsed >= this.rollDuration) {
        this.holdTime += dt;
        if (this.resolveRoll) {
          const resolve = this.resolveRoll;
          this.resolveRoll = null;
          resolve();
        }
      }
      this.platePose = this._tumblePose(elapsed);
      this.answerAlpha = 0;
      this.glow = this.reducedMotion ? 0 : 0.12 + Math.sin(elapsed * 9) * 0.06;
    } else if (this.phase === 'revealing') {
      const t = this.reducedMotion ? 1 : clamp((this.clock - this.revealStart) / this.revealDuration, 0, 1);
      const settle = smoothstep(0, 0.72, t);
      const from = this.tumbleAtReveal || { rx: 0, ry: 0, rz: 0, y: -0.5 };
      // Unwind the tumble to zero so the plate always lands face-on to the camera.
      this.platePose = {
        rx: from.rx * (1 - settle),
        ry: from.ry * (1 - settle),
        rz: from.rz * (1 - settle),
        y: lerp(from.y, 0.06, settle)
      };
      this.shake = this.reducedMotion ? 0 : (1 - t) * Math.sin(t * 18) * 0.12;
      this.liquidSlosh = this.reducedMotion ? 0 : 1 - t;
      this.answerAlpha = smoothstep(0.5, 1, t);
      this.glow = Math.sin(t * Math.PI) * 1.1 + 0.16;
      if (t >= 1) this.phase = 'ready';
    } else {
      const bob = this.reducedMotion ? 0 : Math.sin(this.clock * 1.15) * 0.022;
      this.platePose = {
        rx: this.reducedMotion ? 0 : Math.sin(this.clock * 0.42) * 0.06,
        ry: this.reducedMotion ? 0 : Math.sin(this.clock * 0.55) * 0.24,
        rz: this.reducedMotion ? 0 : Math.sin(this.clock * 0.37) * 0.05,
        y: 0.02 + bob
      };
      this.liquidSlosh = this.reducedMotion ? 0 : 0.25;
      this.answerAlpha = this.answerLines ? 1 : 0;
      this.glow = this.phase === 'ready' ? 0.16 + Math.sin(this.clock * 1.6) * 0.04 : 0.06;
    }
  }

  /** Churning pose used while the vessel is being shaken. */
  _tumblePose(elapsed) {
    const dive = smoothstep(0, this.rollDuration * 0.85, elapsed);
    if (this.reducedMotion) {
      return { rx: 0.5, ry: 0.6, rz: 0.2, y: lerp(0.02, -0.24, dive) };
    }
    return {
      rx: elapsed * 5.2,
      ry: elapsed * 3.05,
      rz: elapsed * 2.15,
      y: lerp(0.02, -0.5, dive)
    };
  }

  get toneRgb() {
    return TONES[this.tone] || TONES.idle;
  }

  /* ─── rendering ─── */

  _render() {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Camera sits far enough that the vessel fills ~72% of the canvas height,
    // leaving room for the shake, the rim glow, and the cast shadow.
    const view = mat4LookAt([0, 0, 4.3], [0, 0, 0], [0, 1, 0]);
    const proj = mat4Perspective((36 * Math.PI) / 180, 1, 0.1, 40);
    this.viewProj = mat4Mul(proj, view);

    const pose = this.platePose || { rx: 0, ry: 0, rz: 0, y: 0.02 };
    const shakeZ = this.shake * 0.5;
    const vesselModel = mat4Mul(
      mat4RotateZ(shakeZ),
      mat4Mul(
        mat4RotateY(this.tilt.y + this.shake * 0.28),
        mat4RotateX(this.tilt.x + Math.cos(this.clock * 9) * this.shake * 0.22)
      )
    );
    const plateModel = mat4Mul(
      mat4Translate(0, pose.y, 0),
      mat4Mul(mat4RotateZ(pose.rz), mat4Mul(mat4RotateY(pose.ry), mat4RotateX(pose.rx)))
    );

    this._drawGroundGlow(w, h);
    this._drawContactShadow(w, h);

    const vessel = this._projectMesh(this.vessel.mesh, vesselModel);
    const plate = this._projectMesh(this.plate.mesh, plateModel);
    const windowPoly = this._projectWindow(vesselModel);
    const liquid = windowPoly
      ? this._liquidGeometry(vesselModel, windowPoly)
      : null;

    const tone = this.toneRgb;

    // 1. shell behind the chamber: back cap first, then the side facets
    for (const face of vessel.faces) {
      if (face.kind === 'ring') continue;
      const base = face.kind === 'back' ? CHAMBER_RGB : BODY_BASE;
      this._fillFace(face, this._faceStyle(face, base, tone, face.kind === 'back' ? 0.05 : 0.55));
    }

    // 2. chamber contents, clipped to the window opening
    if (windowPoly && liquid) {
      ctx.save();
      this._clipPolygon(windowPoly);
      this._fillLiquid(liquid.points, tone);
      for (const face of plate.faces) {
        const base = face.kind === 'answer' ? PLATE_BASE : BODY_EDGE;
        this._fillFace(face, this._faceStyle(face, base, tone, face.kind === 'answer' ? 0.35 : 0.8));
      }
      if (this.answerLines && this.answerAlpha > 0.01) {
        this._drawAnswerText(plate, windowPoly);
      }
      this._overlayLiquid(liquid, tone);
      ctx.restore();
    }

    // 3. the front frame, nearest to the camera, drawn last
    for (const face of vessel.faces) {
      if (face.kind !== 'ring') continue;
      this._fillFace(face, this._faceStyle(face, BODY_EDGE, tone, 0.5));
    }

    if (windowPoly) this._strokeWindow(windowPoly, tone);
  }

  /** Projects a mesh and sorts its faces back-to-front. */
  _projectMesh(mesh, model) {
    const mvp = mat4Mul(this.viewProj, model);
    const screen = [];
    const depth = [];
    for (const vertex of mesh.vertices) {
      const clip = transformPoint(mvp, vertex);
      depth.push(clip[3]);
      screen.push(projectToScreen(clip, this.width, this.height));
    }
    const faces = [];
    for (const face of mesh.faces) {
      if (face.indices.some((index) => !screen[index])) continue;
      let sum = 0;
      for (const index of face.indices) sum += depth[index];
      faces.push({
        kind: face.kind,
        smooth: face.smooth,
        normal: transformDir(model, face.normal),
        depth: sum / face.indices.length,
        points: face.indices.map((index) => screen[index])
      });
    }
    faces.sort((a, b) => b.depth - a.depth);
    return { faces, screen };
  }

  /** Projects the hexagonal opening onto the screen. */
  _projectWindow(vesselModel) {
    const mvp = mat4Mul(this.viewProj, vesselModel);
    const { points, z } = this.vessel.window;
    const projected = points.map(([x, y]) =>
      projectToScreen(transformPoint(mvp, [x, y, z]), this.width, this.height)
    );
    return projected.every(Boolean) ? projected : null;
  }

  /** Screen-space liquid body: the window clipped to everything below the surface. */
  _liquidGeometry(vesselModel, windowPoly) {
    const mvp = mat4Mul(this.viewProj, vesselModel);
    const { radius, z } = this.vessel.window;
    const slosh = this.liquidSlosh || 0;
    const level = -0.09 + Math.sin(this.clock * 8.5) * 0.05 * slosh;
    const tilt = Math.sin(this.clock * 6.3) * 0.16 * slosh;
    const left = projectToScreen(
      transformPoint(mvp, [-radius * 1.35, level + tilt, z * 0.2]),
      this.width,
      this.height
    );
    const right = projectToScreen(
      transformPoint(mvp, [radius * 1.35, level - tilt, z * 0.2]),
      this.width,
      this.height
    );
    if (!left || !right) return null;
    return { points: clipPolygonBelow(windowPoly, left, right), surface: [left, right] };
  }

  _drawGroundGlow(w, h) {
    const { ctx } = this;
    const cx = w / 2;
    const cy = h * 0.52;
    const radius = w * 0.62;
    const intensity = 0.3 + this.glow * 0.9;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, rgbCss(this.toneRgb, Math.min(0.34, 0.2 * intensity)));
    gradient.addColorStop(0.5, rgbCss(this.toneRgb, Math.min(0.12, 0.07 * intensity)));
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  _drawContactShadow(w, h) {
    const { ctx } = this;
    const lift = (this.platePose ? 0 : 0) + 0.02;
    ctx.save();
    ctx.translate(w / 2, h * 0.5 + h * 0.4 + lift);
    ctx.scale(1, 0.2);
    const radius = w * 0.31;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  /* ─── shading & paint helpers ─── */

  /** Blinn-Phong-ish shade: ambient + Lambert, specular, and a verdict-tinted rim. */
  _shade(base, normal, light, tone, rimStrength) {
    const diffuse = Math.max(0, dot(normal, light));
    const half = normalize([light[0], light[1], light[2] + 1]);
    const spec = Math.pow(Math.max(0, dot(normal, half)), 40) * 0.5;
    const rim = Math.pow(1 - clamp(dot(normal, VIEW), 0, 1), 3) * rimStrength;
    const lit = 0.13 + diffuse * 0.95;
    const rgb = [
      base[0] * lit + SPECULAR[0] * spec,
      base[1] * lit + SPECULAR[1] * spec,
      base[2] * lit + SPECULAR[2] * spec
    ];
    return mixRgb(rgb, tone, clamp(rim * 0.55, 0, 1));
  }

  /** Solid fill for faceted faces, soft gradient for the large curved ones. */
  _faceStyle(face, base, tone, rimStrength) {
    if (!face.smooth) {
      return rgbCss(this._shade(base, face.normal, LIGHT, tone, rimStrength));
    }
    const near = this._shade(base, face.normal, LIGHT_NEAR, tone, rimStrength);
    const far = this._shade(base, face.normal, LIGHT_FAR, tone, rimStrength);
    const bounds = boundsOf(face.points);
    const gradient = this.ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    gradient.addColorStop(0, rgbCss(mixRgb(near, SPECULAR, 0.05)));
    gradient.addColorStop(1, rgbCss(far));
    return gradient;
  }

  _pathFromPoints(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  _clipPolygon(points) {
    this._pathFromPoints(points);
    this.ctx.clip();
  }

  _fillFace(face, style) {
    if (face.points.length < 3) return;
    const ctx = this.ctx;
    this._pathFromPoints(face.points);
    ctx.fillStyle = style;
    ctx.fill();
    // Hairline edge keeps the facets reading as machined metal rather than flat shapes.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();
  }

  /* ─── liquid ─── */

  _fillLiquid(points, tone) {
    if (points.length < 3) return;
    const ctx = this.ctx;
    const bounds = boundsOf(points);
    const gradient = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.minX, bounds.maxY);
    gradient.addColorStop(0, rgbCss(mixRgb(hexToRgb('#050a16'), tone, 0.24)));
    gradient.addColorStop(0.6, rgbCss(hexToRgb('#03060d')));
    gradient.addColorStop(1, rgbCss(mixRgb(hexToRgb('#010205'), tone, 0.12)));
    this._pathFromPoints(points);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  _overlayLiquid(liquid, tone) {
    const ctx = this.ctx;
    const points = liquid.points;
    if (points.length >= 3) {
      const bounds = boundsOf(points);
      const gradient = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.minX, bounds.maxY);
      gradient.addColorStop(0, rgbCss(tone, 0.22));
      gradient.addColorStop(1, rgbCss(tone, 0.03));
      this._pathFromPoints(points);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    const [a, b] = liquid.surface;
    // drifting specular streaks just under the surface
    for (let i = 0; i < 3; i += 1) {
      const t = (this.clock * 0.33 + i / 3) % 1;
      ctx.beginPath();
      ctx.ellipse(lerp(a.x, b.x, t), lerp(a.y, b.y, t) + 3, 15, 3, 0, 0, TAU);
      ctx.fillStyle = rgbCss(SPECULAR, 0.05);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = rgbCss(mixRgb(tone, SPECULAR, 0.45), 0.55);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  _strokeWindow(windowPoly, tone) {
    const ctx = this.ctx;
    const bounds = boundsOf(windowPoly);
    ctx.save();
    this._pathFromPoints(windowPoly);
    ctx.strokeStyle = rgbCss(mixRgb(tone, SPECULAR, 0.3), Math.min(0.75, 0.3 + this.glow * 0.35));
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this._pathFromPoints(windowPoly);
    ctx.clip();
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    const vignette = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vignette;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.restore();
  }

  /* ─── verdict text mapped onto the die face ─── */

  _drawAnswerText(plateView) {
    const ctx = this.ctx;
    const face = plateView.faces.find((candidate) => candidate.kind === 'answer');
    if (!face || face.points.length < 6) return;
    if (dot(face.normal, VIEW) < 0.3) return;

    // The face keeps the plate's local vertex order, so three corners are enough to
    // solve the affine transform from text space into screen space.
    const matrix = inkTransform(this.plate.points, face.points);
    if (!matrix) return;

    const lines = this.answerLines;
    if (!lines || !lines.length) return;
    const radius = this.plate.radius;
    const usableWidth = radius * 1.5;
    const maxChars = Math.max(4, ...lines.map((line) => line.length));
    let fontSize = clamp(
      Math.min(usableWidth / (maxChars * 0.62), (radius * 1.05) / lines.length),
      0.05,
      0.2
    );
    const pixelsPerUnit = Math.hypot(matrix[0], matrix[1]) / this.dpr;

    ctx.save();
    ctx.setTransform(
      this.dpr * matrix[0],
      this.dpr * matrix[1],
      this.dpr * matrix[2],
      this.dpr * matrix[3],
      this.dpr * matrix[4],
      this.dpr * matrix[5]
    );
    // The clip lives in the same y-down text space as the ink, so its y axis is flipped
    // to match the transform above.
    this._pathFromPoints(this.plate.points.map(([x, y]) => ({ x, y: -y })));
    ctx.clip();

    // Shrink to fit if the monospace metrics run wide of the plate.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
      if (widest <= usableWidth) break;
      fontSize *= usableWidth / widest;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = this.answerAlpha;
    ctx.fillStyle = '#f2f7ff';
    ctx.shadowColor = rgbCss(this.toneRgb, 0.85);
    ctx.shadowBlur = Math.max(2, fontSize * pixelsPerUnit * 0.45);
    const lineHeight = fontSize * 1.3;
    const top = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, top + index * lineHeight);
    });
    ctx.restore();
  }
}

/* ─── helpers (exported for tests) ─── */

/**
 * Affine map from canvas text space onto a projected plate face, returned as
 * [a, b, c, d, e, f] for `setTransform`.
 *
 * The plate is authored y-up, but canvas text is laid out y-down. Solving the affine
 * against the raw local points therefore mirrors the basis (negative determinant), which
 * renders the ink upside down and reverses the line order. Negating the local y axis
 * first means the result consumes ordinary text coordinates and draws upright glyphs.
 *
 * @param {number[][]} platePoints face-local [x, y] pairs, in face winding order
 * @param {{x: number, y: number}[]} facePoints projected screen points, same order
 */
export function inkTransform(platePoints, facePoints) {
  const corners = [0, 3, 5].map((index) => ({
    local: [platePoints[index][0], -platePoints[index][1]],
    screen: [facePoints[index].x, facePoints[index].y]
  }));
  return affineFromThreePoints(corners[0], corners[1], corners[2]);
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Sutherland–Hodgman clip of a convex polygon against the half-plane below the line
 * a→b. Screen space has y pointing down, so "below the surface line" is a positive
 * cross product.
 */
export function clipPolygonBelow(points, a, b) {
  const out = [];
  const side = (p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const currentSide = side(current);
    const nextSide = side(next);
    if (currentSide >= 0) out.push(current);
    if (currentSide >= 0 !== nextSide >= 0) {
      const t = currentSide / (currentSide - nextSide);
      out.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t
      });
    }
  }
  return out;
}

/** Upper-cases a verdict and wraps it into at most three plate-sized lines. */
export function wrapAnswer(text) {
  const words = String(text || 'Cannot predict now')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return ['CANNOT', 'PREDICT'];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= 11) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 3) {
    return [...lines.slice(0, 2), lines.slice(2).join(' ').slice(0, 14)];
  }
  return lines;
}
