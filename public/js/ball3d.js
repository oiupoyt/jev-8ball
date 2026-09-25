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
  mat4FromQuat,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Translate,
  mixRgb,
  normalize,
  oscillatorStep,
  projectToScreen,
  quatError,
  quatFromAxisAngle,
  quatIdentity,
  quatIntegrate,
  quatMul,
  quatRotate,
  rgbCss,
  smoothstep,
  transformDir,
  transformPoint
} from './math3d.js';
import { createPlate, createVessel } from './meshes.js';

const TAU = Math.PI * 2;
const LIGHT = normalize([-0.42, 0.7, 0.86]);

/**
 * Three-quarter camera. A dead-on view of a shallow prism is a flat silhouette; looking
 * in from the side and slightly above keeps the bevelled rim, the tapered walls and the
 * recessed chamber legible as depth.
 */
export const CAMERA = {
  eye: [1.02, 0.66, 3.92],
  target: [0, 0.02, 0],
  fov: 36,
  near: 0.1,
  far: 40
};

/** Direction from the scene toward the camera: facing tests, rim light and specular. */
const VIEW = normalize([
  CAMERA.eye[0] - CAMERA.target[0],
  CAMERA.eye[1] - CAMERA.target[1],
  CAMERA.eye[2] - CAMERA.target[2]
]);

const BODY_BASE = hexToRgb('#191919');
const BODY_EDGE = hexToRgb('#2b2b30');
const CHAMBER_RGB = hexToRgb('#07070b');
const PLATE_BASE = hexToRgb('#1b1b1f');
const SPECULAR = [236, 245, 255];
const FOG_RGB = hexToRgb('#0b0b0b');

/** Depth haze: the back of the shell must sink into the page, not sit on top of it. */
const FOG = { near: 3.55, far: 4.62, max: 0.3 };

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

/**
 * Die spin while the vessel is being shaken: a constant-speed tumble would look
 * mechanical, so the angular velocity starts fast, decays with drag, and its axis slowly
 * precesses — a body tumbling with angular momentum rather than an Euler loop.
 */
const SPIN = {
  speed: 9.5,
  spread: 3.6,
  drag: 1.35,
  precess: 0.85,
  precessAxis: [0.25, 0.15, 1]
};

/**
 * Die spring that unwinds the tumble onto the answer face. The error is expressed as a
 * single angle about the shortest-path axis, so the die sweeps forward into the answer
 * and bounces once (ζ < 1) — it can never rewind like the old linear unwind did.
 */
const SETTLE = {
  omega: 10.5,
  zeta: 0.68,
  minRate: 2.5,
  maxRate: 6.5,
  landAngle: 0.16,
  restAngle: 0.02
};

/** Hull rattle. Two incommensurate frequencies per channel stop it looking metronomic. */
const SHAKE = {
  attack: 0.055,
  decay: 5.5,
  x: [{ hz: 6.7, amp: 0.03 }, { hz: 10.9, amp: 0.013 }],
  y: [{ hz: 5.3, amp: 0.042 }, { hz: 8.9, amp: 0.017 }],
  yaw: [{ hz: 4.1, amp: 0.04 }, { hz: 7.7, amp: 0.015 }],
  pitch: [{ hz: 4.9, amp: 0.048 }, { hz: 8.3, amp: 0.018 }],
  roll: [{ hz: 3.7, amp: 0.055 }, { hz: 6.1, amp: 0.021 }]
};

const PLATE_SPRING = { omega: 24, zeta: 0.5 };
const SURFACE_SPRING = { omega: 12, zeta: 0.2 };
const THUMP_SPRING = { omega: 17, zeta: 0.18 };
/** How hard the vessel's vertical motion throws the liquid surface around. */
const SURFACE_COUPLING = 14;

/** Deterministic [0,1) noise so every roll tumbles differently but reproducibly. */
function seededUnit(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Drives a position/velocity pair toward a moving target with a spring-damper. */
export function springToward(state, target, dt, { omega, zeta }) {
  const step = oscillatorStep({ x: state.x - target, v: state.v }, dt, omega, zeta);
  return { x: target + step.x, v: step.v };
}

/**
 * Sum of incommensurate sines — a rattle that never repeats on a short cycle. The caller
 * scales it by a continuously varying envelope, so it stays smooth through every phase
 * change.
 */
function rattle(clock, channels) {
  let sum = 0;
  for (const { hz, amp } of channels) sum += Math.sin(TAU * hz * clock + hz) * amp;
  return sum;
}


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
    this.revealDuration = 1.1;
    this.rollProgress = 0;
    this.rollCount = 0;

    this.answerLines = ['CONCENTRATE', '& ASK'];
    this.tone = 'idle';
    this.pendingAnswer = null;
    this.answerAlpha = 1;

    this.pointer = { x: 0, y: 0 };
    this.tilt = { x: 0, y: 0 };
    this.glow = 0;
    this.resolveRoll = null;

    // Die: a free tumble that a spring later unwinds onto the answer face.
    this.plateQuat = quatIdentity();
    this.spin = { q: quatIdentity(), w: [0, 0, 0] };
    this.settle = null;
    this.landed = true;
    this.plateY = { x: 0.02, v: 0 };

    // Hull rattle, impact bounce and the chamber liquid, all spring-driven.
    this.shakeEnergy = 0;
    this.hull = { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0 };
    this.thump = { x: 0, v: 0 };
    this.surface = { x: 0, v: 0 };
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
    this.rollProgress = 0;
    this.glow = 0;
    this.answerLines = null;
    this.answerAlpha = 0;
    this.settle = null;
    this.landed = false;
    this.rollCount += 1;

    // Kick the die into a fresh tumble: fast, off-axis, and never quite the same twice.
    const seed = this.rollCount * 7.13;
    const axis = normalize([
      0.7 + seededUnit(seed) * 0.6,
      0.4 + seededUnit(seed + 1.7) * 0.7,
      0.15 + seededUnit(seed + 3.1) * 0.45
    ]);
    const speed = SPIN.speed + seededUnit(seed + 5.3) * SPIN.spread;
    this.spin.q = this.plateQuat;
    this.spin.w = [axis[0] * speed, axis[1] * speed, axis[2] * speed];
    this.shakeEnergy = 0;

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
    this.landed = false;
    this.phase = 'revealing';
    this._beginSettle();
  }

  /** Returns the vessel to the resting state and clears the verdict. */
  reset() {
    this.answerLines = ['CONCENTRATE', '& ASK'];
    this.tone = 'idle';
    this.phase = 'idle';
    this.glow = 0;
    this.pendingAnswer = null;
    this.settle = null;
    this.landed = true;
    this.answerAlpha = 1;
    this.plateQuat = quatIdentity();
    this.spin.w = [0, 0, 0];
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
    const rm = this.reducedMotion;
    const ease = Math.min(1, dt * 6);
    this.tilt.x += ((rm ? 0 : this.pointer.y * 0.24) - this.tilt.x) * ease;
    this.tilt.y += ((rm ? 0 : this.pointer.x * 0.34) - this.tilt.y) * ease;

    const elapsed = this.clock - this.rollStart;

    // ─── hull rattle ───
    // One continuously varying envelope drives every channel, so the shake can start and
    // stop with the phase machine without ever teleporting the vessel.
    if (this.phase === 'rolling' && !rm) {
      this.shakeEnergy = Math.min(1, this.shakeEnergy + dt / SHAKE.attack);
    } else {
      this.shakeEnergy *= Math.exp(-dt * SHAKE.decay);
      if (this.shakeEnergy < 1e-4) this.shakeEnergy = 0;
    }
    const energy = this.shakeEnergy;
    this.hull = {
      x: rattle(this.clock, SHAKE.x) * energy,
      y: rattle(this.clock, SHAKE.y) * energy,
      yaw: rattle(this.clock, SHAKE.yaw) * energy,
      pitch: rattle(this.clock, SHAKE.pitch) * energy,
      roll: rattle(this.clock, SHAKE.roll) * energy
    };
    this.thump = oscillatorStep(this.thump, dt, THUMP_SPRING.omega, THUMP_SPRING.zeta);

    let targetY = 0.02;

    if (this.phase === 'rolling') {
      this.rollProgress = rm ? 1 : clamp(elapsed / this.rollDuration, 0, 1);
      if (rm) {
        this.plateQuat = quatFromAxisAngle([0.6, 0.75, 0.25], 0.5);
      } else {
        // Angular momentum: the spin decays with drag while its axis precesses, which is
        // what separates a tumbling body from a constant-speed Euler loop.
        const drag = Math.exp(-SPIN.drag * dt);
        this.spin.w = quatRotate(
          quatFromAxisAngle(SPIN.precessAxis, SPIN.precess * dt),
          [this.spin.w[0] * drag, this.spin.w[1] * drag, this.spin.w[2] * drag]
        );
        this.spin.q = quatIntegrate(this.spin.q, this.spin.w, dt);
        this.plateQuat = this.spin.q;
      }
      if (elapsed >= this.rollDuration) {
        this.holdTime += dt;
        if (this.resolveRoll) {
          const resolve = this.resolveRoll;
          this.resolveRoll = null;
          resolve();
        }
      }
      targetY = -0.3 + 0.07 * energy * Math.sin(TAU * 5.1 * this.clock);
      this.answerAlpha = 0;
      this.glow = rm ? 0.1 : 0.1 + energy * 0.07;
    } else if (this.phase === 'revealing') {
      if (!this.settle) this._beginSettle();
      if (rm) this.settle.angle = { x: 0, v: 0 };
      this.settle.angle = oscillatorStep(this.settle.angle, dt, SETTLE.omega, SETTLE.zeta);
      this.plateQuat = quatMul(
        quatFromAxisAngle(this.settle.axis, this.settle.angle.x),
        this.settle.target
      );

      // The spring unwinds the whole error along the shortest path, so the die sweeps
      // *into* the answer and rocks once past it — never rewinding the tumble.
      const remaining = Math.abs(this.settle.angle.x);
      if (!this.landed && remaining <= SETTLE.landAngle) {
        this.landed = true;
        this.thump.v -= rm ? 2 : 7.5; // the hull takes the impact…
        this.plateY.v -= 1; // …and the die sinks into the liquid
        this.surface.v += 2.4;
        this.glow = Math.max(this.glow, 0.9);
      }
      // The ink fades in as the face turns toward the camera, and is latched so the small
      // overshoot of the settle can never make the verdict flicker.
      this.answerAlpha = Math.max(
        this.answerAlpha,
        smoothstep(SETTLE.landAngle * 3, SETTLE.restAngle * 3.5, remaining)
      );
      targetY = 0.06;
      const settled =
        remaining <= SETTLE.restAngle && Math.abs(this.settle.angle.v) <= 0.25;
      if (settled || this.clock - this.revealStart > this.revealDuration * 2) {
        this.phase = 'ready';
      }
    } else {
      // ready / idle: square to the camera with only a whisper of movement, so the verdict
      // stays readable instead of rocking under the reader's eye.
      const wobble = rm ? 0 : 1;
      this.plateQuat = quatMul(
        quatFromAxisAngle([0, 1, 0], Math.sin(this.clock * 0.62) * 0.03 * wobble),
        quatFromAxisAngle([1, 0, 0], Math.sin(this.clock * 0.47) * 0.024 * wobble)
      );
      const bob = rm ? 0 : Math.sin(this.clock * 1.15) * 0.022;
      targetY = 0.02 + bob;
      this.answerAlpha = this.answerLines ? 1 : 0;
      this.glow = this.phase === 'ready' ? 0.16 + Math.sin(this.clock * 1.6) * 0.04 : 0.06;
    }

    this.plateY = springToward(this.plateY, targetY, dt, PLATE_SPRING);

    // ─── chamber liquid ───
    // The surface is an oscillator kicked by the vessel's own vertical motion, so it
    // sloshes while the oracle is shaken, splashes when the die lands and settles still —
    // instead of the old sine that wobbled forever.
    const hullY = this.hull.y + this.thump.x;
    const hullFall = this.prevHullY === undefined ? 0 : hullY - this.prevHullY;
    this.prevHullY = hullY;
    this.surface.v -= hullFall * SURFACE_COUPLING;
    this.surface = oscillatorStep(this.surface, dt, SURFACE_SPRING.omega, SURFACE_SPRING.zeta);
  }

  /**
   * Captures the tumble's remaining error as one angle about its shortest-path axis, and
   * hands the spring the die's current spin so the settle starts without a jolt.
   */
  _beginSettle(from = this.spin.q) {
    const error = quatError(from, quatIdentity());
    // Only the spin component *about the settle axis* carries into the unwind; the rest of
    // the tumble's momentum is orthogonal and must not be added as fake approach speed. The
    // ceiling keeps a fast tumble from snapping the die round in a couple of frames.
    const rate = clamp(
      dot(this.spin.w, error.axis),
      SETTLE.minRate,
      SETTLE.maxRate
    );
    this.settle = {
      axis: error.axis,
      angle: { x: error.angle, v: -rate },
      target: quatIdentity()
    };
    this.plateQuat = from;
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

    // The camera frames the vessel at ~72% of the canvas height, leaving room for the
    // rattle, the rim glow and the cast shadow.
    const view = mat4LookAt(CAMERA.eye, CAMERA.target, [0, 1, 0]);
    const proj = mat4Perspective((CAMERA.fov * Math.PI) / 180, 1, CAMERA.near, CAMERA.far);
    this.viewProj = mat4Mul(proj, view);

    // Hull: pointer parallax plus the rattle, with the impact bounce folded into y.
    const hullRot = mat4Mul(
      mat4RotateZ(this.hull.roll),
      mat4Mul(
        mat4RotateY(this.tilt.y + this.hull.yaw),
        mat4RotateX(this.tilt.x + this.hull.pitch)
      )
    );
    const vesselModel = mat4Mul(
      mat4Translate(this.hull.x, this.hull.y + this.thump.x, 0),
      hullRot
    );
    // The die rides inside the hull, so parallax and shake carry it along instead of
    // letting it look pasted onto the screen.
    const plateModel = mat4Mul(
      hullRot,
      mat4Mul(mat4Translate(0, this.plateY.x, 0), mat4FromQuat(this.plateQuat))
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

    // 1. shell behind the chamber: the back cap, then the tapered side walls
    for (const face of vessel.faces) {
      if (face.kind === 'ring' || face.kind === 'bevel') continue;
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
        this._drawAnswerText(plate);
      }
      this._overlayLiquid(liquid, tone);
      ctx.restore();
    }

    // 3. the front of the shell, drawn last: the forward-facing bevel carries the key
    //    light and the flat collar sits just behind it.
    for (const face of vessel.faces) {
      if (face.kind !== 'ring' && face.kind !== 'bevel') continue;
      const base = face.kind === 'bevel' ? BODY_EDGE : BODY_BASE;
      this._fillFace(face, this._faceStyle(face, base, tone, face.kind === 'bevel' ? 0.3 : 0.5));
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
    // Level and tilt come from the slosh oscillator, so the surface rings down to a still
    // mirror once the oracle settles instead of waving forever.
    const level = -0.075 + this.surface.x;
    const tilt = clamp(this.surface.v * 0.03, -0.2, 0.2);
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
    // The shadow stays anchored while the hull rattles above it, which is what sells the
    // vessel as a solid body in front of a surface rather than a flat image being nudged.
    const spread = 1 + this.shakeEnergy * 0.22;
    const opacity = 0.6 - this.shakeEnergy * 0.16;
    ctx.save();
    ctx.translate(w / 2, h * 0.5 + h * 0.4);
    ctx.scale(1, 0.2);
    const radius = w * 0.31 * spread;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(0,0,0,${opacity})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  /* ─── shading & paint helpers ─── */

  /** Blinn-Phong-ish shade: ambient + Lambert, specular, a verdict rim and depth haze. */
  _shade(base, normal, light, tone, rimStrength, fog = 0) {
    const diffuse = Math.max(0, dot(normal, light));
    const half = normalize([light[0] + VIEW[0], light[1] + VIEW[1], light[2] + VIEW[2]]);
    const spec = Math.pow(Math.max(0, dot(normal, half)), 42) * 0.55;
    const rim = Math.pow(1 - clamp(dot(normal, VIEW), 0, 1), 3) * rimStrength;
    const lit = 0.12 + diffuse * 0.95;
    const rgb = [
      base[0] * lit + SPECULAR[0] * spec,
      base[1] * lit + SPECULAR[1] * spec,
      base[2] * lit + SPECULAR[2] * spec
    ];
    const tinted = mixRgb(rgb, tone, clamp(rim * 0.55, 0, 1));
    return fog > 0 ? mixRgb(tinted, FOG_RGB, fog) : tinted;
  }

  /** Solid fill for faceted faces, soft gradient for the large curved ones. */
  _faceStyle(face, base, tone, rimStrength) {
    const fog = smoothstep(FOG.near, FOG.far, face.depth) * FOG.max;
    if (!face.smooth) {
      return rgbCss(this._shade(base, face.normal, LIGHT, tone, rimStrength, fog));
    }
    const near = this._shade(base, face.normal, LIGHT_NEAR, tone, rimStrength, fog);
    const far = this._shade(base, face.normal, LIGHT_FAR, tone, rimStrength, fog);
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
