/**
 * Mesh builders for the oracle vessel. Pure data in, pure data out: every mesh is
 * `{ vertices: [[x, y, z]], faces: [{ indices, normal, kind, smooth }] }`, which the
 * renderer walks generically.
 */

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
 * The outer shell: a hexagonal prism whose front cap has a hexagonal opening so the
 * liquid chamber inside is visible through the frame.
 */
export function createVessel({ outerRadius = 1, depth = 0.52, windowRadius = 0.63 } = {}) {
  const half = depth / 2;
  const inner = hexagon(windowRadius);
  const vertices = [];
  const push = (x, y, z) => vertices.push([x, y, z]) - 1;
  const points = hexagon(outerRadius);

  const outerBack = points.map(([x, y]) => push(x, y, -half));
  const outerFront = points.map(([x, y]) => push(x, y, half));
  const innerFront = inner.map(([x, y]) => push(x, y, half));

  const faces = [
    { indices: [...outerBack].reverse(), normal: [0, 0, -1], kind: 'back', smooth: true }
  ];

  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const mid = Math.PI / 2 + ((i + 0.5) * Math.PI) / 3;
    faces.push({
      indices: [outerBack[i], outerBack[j], outerFront[j], outerFront[i]],
      normal: [Math.cos(mid), Math.sin(mid), 0],
      kind: 'side',
      smooth: true
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
    window: { radius: windowRadius, z: half, points: inner },
    extents: { outerRadius, depth, windowRadius }
  };
}

/** The floating die: a flat hexagonal plate that can settle face-on to the answer. */
export function createPlate({ radius = 0.44, thickness = 0.16 } = {}) {
  const half = thickness / 2;
  const points = hexagon(radius);
  const vertices = [];
  const push = (x, y, z) => vertices.push([x, y, z]) - 1;

  const front = points.map(([x, y]) => push(x, y, half));
  const back = points.map(([x, y]) => push(x, y, -half));

  const faces = [
    { indices: front, normal: [0, 0, 1], kind: 'answer', smooth: false },
    { indices: [...back].reverse(), normal: [0, 0, -1], kind: 'plate-back', smooth: false }
  ];

  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const mid = Math.PI / 2 + ((i + 0.5) * Math.PI) / 3;
    faces.push({
      indices: [back[i], back[j], front[j], front[i]],
      normal: [Math.cos(mid), Math.sin(mid), 0],
      kind: 'plate-rim',
      smooth: false
    });
  }

  return { mesh: { vertices, faces }, points, radius, thickness };
}

export function faceCentroid(vertices, indices) {
  return centroid(vertices, indices);
}
