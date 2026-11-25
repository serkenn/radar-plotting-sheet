// Printable A4 landscape pages: the plotting sheet on the left and three boxes on the
// right (own ship and observations, results, enlarged speed triangle).

import { fmtAngle, fmtAspect, fmtBearing, fmtNum, fmtTurn, roman } from './format.js';
import { STEPS, fitView, fullView, renderScaleBar, renderSheet, trianglePoints } from './render.js';
import { formatTime } from './solve.js';

const SHEET = 720; // viewBox units; the sheet is printed 182 mm wide
const SHEET_HEIGHT = 742; // leaves a strip under the sheet for the distance scale
const DETAIL_WIDTH = 400; // viewBox units; the enlarged view is printed about 86 mm wide
const SIDE_WIDTH_MM = 86;
const PAGE_HEIGHT_MM = 189;
const TRIANGLE_STEP = STEPS.indexOf('triangle');
const AVOID_STEP = STEPS.indexOf('avoid');

/** Pages printed for each choice of content. */
export const PRINT_CONTENTS = {
  report: ['report'],
  problem: ['problem'],
  blank: ['blank'],
  both: ['problem', 'report'],
};

const fmtPlain = (value) => String(Math.round(value * 100) / 100);
const BLANK = '<span class="blank"></span>';
const signed = (value) => `${value >= 0 ? '+' : '−'}${fmtAngle(Math.abs(value))}`;

function sheetSvg(scene, range) {
  const view = fullView(SHEET, SHEET, range);
  const left = SHEET / 2 - view.ppm * range;
  return (
    `<svg class="sheet static" viewBox="0 0 ${SHEET} ${SHEET_HEIGHT}" role="img" aria-label="プロッティング用紙">` +
    renderSheet(view, scene) +
    renderScaleBar(view, range, left, SHEET - 4) +
    '</svg>'
  );
}

function avoidCondition(target) {
  const given = target.avoidGiven;
  if (given.time === null || !(given.distance > 0)) return '避航：条件が入力されていません';
  const start = `${formatTime(given.time)} に動作を始め、`;
  return given.mode === 'cpa'
    ? `避航：${start}CPA を ${fmtPlain(given.distance)} 海里にする`
    : `避航：${start}船首方向 ${fmtPlain(given.distance)} 海里を通過させる（変速）`;
}

function givenBox(kind, ctx) {
  const { model } = ctx;
  const blank = kind === 'blank';
  const multi = !blank && model.targets.length > 1;

  const own =
    !blank && model.own
      ? `真針路 <b>${fmtBearing(model.own.course)}</b>　速力 <b>${fmtPlain(model.own.speed)} ノット</b>`
      : `真針路 ${BLANK}°　速力 ${BLANK} ノット`;

  let body = '';
  if (blank) {
    for (let k = 0; k < 3; k += 1) body += `<tr class="write"><th scope="row">M${k + 1}</th><td></td><td></td><td></td></tr>`;
  } else {
    for (const target of model.targets) {
      const rows = target.rows.length ? target.rows : [null, null];
      rows.forEach((o, k) => {
        const group = multi && k === 0 ? `<th scope="rowgroup" rowspan="${rows.length}">${roman(target.index)}</th>` : '';
        const cells = o
          ? `<td>${formatTime(o.time)}</td><td>${fmtBearing(o.bearing)}</td><td>${fmtPlain(o.range)}</td>`
          : '<td></td><td></td><td></td>';
        body += `<tr>${group}<th scope="row">M${k + 1}</th>${cells}</tr>`;
      });
    }
  }

  const conditions = blank
    ? ''
    : model.targets
        .filter((target) => target.avoidOn)
        .map((target) => `<p class="condition">${multi ? `物標 ${roman(target.index)}　` : ''}${avoidCondition(target)}</p>`)
        .join('');

  return (
    '<section class="box box-given"><h3>自船と観測</h3>' +
    `<p class="own-line">自船　${own}</p>` +
    `<table class="form"><thead><tr>${multi ? '<th scope="col">物標</th>' : ''}<th scope="col">観測</th><th scope="col">時刻</th><th scope="col">真方位</th><th scope="col">距離（海里）</th></tr></thead>` +
    `<tbody>${body}</tbody></table>${conditions}</section>`
  );
}

function avoidResult(target, multi) {
  if (!target.avoidOn) return '—';
  const avoid = target.avoid;
  if (!avoid?.ok) return '作図できません';
  const speed = avoid.speed ? `${fmtNum(avoid.speed.speed, 1)} ノット` : 'なし';
  if (avoid.mode === 'bow') return `変速 ${speed}<small>変速後の DCPA ${fmtNum(avoid.newCpa.dcpa, 2)} 海里</small>`;
  const courses =
    avoid.courses.map((s) => (multi ? fmtBearing(s.course) : `${fmtBearing(s.course)}（${fmtTurn(s.turn)}）`)).join('／') || 'なし';
  return `変針 ${courses}<small>変速 ${speed}</small>`;
}

/** Course and speed on one line, or on two lines where columns are narrow. */
const pair = (course, speed, multi) =>
  multi ? `${fmtBearing(course)}<small>${fmtNum(speed)} ノット</small>` : `${fmtBearing(course)}・${fmtNum(speed)} ノット`;

function resultBox(kind, ctx) {
  const { model, step } = ctx;
  const blank = kind === 'blank';
  const report = kind === 'report';
  const targets = blank ? [null] : model.targets;
  const multi = targets.length > 1;
  const anyAvoid = blank || model.targets.some((target) => target.avoidOn);

  const rows = [
    ['相対針路・相対速力', 'relative', (s) => (s.rel.moving ? pair(s.rel.course, s.rel.speed, multi) : '相対運動なし')],
    [
      'DCPA<small>CPA の方位</small>',
      'cpa',
      (s) => {
        if (!s.cpa) return '—';
        if (s.cpa.bearing === null) return '0 海里<small>衝突コース</small>';
        return `${fmtNum(s.cpa.dcpa, 2)} 海里<small>${fmtBearing(s.cpa.bearing)}</small>`;
      },
    ],
    [
      'TCPA<small>最接近の時刻</small>',
      'cpa',
      (s) => {
        if (!s.cpa) return '—';
        if (s.cpa.tcpaMin < 0) return '通過済み';
        return `${formatTime(s.cpa.time)}<small>${multi ? '' : '最後の観測の '}${fmtNum(s.cpa.tcpaMin, 1)} 分後</small>`;
      },
    ],
    ['真針路・真速力', 'triangle', (s) => (s.true.course === null ? '停止（真速力 0）' : pair(s.true.course, s.true.speed, multi))],
    [
      'アスペクト',
      'aspect',
      (s) => {
        if (!s.aspect) return '—';
        const op = s.last.bearing < 180 ? '+' : '−';
        const formula = multi
          ? ''
          : `<small>${fmtBearing(s.true.course)} −（${fmtBearing(s.last.bearing)} ${op} 180°）＝ ${signed(s.aspect.diff)}</small>`;
        return `${fmtAspect(s.aspect)}${formula}`;
      },
    ],
  ];
  if (anyAvoid) rows.push(['避航<small>新針路・新速力</small>', 'avoid', (s, target) => avoidResult(target, multi)]);
  const scaleNote =
    report && ctx.method === 'speed' && step >= TRIANGLE_STEP
      ? `<p class="condition">速力ベクトルの縮尺：1 海里の目盛り ＝ ${fmtPlain(ctx.knotsPerMile)} ノット</p>`
      : '';

  const cell = (target, stepName, fill) => {
    const shown = report && target?.sol.ok && step >= STEPS.indexOf(stepName);
    return shown ? `<td>${fill(target.sol, target)}</td>` : '<td class="write"></td>';
  };
  const head = multi
    ? `<thead><tr><th></th>${targets.map((target) => `<th scope="col">物標 ${roman(target.index)}</th>`).join('')}</tr></thead>`
    : '';
  const body = rows
    .map(([label, stepName, fill]) => `<tr><th scope="row">${label}</th>${targets.map((target) => cell(target, stepName, fill)).join('')}</tr>`)
    .join('');

  return `<section class="box box-result"><h3>結果</h3><table class="form result">${head}<tbody>${body}</tbody></table>${scaleNote}</section>`;
}

/**
 * Height in viewBox units for the enlarged view. The third box takes whatever the two
 * boxes above leave, so their heights are estimated from the number of table rows; the
 * drawing then keeps the same text size however much room there is.
 */
function detailHeight(model, method) {
  const multi = model.targets.length > 1;
  const obsRows = model.targets.reduce((count, target) => count + Math.max(2, target.rows.length), 0);
  const conditions = model.targets.filter((target) => target.avoidOn).length;
  const given = 19.1 + obsRows * 4.9 + conditions * 5;
  const result = multi ? 54.4 + (conditions ? 9 : 0) : 43 + (conditions ? 10.6 : 0);
  const note = method === 'speed' ? 5 : 0;
  const room = PAGE_HEIGHT_MM - 12 - 3 * 2.4 - given - result - note - 9.4;
  return Math.round(Math.min(330, Math.max(170, (DETAIL_WIDTH * room) / SIDE_WIDTH_MM)));
}

function detailBox(kind, ctx, scene) {
  const front = ctx.model.targets[ctx.active];
  if (kind === 'report' && front?.sol.ok && ctx.step >= TRIANGLE_STEP) {
    const avoid = ctx.step >= AVOID_STEP ? front.avoid : null;
    const height = detailHeight(ctx.model, ctx.method);
    const points = trianglePoints(front.sol, avoid, ctx.method, ctx.knotsPerMile);
    const view = fitView(DETAIL_WIDTH, height, points, Math.min(64, height * 0.22));
    const which = ctx.model.targets.length > 1 ? `（物標 ${roman(front.index)}）` : '';
    return (
      `<section class="box box-detail"><h3>${ctx.method === 'speed' ? '速力三角形だけを抜き出した図' : '速力三角形の拡大図'}${which}</h3>` +
      `<svg class="sheet static" viewBox="0 0 ${DETAIL_WIDTH} ${height}" role="img" aria-label="速力三角形の拡大図">${renderSheet(view, { ...scene, detail: true })}</svg></section>`
    );
  }
  return '<section class="box box-detail"><h3>計算・メモ</h3></section>';
}

function page(kind, ctx) {
  const { model, range, active, step } = ctx;
  const scene =
    kind === 'report'
      ? {
          range,
          step,
          own: model.own,
          targets: model.targets.map((t) => ({ index: t.index, sol: t.sol, avoid: t.avoid, active: t.index === active })),
          loose: model.targets.filter((t) => !t.sol.ok).flatMap((t) => t.points),
          method: ctx.method,
          knotsPerMile: ctx.knotsPerMile,
          multi: model.targets.length > 1,
        }
      : { range, step: 0, own: null, targets: [], loose: [], blank: true };
  const tag = { report: 'レポート', problem: '問題用紙', blank: '' }[kind];

  return (
    `<section class="page page-${kind}">` +
    `<div class="page-sheet">${sheetSvg(scene, range)}</div>` +
    '<div class="page-side">' +
    `<header class="page-head"><h2>レーダー・プロッティング用紙</h2><p>${tag ? `<span class="page-kind">${tag}</span>` : ''}<span>レンジ ${fmtPlain(range)} 海里</span></p></header>` +
    givenBox(kind, ctx) +
    resultBox(kind, ctx) +
    detailBox(kind, ctx, scene) +
    '</div></section>'
  );
}

/**
 * @param {{model: object, range: number, active: number, step: number, content: keyof typeof PRINT_CONTENTS,
 *   method?: 'distance' | 'speed', knotsPerMile?: number}} ctx
 * @returns {string} markup of one or more A4 landscape pages
 */
export function buildPrintPages(ctx) {
  const kinds = PRINT_CONTENTS[ctx.content] ?? PRINT_CONTENTS.report;
  const full = { method: 'distance', knotsPerMile: 1, ...ctx };
  return kinds.map((kind) => page(kind, full)).join('');
}
