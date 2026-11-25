import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cross, len, sub, vec } from '../public/js/geometry.js';
import { buildModel, chooseRange, chooseSpeedScale } from '../public/js/model.js';
import { PRESETS } from '../public/js/presets.js';
import { STEPS, fullView, renderSheet, trianglePoints } from '../public/js/render.js';

const visible = (markup) => markup.replace(/<[^>]*>/g, '\n');

function sceneFor(id, method, step = STEPS.length - 1) {
  const model = buildModel(PRESETS.find((p) => p.id === id));
  const range = chooseRange(model, 'auto');
  const scene = {
    range,
    step,
    own: model.own,
    targets: model.targets.map((t) => ({ index: t.index, sol: t.sol, avoid: t.avoid, active: t.index === 0 })),
    loose: [],
    multi: model.targets.length > 1,
    method,
    knotsPerMile: chooseSpeedScale(model, range),
  };
  return { model, range, scene };
}

const draw = (id, method, step, size = 900) => {
  const { range, scene } = sceneFor(id, method, step);
  return renderSheet(fullView(size, size, range), scene);
};

test('distance-vector method draws the triangle at the first plot', () => {
  const seen = visible(draw('crossing', 'distance'));
  assert.ok(seen.includes('\ne\n'), 'point e is labelled');
  assert.ok(!seen.includes('転移'));
});

test('speed-vector method draws the triangle from the centre with the relative motion transferred', () => {
  const markup = draw('crossing', 'speed');
  const seen = visible(markup);
  for (const text of ['自船 040°・15.0kn', '相対（転移）269.5°・30.1kn', '新しい相対（転移）', '新針路 097.5°', '新針路 303.4°', '新速力 3.6kn']) {
    assert.ok(seen.includes(text), text);
  }
  assert.ok(!seen.includes('\ne\n'), 'there is no point e in this method');
  // one pair of single marks (relative motion) and one pair of double marks (new relative motion)
  assert.equal((markup.match(/class="ln thin rel" d="M/g) ?? []).length, 2);
  assert.equal((markup.match(/class="ln thin avoid" d="M/g) ?? []).length, 4);
});

test('earlier steps do not show the triangle or the avoidance construction', () => {
  const seen = visible(draw('crossing', 'speed', STEPS.indexOf('cpa')));
  assert.ok(!seen.includes('転移'));
  assert.ok(!seen.includes('新針路'));
  const triangle = visible(draw('crossing', 'speed', STEPS.indexOf('triangle')));
  assert.ok(triangle.includes('相対（転移）'));
  assert.ok(!triangle.includes('新針路'));
});

test('in the speed-vector triangle every new own-ship vector ends on the transferred line', () => {
  const { model, scene } = sceneFor('crossing', 'speed');
  const { sol, avoid } = model.targets[0];
  const k = scene.knotsPerMile;
  const tip = { x: sol.true.vel.x / k, y: sol.true.vel.y / k };
  const onLine = (p) => Math.abs(cross(sub(p, tip), avoid.dir)) < 1e-9;
  for (const s of avoid.courses) {
    const end = vec(s.course, sol.own.speed / k);
    assert.ok(onLine(end), `course ${s.course}`);
    assert.ok(Math.abs(len(end) - sol.own.speed / k) < 1e-9);
  }
  assert.ok(onLine(vec(sol.own.course, avoid.speed.speed / k)), 'speed-only solution');
});

test('the view of the triangle follows the drawing method', () => {
  const { model, scene } = sceneFor('crossing', 'speed');
  const { sol, avoid } = model.targets[0];
  const atPlot = trianglePoints(sol, avoid);
  const atCentre = trianglePoints(sol, avoid, 'speed', scene.knotsPerMile);
  assert.ok(atPlot.every((p) => len(p) > 5), 'the distance triangle lies out by the plots');
  assert.ok(atCentre.some((p) => len(p) === 0), 'the speed triangle starts at the centre');
});

test('slowing down in the speed-vector method', () => {
  const seen = visible(draw('slow-down', 'speed'));
  assert.ok(seen.includes('新速力 7.7kn'));
  assert.ok(!seen.includes('新針路'));
});
