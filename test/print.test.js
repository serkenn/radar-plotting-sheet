import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildModel, chooseRange, chooseSpeedScale } from '../public/js/model.js';
import { PRESETS } from '../public/js/presets.js';
import { PRINT_CONTENTS, buildPrintPages } from '../public/js/print.js';

const preset = (id) => PRESETS.find((p) => p.id === id);
const pages = (html) => html.split('<section class="page ').slice(1);
// What a reader sees: SVG coordinates and other attributes are full of digits, so they are stripped first.
const visible = (html) => html.replace(/<[^>]*>/g, '\n');
const build = (id, content, step = 5, active = 0) => {
  const model = buildModel(preset(id));
  return buildPrintPages({ model, range: chooseRange(model, 'auto'), active, step, content });
};

test('the model solves a preset and picks a range that holds every plot', () => {
  const model = buildModel(preset('crossing'));
  assert.ok(model.targets[0].sol.ok);
  assert.ok(model.targets[0].avoid.ok);
  assert.equal(chooseRange(model, 'auto'), 12);
  assert.equal(chooseRange(model, '24'), 24);
  const near = buildModel({ own: { course: '0', speed: '10' }, targets: [{ obs: [{ time: '1200', bearing: '90', range: '2.5' }, { time: '1206', bearing: '90', range: '2' }], avoid: { on: false, time: '', mode: 'cpa', dist: '', side: 'auto' } }] });
  assert.equal(chooseRange(near, 'auto'), 3);
});

test('incomplete input is reported by the model', () => {
  const state = structuredClone(preset('crossing'));
  state.targets[0].obs[1].bearing = 'x';
  assert.equal(buildModel(state).targets[0].sol.error, 'observation');
  state.targets[0].obs[1].bearing = '083.5';
  state.own.course = '';
  assert.equal(buildModel(state).targets[0].sol.error, 'own');
});

test('each choice of content gives the expected pages', () => {
  for (const [content, kinds] of Object.entries(PRINT_CONTENTS)) {
    const html = build('crossing', content);
    assert.deepEqual(pages(html).map((p) => p.slice(0, p.indexOf('"')).replace('page-', '')), kinds, content);
  }
});

test('the report prints the given values, the answers and the construction', () => {
  const html = build('crossing', 'report');
  const seen = visible(html);
  for (const text of ['040°', '1000', '085°', '083.5°', '269.5°・30.1 ノット', '0.94 海里', '1024', 'R35.', '097.5°', '303.4°', '3.6 ノット', '速力三角形の拡大図']) {
    assert.ok(seen.includes(text), `report should contain ${text}`);
  }
  assert.ok(html.includes('class="ln rel bold"'), 'relative motion line is drawn');
  assert.ok(html.includes('class="ln avoid bold"'), 'avoidance line is drawn');
});

test('the problem sheet gives the data but none of the answers', () => {
  const html = build('crossing', 'problem');
  const seen = visible(html);
  for (const text of ['040°', '1000', '085°', '083.5°', 'CPA を 3 海里にする', '計算・メモ']) {
    assert.ok(seen.includes(text), `problem sheet should contain ${text}`);
  }
  for (const answer of ['269.5°', '30.1', '0.94', '1024', 'R35.', '097.5°', '303.4°', '3.6 ノット', '298.']) {
    assert.ok(!seen.includes(answer), `problem sheet must not show ${answer}`);
  }
  assert.ok(!html.includes('class="ln rel'), 'no construction on the problem sheet');
  assert.ok(!html.includes('class="dt ink"'), 'no plotted points on the problem sheet');
});

test('the blank sheet has no data at all', () => {
  const html = build('crossing', 'blank');
  const seen = visible(html);
  for (const text of ['040°', '1000', '083.5°', '269.5°']) assert.ok(!seen.includes(text), `blank sheet must not show ${text}`);
  assert.ok(html.includes('class="blank"'));
  assert.ok(html.includes('class="ring outer"'));
});

test('a report up to an earlier step leaves the later answers empty', () => {
  const seen = visible(build('crossing', 'report', 1));
  assert.ok(seen.includes('269.5°・30.1 ノット'));
  for (const later of ['0.94 海里', 'R35.', '097.5°', '速力三角形の拡大図']) assert.ok(!seen.includes(later), `${later} belongs to a later step`);
});

test('several targets share one table', () => {
  const seen = visible(build('three-ships', 'report', 5, 1));
  for (const text of ['物標 Ⅰ', '物標 Ⅱ', '物標 Ⅲ', 'G31.5°', '速力三角形の拡大図（物標 Ⅱ）']) assert.ok(seen.includes(text), text);
});

test('the speed-vector method is carried into the printed report', () => {
  const model = buildModel(preset('crossing'));
  const range = chooseRange(model, 'auto');
  const knotsPerMile = chooseSpeedScale(model, range);
  assert.equal(knotsPerMile, 2, '23 knots on a 12 mile sheet needs one mile per two knots');
  const seen = visible(buildPrintPages({ model, range, active: 0, step: 5, content: 'report', method: 'speed', knotsPerMile }));
  for (const text of ['相対（転移）269.5°・30.1kn', '新しい相対（転移）', '新針路 097.5°', '新速力 3.6kn', '1 海里の目盛り ＝ 2 ノット', '速力三角形だけを抜き出した図']) {
    assert.ok(seen.includes(text), text);
  }
});

test('the speed scale keeps the fastest vector on the sheet', () => {
  const slow = buildModel(preset('three-plots'));
  assert.equal(chooseSpeedScale(slow, 12), 1);
  const fast = buildModel(preset('three-ships'));
  assert.equal(chooseSpeedScale(fast, 12), 4);
  assert.equal(chooseSpeedScale(fast, 48), 1);
});
