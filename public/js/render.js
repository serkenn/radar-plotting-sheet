// Draws the plotting sheet and the construction as SVG markup.
// Everything is projected to screen pixels here, so line widths and label sizes
// stay constant at any zoom level.

import { DEG, ORIGIN, add, bearingOf, dot, len, lineCircle, norm180, scale, sub, vec } from './geometry.js';
import { fmtAspect, fmtBearing, fmtNum, roman } from './format.js';
import { formatTime } from './solve.js';

/** Construction steps, in drawing order. */
export const STEPS = ['plot', 'relative', 'cpa', 'triangle', 'aspect', 'avoid'];

const r1 = (n) => Math.round(n * 10) / 10;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
const mid = (a, b) => scale(add(a, b), 0.5);

/** View that shows the whole sheet. */
export function fullView(width, height, range) {
  const pad = Math.min(width, height) < 430 ? 30 : 38;
  return { w: width, h: height, cx: 0, cy: 0, ppm: Math.max(0.5, (Math.min(width, height) / 2 - pad) / range) };
}

/**
 * View that fits the given points with some room for labels.
 * @param {number | {x: number, y: number}} pad room in pixels; labels are wide, so the sides may get more
 */
export function fitView(width, height, points, pad = 58) {
  const padX = typeof pad === 'number' ? pad : pad.x;
  const padY = typeof pad === 'number' ? pad : pad.y;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(maxX - minX, 1e-3);
  const spanY = Math.max(maxY - minY, 1e-3);
  const ppm = Math.min((width - 2 * padX) / spanX, (height - 2 * padY) / spanY);
  return { w: width, h: height, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, ppm: Math.max(0.5, Math.min(ppm, 4000)) };
}

/**
 * Points occupied by the speed triangle and, when present, the avoidance construction on it.
 * @param {'distance' | 'speed'} method where the triangle is drawn (at the first plot, or at the centre)
 * @param {number} knotsPerMile scale of the speed vectors (speed method only)
 */
export function trianglePoints(sol, avoid, method = 'distance', knotsPerMile = 1) {
  if (method === 'speed') {
    const radius = sol.own.speed / knotsPerMile;
    const points = [ORIGIN, scale(sol.own.vel, 1 / knotsPerMile), scale(sol.true.vel, 1 / knotsPerMile)];
    if (avoid?.ok) {
      for (const s of avoid.courses) points.push(vec(s.course, radius));
      // a far-fetched speed would shrink everything else, so it is capped for the view
      if (avoid.speed) points.push(vec(sol.own.course, Math.min(avoid.speed.speed, sol.own.speed * 2.5) / knotsPerMile));
    }
    return points;
  }
  const points = [sol.e, sol.first.p, sol.last.p];
  if (avoid?.ok) {
    const { centre, radius } = avoid.circle;
    points.push({ x: centre.x - radius, y: centre.y - radius }, { x: centre.x + radius, y: centre.y + radius });
    for (const s of avoid.courses) points.push(s.point);
    if (avoid.speed) points.push(avoid.speed.point);
  }
  return points;
}

// Where else to try a label when its first place is taken: [turn in degrees, extra gap in pixels].
const LABEL_TRIES = [
  [30, 0],
  [-30, 0],
  [60, 2],
  [-60, 2],
  [0, 12],
  [95, 4],
  [-95, 4],
  [30, 12],
  [-30, 12],
  [180, 0],
  [0, 26],
  [180, 14],
  [60, 22],
  [-60, 22],
  [0, 40],
  [180, 30],
];

class Pen {
  constructor(view) {
    this.view = view;
    this.parts = [];
    this.boxes = []; // rectangles already taken by labels
  }

  xy(p) {
    const v = this.view;
    return [v.w / 2 + (p.x - v.cx) * v.ppm, v.h / 2 - (p.y - v.cy) * v.ppm];
  }

  /** Miles to pixels. */
  px(miles) {
    return miles * this.view.ppm;
  }

  /** World point moved by a distance in pixels along a bearing. */
  shift(p, bearing, pixels) {
    return add(p, vec(bearing, pixels / this.view.ppm));
  }

  raw(markup) {
    this.parts.push(markup);
  }

  line(a, b, cls) {
    const [x1, y1] = this.xy(a);
    const [x2, y2] = this.xy(b);
    this.raw(`<line class="ln ${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
  }

  arrow(a, b, cls, head = 10) {
    const [x1, y1] = this.xy(a);
    const [x2, y2] = this.xy(b);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      this.line(a, b, cls);
      return;
    }
    const h = Math.min(head, d * 0.55);
    const ux = dx / d;
    const uy = dy / d;
    const bx = x2 - ux * h;
    const by = y2 - uy * h;
    const wx = -uy * h * 0.36;
    const wy = ux * h * 0.36;
    this.raw(`<line class="ln ${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(bx)}" y2="${r1(by)}"/>`);
    this.raw(
      `<polygon class="hd ${cls}" points="${r1(x2)},${r1(y2)} ${r1(bx + wx)},${r1(by + wy)} ${r1(bx - wx)},${r1(by - wy)}"/>`,
    );
  }

  circle(centre, radiusMiles, cls) {
    const [x, y] = this.xy(centre);
    this.raw(`<circle class="ln ${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(this.px(radiusMiles))}"/>`);
  }

  dot(p, cls, radius = 3.4) {
    const [x, y] = this.xy(p);
    this.raw(`<circle class="dt ${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${radius}"/>`);
  }

  /** Hollow marker. */
  ring(p, cls, radius = 4.4) {
    const [x, y] = this.xy(p);
    this.raw(`<circle class="ln hollow ${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${radius}"/>`);
  }

  /**
   * Label placed `gap` pixels from p in the direction of `bearing`. It is kept inside the
   * picture, and moved round its point when the place is already taken by another label.
   * An optional label is left out when no free place is found.
   */
  text(p, label, cls, bearing = 0, gap = 9, optional = false) {
    const { w, h } = this.view;
    const [x0, y0] = this.xy(p);
    const size = cls.includes('big') ? 14 : cls.includes('small') ? 10.5 : 12;
    const width = textWidth(label, size);
    const onScreen = x0 >= 0 && x0 <= w && y0 >= 0 && y0 <= h;
    const edge = 4;

    const layout = (turn, extra) => {
      const direction = (bearing + turn) * DEG;
      const dx = Math.sin(direction) * (gap + extra);
      const dy = -Math.cos(direction) * (gap + extra);
      const anchor = Math.abs(dx) <= Math.abs(dy) * 0.6 ? 'middle' : dx > 0 ? 'start' : 'end';
      const baseline = Math.abs(dy) <= Math.abs(dx) * 0.6 ? 'central' : dy > 0 ? 'hanging' : 'auto';
      const above = baseline === 'auto' ? size : baseline === 'central' ? size / 2 : 0;
      let x = x0 + dx;
      let y = y0 + dy;
      let left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
      if (onScreen) {
        // nudged back in rather than cut off at the edge
        const shift = left < edge ? edge - left : left + width > w - edge ? w - edge - (left + width) : 0;
        x += shift;
        left += shift;
        y = Math.max(edge + above, Math.min(h - edge - (size - above), y));
      }
      return { x, y, anchor, baseline, box: [left - 2, y - above - 1, left + width + 2, y - above + size + 1] };
    };
    const taken = (box) => this.boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);

    let place = layout(0, 0);
    if (onScreen && taken(place.box)) {
      const free = LABEL_TRIES.map(([turn, extra]) => layout(turn, extra)).find((other) => !taken(other.box));
      if (free) place = free;
      else if (optional) return;
    }
    this.boxes.push(place.box);
    this.raw(
      `<text class="lbl ${cls}" x="${r1(place.x)}" y="${r1(place.y)}" text-anchor="${place.anchor}" dominant-baseline="${place.baseline}">${esc(label)}</text>`,
    );
  }

  /** Circular arc around p from one bearing to another, the short way round. */
  arc(p, radius, fromBearing, toBearing, cls) {
    const [x0, y0] = this.xy(p);
    const point = (b) => [x0 + Math.sin(b * DEG) * radius, y0 - Math.cos(b * DEG) * radius];
    const [x1, y1] = point(fromBearing);
    const [x2, y2] = point(toBearing);
    const sweep = norm180(toBearing - fromBearing) > 0 ? 1 : 0;
    this.raw(`<path class="ln ${cls}" d="M${r1(x1)} ${r1(y1)}A${radius} ${radius} 0 0 ${sweep} ${r1(x2)} ${r1(y2)}"/>`);
  }

  /**
   * Small arrow-shaped marks on the line from a to b. Lines that carry the same number
   * of marks are parallel: this is how a line and its transferred copy are tied together.
   */
  chevrons(a, b, count, cls, where = 0.5) {
    const [x1, y1] = this.xy(a);
    const [x2, y2] = this.xy(b);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d < 34) return;
    const ux = dx / d;
    const uy = dy / d;
    for (let i = 0; i < count; i += 1) {
      const along = d * where + (i - (count - 1) / 2) * 6.5;
      const tipX = x1 + ux * (along + 3.5);
      const tipY = y1 + uy * (along + 3.5);
      const baseX = x1 + ux * (along - 3.5);
      const baseY = y1 + uy * (along - 3.5);
      this.raw(
        `<path class="ln thin ${cls}" d="M${r1(baseX - uy * 5)} ${r1(baseY + ux * 5)}L${r1(tipX)} ${r1(tipY)}L${r1(baseX + uy * 5)} ${r1(baseY - ux * 5)}"/>`,
      );
    }
  }

  toString() {
    return this.parts.join('');
  }
}

const fmtRange = (value) => String(Math.round(value * 100) / 100);

/** Rough width of a label in pixels: full-width characters take a whole em, others about 0.6 em. */
function textWidth(label, size) {
  let ems = 0;
  for (const ch of label) ems += ch.codePointAt(0) > 0x2e7f ? 1 : 0.6;
  return ems * size;
}

function drawSheet(pen, range, detail, knots = null) {
  const [cx, cy] = pen.xy(ORIGIN);
  const radius = pen.px(range);
  const minor = range / 12;
  pen.raw(`<circle class="paper" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(radius)}"/>`);

  for (let b = 0; b < 360; b += 10) {
    const kind = b % 90 === 0 ? ' axis' : b % 30 === 0 ? ' strong' : '';
    const from = vec(b, b % 30 === 0 ? minor : minor * 2);
    const [x1, y1] = pen.xy(from);
    const [x2, y2] = pen.xy(vec(b, range));
    pen.raw(`<line class="radial${kind}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
  }
  for (let i = 1; i <= 12; i += 1) {
    const kind = i === 12 ? 'outer' : i % 2 === 0 ? 'major' : 'minor';
    pen.raw(`<circle class="ring ${kind}" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(pen.px(i * minor))}"/>`);
  }

  if (!detail) {
    const everyDegree = radius * DEG >= 2.2;
    const small = radius < 190;
    for (let b = 0; b < 360; b += 1) {
      const ten = b % 10 === 0;
      const five = b % 5 === 0;
      if (!everyDegree && !five) continue;
      const size = ten ? 9 : five ? 6 : 3.5;
      const sx = Math.sin(b * DEG);
      const sy = -Math.cos(b * DEG);
      pen.raw(
        `<line class="tick" x1="${r1(cx + sx * radius)}" y1="${r1(cy + sy * radius)}" x2="${r1(cx + sx * (radius + size))}" y2="${r1(cy + sy * (radius + size))}"/>`,
      );
      if (ten && (!small || b % 30 === 0)) {
        const at = radius + (small ? 17 : 20);
        pen.raw(
          `<text class="tick-label" x="${r1(cx + sx * at)}" y="${r1(cy + sy * at)}">${String(b).padStart(3, '0')}</text>`,
        );
      }
    }
  }

  // Distance figures on the solid rings, just right of the southern axis. Speed vectors
  // normally share them (one mile = one knot). Only when the vectors are on a scale of
  // their own are the rings also figured in knots, on the northern axis, and the two
  // sets are told apart by their units. Where the triangle is shown alone, the rings
  // are figured in knots only.
  const ownScale = Boolean(knots) && knots !== 1;
  for (let i = 2; i <= 12; i += 2) {
    if (!(detail && knots)) {
      const [x, y] = pen.xy(vec(180, i * minor));
      const unit = ownScale && i === 12 ? '海里' : '';
      pen.raw(`<text class="range-label" x="${r1(x + 3)}" y="${r1(y - 3)}">${fmtRange(i * minor)}${unit}</text>`);
    }
    if (knots && (ownScale || detail)) {
      const [x, y] = pen.xy(vec(0, i * minor));
      const label = `${fmtRange(i * minor * knots)}kn`;
      pen.raw(`<text class="range-label knots" x="${r1(x - 3)}" y="${r1(y + 11)}" text-anchor="end">${label}</text>`);
      // other labels keep clear of the scale figures
      pen.boxes.push([x - 5 - textWidth(label, 9.5), y + 1, x - 1, y + 14]);
    }
  }
  pen.raw(
    `<path class="centre-mark" d="M${r1(cx - 6)} ${r1(cy)}H${r1(cx + 6)}M${r1(cx)} ${r1(cy - 6)}V${r1(cy + 6)}"/>`,
  );
}

/**
 * Linear distance scale with the same miles-to-pixels ratio as the sheet, for use with dividers.
 * Drawn from `left` to the right; `baseline` is the y of the scale line.
 */
export function renderScaleBar(view, range, left, baseline, unit = '海里') {
  const x = (miles) => r1(left + miles * view.ppm);
  const parts = [`<line class="tick" x1="${x(0)}" y1="${baseline}" x2="${x(range)}" y2="${baseline}"/>`];
  for (let i = 0; i <= 60; i += 1) {
    const miles = (range / 60) * i;
    const size = i % 10 === 0 ? 8 : i % 5 === 0 ? 5.5 : 3;
    parts.push(`<line class="tick" x1="${x(miles)}" y1="${baseline}" x2="${x(miles)}" y2="${r1(baseline + size)}"/>`);
    if (i % 10 === 0) parts.push(`<text class="tick-label" x="${x(miles)}" y="${baseline + 17}">${fmtRange(miles)}</text>`);
  }
  parts.push(`<text class="range-label" x="${r1(x(range) + 14)}" y="${baseline + 20}">${esc(unit)}</text>`);
  return parts.join('');
}

function drawOwnShip(pen, own, range) {
  pen.line(ORIGIN, vec(own.course, range), 'own thin dash');
  const [x, y] = pen.xy(ORIGIN);
  pen.raw(
    `<g class="own-ship" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(own.course)})"><polygon points="0,-10 4.5,-3 4.5,8 -4.5,8 -4.5,-3"/></g>`,
  );
  pen.text(vec(own.course, range * 0.9), `自船 ${fmtBearing(own.course)}`, 'own small', own.course + 90, 7);
}

/** Distance-vector method: the triangle e–M1–M(last), drawn where the target was plotted. */
function drawDistanceTriangle(pen, target, scene, avoidShown) {
  const { sol, avoid, active } = target;
  const centroid = scale(add(add(sol.e, sol.first.p), sol.last.p), 1 / 3);
  const outward = (p) => {
    const d = sub(p, centroid);
    return len(d) < 1e-9 ? 0 : bearingOf(d);
  };
  // Vector labels need room; on the full sheet they are left to the enlarged view.
  const roomy = active && pen.px(Math.max(len(sol.own.disp), len(sol.true.disp), len(sol.disp))) >= 150;

  pen.arrow(sol.e, sol.first.p, 'own');
  if (sol.true.course !== null) pen.arrow(sol.e, sol.last.p, 'tgt');
  pen.dot(sol.e, 'ink', 2.6);
  if (active) pen.text(sol.e, 'e', 'ink', outward(sol.e), 9);
  if (roomy) {
    const ownMid = mid(sol.e, sol.first.p);
    pen.text(ownMid, `自船 ${fmtBearing(sol.own.course)}・${fmtNum(sol.own.speed)}kn`, 'own', outward(ownMid), 9);
    if (sol.true.course !== null) {
      const tgtAt = add(sol.e, scale(sub(sol.last.p, sol.e), 0.3));
      pen.text(tgtAt, `他船 ${fmtBearing(sol.true.course)}・${fmtNum(sol.true.speed)}kn`, 'tgt', outward(tgtAt), 9);
    }
  }
  if (!avoidShown) return;

  // The line through the last plot, parallel to the new relative motion, drawn
  // backwards; it meets the own-ship circle (new courses) and the own-ship side (new speed).
  const back = scale(avoid.dir, -1);
  const marks = [...avoid.courses.map((s) => s.point), ...(avoid.speed ? [avoid.speed.point] : [])];
  const reaches = marks.map((p) => dot(sub(p, avoid.through), back));
  const reach = Math.max(len(sub(sol.e, avoid.through)), ...reaches) + avoid.circle.radius * 0.45;
  pen.line(avoid.through, add(avoid.through, scale(back, reach)), 'avoid thin dash');
  if (avoid.mode === 'cpa') pen.circle(avoid.circle.centre, avoid.circle.radius, 'own thin dots');

  avoid.courses.forEach((s) => {
    pen.arrow(sol.e, s.point, 'own dash', 8);
    pen.dot(s.point, 'avoid', 3.2);
    if (roomy) pen.text(s.point, `新針路 ${fmtBearing(s.course)}`, 'avoid', outward(s.point), 10);
  });
  if (avoid.speed) {
    pen.ring(avoid.speed.point, 'avoid', 3.6);
    if (roomy) {
      const lastIsLeft = dot(vec(sol.own.course - 90, 1), sub(sol.last.p, sol.e)) > 0;
      pen.text(avoid.speed.point, `新速力 ${fmtNum(avoid.speed.speed)}kn`, 'avoid', sol.own.course + (lastIsLeft ? 90 : -90), 10);
    }
  }
}

/**
 * Speed-vector method: own ship and target vectors start at the centre, and the relative
 * motion is transferred (moved parallel to itself) so that it joins their tips.
 */
function drawSpeedTriangle(pen, target, scene, avoidShown) {
  const { sol, avoid, active } = target;
  const k = scene.knotsPerMile;
  const own = scale(sol.own.vel, 1 / k);
  const tgt = scale(sol.true.vel, 1 / k);
  const centroid = scale(add(own, tgt), 1 / 3);
  const outward = (p) => {
    const d = sub(p, centroid);
    return len(d) < 1e-9 ? 0 : bearingOf(d);
  };
  const size = pen.px(Math.max(len(own), len(tgt), len(sub(tgt, own))));
  const roomy = active && (scene.detail ? size >= 120 : size >= 170 && pen.px(scene.range) >= 240);

  if (active && sol.own.speed > 0) pen.arrow(ORIGIN, own, 'own bold');
  if (sol.true.course !== null) pen.arrow(ORIGIN, tgt, 'tgt bold');
  if (sol.rel.moving) {
    pen.arrow(own, tgt, 'rel');
    // one mark on the plotted line and one on its transferred copy
    pen.chevrons(own, tgt, 1, 'rel');
    if (!scene.detail) pen.chevrons(sol.first.p, sol.last.p, 1, 'rel');
  }
  if (roomy) {
    if (sol.own.speed > 0) {
      const ownAt = scale(own, 0.74);
      pen.text(ownAt, `自船 ${fmtBearing(sol.own.course)}・${fmtNum(sol.own.speed)}kn`, 'own', outward(ownAt), 10);
    }
    if (sol.true.course !== null) {
      const tgtAt = scale(tgt, 0.6);
      pen.text(tgtAt, `他船 ${fmtBearing(sol.true.course)}・${fmtNum(sol.true.speed)}kn`, 'tgt', outward(tgtAt), 10);
    }
    if (sol.rel.moving) {
      const relMid = mid(own, tgt);
      pen.text(relMid, `相対（転移）${fmtBearing(sol.rel.course)}・${fmtNum(sol.rel.speed)}kn`, 'rel', outward(relMid), 13);
    }
  }
  if (!avoidShown) return;

  // The new relative motion, transferred to the tip of the target vector and drawn
  // backwards: the new own-ship vector must end on this line.
  const radius = sol.own.speed / k;
  const back = scale(avoid.dir, -1);
  const tips = avoid.courses.map((s) => ({ course: s.course, p: vec(s.course, radius) }));
  const speedTip = avoid.speed ? vec(sol.own.course, avoid.speed.speed / k) : null;
  const marks = [...tips.map((tip) => tip.p), ...(speedTip ? [speedTip] : [])];
  const furthest = Math.max(len(sub(own, tgt)), ...marks.map((p) => dot(sub(p, tgt), back)));
  const reach = Math.min(scene.range * 2.5, furthest + scene.range * 0.15);
  const far = add(tgt, scale(back, reach));
  pen.line(tgt, far, 'avoid thin dash');
  pen.chevrons(tgt, far, 2, 'avoid', 0.42);

  // course only: the tip stays on the circle of own speed
  if (avoid.mode === 'cpa') pen.circle(ORIGIN, radius, 'own thin dots');
  for (const tip of tips) {
    pen.arrow(ORIGIN, tip.p, 'own dash', 8);
    pen.dot(tip.p, 'avoid', 3.4);
    if (roomy) pen.text(tip.p, `新針路 ${fmtBearing(tip.course)}`, 'avoid', bearingOf(tip.p), 10);
  }
  // speed only: the tip stays on the own course line
  if (speedTip) {
    if (avoid.speed.speed > sol.own.speed) pen.line(own, speedTip, 'own thin dash');
    pen.ring(speedTip, 'avoid', 4);
    if (roomy) {
      const targetOnLeft = dot(vec(sol.own.course - 90, 1), tgt) > 0;
      pen.text(speedTip, `新速力 ${fmtNum(avoid.speed.speed)}kn`, 'avoid', sol.own.course + (targetOnLeft ? 90 : -90), 10);
    }
  }
  if (roomy) {
    const at = add(tgt, scale(back, reach * 0.3));
    const side = bearingOf(back) + (dot(vec(bearingOf(back) - 90, 1), at) >= 0 ? -90 : 90);
    pen.text(at, '新しい相対（転移）', 'avoid small', side, 12, true);
  }
}

function drawTarget(pen, target, scene) {
  const { sol, avoid, active } = target;
  const at = (name) => scene.step >= STEPS.indexOf(name);
  const speedMethod = scene.method === 'speed';
  // The enlarged view of the speed-vector triangle shows that triangle alone.
  const triangleOnly = Boolean(scene.detail) && speedMethod;
  const moving = sol.rel.moving;
  const relBearing = moving ? bearingOf(sol.disp) : 0;

  // Labels of the plotted points go on the side of the relative motion line away from
  // the triangle: away from e, or away from the centre in the speed-vector method.
  const leftOfLine = vec(relBearing - 90, 1);
  const awayFrom = speedMethod ? ORIGIN : sol.e;
  const plotSide = dot(leftOfLine, sub(mid(sol.first.p, sol.last.p), awayFrom)) >= 0 ? relBearing - 90 : relBearing + 90;
  // With the plots close together on screen, labels are cut down to the essentials.
  const spacing = pen.px(len(sol.disp)) / (sol.obs.length - 1);
  const compact = spacing < 50;
  const avoidShown = at('avoid') && active && Boolean(avoid?.ok);

  if (!triangleOnly) {
    // 1. Plot
    sol.obs.forEach((o, i) => {
      pen.dot(o.p, 'ink');
      // Neighbouring labels alternate between two rows so that they do not run into each other.
      const gap = spacing < 96 && i % 2 === 1 ? 23 : 9;
      if (active) pen.text(o.p, compact ? `M${i + 1}` : `M${i + 1} ${formatTime(o.time)}`, 'ink', plotSide, gap);
    });
    if (scene.multi && !active) pen.text(sol.first.p, roman(target.index), 'ink tag', relBearing + 180, 13);

    // 2. Relative motion line
    if (at('relative') && moving) {
      pen.arrow(sol.first.p, sol.last.p, 'rel bold');
      const ahead = lineCircle(sol.last.p, sol.disp, ORIGIN, scene.range).filter((hit) => hit.s > 0);
      if (ahead.length) pen.line(sol.last.p, ahead[ahead.length - 1].point, 'rel dash');
      if (sol.cpa.tcpaMin < -sol.dtMin) pen.line(sol.first.p, sol.cpa.point, 'rel dash');
      if (active && pen.px(len(sol.disp)) >= 150) {
        pen.text(mid(sol.first.p, sol.last.p), `相対 ${fmtBearing(sol.rel.course)}・${fmtNum(sol.rel.speed)}kn`, 'rel', plotSide, 25);
      }
    }

    // 3. CPA
    if (at('cpa') && sol.cpa) {
      const c = sol.cpa;
      const out = c.bearing ?? relBearing + 90;
      if (pen.px(c.dcpa) > 2) {
        pen.line(ORIGIN, c.point, 'cpa');
        // right-angle mark between the perpendicular and the relative motion line
        const a = pen.shift(c.point, out + 180, 7);
        const b = pen.shift(c.point, relBearing + 180, 7);
        const corner = pen.shift(a, relBearing + 180, 7);
        pen.line(a, corner, 'cpa thin');
        pen.line(corner, b, 'cpa thin');
      }
      pen.dot(c.point, 'cpa', 3.6);
      if (active) {
        const when = c.tcpaMin >= 0 ? formatTime(c.time) : '通過済み';
        pen.text(c.point, compact || avoidShown ? 'CPA' : `CPA ${fmtNum(c.dcpa, 2)}海里・${when}`, 'cpa', out, 10);
      }
    }
  }

  // 5. Aspect: the angle at the target between her heading and the line back to own ship.
  // (Drawn before the triangle so that the triangle stays on top near the centre.)
  if (at('aspect') && sol.aspect && !scene.detail) {
    const m = sol.last.p;
    const a = sol.aspect;
    const course = sol.true.course;
    pen.line(m, ORIGIN, 'ink thin dots');
    pen.arrow(m, pen.shift(m, course, 50), 'tgt thin', 8);
    const sided = a.side === 'R' || a.side === 'G';
    const colour = a.side === 'G' ? 'stbd' : 'port';
    if (sided) pen.arc(m, 27, course, a.reciprocal, `${colour} bold`);
    const [x, y] = pen.xy(m);
    pen.raw(
      `<g class="ship" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(course)})"><polygon class="port-side" points="0,-11 -4.5,-4 -4.5,10 0,10"/><polygon class="stbd-side" points="0,-11 4.5,-4 4.5,10 0,10"/><polygon class="hull" points="0,-11 4.5,-4 4.5,10 -4.5,10 -4.5,-4"/></g>`,
    );
    if (active) {
      const middle = sided ? course - a.diff / 2 : course;
      pen.text(pen.shift(m, middle, 32), fmtAspect(a), `${sided ? colour : 'ink'} big`, middle, 6);
      // Explain the ±180°: the same line has two bearings, one from each ship.
      if (scene.step === STEPS.indexOf('aspect') && pen.px(sol.last.range) > 170) {
        const side = norm180(course - a.reciprocal) > 0 ? a.reciprocal - 90 : a.reciprocal + 90;
        pen.text(pen.shift(ORIGIN, sol.last.bearing, 58), `自船から見た他船 ${fmtBearing(sol.last.bearing)}`, 'ink small', side, 9);
        pen.text(pen.shift(m, a.reciprocal, 78), `他船から見た自船 ${fmtBearing(a.reciprocal)}`, 'ink small', side, 9);
      }
    }
  }

  // 6. Manoeuvre that opens the CPA: the new relative motion line on the sheet
  if (avoidShown && !triangleOnly) {
    const ahead = lineCircle(avoid.m3, avoid.dir, ORIGIN, scene.range).filter((hit) => hit.s > 0);
    const exit = ahead.length ? ahead[ahead.length - 1].point : null;
    const aim = avoid.mode === 'cpa' ? avoid.tangentPoint : avoid.pass;

    if (avoid.mode === 'cpa') {
      pen.circle(ORIGIN, avoid.distance, 'avoid thin dash');
      pen.line(ORIGIN, avoid.tangentPoint, 'avoid thin');
      pen.arrow(avoid.m3, avoid.tangentPoint, 'avoid bold');
      if (exit) pen.line(avoid.tangentPoint, exit, 'avoid dash');
      pen.dot(avoid.tangentPoint, 'avoid', 3);
      pen.text(avoid.tangentPoint, compact ? `${fmtRange(avoid.distance)}海里` : `CPA ${fmtRange(avoid.distance)}海里`, 'avoid', bearingOf(avoid.tangentPoint), 10);
    } else {
      pen.line(ORIGIN, avoid.newCpa.point, 'avoid thin');
      pen.arrow(avoid.m3, avoid.pass, 'avoid bold');
      if (exit) pen.line(avoid.pass, exit, 'avoid dash');
      pen.dot(avoid.pass, 'avoid', 3.4);
      // label on the side of the heading line away from the approaching target
      const targetOnLeft = dot(vec(sol.own.course - 90, 1), avoid.m3) > 0;
      pen.text(avoid.pass, `船首方向 ${fmtRange(avoid.distance)}海里`, 'avoid', sol.own.course + (targetOnLeft ? 90 : -90), 10);
      pen.dot(avoid.newCpa.point, 'avoid', 3);
      pen.text(avoid.newCpa.point, `DCPA ${fmtNum(avoid.newCpa.dcpa, 2)}海里`, 'avoid', avoid.newCpa.bearing ?? avoid.relCourse + 90, 10);
    }
    // two marks on the new line and on its transferred copy in the speed-vector triangle
    if (speedMethod) pen.chevrons(avoid.m3, aim, 2, 'avoid');
    pen.ring(avoid.m3, 'avoid');
    pen.text(avoid.m3, compact ? formatTime(avoid.time) : `動作開始 ${formatTime(avoid.time)}`, 'avoid', plotSide + 180, 11);
  }

  // 4. Speed triangle, with the avoidance construction on it when that step is shown
  if (at('triangle')) {
    if (speedMethod) drawSpeedTriangle(pen, target, scene, avoidShown);
    else drawDistanceTriangle(pen, target, scene, avoidShown);
  }
}

/**
 * @param {{w: number, h: number, cx: number, cy: number, ppm: number}} view
 * @param {{range: number, step: number, own: object | null, targets: object[], loose: object[],
 *   blank?: boolean, detail?: boolean, multi?: boolean,
 *   method?: 'distance' | 'speed', knotsPerMile?: number}} scene
 * @returns {string} SVG markup for the inside of the <svg> element
 */
export function renderSheet(view, scene) {
  const pen = new Pen(view);
  const full = { method: 'distance', knotsPerMile: 1, ...scene };
  const vectorsShown = !full.blank && full.method === 'speed' && full.step >= STEPS.indexOf('triangle');
  drawSheet(pen, full.range, full.detail, vectorsShown ? full.knotsPerMile : null);
  if (full.blank) return pen.toString();

  if (full.own) drawOwnShip(pen, full.own, full.range);
  for (const p of full.loose) pen.dot(p, 'ink');

  const solved = full.targets.filter((t) => t.sol.ok);
  const background = solved.filter((t) => !t.active);
  if (background.length) {
    pen.raw('<g class="dim">');
    background.forEach((t) => drawTarget(pen, t, full));
    pen.raw('</g>');
  }
  const front = solved.find((t) => t.active);
  if (front) drawTarget(pen, front, full);
  return pen.toString();
}
