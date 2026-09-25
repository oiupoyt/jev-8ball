/**
 * Unit tests for the hand-rolled 3D layer. These are pure functions, so they run in
 * Node with no browser: `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CAMERA, OracleBall, clipPolygonBelow, inkTransform, springToward, wrapAnswer } from '../public/js/ball3d.js';
import {
  affineFromThreePoints,
  clamp,
  cross,
  dot,
  hexToRgb,
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
  quatSlerp,
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
  const { mesh, window: opening, extents } = createVessel();
  assert.equal(mesh.vertices.length, 24); // four hexagonal rings
  assert.equal(mesh.faces.length, 19); // back cap + 6 sides + 6 bevels + 6 front frame pieces

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

  // The widest ring sits behind the front plane, so every bevel slopes forward and
  // outward: that is the band that faces the camera and the key light.
  assert.ok(extents.rimZ < extents.frontZ, 'the bevel must slope toward the camera');
  assert.ok(extents.frontRadius < extents.radius, 'the front cap must be narrower than the rim');
  for (const face of mesh.faces) {
    if (face.kind !== 'bevel') continue;
    const radial = Math.hypot(face.normal[0], face.normal[1]);
    assert.ok(face.normal[2] > 0, 'bevel must face the camera');
    assert.ok(radial > 0, 'bevel must face outward');
  }

  // The opening is smaller than the body and sits on the front plane.
  assert.ok(opening.radius > 0 && opening.radius < 1);
  assert.ok(opening.z > 0);
  assert.equal(opening.points.length, 6);
});

test('plate mesh exposes an ordered answer face for text projection', () => {
  const plate = createPlate();
  assert.equal(plate.mesh.vertices.length, 24); // front face, two lips, back face
  assert.equal(plate.mesh.faces.length, 20); // 2 caps + shoulder, rim and heel rings

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
    assert.ok(near(Math.hypot(point[0], point[1]), plate.radius));
  });

  // A bevelled shoulder keeps a highlight sweeping across the die as it tumbles.
  const shoulder = plate.mesh.faces.filter((face) => face.kind === 'plate-shoulder');
  assert.equal(shoulder.length, 6);
  for (const face of shoulder) {
    assert.ok(face.normal[2] > 0, 'shoulder must face the camera');
    assert.ok(Math.hypot(face.normal[0], face.normal[1]) > 0, 'shoulder must face outward');
  }
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

/* ─── animation layer ─── */

test('quaternions agree with the matrix rotations', () => {
  const angle = 0.7;
  for (const [axis, rotate] of [
    [[1, 0, 0], mat4RotateX],
    [[0, 1, 0], mat4RotateY],
    [[0, 0, 1], mat4RotateZ]
  ]) {
    const fromQuat = mat4FromQuat(quatFromAxisAngle(axis, angle));
    const fromMatrix = rotate(angle);
    for (let i = 0; i < 16; i += 1) {
      assert.ok(near(fromQuat[i], fromMatrix[i], 1e-6), `element ${i} for axis ${axis}`);
    }
  }

  // Composing quaternions must match composing matrices, and rotating a direction through
  // the quaternion path must land where the matrix path does.
  const composed = quatMul(quatFromAxisAngle([0, 0, 1], 0.4), quatFromAxisAngle([1, 0, 0], -1.1));
  const composedMatrix = mat4Mul(mat4RotateZ(0.4), mat4RotateX(-1.1));
  const direction = normalize([0.3, -0.4, 0.8]);
  assert.ok(nearVec(quatRotate(composed, direction), transformDir(composedMatrix, direction), 1e-5));
  assert.ok(near(Math.hypot(...composed), 1, 1e-9), 'quatMul must preserve unit length');
});

test('quatSlerp takes the shortest path and is exact at both ends', () => {
  const a = quatFromAxisAngle([0, 1, 0], 0.3);
  const b = quatFromAxisAngle([1, 0, 0], 2.4);
  assert.ok(nearVec(quatSlerp(a, b, 0), a, 1e-9));
  assert.ok(nearVec(quatSlerp(a, b, 1), b, 1e-9));

  const mid = quatSlerp(a, b, 0.5);
  assert.ok(near(quatError(mid, a).angle, quatError(mid, b).angle, 1e-6), 'midpoint must be equidistant');

  // 350° about an axis is a 10° rotation, not a 350° one.
  const nearlyFull = quatFromAxisAngle([0, 0, 1], Math.PI * 2 - 0.2);
  assert.ok(quatError(nearlyFull, quatIdentity()).angle < 0.25);
});

test('quatError yields an error that unwinds onto the target', () => {
  const target = quatFromAxisAngle([0.2, 1, 0.4], 0.9);
  const spin = { axis: normalize([0.3, -0.5, 0.8]), angle: 2.2 };
  const from = quatMul(quatFromAxisAngle(spin.axis, spin.angle), target);

  const error = quatError(from, target);
  assert.ok(near(error.angle, spin.angle, 1e-6), `recovered ${error.angle}`);
  assert.ok(nearVec(error.axis, spin.axis, 1e-6));

  // The identity the settle relies on: winding the angle down to zero lands exactly on the
  // target, while the full angle reproduces where the die actually was.
  assert.ok(nearVec(quatMul(quatFromAxisAngle(error.axis, error.angle), target), from, 1e-9));
  assert.ok(nearVec(quatMul(quatFromAxisAngle(error.axis, 0), target), target, 1e-12));
});

test('quatIntegrate spins a body about its axis', () => {
  let q = quatIdentity();
  // Stay under half a turn: past that the shortest-path angle wraps, which is the
  // behaviour quatError is *supposed* to have.
  const steps = 24;
  for (let i = 0; i < steps; i += 1) q = quatIntegrate(q, [0, 0, 2.5], 1 / 60);
  const expected = (steps * 2.5) / 60;
  assert.ok(near(Math.hypot(...q), 1, 1e-9), 'integration must stay normalized');
  assert.ok(near(quatError(q, quatIdentity()).angle, expected, 1e-3));
  assert.ok(nearVec(quatError(q, quatIdentity()).axis, [0, 0, 1], 1e-3));
});

test('oscillatorStep is stable, damped and frame-rate independent', () => {
  // One 30 Hz step and two 60 Hz steps must agree: motion cannot depend on the frame rate
  // of the machine it happens to run on.
  const coarse = oscillatorStep({ x: 1, v: 0 }, 1 / 30, 12, 0.3);
  const fine = oscillatorStep(oscillatorStep({ x: 1, v: 0 }, 1 / 60, 12, 0.3), 1 / 60, 12, 0.3);
  assert.ok(near(coarse.x, fine.x, 1e-9) && near(coarse.v, fine.v, 1e-9));

  // A critically damped spring approaches rest without crossing it.
  let state = { x: 1, v: 0 };
  for (let i = 0; i < 240; i += 1) {
    state = oscillatorStep(state, 1 / 60, 8, 1);
    assert.ok(state.x > 0, `critically damped spring overshot at step ${i}`);
  }
  assert.ok(Math.abs(state.x) < 1e-3, `did not settle: ${state.x}`);

  // An underdamped spring rings past the target.
  let ringing = { x: 1, v: 0 };
  let crossed = false;
  for (let i = 0; i < 120; i += 1) {
    ringing = oscillatorStep(ringing, 1 / 60, 10, 0.2);
    if (ringing.x < 0) crossed = true;
  }
  assert.ok(crossed, 'an underdamped spring should overshoot');

  // A stalled frame must not make the simulation explode: that is why it sub-steps.
  const stalled = oscillatorStep({ x: 1, v: 0 }, 0.5, 50, 0.1);
  assert.ok(Number.isFinite(stalled.x) && Math.abs(stalled.x) <= 1.01, `blew up: ${stalled.x}`);
});

test('springToward converges on a target and is frame-rate independent', () => {
  let state = { x: 0, v: 0 };
  for (let i = 0; i < 240; i += 1) state = springToward(state, 1, 1 / 60, { omega: 20, zeta: 0.7 });
  assert.ok(near(state.x, 1, 1e-3), `did not converge: ${state.x}`);

  const rates = { omega: 20, zeta: 0.7 };
  const coarse = springToward({ x: 0, v: 0 }, 0.5, 1 / 30, rates);
  const fine = springToward(springToward({ x: 0, v: 0 }, 0.5, 1 / 60, rates), 0.5, 1 / 60, rates);
  assert.ok(near(coarse.x, fine.x, 1e-9) && near(coarse.v, fine.v, 1e-9));
});

test('the roll tumbles smoothly and settles onto the answer face', () => {
  // The renderer modules are pure, so the whole motion can be stepped headlessly against a
  // stub canvas: no browser, no WebGL, and fully deterministic.
  const ball = new OracleBall({ getContext: () => null }, {});
  const dt = 1 / 60;
  const step = () => {
    ball.clock += dt;
    ball._update(dt);
  };

  ball.roll();
  const start = ball.plateQuat.slice();
  let travelled = 0;
  for (let i = 0; i < 30; i += 1) {
    step();
    travelled += quatError(start, ball.plateQuat).angle;
  }
  assert.ok(travelled > 1.5, `the die barely tumbled: ${travelled} rad in half a second`);

  // Answer mid-tumble, then record every frame of the settle.
  ball.answer('Yes definitely.', 'affirmative');
  const remainingAngle = [];
  const jumps = [];
  let previous = ball.plateQuat.slice();
  let frames = 0;
  while (ball.phase !== 'ready' && frames < 900) {
    step();
    const now = ball.plateQuat.slice();
    jumps.push(quatError(previous, now).angle);
    remainingAngle.push(quatError(now, quatIdentity()).angle);
    previous = now;
    frames += 1;
  }
  assert.equal(ball.phase, 'ready', 'the settle must finish on its own');

  // No frame may teleport the die: a jump is exactly what a rewinding unwind looks like.
  assert.ok(Math.max(...jumps) < 0.3, `a single frame rotated ${Math.max(...jumps)} rad`);

  // The remaining error falls away, overshooting at most once — a settle, not a rewind.
  let sign = 0;
  let overshoot = 0;
  let crossed = false;
  remainingAngle.forEach((value, index) => {
    if (index === 0) return;
    const delta = value - remainingAngle[index - 1];
    if (Math.abs(delta) < 1e-4) return;
    const next = Math.sign(delta);
    if (sign !== 0 && next !== sign) crossed = true;
    sign = next;
    if (crossed) overshoot = Math.max(overshoot, value);
  });
  assert.ok(overshoot > 0.01, 'the settle should bounce once as the die lands');
  assert.ok(overshoot < 0.2, `the settle bounced too far: ${overshoot} rad`);
  assert.ok(remainingAngle.at(-1) < 0.03, `the die never landed: ${remainingAngle.at(-1)}`);

  // Face-on to the camera, ink surfaced, floating inside the chamber.
  assert.ok(dot(quatRotate(ball.plateQuat, [0, 0, 1]), [0, 0, 1]) > 0.999);
  assert.equal(ball.answerAlpha, 1);
  assert.ok(ball.plateY.x > 0 && ball.plateY.x < 0.2, `the die drifted to y=${ball.plateY.x}`);

  // The rattle and the liquid must ring down instead of buzzing forever.
  for (let i = 0; i < 240; i += 1) step();
  assert.ok(ball.shakeEnergy < 1e-3, `the rattle never stopped: ${ball.shakeEnergy}`);
  assert.ok(Math.abs(ball.surface.x) < 0.02, `the liquid never settled: ${ball.surface.x}`);
});

test('the renderer camera frames the vessel from a three-quarter angle', () => {
  const size = 344;
  const view = mat4LookAt(CAMERA.eye, CAMERA.target, [0, 1, 0]);
  const projection = mat4Mul(
    mat4Perspective((CAMERA.fov * Math.PI) / 180, 1, CAMERA.near, CAMERA.far),
    view
  );
  const { extents } = createVessel();
  const centre = projectToScreen(transformPoint(projection, [0, 0, 0]), size, size);
  const rim = [-1, 1].map((sign) =>
    projectToScreen(transformPoint(projection, [sign * extents.radius, 0, extents.rimZ]), size, size)
  );
  const fraction = Math.max(...rim.map((point) => Math.abs(point.x - centre.x))) / (size / 2);

  // Big enough to read, small enough to leave room for the rattle and the cast shadow.
  assert.ok(fraction > 0.68 && fraction < 0.84, `the vessel fills ${fraction} of the frame`);
  assert.ok(near(centre.x, size / 2, 2) && near(centre.y, size / 2, 4), 'the vessel must stay centred');

  // The camera has to sit off-axis, or the bevelled rim and tapered walls flatten away.
  const offset = Math.hypot(CAMERA.eye[0] - CAMERA.target[0], CAMERA.eye[1] - CAMERA.target[1]);
  assert.ok(offset > 0.5, `the camera is almost dead-on: ${offset}`);
});



