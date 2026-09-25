/**
 * Mesh builders for the oracle vessel. Pure data in, pure data out: every mesh is
 * `{ vertices: [[x, y, z]], faces: [{ indices, normal, kind, smooth }] }`, which the
 * renderer walks generically.
 *
 * Both solids are stacks of hexagonal rings, which lets a bevel sit wherever an edge
 * should catch the key light. At the camera's three-quarter angle those bevels are what
 * make the shapes read as solid rather than as flat silhouettes.
 */

import { normalize } from './math3d.js';

/** Point-up hexagon vertices (matches the CSS clip-path used elsewhere). */
export function hexagon(radius, rotation = Math.PI / 2) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = rotation + (i * Math.PI) / 3;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function centroid(vertices, indices) {
  const sum = [0, 0, 0];
  for (const index of indices) {
    const v = vertices[index];
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  const n = indices.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/**
 * Outward normal of a wall, solved in the (radius, z) profile plane. Both solids are
 * surfaces of revolution about the z axis, so "outward" is simply the sign that points
 * away from the interior at (0, 0) — no hand-picked normals to get wrong when a ring
 * moves.
 */
function profileNormal(u1, z1, u2, z2) {
  let nu = z2 - z1;
  let nz = -(u2 - u1);
  if (-u1 * nu - z1 * nz > 0) {
    nu = -nu;
    nz = -nz;
  }
  const len = Math.hypot(nu, nz) || 1;
  return [nu / len, nz / len];
}

/** Lifts a profile normal into a 3D face normal for the wall facing `angle`. */
function wallNormal(angle, profile) {
  return [Math.cos(angle) * profile[0], Math.sin(angle) * profile[0], profile[1]];
}

/** Mid-angle of the hexagonal wall between vertex i and i + 1. */
const wallAngle = (i) => Math.PI / 2 + ((i + 0.5) * Math.PI) / 3;

/**
 * The outer shell: a chamfered hexagonal puck.
 *
 * The widest ring sits *behind* the front plane, so a bevel slopes forward and outward
 * from it to the flat front cap — that bevel faces the camera and the key light, which is
 * what gives the body its solid read. The front cap carries the recessed window.
 */
export function createVessel({
  radius = 1,
  rimZ = 0.24,
  frontRadius = 0.88,
  frontZ = 0.37,
  backRadius = 0.8,
  backZ = -0.37,
  windowRadius = 0.63
} = {}) {
  const vertices = [];
  const push = (x, y, z) => vertices.push([x, y, z]) - 1;
  const ring = (r, z) => hexagon(r).map(([x, y]) => push(x, y, z));

  const outerBack = ring(backRadius, backZ);
  const rim = ring(radius, rimZ);
  const outerFront = ring(frontRadius, frontZ);
  const innerFront = ring(windowRadius, frontZ);

  const side = profileNormal(backRadius, backZ, radius, rimZ);
  const bevel = profileNormal(radius, rimZ, frontRadius, frontZ);

  const faces = [
    { indices: [...outerBack].reverse(), normal: [0, 0, -1], kind: 'back', smooth: true }
  ];

  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const angle = wallAngle(i);
    faces.push({
      indices: [outerBack[i], outerBack[j], rim[j], rim[i]],
      normal: wallNormal(angle, side),
      kind: 'side',
      smooth: true
    });
    faces.push({
      indices: [rim[i], rim[j], outerFront[j], outerFront[i]],
      normal: wallNormal(angle, bevel),
      kind: 'bevel',
      smooth: false
    });
    faces.push({
      indices: [outerFront[i], outerFront[j], innerFront[j], innerFront[i]],
      normal: [0, 0, 1],
      kind: 'ring',
      smooth: false
    });
  }

  return {
    mesh: { vertices, faces },
    window: { radius: windowRadius, z: frontZ, points: hexagon(windowRadius) },
    extents: { radius, rimZ, frontRadius, frontZ, backRadius, backZ, windowRadius }
  };
}

/**
 * The floating die: a chamfered hexagonal token. The front face stays flat (the verdict is
 * inked onto it), while the bevelled shoulder and rim give the tumble a moving highlight
 * instead of a flat edge-on line.
 */
export function createPlate({ radius = 0.44, thickness = 0.2, chamfer = 0.05 } = {}) {
  const half = thickness / 2;
  const lipZ = half - chamfer * 1.6;
  const faceRadius = radius - chamfer;

  const vertices = [];
  const push = (x, y, z) => vertices.push([x, y, z]) - 1;
  const ring = (r, z) => hexagon(r).map(([x, y]) => push(x, y, z));

  const front = ring(faceRadius, half);
  const frontLip = ring(radius, lipZ);
  const backLip = ring(radius, -lipZ);
  const back = ring(faceRadius, -half);

  const shoulder = profileNormal(radius, lipZ, faceRadius, half);
  const rim = profileNormal(radius, -lipZ, radius, lipZ);
  const heel = profileNormal(faceRadius, -half, radius, -lipZ);

  const faces = [
    { indices: front, normal: [0, 0, 1], kind: 'answer', smooth: false },
    { indices: [...back].reverse(), normal: [0, 0, -1], kind: 'plate-back', smooth: false }
  ];

  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const angle = wallAngle(i);
    faces.push({
      indices: [frontLip[i], frontLip[j], front[j], front[i]],
      normal: wallNormal(angle, shoulder),
      kind: 'plate-shoulder',
      smooth: false
    });
    faces.push({
      indices: [backLip[i], backLip[j], frontLip[j], frontLip[i]],
      normal: wallNormal(angle, rim),
      kind: 'plate-rim',
      smooth: false
    });
    faces.push({
      indices: [back[i], back[j], backLip[j], backLip[i]],
      normal: wallNormal(angle, heel),
      kind: 'plate-heel',
      smooth: false
    });
  }

  return { mesh: { vertices, faces }, points: hexagon(faceRadius), radius: faceRadius, thickness };
}

export function faceCentroid(vertices, indices) {
  return centroid(vertices, indices);
}

