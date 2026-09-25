/**
 * Minimal 3D math: vectors are [x, y, z] arrays, matrices are column-major
 * Float32Array(16) (m[col * 4 + row]), matching the usual graphics convention.
 *
 * Everything here is pure so it can be unit tested outside a browser.
 */

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mulScalar(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  return len === 0 ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Reflection of incident vector `d` about normal `n`. */
export function reflect(d, n) {
  const k = 2 * dot(n, d);
  return [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]];
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Smooth 0..1 ramp, used for animation easing. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Returns a ∘ b (b applied first, then a). */
export function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function mat4Scale(x, y = x, z = x) {
  const m = mat4Identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

export function mat4RotateX(rad) {
  const m = mat4Identity();
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function mat4RotateY(rad) {
  const m = mat4Identity();
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function mat4RotateZ(rad) {
  const m = mat4Identity();
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye, target, up) {
  const zAxis = normalize(sub(eye, target));
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const m = mat4Identity();
  m[0] = xAxis[0];
  m[1] = yAxis[0];
  m[2] = zAxis[0];
  m[4] = xAxis[1];
  m[5] = yAxis[1];
  m[6] = zAxis[1];
  m[8] = xAxis[2];
  m[9] = yAxis[2];
  m[10] = zAxis[2];
  m[12] = -dot(xAxis, eye);
  m[13] = -dot(yAxis, eye);
  m[14] = -dot(zAxis, eye);
  return m;
}

/** Transforms a point (w = 1) and returns the full homogeneous result. */
export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  ];
}

/** Transforms a direction (w = 0, ignores translation), then normalizes. */
export function transformDir(m, v) {
  return normalize([
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
  ]);
}

/**
 * Projects a homogeneous point into CSS-pixel screen space.
 * Returns null when the point sits on or behind the camera plane.
 */
export function projectToScreen(clip, width, height) {
  const w = clip[3];
  if (w <= 1e-6) return null;
  const ndcX = clip[0] / w;
  const ndcY = clip[1] / w;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
    depth: clip[2] / w
  };
}

/**
 * Solves the 2D affine transform taking local (x, y) to screen (X, Y) from three
 * point correspondences, returned as [a, b, c, d, e, f] for setTransform.
 * Used to lay the answer text onto the projected die face.
 */
export function affineFromThreePoints(p1, p2, p3) {
  const [x1, y1] = p1.local;
  const [x2, y2] = p2.local;
  const [x3, y3] = p3.local;
  const den = (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  if (Math.abs(den) < 1e-9) return null;
  const s1 = p1.screen;
  const s2 = p2.screen;
  const s3 = p3.screen;
  const a = ((s1[0] - s3[0]) * (y2 - y3) - (s2[0] - s3[0]) * (y1 - y3)) / den;
  const c = ((x1 - x3) * (s2[0] - s3[0]) - (x2 - x3) * (s1[0] - s3[0])) / den;
  const b = ((s1[1] - s3[1]) * (y2 - y3) - (s2[1] - s3[1]) * (y1 - y3)) / den;
  const d = ((x1 - x3) * (s2[1] - s3[1]) - (x2 - x3) * (s1[1] - s3[1])) / den;
  return [a, b, c, d, s1[0] - a * x1 - c * y1, s1[1] - b * x1 - d * y1];
}

/* ─── quaternions ([x, y, z, w], same right-handed convention as the matrices) ─── */

export function quatIdentity() {
  return [0, 0, 0, 1];
}

export function quatFromAxisAngle(axis, rad) {
  const n = normalize(axis);
  const half = rad / 2;
  const s = Math.sin(half);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(half)];
}

/** Returns a ∘ b (b applied first). */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

export function quatConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len === 0 ? quatIdentity() : [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Shortest-path spherical interpolation; falls back to a lerp when nearly parallel. */
export function quatSlerp(a, b, t) {
  let d = quatDot(a, b);
  let target = b;
  if (d < 0) {
    target = [-b[0], -b[1], -b[2], -b[3]];
    d = -d;
  }
  if (d > 0.9995) {
    return quatNormalize([
      a[0] + (target[0] - a[0]) * t,
      a[1] + (target[1] - a[1]) * t,
      a[2] + (target[2] - a[2]) * t,
      a[3] + (target[3] - a[3]) * t
    ]);
  }
  const theta = Math.acos(clamp(d, -1, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return quatNormalize([
    a[0] * wa + target[0] * wb,
    a[1] * wa + target[1] * wb,
    a[2] * wa + target[2] * wb,
    a[3] * wa + target[3] * wb
  ]);
}

/**
 * Shortest-path rotation taking `from` onto `to`: the axis (unit, world space) and the
 * angle in [0, π]. `quatMul(quatFromAxisAngle(axis, angle), to)` reproduces `from`,
 * which is what lets a spring unwind the remaining error without ever rewinding.
 */
export function quatError(from, to) {
  // The rotation takes `to` onto `from`, so it can be *unwound*: pre-multiplying `to` by
  // the returned axis/angle reproduces `from`, and driving the angle to zero lands on `to`.
  let d = quatMul(from, quatConjugate(to));
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const v = [d[0], d[1], d[2]];
  const sin = Math.hypot(v[0], v[1], v[2]);
  return {
    axis: sin < 1e-9 ? [0, 1, 0] : [v[0] / sin, v[1] / sin, v[2] / sin],
    angle: 2 * Math.atan2(sin, d[3])
  };
}

/** Integrates a freely spinning body one step: q' = normalize(q + ½ ω q dt). */
export function quatIntegrate(q, omega, dt) {
  const spin = [omega[0] * 0.5 * dt, omega[1] * 0.5 * dt, omega[2] * 0.5 * dt, 0];
  const dq = quatMul(spin, q);
  return quatNormalize([q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]]);
}

/** Rotates a direction by a unit quaternion. */
export function quatRotate(q, v) {
  const qv = [q[0], q[1], q[2]];
  const t = mulScalar(cross(qv, v), 2);
  return add(add(v, mulScalar(t, q[3])), cross(qv, t));
}

/** Column-major Float32Array(16) for a unit quaternion. */
export function mat4FromQuat(q) {
  const [x, y, z, w] = q;
  const m = mat4Identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/** Integration quantum for `oscillatorStep`: exact for frame times that are multiples of it. */
export const OSCILLATOR_SUBSTEP = 1 / 240;

/**
 * One step of a damped harmonic oscillator, integrated with fixed sub-steps so the result
 * does not depend on the frame time and cannot blow up on a slow frame (the explicit
 * scheme is only stable while ω·h stays well below 2).
 *
 * @param {{x: number, v: number}} state position and velocity
 * @param {number} dt frame time in seconds
 * @param {number} omega undamped angular frequency (rad/s)
 * @param {number} zeta damping ratio (1 = critically damped, < 1 overshoots)
 */
export function oscillatorStep(state, dt, omega, zeta, substep = OSCILLATOR_SUBSTEP) {
  let { x, v } = state;
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(substep, remaining);
    remaining -= h;
    const accel = -omega * omega * x - 2 * zeta * omega * v;
    v += accel * h;
    x += v * h;
  }
  return { x, v };
}

/** Mixes two [r, g, b] colours (0..255) by t. */
export function mixRgb(from, to, t) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t
  ];
}

export function rgbCss(rgb, alpha = 1) {
  const r = Math.round(clamp(rgb[0], 0, 255));
  const g = Math.round(clamp(rgb[1], 0, 255));
  const b = Math.round(clamp(rgb[2], 0, 255));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** Parses '#rrggbb' into [r, g, b]. */
export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}
