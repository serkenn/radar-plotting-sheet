import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bearingOf, footOnLine, len, lineCircle, lineLine, norm180, norm360, tangentsFromPoint, vec } from '../public/js/geometry.js';
import { formatTime, parseNumber, parseTime, solveAvoidance, solveTarget } from '../public/js/solve.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ±${tolerance}, got ${actual}`);

const obs = (rows) => rows.map(([time, bearing, range]) => ({ time: parseTime(time), bearing, range }));

test('angles are normalised', () => {
  assert.equal(norm360(-10), 350);
  assert.equal(norm360(725), 5);
  assert.equal(norm180(190), -170);
  assert.equal(norm180(180), 180);
  assert.equal(norm180(-180), 180);
});

test('bearings run clockwise from north', () => {
  near(vec(90, 2).x, 2, 1e-12);
  near(vec(90, 2).y, 0, 1e-12);
  near(bearingOf({ x: -1, y: 0 }), 270, 1e-9);
  near(bearingOf({ x: 1, y: 1 }), 45, 1e-9);
});

test('line helpers', () => {
  const foot = footOnLine({ x: 5, y: 1 }, { x: 1, y: 0 });
  near(foot.point.x, 0, 1e-12);
  near(foot.point.y, 1, 1e-12);
  const hit = lineLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 4, y: 0 }, { x: 0, y: 1 });
  near(hit.point.x, 4, 1e-12);
  near(hit.point.y, 4, 1e-12);
  assert.equal(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 0 }), null);
  const cuts = lineCircle({ x: -5, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 3);
  assert.equal(cuts.length, 2);
  near(cuts[0].point.x, -3, 1e-12);
  near(cuts[1].point.x, 3, 1e-12);
});

test('tangents touch the circle at right angles', () => {
  const p = vec(80, 6);
  const tangents = tangentsFromPoint(p, 3);
  assert.equal(tangents.length, 2);
  for (const t of tangents) {
    near(len(t.point), 3, 1e-9);
    near(t.point.x * t.dir.x + t.point.y * t.dir.y, 0, 1e-9);
  }
  assert.equal(tangentsFromPoint(vec(10, 2), 3).length, 0);
});

test('time and number parsing', () => {
  assert.equal(parseTime('1006'), 606);
  assert.equal(parseTime('906'), 546);
  assert.equal(parseTime('10:06'), 606);
  assert.equal(parseTime('１００６'), 606);
  assert.equal(parseTime('2460'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(formatTime(606), '1006');
  assert.equal(formatTime(1445), '0005');
  assert.equal(formatTime(623.8), '1024');
  assert.equal(parseNumber('083.5'), 83.5);
  assert.equal(parseNumber('８３．５'), 83.5);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('12a')));
});

test('crossing target: relative motion, true motion, CPA and aspect', () => {
  const sol = solveTarget({ course: 40, speed: 15 }, obs([['1000', 85, 12], ['1006', 83.5, 9]]));
  assert.ok(sol.ok);
  near(sol.rel.course, 269.5, 0.1, 'relative course');
  near(sol.rel.speed, 30.1, 0.1, 'relative speed');
  near(sol.true.course, 298.8, 0.1, 'true course');
  near(sol.true.speed, 23.3, 0.1, 'true speed');
  near(sol.cpa.dcpa, 0.94, 0.01, 'DCPA');
  near(sol.cpa.bearing, 359.5, 0.1, 'CPA bearing');
  near(sol.cpa.tcpaMin, 17.8, 0.1, 'TCPA');
  assert.equal(formatTime(sol.cpa.time), '1024');
  assert.equal(sol.aspect.side, 'R');
  near(sol.aspect.reciprocal, 263.5, 1e-9);
  near(sol.aspect.angle, 35.3, 0.1, 'aspect');
  // The triangle closes: e → M1 is own ship, e → M2 is the target.
  near(len({ x: sol.first.p.x - sol.e.x, y: sol.first.p.y - sol.e.y }), 1.5, 1e-9);
  near(len({ x: sol.last.p.x - sol.e.x, y: sol.last.p.y - sol.e.y }), sol.true.speed / 10, 1e-9);
});

test('course or speed change that opens the CPA to 3 miles', () => {
  const sol = solveTarget({ course: 40, speed: 15 }, obs([['1000', 85, 12], ['1006', 83.5, 9]]));
  const avoid = solveAvoidance(sol, { time: parseTime('1012'), mode: 'cpa', distance: 3 });
  assert.ok(avoid.ok);
  near(bearingOf(avoid.m3), 80.5, 0.1, 'action point bearing');
  near(len(avoid.m3), 6.01, 0.01, 'action point range');
  near(avoid.relCourse, 290.4, 0.1, 'new relative course');
  near(avoid.newCpa.dcpa, 3, 1e-9);
  assert.equal(avoid.courses.length, 2);
  near(avoid.courses[0].course, 97.5, 0.1, 'starboard solution');
  near(avoid.courses[0].turn, 57.5, 0.1);
  near(avoid.courses[1].course, 303.4, 0.1, 'port solution');
  near(avoid.courses[1].turn, -96.6, 0.1);
  near(avoid.speed.speed, 3.57, 0.01, 'new speed');
  assert.equal(avoid.speed.change, 'slower');
  assert.equal(avoid.alreadyClear, false);
  // Every solution keeps the new relative motion parallel to the tangent.
  for (const s of avoid.courses) {
    const rel = { x: sol.true.vel.x - vec(s.course, 15).x, y: sol.true.vel.y - vec(s.course, 15).y };
    near(bearingOf(rel), avoid.relCourse, 1e-6);
    near(len({ x: s.point.x - sol.e.x, y: s.point.y - sol.e.y }), 1.5, 1e-9);
  }
  const other = solveAvoidance(sol, { time: parseTime('1012'), mode: 'cpa', distance: 3, side: 'opposite' });
  near(other.relCourse, 230.6, 0.1, 'other tangent');
  assert.equal(other.courses.length, 0);
});

test('slowing down so that the target crosses 2.5 miles ahead', () => {
  const sol = solveTarget(
    { course: 165, speed: 9 },
    obs([['1600', 270, 12], ['1610', 269, 10.5], ['1620', 268, 9]]),
  );
  assert.ok(sol.ok);
  assert.equal(sol.dtMin, 20);
  near(sol.true.course, 130.3, 0.1);
  near(sol.true.speed, 14.9, 0.1);
  const avoid = solveAvoidance(sol, { time: parseTime('1630'), mode: 'bow', distance: 2.5 });
  assert.ok(avoid.ok);
  near(avoid.relCourse, 103.4, 0.1);
  near(avoid.speed.speed, 7.66, 0.01);
  near(avoid.newCpa.dcpa, 2.2, 0.01);
  assert.equal(avoid.courses.length, 0);
});

test('steady bearing means collision', () => {
  const sol = solveTarget({ course: 0, speed: 10 }, obs([['1200', 90, 6], ['1206', 90, 5]]));
  near(sol.rel.course, 270, 1e-6);
  near(sol.rel.speed, 10, 1e-6);
  near(sol.cpa.dcpa, 0, 1e-9);
  assert.equal(sol.cpa.bearing, null);
  near(sol.cpa.tcpaMin, 30, 1e-6);
  near(sol.true.course, 315, 1e-6);
  near(sol.true.speed, Math.SQRT2 * 10, 1e-6);
  assert.equal(sol.aspect.side, 'R');
  near(sol.aspect.angle, 45, 1e-6);
  const avoid = solveAvoidance(sol, { time: parseTime('1212'), mode: 'cpa', distance: 2 });
  assert.ok(avoid.ok);
  assert.ok(avoid.courses.some((s) => s.turn > 0), 'a starboard turn is offered on a collision course');
});

test('target showing her starboard side', () => {
  const sol = solveTarget({ course: 300, speed: 12 }, obs([['1200', 249, 12], ['1206', 250.5, 9.5]]));
  near(sol.true.course, 35, 0.1);
  near(sol.true.speed, 21.1, 0.1);
  assert.equal(sol.aspect.side, 'G');
  near(sol.aspect.reciprocal, 70.5, 1e-9);
  near(sol.aspect.angle, 35.5, 0.1);
  near(sol.cpa.dcpa, 1.19, 0.01);
  near(sol.cpa.bearing, 333.3, 0.1);
});

test('aspect at the bow and at the stern', () => {
  // Target dead ahead steering straight for us, then straight away from us.
  const headOn = solveTarget({ course: 0, speed: 10 }, obs([['0800', 0, 10], ['0806', 0, 8]]));
  assert.equal(headOn.aspect.side, 'bow');
  near(headOn.true.course, 180, 1e-6);
  const overtaking = solveTarget({ course: 0, speed: 10 }, obs([['0800', 0, 5], ['0806', 0, 5.5]]));
  assert.equal(overtaking.aspect.side, 'stern');
  near(overtaking.true.course, 0, 1e-6);
  assert.equal(overtaking.bow, null);
});

test('observations across midnight', () => {
  const sol = solveTarget({ course: 40, speed: 15 }, obs([['2357', 85, 12], ['0003', 83.5, 9]]));
  assert.ok(sol.ok);
  assert.equal(sol.dtMin, 6);
  assert.equal(formatTime(sol.cpa.time), '0021');
  const avoid = solveAvoidance(sol, { time: parseTime('0009'), mode: 'cpa', distance: 3 });
  assert.ok(avoid.ok);
  near(avoid.courses[0].course, 97.5, 0.1);
});

test('invalid input is reported, not thrown', () => {
  assert.equal(solveTarget({ course: NaN, speed: 10 }, obs([['1000', 85, 12], ['1006', 83.5, 9]])).error, 'own');
  assert.equal(solveTarget({ course: 0, speed: 10 }, obs([['1000', 85, 12]])).error, 'few');
  assert.equal(solveTarget({ course: 0, speed: 10 }, obs([['1000', 85, 0], ['1006', 83.5, 9]])).error, 'observation');
  const sol = solveTarget({ course: 40, speed: 15 }, obs([['1000', 85, 12], ['1006', 83.5, 9]]));
  assert.equal(solveAvoidance(sol, { time: parseTime('1000'), mode: 'cpa', distance: 3 }).error, 'early');
  assert.equal(solveAvoidance(sol, { time: parseTime('1030'), mode: 'cpa', distance: 3 }).error, 'passed');
  assert.equal(solveAvoidance(sol, { time: parseTime('1020'), mode: 'cpa', distance: 3 }).error, 'inside');
  assert.equal(solveAvoidance(sol, { time: parseTime('1012'), mode: 'cpa', distance: 0 }).error, 'distance');
  // Same course and speed as own ship: no relative motion.
  const parallel = solveTarget({ course: 0, speed: 10 }, obs([['1000', 90, 5], ['1006', 90, 5]]));
  assert.equal(parallel.rel.moving, false);
  assert.equal(parallel.cpa, null);
  assert.equal(solveAvoidance(parallel, { time: parseTime('1012'), mode: 'cpa', distance: 3 }).error, 'static');
});
