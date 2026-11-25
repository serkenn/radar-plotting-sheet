// Form state, results table, step control and zoom for the plotting sheet.

import { fmtAngle, fmtAspect, fmtBearing, fmtNum, fmtTurn, roman } from './format.js';
import { bearingOf, len } from './geometry.js';
import { buildModel, chooseRange, chooseSpeedScale } from './model.js';
import { PRESETS, emptyTarget } from './presets.js';
import { buildPrintPages } from './print.js';
import { STEPS, fitView, fullView, renderSheet, trianglePoints } from './render.js';
import { formatTime, toHalfWidth } from './solve.js';

const MAX_TARGETS = 3;
const MAX_OBS = 4;
const RANGE_CHOICES = ['auto', '3', '6', '12', '24', '48'];
const LAST_STEP = STEPS.length - 1;
const AVOID_STEP = STEPS.indexOf('avoid');
const MAX_ZOOM = 150;
const PAGE_WIDTH_PX = (297 / 25.4) * 96; // A4 landscape at CSS resolution
const METHOD_KEY = 'radar-plotting-sheet:method';

const STEP_INFO = [
  {
    title: 'プロット',
    text: '観測した真方位と距離の点を打ち、古い順に M1、M2…と時刻を書きます。方位は外周の目盛り、距離は同心円で取ります。',
  },
  {
    title: '相対運動線',
    text: 'M1 から最後の点へ線を引き、中心の先まで延長します。線の向きが相対針路、長さを経過時間で割ったものが相対速力です。',
  },
  {
    title: 'CPA',
    text: '中心（自船）から相対運動線へ垂線を下ろします。足が最接近点（CPA）、垂線の長さが DCPA、そこまでにかかる時間が TCPA です。',
  },
  { title: '速力三角形', text: '' },
  {
    title: 'アスペクト',
    text: '他船の位置に立って、他船の船首方向と「自船が見える方向」の間の角を測ります。自船が見える方向は、観測した方位の反対（±180°）です。左舷が見えれば R（紅）、右舷が見えれば G（緑）。',
  },
  { title: '避航', text: '' },
];

const TRIANGLE_TEXT = {
  distance:
    'M1 から自船の針路と反対向きに、観測の間に自船が進む距離を取って e とします。e→M1 が自船、e→最後の点が他船の真針路・真速力です（距離ベクトル方式）。',
  speed:
    '中心から自船の真針路の向きに、速力の長さの矢印を引きます。その先端へ相対運動線を平行に移し（転移）、相対速力の長さを取ります。中心からその先へ引いた矢印が、他船の真針路・真速力です（速力ベクトル方式）。',
};

const AVOID_TEXT = {
  distance: {
    cpa: '動作を始める位置から、希望する CPA の円へ接線を引きます（新しい相対運動線）。それと平行な線を最後の観測点から逆向きに引き、e を中心に自船の航走距離を半径とする円との交点が新しい針路、元の自船の辺との交点が新しい速力です。',
    bow: '動作を始める位置から、自船の船首線上の指定した距離の点へ線を引きます（新しい相対運動線）。それと平行な線を最後の観測点から逆向きに引き、元の自船の辺との交点までの長さが新しい速力です。',
  },
  speed: {
    cpa: '動作を始める位置から、希望する CPA の円へ接線を引きます（新しい相対運動線）。その線を他船の矢印の先端へ平行に移し（転移）、逆向きに延ばします。新しい自船の矢印の先端は、必ずこの線の上に来ます。針路だけ変えるなら、中心から自船の速力を半径とする円との交点（新針路）。速力だけ変えるなら、元の自船の針路線との交点（中心からの長さが新速力）。',
    bow: '動作を始める位置から、自船の船首線上の指定した距離の点へ線を引きます（新しい相対運動線）。その線を他船の矢印の先端へ平行に移し（転移）、逆向きに延ばします。元の自船の針路線との交点が新しい自船の矢印の先端で、中心からの長さが新速力です。',
  },
  off: '「避航の作図をする」にチェックを入れると、CPA を大きくする変針・変速の作図を描きます。',
};

const TARGET_ERRORS = {
  own: '自船の真針路（0〜360）と速力を入力してください。',
  few: '観測を 2 回以上入力すると作図します。',
  observation: '読み取れない観測があります。時刻は 1006 のような 4 桁、真方位は 0〜360、距離は 0 より大きい数で入力してください。',
  time: '観測の時刻は古い順に、12 時間以内の間隔で入力してください。',
};

const AVOID_ERRORS = {
  time: '動作を始める時刻を 1012 のような 4 桁で入力してください。',
  early: '動作を始める時刻は、最後の観測より後にしてください。',
  passed: 'その時刻には、すでに最接近を過ぎています。',
  inside: 'その時刻には、他船はすでに指定した距離より内側にいます。',
  distance: '距離を 0 より大きい数で入力してください。',
  static: '相対運動がない（自船と同じ針路・速力）ので、避航の作図はできません。',
};

const $ = (id) => document.getElementById(id);
const sheetSvg = $('sheet');
const sheetFrame = $('sheet-frame');
const detailSvg = $('detail');
const detailFrame = $('detail-frame');
const detailSection = detailFrame.closest('section');
const form = $('form');
const obsRows = $('obs-rows');
const targetTabs = $('target-tabs');
const stepTabs = $('step-tabs');
const stepText = $('step-text');
const resultsEl = $('results');
const resultsTarget = $('results-target');
const presetSelect = $('preset');
const avoidFields = $('avoid-fields');
const sideField = $('side-field');
const printView = $('print-view');
const printPages = $('print-pages');
const SHEET_TITLE = sheetSvg.innerHTML;

const state = {
  own: { course: '', speed: '' },
  targets: [emptyTarget()],
  active: 0,
  range: 'auto',
  step: LAST_STEP,
  method: 'distance',
};
const printOptions = { content: 'report', steps: 'all' };
const zoom = { factor: 1, cx: 0, cy: 0 };
let model = null;
let currentRange = 12;
let speedScale = 1;

// ---------------------------------------------------------------- state

const clone = (value) => JSON.parse(JSON.stringify(value));
const activeTarget = () => state.targets[state.active];

function loadPreset(preset) {
  state.own = clone(preset.own);
  state.targets = clone(preset.targets);
  state.active = 0;
  state.range = 'auto';
  state.step = LAST_STEP;
  resetZoom();
}

function clearAll() {
  state.own = { course: '', speed: '' };
  state.targets = [emptyTarget()];
  state.active = 0;
  state.range = 'auto';
  state.step = LAST_STEP;
  resetZoom();
}

/** Node and key addressed by a data-path. "t." means the active target. */
function resolve(path) {
  const keys = path.split('.');
  let node = state;
  if (keys[0] === 't') {
    node = activeTarget();
    keys.shift();
  }
  const last = keys.pop();
  for (const key of keys) node = node[key];
  return [node, last];
}

const cleanField = (text) => toHalfWidth(text).replace(/[^0-9.:-]/g, '').slice(0, 8);

function encodeState() {
  const params = new URLSearchParams();
  params.set('o', [state.own.course, state.own.speed].map(cleanField).join(','));
  params.set(
    't',
    state.targets
      .map((t) => t.obs.map((o) => [o.time, o.bearing, o.range].map(cleanField).join(',')).join(';'))
      .join('|'),
  );
  params.set(
    'a',
    state.targets
      .map((t) => [t.avoid.on ? 1 : 0, cleanField(t.avoid.time), t.avoid.mode, cleanField(t.avoid.dist), t.avoid.side].join(','))
      .join('|'),
  );
  if (state.range !== 'auto') params.set('r', state.range);
  if (state.active) params.set('k', String(state.active));
  if (state.step !== LAST_STEP) params.set('s', String(state.step));
  if (state.method === 'speed') params.set('v', '1');
  return params.toString();
}

function decodeState(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('o') || !params.has('t')) return false;
  const int = (text, low, high, fallback) => {
    const n = Number.parseInt(text ?? '', 10);
    return Number.isInteger(n) && n >= low && n <= high ? n : fallback;
  };
  const [course = '', speed = ''] = params.get('o').split(',').map(cleanField);
  const avoidParts = (params.get('a') ?? '').split('|');
  const targets = params
    .get('t')
    .split('|')
    .slice(0, MAX_TARGETS)
    .map((part, index) => {
      const obs = part
        .split(';')
        .slice(0, MAX_OBS)
        .map((row) => {
          const [time = '', bearing = '', range = ''] = row.split(',').map(cleanField);
          return { time, bearing, range };
        });
      while (obs.length < 2) obs.push({ time: '', bearing: '', range: '' });
      const a = (avoidParts[index] ?? '').split(',');
      return {
        obs,
        avoid: {
          on: a[0] === '1',
          time: cleanField(a[1] ?? ''),
          mode: a[2] === 'bow' ? 'bow' : 'cpa',
          dist: cleanField(a[3] ?? ''),
          side: a[4] === 'opposite' ? 'opposite' : 'auto',
        },
      };
    });
  if (!targets.length) return false;
  state.own = { course, speed };
  state.targets = targets;
  state.active = int(params.get('k'), 0, targets.length - 1, 0);
  state.range = RANGE_CHOICES.includes(params.get('r')) ? params.get('r') : 'auto';
  state.step = int(params.get('s'), 0, LAST_STEP, LAST_STEP);
  state.method = params.get('v') === '1' ? 'speed' : 'distance';
  resetZoom();
  return true;
}

let hashTimer = 0;
function scheduleHashUpdate() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    history.replaceState(null, '', `#${encodeState()}`);
  }, 200);
}

// ---------------------------------------------------------------- drawing

function frameSize(frame) {
  const box = frame.getBoundingClientRect();
  return { w: Math.max(120, Math.round(box.width)), h: Math.max(120, Math.round(box.height)) };
}

function mainView() {
  const { w, h } = frameSize(sheetFrame);
  const base = fullView(w, h, currentRange);
  return { ...base, cx: zoom.cx, cy: zoom.cy, ppm: base.ppm * zoom.factor };
}

function draw() {
  const scene = {
    range: currentRange,
    step: state.step,
    own: model.own,
    targets: model.targets.map((t) => ({ index: t.index, sol: t.sol, avoid: t.avoid, active: t.index === state.active })),
    loose: model.targets.filter((t) => !t.sol.ok).flatMap((t) => t.points),
    method: state.method,
    knotsPerMile: speedScale,
    multi: state.targets.length > 1,
  };

  const view = mainView();
  sheetSvg.setAttribute('viewBox', `0 0 ${view.w} ${view.h}`);
  sheetSvg.innerHTML = SHEET_TITLE + renderSheet(view, scene);
  sheetSvg.classList.toggle('zoomed', zoom.factor > 1.001);

  const front = model.targets[state.active];
  const showDetail = front.sol.ok && state.step >= STEPS.indexOf('triangle');
  detailSection.classList.toggle('empty', !showDetail);
  $('detail-title').textContent = state.method === 'speed' ? '速力三角形だけを抜き出した図' : '速力三角形の拡大図';
  if (showDetail) {
    const { w, h } = frameSize(detailFrame);
    const avoid = state.step >= AVOID_STEP ? front.avoid : null;
    const points = trianglePoints(front.sol, avoid, state.method, speedScale);
    const detailView = fitView(w, h, points, Math.max(62, Math.min(w, h) * 0.2));
    detailSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    detailSvg.innerHTML = renderSheet(detailView, { ...scene, detail: true });
  } else {
    detailSvg.innerHTML = '';
  }
}

let drawQueued = false;
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

// ---------------------------------------------------------------- results

const row = (label, value) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
const signed = (value) => `${value >= 0 ? '+' : '−'}${fmtAngle(Math.abs(value))}`;

function resultRows(target) {
  const { sol, avoid } = target;
  const rows = [];
  const gate = (step, label, value) => {
    const index = STEPS.indexOf(step);
    rows.push(row(label, state.step >= index ? value() : `<span class="locked">手順 ${index + 1} で表示</span>`));
  };

  gate('relative', '相対針路・相対速力', () =>
    sol.rel.moving
      ? `<b>${fmtBearing(sol.rel.course)}・${fmtNum(sol.rel.speed)} ノット</b><small>${fmtNum(sol.dtMin, 0)} 分で ${fmtNum(len(sol.disp), 2)} 海里</small>`
      : '相対運動なし（自船と同じ針路・速力）',
  );

  if (sol.cpa) {
    gate('cpa', 'DCPA（最接近距離）', () =>
      sol.cpa.bearing === null
        ? '<b>0 海里</b><small>相対運動線が中心を通る＝衝突コース</small>'
        : `<b>${fmtNum(sol.cpa.dcpa, 2)} 海里</b><small>CPA の方位 ${fmtBearing(sol.cpa.bearing)}</small>`,
    );
    gate('cpa', 'TCPA（最接近の時刻）', () =>
      sol.cpa.tcpaMin >= 0
        ? `<b>${formatTime(sol.cpa.time)}</b><small>最後の観測の ${fmtNum(sol.cpa.tcpaMin, 1)} 分後</small>`
        : `<b>通過済み</b><small>最後の観測の ${fmtNum(-sol.cpa.tcpaMin, 1)} 分前</small>`,
    );
    if (sol.bow && sol.cpa.bearing !== null && state.step >= STEPS.indexOf('cpa')) {
      const where = sol.bow.range >= 0 ? '船首方向' : '船尾方向';
      rows.push(
        row(
          '自船の船首尾線を横切る所',
          `${where} ${fmtNum(Math.abs(sol.bow.range), 1)} 海里<small>${formatTime(sol.bow.time)} ごろ</small>`,
        ),
      );
    }
  }

  gate('triangle', '真針路・真速力', () =>
    sol.true.course === null
      ? '止まっている物標（真速力 0）'
      : `<b>${fmtBearing(sol.true.course)}・${fmtNum(sol.true.speed)} ノット</b>`,
  );
  if (state.method === 'speed' && state.step >= STEPS.indexOf('triangle')) {
    rows.push(
      row(
        '速力ベクトルの縮尺',
        `1 海里の目盛り ＝ ${speedScale} ノット<small>自船 ${fmtNum(sol.own.speed)} ノットの矢印は ${fmtNum(sol.own.speed / speedScale, 2)} 海里の長さ</small>`,
      ),
    );
  }

  if (sol.aspect) {
    gate('aspect', 'アスペクト', () => {
      const a = sol.aspect;
      const colour = a.side === 'R' ? 'port' : a.side === 'G' ? 'stbd' : '';
      const op = sol.last.bearing < 180 ? '+' : '−';
      const reason =
        a.side === 'R'
          ? '＋なので左舷が見える（R）'
          : a.side === 'G'
            ? '−なので右舷が見える（G）'
            : a.side === 'bow'
              ? '正船首を向けて来る'
              : '正船尾を見せて遠ざかる';
      return (
        `<b class="${colour}">${fmtAspect(a)}</b>` +
        `<small>${fmtBearing(sol.true.course)} −（${fmtBearing(sol.last.bearing)} ${op} 180°）＝ ${signed(a.diff)}。${reason}</small>` +
        `<small>他船から見た自船の方位は ${fmtBearing(a.reciprocal)}</small>`
      );
    });
  }

  if (target.avoidOn) {
    if (state.step < AVOID_STEP) {
      rows.push(row('避航', `<span class="locked">手順 ${AVOID_STEP + 1} で表示</span>`));
    } else if (!avoid.ok) {
      rows.push(row('避航', `<span class="warn">${AVOID_ERRORS[avoid.error] ?? '作図できません。'}</span>`));
    } else {
      rows.push(
        row(
          '動作を始める位置',
          `方位 ${fmtBearing(bearingOf(avoid.m3))}・距離 ${fmtNum(len(avoid.m3), 1)} 海里<small>${formatTime(avoid.time)}</small>`,
        ),
      );
      rows.push(row('新しい相対針路', fmtBearing(avoid.relCourse)));
      if (avoid.mode === 'cpa') {
        rows.push(
          row(
            '変針（速力はそのまま）',
            avoid.courses.length
              ? avoid.courses.map((s) => `<b>${fmtBearing(s.course)}</b>（${fmtTurn(s.turn)}）`).join(' と ')
              : '<span class="warn">速力を変えずに変針だけでは作れません</span>',
          ),
        );
      }
      const change = { slower: '減速', faster: '増速', same: '今の速力のまま' };
      let speedText = '<span class="warn">針路を変えずに変速だけでは作れません</span>';
      if (avoid.speed) {
        speedText = `<b>${fmtNum(avoid.speed.speed, 1)} ノット</b>（${change[avoid.speed.change]}）`;
        if (avoid.speed.speed > 40) speedText += '<small class="warn">計算上の値です。現実の速力では作れません。</small>';
      }
      rows.push(row('変速（針路はそのまま）', speedText));
      if (avoid.mode === 'bow') {
        rows.push(row('変速後の DCPA', `<b>${fmtNum(avoid.newCpa.dcpa, 2)} 海里</b>`));
      } else if (avoid.alreadyClear) {
        rows.push(row('メモ', 'このまま進んでも、DCPA は指定した距離以上あります。'));
      }
    }
  }
  return rows;
}

function renderResults() {
  const target = model.targets[state.active];
  resultsTarget.textContent = state.targets.length > 1 ? `物標 ${roman(state.active)}` : '';
  if (!target.sol.ok) {
    resultsEl.innerHTML = `<p class="hint">${TARGET_ERRORS[target.sol.error] ?? '入力を確かめてください。'}</p>`;
    return;
  }
  resultsEl.innerHTML = `<table class="res"><tbody>${resultRows(target).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- form

function renderTargetTabs() {
  const tabs = state.targets.map(
    (_, i) =>
      `<button type="button" role="tab" data-target="${i}" aria-selected="${i === state.active}" class="${i === state.active ? 'on' : ''}">物標 ${roman(i)}</button>`,
  );
  if (state.targets.length < MAX_TARGETS) tabs.push('<button type="button" data-add-target class="quiet">＋ 追加</button>');
  targetTabs.innerHTML = tabs.join('');
  $('remove-target').hidden = state.targets.length < 2;
}

function renderObsRows() {
  const t = activeTarget();
  obsRows.innerHTML = t.obs
    .map((_, i) => {
      const name = `M${i + 1}`;
      const remove =
        t.obs.length > 2
          ? `<button type="button" class="icon" data-remove-obs="${i}" aria-label="${name} の行を削除">×</button>`
          : '';
      return (
        `<tr><th scope="row">${name}</th>` +
        `<td><input data-path="t.obs.${i}.time" inputmode="numeric" maxlength="5" placeholder="${i === 0 ? '1000' : '1006'}" aria-label="${name} の時刻"></td>` +
        `<td><input data-path="t.obs.${i}.bearing" inputmode="decimal" maxlength="7" placeholder="085" aria-label="${name} の真方位"></td>` +
        `<td><input data-path="t.obs.${i}.range" inputmode="decimal" maxlength="7" placeholder="12" aria-label="${name} の距離"></td>` +
        `<td>${remove}</td></tr>`
      );
    })
    .join('');
  $('add-obs').hidden = t.obs.length >= MAX_OBS;
}

/** Copy the state into every control that has a data-path. */
function syncControls() {
  for (const control of form.querySelectorAll('[data-path]')) {
    const [node, key] = resolve(control.dataset.path);
    if (control.type === 'checkbox') control.checked = Boolean(node[key]);
    else control.value = node[key];
  }
  syncDependentControls();
}

function syncDependentControls() {
  const avoid = activeTarget().avoid;
  avoidFields.classList.toggle('off', !avoid.on);
  for (const control of avoidFields.querySelectorAll('input, select')) control.disabled = !avoid.on;
  sideField.hidden = avoid.mode !== 'cpa';
}

function rebuildForm() {
  renderTargetTabs();
  renderObsRows();
  syncControls();
}

// ---------------------------------------------------------------- steps

const maxStep = () => (activeTarget().avoid.on ? LAST_STEP : AVOID_STEP - 1);

function renderSteps() {
  const limit = maxStep();
  if (state.step > limit) state.step = limit;
  stepTabs.innerHTML = STEP_INFO.map((info, i) => {
    const locked = i > limit;
    const cls = [i === state.step ? 'on' : '', i < state.step ? 'done' : ''].join(' ').trim();
    return `<li><button type="button" data-step="${i}" class="${cls}"${locked ? ' disabled' : ''}${i === state.step ? ' aria-current="step"' : ''}><span class="num">${i + 1}</span><span class="name">${info.title}</span></button></li>`;
  }).join('');
  const avoid = activeTarget().avoid;
  let text = STEP_INFO[state.step].text;
  if (state.step === STEPS.indexOf('triangle')) text = TRIANGLE_TEXT[state.method];
  if (state.step === AVOID_STEP) text = avoid.on ? AVOID_TEXT[state.method][avoid.mode] : AVOID_TEXT.off;
  stepText.textContent = `${state.step + 1}. ${STEP_INFO[state.step].title}：${text}`;
  $('step-prev').disabled = state.step <= 0;
  $('step-next').disabled = state.step >= limit;
}

// ---------------------------------------------------------------- update

function refresh() {
  model = buildModel(state);
  currentRange = chooseRange(model, state.range);
  speedScale = chooseSpeedScale(model, currentRange);
  renderSteps();
  renderResults();
  draw();
  scheduleHashUpdate();
}

// ---------------------------------------------------------------- zoom and pan

function resetZoom() {
  zoom.factor = 1;
  zoom.cx = 0;
  zoom.cy = 0;
}

function clampZoom() {
  zoom.factor = Math.min(MAX_ZOOM, Math.max(1, zoom.factor));
  if (zoom.factor <= 1.001) {
    resetZoom();
    return;
  }
  const d = Math.hypot(zoom.cx, zoom.cy);
  if (d > currentRange) {
    zoom.cx *= currentRange / d;
    zoom.cy *= currentRange / d;
  }
}

/** Zoom by a factor while keeping the world point under (px, py) in place. */
function zoomAt(px, py, multiplier) {
  const before = mainView();
  const wx = before.cx + (px - before.w / 2) / before.ppm;
  const wy = before.cy - (py - before.h / 2) / before.ppm;
  zoom.factor = Math.min(MAX_ZOOM, Math.max(1, zoom.factor * multiplier));
  const after = mainView();
  zoom.cx = wx - (px - after.w / 2) / after.ppm;
  zoom.cy = wy + (py - after.h / 2) / after.ppm;
  clampZoom();
  queueDraw();
}

function zoomToTriangle() {
  const front = model.targets[state.active];
  if (!front.sol.ok) return;
  const { w, h } = frameSize(sheetFrame);
  const avoid = state.step >= AVOID_STEP ? front.avoid : null;
  const fit = fitView(w, h, trianglePoints(front.sol, avoid, state.method, speedScale), 70);
  const base = fullView(w, h, currentRange);
  zoom.factor = fit.ppm / base.ppm;
  zoom.cx = fit.cx;
  zoom.cy = fit.cy;
  clampZoom();
  queueDraw();
}

function localPoint(event) {
  const box = sheetSvg.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

const pointers = new Map();
let gesture = null;

function beginGesture() {
  const points = [...pointers.values()];
  if (!points.length) {
    gesture = null;
    return;
  }
  const centre = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
  const spread = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  gesture = { centre, spread, view: mainView(), factor: zoom.factor };
}

function moveGesture() {
  if (!gesture) return;
  const points = [...pointers.values()];
  const centre = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
  const start = gesture.view;
  // World point that was under the gesture centre when it began.
  const wx = start.cx + (gesture.centre.x - start.w / 2) / start.ppm;
  const wy = start.cy - (gesture.centre.y - start.h / 2) / start.ppm;
  if (points.length > 1 && gesture.spread > 0) {
    const spread = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    zoom.factor = Math.min(MAX_ZOOM, Math.max(1, gesture.factor * (spread / gesture.spread)));
  }
  if (zoom.factor <= 1.001 && points.length === 1) return;
  const now = mainView();
  zoom.cx = wx - (centre.x - now.w / 2) / now.ppm;
  zoom.cy = wy + (centre.y - now.h / 2) / now.ppm;
  clampZoom();
  queueDraw();
}

function bindZoom() {
  sheetSvg.addEventListener(
    'wheel',
    (event) => {
      // Plain wheel scrolls the page; Ctrl/⌘ + wheel (also sent by a trackpad pinch) zooms the sheet.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const p = localPoint(event);
      zoomAt(p.x, p.y, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016)));
    },
    { passive: false },
  );
  sheetSvg.addEventListener('dblclick', (event) => {
    const p = localPoint(event);
    zoomAt(p.x, p.y, 2);
  });
  sheetSvg.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    sheetSvg.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, localPoint(event));
    beginGesture();
  });
  sheetSvg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, localPoint(event));
    moveGesture();
  });
  const end = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    beginGesture();
  };
  sheetSvg.addEventListener('pointerup', end);
  sheetSvg.addEventListener('pointercancel', end);

  document.querySelector('.zoom').addEventListener('click', (event) => {
    const action = event.target.closest('[data-zoom]')?.dataset.zoom;
    if (!action) return;
    const { w, h } = frameSize(sheetFrame);
    if (action === 'in') zoomAt(w / 2, h / 2, 1.6);
    else if (action === 'out') zoomAt(w / 2, h / 2, 1 / 1.6);
    else if (action === 'triangle') zoomToTriangle();
    else {
      resetZoom();
      queueDraw();
    }
  });
}

// ---------------------------------------------------------------- events

function bindForm() {
  const onEdit = (event) => {
    const control = event.target;
    const path = control.dataset?.path;
    if (!path) return;
    const [node, key] = resolve(path);
    node[key] = control.type === 'checkbox' ? control.checked : control.value;
    if (path === 'range' || path === 'method') resetZoom();
    if (path === 'method') {
      try {
        localStorage.setItem(METHOD_KEY, state.method);
      } catch {
        // storage can be unavailable (private window); the choice then lasts for this visit only
      }
    }
    presetSelect.value = '';
    syncDependentControls();
    refresh();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  form.addEventListener('submit', (event) => event.preventDefault());

  targetTabs.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-add-target')) {
      if (state.targets.length >= MAX_TARGETS) return;
      state.targets.push(emptyTarget());
      state.active = state.targets.length - 1;
      presetSelect.value = '';
    } else {
      state.active = Number(button.dataset.target);
    }
    resetZoom();
    rebuildForm();
    refresh();
  });

  $('remove-target').addEventListener('click', () => {
    if (state.targets.length < 2) return;
    state.targets.splice(state.active, 1);
    state.active = Math.min(state.active, state.targets.length - 1);
    presetSelect.value = '';
    resetZoom();
    rebuildForm();
    refresh();
  });

  $('add-obs').addEventListener('click', () => {
    const t = activeTarget();
    if (t.obs.length >= MAX_OBS) return;
    t.obs.push({ time: '', bearing: '', range: '' });
    presetSelect.value = '';
    rebuildForm();
    refresh();
    obsRows.querySelector(`[data-path="t.obs.${t.obs.length - 1}.time"]`)?.focus();
  });

  obsRows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-obs]');
    if (!button) return;
    const t = activeTarget();
    if (t.obs.length <= 2) return;
    t.obs.splice(Number(button.dataset.removeObs), 1);
    presetSelect.value = '';
    rebuildForm();
    refresh();
  });
}

function bindSteps() {
  const go = (step) => {
    state.step = Math.min(maxStep(), Math.max(0, step));
    refresh();
  };
  stepTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (button && !button.disabled) go(Number(button.dataset.step));
  });
  $('step-prev').addEventListener('click', () => go(state.step - 1));
  $('step-next').addEventListener('click', () => go(state.step + 1));
}

function bindTopBar() {
  presetSelect.innerHTML =
    '<option value="">例題を選ぶ…</option>' +
    PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('');
  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === presetSelect.value);
    if (!preset) return;
    loadPreset(preset);
    rebuildForm();
    refresh();
  });

  $('clear').addEventListener('click', () => {
    clearAll();
    presetSelect.value = '';
    rebuildForm();
    refresh();
    form.querySelector('[data-path="own.course"]').focus();
  });

  const copyButton = $('copy-link');
  copyButton.addEventListener('click', async () => {
    history.replaceState(null, '', `#${encodeState()}`);
    let message = 'コピーしました';
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      message = 'アドレス欄からコピーしてください';
    }
    const label = copyButton.textContent;
    copyButton.textContent = message;
    setTimeout(() => {
      copyButton.textContent = label;
    }, 1800);
  });

  $('print').addEventListener('click', enterPrintMode);
}

// ---------------------------------------------------------------- print mode

function renderPrintView() {
  printPages.innerHTML = buildPrintPages({
    model,
    range: currentRange,
    active: state.active,
    step: printOptions.steps === 'current' ? state.step : LAST_STEP,
    content: printOptions.content,
    method: state.method,
    knotsPerMile: speedScale,
  });
}

/** Shrink the page preview to the window width; printing always uses full size. */
function fitPrintPreview() {
  const scale = Math.min(1, (document.documentElement.clientWidth - 24) / PAGE_WIDTH_PX);
  printView.style.setProperty('--preview-zoom', scale.toFixed(4));
}

function enterPrintMode() {
  renderPrintView();
  fitPrintPreview();
  document.body.classList.add('print-mode');
  window.scrollTo(0, 0);
  $('print-go').focus();
}

function exitPrintMode() {
  document.body.classList.remove('print-mode');
  queueDraw();
  $('print').focus();
}

function bindPrint() {
  $('print-content').addEventListener('change', (event) => {
    printOptions.content = event.target.value;
    renderPrintView();
  });
  $('print-steps').addEventListener('change', (event) => {
    printOptions.steps = event.target.value;
    renderPrintView();
  });
  $('print-go').addEventListener('click', () => window.print());
  $('print-close').addEventListener('click', exitPrintMode);
  // Printing from the browser menu uses the same pages.
  window.addEventListener('beforeprint', renderPrintView);
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('print-mode')) fitPrintPreview();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('print-mode')) exitPrintMode();
  });
}

function start() {
  bindTopBar();
  bindForm();
  bindSteps();
  bindZoom();
  bindPrint();

  if (!decodeState(location.hash)) {
    loadPreset(PRESETS[0]);
    presetSelect.value = PRESETS[0].id;
    try {
      if (localStorage.getItem(METHOD_KEY) === 'speed') state.method = 'speed';
    } catch {
      // no stored choice
    }
  }
  rebuildForm();
  refresh();

  new ResizeObserver(queueDraw).observe(sheetFrame);
  new ResizeObserver(queueDraw).observe(detailFrame);
  window.addEventListener('hashchange', () => {
    if (decodeState(location.hash)) {
      presetSelect.value = '';
      rebuildForm();
      refresh();
    }
  });
}

start();
