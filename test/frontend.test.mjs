/**
 * Unit tests for the hand-rolled 3D layer. These are pure functions, so they run in
 * Node with no browser: `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { clipPolygonBelow, inkTransform, wrapAnswer } from '../public/js/ball3d.js';
import {
  affineFromThreePoints,
  clamp,
  cross,
  dot,
  hexToRgb,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4RotateZ,
  mat4Translate,
  mixRgb,
  normalize,
  projectToScreen,
  rgbCss,
  smoothstep,
  transformDir,
  transformPoint
} from '../public/js/math3d.js';
import { createPlate, createVessel, hexagon } from '../public/js/meshes.js';

const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
const nearVec = (a, b, tolerance = 1e-5) =>
  a.every((value, index) => near(value, b[index], tolerance));

test('vector helpers behave', () => {
  assert.ok(nearVec(normalize([3, 0, 0]), [1, 0, 0]));
  assert.ok(nearVec(normalize([0, 0, 0]), [0, 0, 0]));
  assert.equal(dot([1, 2, 3], [4, -5, 6]), 12);
  assert.ok(nearVec(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]));
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, -3), 0);
  assert.equal(smoothstep(0, 1, 3), 1);
  assert.deepEqual(hexToRgb('#10b981'), [16, 185, 129]);
  assert.equal(rgbCss([300, -5, 10.4]), 'rgb(255,0,10)');
  assert.equal(rgbCss([10, 20, 30], 0.5), 'rgba(10,20,30,0.5)');
  assert.ok(nearVec(mixRgb([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]));
});

test('matrices compose in the documented order', () => {
  const translated = mat4Mul(mat4Translate(1, 2, 3), mat4Translate(10, 20, 30));
  assert.ok(nearVec(transformPoint(translated, [0, 0, 0]).slice(0, 3), [11, 22, 33]));

  const rotated = mat4RotateZ(Math.PI / 2);
  assert.ok(nearVec(transformPoint(rotated, [1, 0, 0]).slice(0, 3), [0, 1, 0], 1e-6));
  assert.ok(nearVec(transformDir(rotated, [1, 0, 0]), [0, 1, 0], 1e-6));
});

test('camera projection keeps the vessel inside the viewport', () => {
  const view = mat4LookAt([0, 0, 4.3], [0, 0, 0], [0, 1, 0]);
  const projection = mat4Mul(mat4Perspective((36 * Math.PI) / 180, 1, 0.1, 40), view);
  const size = 344;

  const centre = projectToScreen(transformPoint(projection, [0, 0, 0]), size, size);
  assert.ok(near(centre.x, size / 2) && near(centre.y, size / 2));

  // A point on the vessel's silhouette should land at ~72% of the half-height, which
  // is what leaves room for the shake and the cast shadow.
  const edge = projectToScreen(transformPoint(projection, [1, 0, 0]), size, size);
  const fraction = (edge.x - size / 2) / (size / 2);
  assert.ok(fraction > 0.68 && fraction < 0.76, `silhouette fraction was ${fraction}`);

  // Far side of the vessel must sort behind the origin for the painter's algorithm,
  // and perspective must foreshorten the same height as depth increases.
  const back = projectToScreen(transformPoint(projection, [0, 0, -1]), size, size);
  assert.ok(back.depth > centre.depth, 'NDC depth must grow with distance');

  const nearTop = projectToScreen(transformPoint(projection, [0, 1, 0]), size, size);
  const farTop = projectToScreen(transformPoint(projection, [0, 1, -1]), size, size);
  assert.ok(nearTop.y < size / 2, 'a raised point must project above the centre row');
  assert.ok(farTop.y > nearTop.y, 'the same height must foreshorten when it is further away');
});

test('affine solve maps local points onto screen points', () => {
  const matrix = affineFromThreePoints(
    { local: [0, 0], screen: [10, 20] },
    { local: [1, 0], screen: [12, 20] },
    { local: [0, 1], screen: [10, 22] }
  );
  assert.ok(nearVec(matrix, [2, 0, 0, 2, 10, 20]));
  // Degenerate (collinear) inputs must not produce a usable transform.
  assert.equal(
    affineFromThreePoints(
      { local: [0, 0], screen: [0, 0] },
      { local: [1, 1], screen: [1, 1] },
      { local: [2, 2], screen: [2, 2] }
    ),
    null
  );
});

test('hexagon vertices are point-up and evenly spaced', () => {
  const points = hexagon(2);
  assert.equal(points.length, 6);
  assert.ok(nearVec(points[0], [0, 2], 1e-9));
  for (const point of points) {
    assert.ok(near(Math.hypot(point[0], point[1]), 2));
  }
  // Neighbouring vertices must be exactly one radius apart on a regular hexagon.
  assert.ok(near(Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]), 2));
});

test('vessel mesh is closed, outward-facing, and unit-normalled', () => {
  const { mesh, window: opening } = createVessel();
  assert.equal(mesh.vertices.length, 18);
  assert.equal(mesh.faces.length, 13); // back cap + 6 sides + 6 frame pieces

  for (const face of mesh.faces) {
    assert.ok(face.indices.length >= 3 && face.indices.length <= 6);
    for (const index of face.indices) {
      assert.ok(index >= 0 && index < mesh.vertices.length, 'face index out of range');
    }
    assert.ok(near(Math.hypot(...face.normal), 1), 'normal must be unit length');
  }

  // Side facets must face away from the axis, caps must face along ±z.
  for (const face of mesh.faces) {
    if (face.kind === 'side') {
      const centre = face.indices
        .map((index) => mesh.vertices[index])
        .reduce((sum, vertex) => [sum[0] + vertex[0], sum[1] + vertex[1]], [0, 0]);
      assert.ok(dot(face.normal, [centre[0], centre[1], 0]) > 0, 'side normal points inward');
    }
    if (face.kind === 'back') assert.deepEqual(face.normal, [0, 0, -1]);
    if (face.kind === 'ring') assert.deepEqual(face.normal, [0, 0, 1]);
  }

  // The opening is smaller than the body and sits on the front plane.
  assert.ok(opening.radius > 0 && opening.radius < 1);
  assert.ok(opening.z > 0);
  assert.equal(opening.points.length, 6);
});

test('plate mesh exposes an ordered answer face for text projection', () => {
  const plate = createPlate();
  assert.equal(plate.mesh.vertices.length, 12);
  assert.equal(plate.mesh.faces.length, 8); // 8 faces, like the eight-ball

  const answer = plate.mesh.faces.find((face) => face.kind === 'answer');
  assert.deepEqual(answer.normal, [0, 0, 1]);
  assert.equal(answer.indices.length, 6);

  // _drawAnswerText pairs face.points[i] with plate.points[i], so vertex order matters.
  answer.indices.forEach((index, position) => {
    const vertex = plate.mesh.vertices[index];
    const point = plate.points[position];
    assert.ok(near(vertex[0], point[0]), `x mismatch at ${position}`);
    assert.ok(near(vertex[1], point[1]), `y mismatch at ${position}`);
    assert.ok(near(vertex[2], plate.thickness / 2));
  });
});

test('inkTransform keeps verdict glyphs upright on a face-on plate', () => {
  const plate = createPlate();
  const answer = plate.mesh.faces.find((face) => face.kind === 'answer');

  // A face-on plate: local x runs right, local y (up) runs up the screen, so it maps to
  // negative screen y because canvas y grows downwards.
  const scale = 100;
  const centre = 172;
  const facePoints = answer.indices.map((index) => {
    const local = plate.mesh.vertices[index];
    return { x: centre + local[0] * scale, y: centre - local[1] * scale };
  });

  const matrix = inkTransform(plate.points, facePoints);
  assert.ok(matrix, 'the text transform must be solvable');

  // A mirrored basis (negative determinant) renders every glyph upside down — the exact
  // bug this helper exists to prevent.
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  assert.ok(determinant > 0, `text basis is mirrored: det = ${determinant}`);

  // Text "right" and text "down" must travel right and down the screen respectively.
  assert.ok(matrix[0] > 0 && near(matrix[1], 0), `right drifts: (${matrix[0]}, ${matrix[1]})`);
  assert.ok(matrix[3] > 0 && near(matrix[2], 0), `down drifts: (${matrix[2]}, ${matrix[3]})`);

  // Successive lines are laid out at increasing y, so line two must land below line one.
  const origin = { x: matrix[4], y: matrix[5] };
  const secondLine = { x: matrix[2] + matrix[4], y: matrix[3] + matrix[5] };
  assert.ok(secondLine.y > origin.y, 'later lines must render below earlier ones');
  assert.equal(secondLine.y - origin.y, scale, 'one text unit must scale uniformly');

  // Collinear local corners cannot define a basis, so the solve must fail loudly rather
  // than hand the renderer a garbage transform.
  const collinear = Array.from({ length: 6 }, (_, index) => [index, 0]);
  assert.equal(inkTransform(collinear, facePoints), null);
});

test('clipPolygonBelow keeps only the part under the surface line', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const clipped = clipPolygonBelow(square, { x: 0, y: 5 }, { x: 10, y: 5 });
  assert.ok(clipped.length >= 3);
  for (const point of clipped) {
    assert.ok(point.y >= 5 - 1e-9, `point above the surface survived: ${point.y}`);
  }
  let area = 0;
  for (let i = 0; i < clipped.length; i += 1) {
    const current = clipped[i];
    const next = clipped[(i + 1) % clipped.length];
    area += current.x * next.y - next.x * current.y;
  }
  assert.ok(near(Math.abs(area / 2), 50, 1e-6), `half the square should remain, got ${area / 2}`);

  // A line entirely below the polygon leaves the polygon untouched.
  assert.equal(clipPolygonBelow(square, { x: 0, y: 50 }, { x: 10, y: 50 }).length, 0);
  assert.equal(clipPolygonBelow(square, { x: 0, y: -10 }, { x: 10, y: -10 }).length, 4);
});

test('wrapAnswer breaks verdicts into plate-sized lines', () => {
  assert.deepEqual(wrapAnswer('It is certain.'), ['IT IS', 'CERTAIN.']);
  assert.deepEqual(wrapAnswer('My sources say no.'), ['MY SOURCES', 'SAY NO.']);
  assert.deepEqual(wrapAnswer('Very doubtful.'), ['VERY', 'DOUBTFUL.']);
  assert.deepEqual(wrapAnswer('Concentrate and ask again.'), [
    'CONCENTRATE',
    'AND ASK',
    'AGAIN.'
  ]);
  assert.ok(wrapAnswer('').length >= 1);
  assert.ok(wrapAnswer('   ').length >= 1);
  const long = wrapAnswer('a really extremely unreasonably long prophecy string');
  assert.ok(long.length <= 3, 'never more than three lines');
  for (const line of long) {
    assert.ok(line.length <= 20, `line too long for the plate: ${line}`);
  }
});
