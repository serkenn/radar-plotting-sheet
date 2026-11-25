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

/** View that fits the given points with some room for labels. */
export function fitView(width, height, points, pad = 58) {
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
  const ppm = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  return { w: width, h: height, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, ppm: Math.max(0.5, Math.min(ppm, 4000)) };
}

/** Points occupied by the speed triangle and, when present, the avoidance construction on it. */
export function trianglePoints(sol, avoid) {
  const points = [sol.e, sol.first.p, sol.last.p];
  if (avoid?.ok) {
    const { centre, radius } = avoid.circle;
    points.push({ x: centre.x - radius, y: centre.y - radius }, { x: centre.x + radius, y: centre.y + radius });
    for (const s of avoid.courses) points.push(s.point);
    if (avoid.speed) points.push(avoid.speed.point);
  }
  return points;
}

class Pen {
  constructor(view) {
    this.view = view;
    this.parts = [];
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

  /** Label placed `gap` pixels from p in the direction of `bearing`. */
  text(p, label, cls, bearing = 0, gap = 9) {
    const [x0, y0] = this.xy(p);
    const dx = Math.sin(bearing * DEG) * gap;
    const dy = -Math.cos(bearing * DEG) * gap;
    const anchor = dx > 2.5 ? 'start' : dx < -2.5 ? 'end' : 'middle';
    const baseline = dy > 2.5 ? 'hanging' : dy < -2.5 ? 'auto' : 'central';
    this.raw(
      `<text class="lbl ${cls}" x="${r1(x0 + dx)}" y="${r1(y0 + dy)}" text-anchor="${anchor}" dominant-baseline="${baseline}">${esc(label)}</text>`,
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

  toString() {
    return this.parts.join('');
  }
}

const fmtRange = (value) => String(Math.round(value * 100) / 100);

function drawSheet(pen, range, detail) {
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

  // Distance figures on the solid rings, just right of the southern axis.
  for (let i = 2; i <= 12; i += 2) {
    const [x, y] = pen.xy(vec(180, i * minor));
    pen.raw(`<text class="range-label" x="${r1(x + 3)}" y="${r1(y - 3)}">${fmtRange(i * minor)}</text>`);
  }
  pen.raw(
    `<path class="centre-mark" d="M${r1(cx - 6)} ${r1(cy)}H${r1(cx + 6)}M${r1(cx)} ${r1(cy - 6)}V${r1(cy + 6)}"/>`,
  );
}

/**
 * Linear distance scale with the same miles-to-pixels ratio as the sheet, for use with dividers.
 * Drawn from `left` to the right; `baseline` is the y of the scale line.
 */
export function renderScaleBar(view, range, left, baseline) {
  const x = (miles) => r1(left + miles * view.ppm);
  const parts = [`<line class="tick" x1="${x(0)}" y1="${baseline}" x2="${x(range)}" y2="${baseline}"/>`];
  for (let i = 0; i <= 60; i += 1) {
    const miles = (range / 60) * i;
    const size = i % 10 === 0 ? 8 : i % 5 === 0 ? 5.5 : 3;
    parts.push(`<line class="tick" x1="${x(miles)}" y1="${baseline}" x2="${x(miles)}" y2="${r1(baseline + size)}"/>`);
    if (i % 10 === 0) parts.push(`<text class="tick-label" x="${x(miles)}" y="${baseline + 17}">${fmtRange(miles)}</text>`);
  }
  parts.push(`<text class="range-label" x="${r1(x(range) + 14)}" y="${baseline + 20}">海里</text>`);
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

function drawTarget(pen, target, scene) {
  const { sol, avoid, active } = target;
  const at = (name) => scene.step >= STEPS.indexOf(name);
  const moving = sol.rel.moving;
  const relBearing = moving ? bearingOf(sol.disp) : 0;

  // Labels of the plotted points go on the side of the relative motion line away from e.
  const leftOfLine = vec(relBearing - 90, 1);
  const plotSide = dot(leftOfLine, sub(mid(sol.first.p, sol.last.p), sol.e)) >= 0 ? relBearing - 90 : relBearing + 90;
  const centroid = scale(add(add(sol.e, sol.first.p), sol.last.p), 1 / 3);
  const outward = (p) => {
    const d = sub(p, centroid);
    return len(d) < 1e-9 ? plotSide : bearingOf(d);
  };
  const triangleSize = pen.px(Math.max(len(sol.own.disp), len(sol.true.disp), len(sol.disp)));
  // Vector labels need room; on the full sheet they are left to the enlarged view.
  const roomy = active && triangleSize >= 150;
  // With the plots close together on screen, labels are cut down to the essentials.
  const spacing = pen.px(len(sol.disp)) / (sol.obs.length - 1);
  const compact = spacing < 50;
  const avoidShown = at('avoid') && active && Boolean(avoid?.ok);

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
    if (roomy) {
      pen.text(
        mid(sol.first.p, sol.last.p),
        `相対 ${fmtBearing(sol.rel.course)}・${fmtNum(sol.rel.speed)}kn`,
        'rel',
        plotSide,
        25,
      );
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

  // 4. Speed triangle
  if (at('triangle')) {
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
  }

  // 5. Aspect: the angle at the target between her heading and the line back to own ship
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

  // 6. Manoeuvre that opens the CPA
  if (avoidShown) {
    const ahead = lineCircle(avoid.m3, avoid.dir, ORIGIN, scene.range).filter((hit) => hit.s > 0);
    const exit = ahead.length ? ahead[ahead.length - 1].point : null;
    const newBearing = avoid.relCourse;

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
      pen.text(avoid.newCpa.point, `DCPA ${fmtNum(avoid.newCpa.dcpa, 2)}海里`, 'avoid', avoid.newCpa.bearing ?? newBearing + 90, 10);
    }
    pen.ring(avoid.m3, 'avoid');
    pen.text(avoid.m3, compact ? formatTime(avoid.time) : `動作開始 ${formatTime(avoid.time)}`, 'avoid', plotSide + 180, 11);

    // On the speed triangle: the line through the last plot, parallel to the new
    // relative motion, drawn backwards; it meets the own-ship circle and the own-ship side.
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
}

/** Speed-vector method: one-hour vectors drawn from the centre. */
function drawSpeedVectors(pen, sol, range) {
  const fastest = Math.max(sol.own.speed, sol.true.speed);
  let knotsPerMile = 1;
  for (const k of [1, 2, 4, 5, 10, 20]) {
    knotsPerMile = k;
    if (fastest / k <= range) break;
  }
  const own = scale(sol.own.vel, 1 / knotsPerMile);
  const tgt = scale(sol.true.vel, 1 / knotsPerMile);
  pen.arrow(ORIGIN, own, 'own');
  pen.arrow(ORIGIN, tgt, 'tgt');
  pen.arrow(own, tgt, 'rel');
  const away = bearingOf(sub(mid(own, tgt), ORIGIN));
  pen.text(mid(own, tgt), `速力ベクトル方式（1海里＝${knotsPerMile}ノット）`, 'rel small', away, 10);
}

/**
 * @param {{w: number, h: number, cx: number, cy: number, ppm: number}} view
 * @param {{range: number, step: number, own: object | null, targets: object[], loose: object[],
 *   blank?: boolean, detail?: boolean, speedVector?: boolean, multi?: boolean}} scene
 * @returns {string} SVG markup for the inside of the <svg> element
 */
export function renderSheet(view, scene) {
  const pen = new Pen(view);
  drawSheet(pen, scene.range, scene.detail);
  if (scene.blank) return pen.toString();

  if (scene.own) drawOwnShip(pen, scene.own, scene.range);
  for (const p of scene.loose) pen.dot(p, 'ink');

  const solved = scene.targets.filter((t) => t.sol.ok);
  const background = solved.filter((t) => !t.active);
  if (background.length) {
    pen.raw('<g class="dim">');
    background.forEach((t) => drawTarget(pen, t, scene));
    pen.raw('</g>');
  }
  const front = solved.find((t) => t.active);
  if (front) {
    drawTarget(pen, front, scene);
    if (scene.speedVector && scene.step >= STEPS.indexOf('triangle') && front.sol.true.course !== null) {
      drawSpeedVectors(pen, front.sol, scene.range);
    }
  }
  return pen.toString();
}
