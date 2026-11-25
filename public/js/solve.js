// Radar plotting solutions: relative motion, CPA, speed triangle, aspect and
// the course / speed change that opens the CPA.
// Units: nautical miles, knots, minutes. Bearings in degrees clockwise from north.

import {
  ORIGIN,
  add,
  bearingOf,
  cross,
  dot,
  footOnLine,
  len,
  lineLine,
  norm180,
  norm360,
  scale,
  sub,
  tangentsFromPoint,
  unit,
  vec,
} from './geometry.js';

const DAY = 1440;
const TINY = 1e-6;

/** Convert full-width digits and punctuation to ASCII. */
export function toHalfWidth(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，、]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[－ー−]/g, '-');
}

/** Parse a decimal number typed by a user. Returns NaN when it is not a number. */
export function parseNumber(text) {
  const s = toHalfWidth(text).trim().replace(/°$/, '');
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(s)) return NaN;
  return Number(s);
}

/** Parse "1006", "906" or "10:06" into minutes after midnight. Returns null when invalid. */
export function parseTime(text) {
  const s = toHalfWidth(text).trim().replace(/[:\s]/g, '');
  if (!/^\d{3,4}$/.test(s)) return null;
  const hours = Number(s.slice(0, -2));
  const minutes = Number(s.slice(-2));
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Format minutes after midnight as "HHMM" (rounded to the nearest minute). */
export function formatTime(minutes) {
  const m = (((Math.round(minutes) % DAY) + DAY) % DAY);
  return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
}

const fail = (error) => ({ ok: false, error });

/**
 * Solve one target from own ship data and at least two observations.
 *
 * The relative motion line is drawn through the first and the last observation.
 *
 * @param {{course: number, speed: number}} own true course (deg) and speed (kn)
 * @param {{time: number, bearing: number, range: number}[]} observations in time order;
 *   time in minutes after midnight, true bearing (deg), range (NM)
 */
export function solveTarget(own, observations) {
  if (!Number.isFinite(own?.course) || !Number.isFinite(own?.speed) || own.speed < 0) return fail('own');
  if (!Array.isArray(observations) || observations.length < 2) return fail('few');

  const obs = [];
  let offset = 0;
  for (const o of observations) {
    if (!Number.isFinite(o.time) || !Number.isFinite(o.bearing) || !(o.range > 0)) return fail('observation');
    let time = o.time + offset;
    if (obs.length && time <= obs[obs.length - 1].time) {
      // A later observation with an earlier clock time means the watch ran past midnight.
      offset += DAY;
      time += DAY;
    }
    obs.push({ time, bearing: norm360(o.bearing), range: o.range, p: vec(o.bearing, o.range) });
  }

  const first = obs[0];
  const last = obs[obs.length - 1];
  const dtMin = last.time - first.time;
  if (!(dtMin > 0) || dtMin > 12 * 60) return fail('time');
  const hours = dtMin / 60;

  const disp = sub(last.p, first.p);
  const relVel = scale(disp, 1 / hours);
  const relSpeed = len(relVel);
  const moving = relSpeed > TINY;

  const ownVel = vec(own.course, own.speed);
  const e = sub(first.p, scale(ownVel, hours));
  const trueVel = add(relVel, ownVel);
  const trueSpeed = len(trueVel);
  const trueCourse = trueSpeed > TINY ? bearingOf(trueVel) : null;

  let cpa = null;
  if (moving) {
    const foot = footOnLine(last.p, disp);
    const dcpa = len(foot.point);
    const tcpaMin = foot.s * dtMin;
    cpa = {
      point: foot.point,
      dcpa,
      bearing: dcpa > TINY ? bearingOf(foot.point) : null,
      tcpaMin,
      time: last.time + tcpaMin,
    };
  }

  let aspect = null;
  if (trueCourse !== null) {
    // Seen from the target, own ship lies on the reciprocal of the observed bearing.
    const reciprocal = norm360(last.bearing + 180);
    const diff = norm180(trueCourse - reciprocal);
    const angle = Math.abs(diff);
    const side = angle < 0.05 ? 'bow' : angle > 179.95 ? 'stern' : diff > 0 ? 'R' : 'G';
    aspect = { reciprocal, diff, angle, side };
  }

  let bow = null;
  if (moving) {
    const hit = lineLine(last.p, disp, ORIGIN, vec(own.course, 1));
    if (hit && hit.s > 0) {
      bow = { range: hit.t, tMin: hit.s * dtMin, time: last.time + hit.s * dtMin, point: hit.point };
    }
  }

  return {
    ok: true,
    obs,
    first,
    last,
    dtMin,
    hours,
    disp,
    rel: { vel: relVel, speed: relSpeed, course: moving ? bearingOf(relVel) : null, moving },
    own: { course: norm360(own.course), speed: own.speed, vel: ownVel, disp: scale(ownVel, hours) },
    e,
    true: { vel: trueVel, speed: trueSpeed, course: trueCourse, disp: scale(trueVel, hours) },
    cpa,
    aspect,
    bow,
  };
}

/**
 * Own ship manoeuvre that makes the target follow a new relative motion line.
 *
 * mode "cpa": from the action point the target must pass at `distance` (tangent to that circle).
 *   Gives the new course(s) at unchanged speed and the new speed at unchanged course.
 * mode "bow": the target must cross own ship's heading line `distance` ahead.
 *   Gives the new speed at unchanged course.
 *
 * @param {ReturnType<typeof solveTarget>} sol
 * @param {{time: number, mode: 'cpa' | 'bow', distance: number, side?: 'auto' | 'opposite'}} options
 */
export function solveAvoidance(sol, options) {
  if (!sol?.ok) return fail('target');
  if (!sol.rel.moving) return fail('static');
  if (!(options.distance > 0)) return fail('distance');
  if (!Number.isFinite(options.time)) return fail('time');

  // Put the action time on the same day as the last observation.
  let time = options.time + Math.floor(sol.last.time / DAY) * DAY;
  if (time < sol.last.time - DAY / 2) time += DAY;
  if (time < sol.last.time) return fail('early');
  const minutesAhead = time - sol.last.time;
  if (minutesAhead >= sol.cpa.tcpaMin) return fail('passed');

  const m3 = add(sol.last.p, scale(sol.rel.vel, minutesAhead / 60));
  const targetVel = sol.true.vel;
  const ownSpeed = sol.own.speed;
  const heading = vec(sol.own.course, 1);
  const tau = sol.hours; // the speed triangle is drawn for this many hours

  /** Everything that follows from the new relative direction u (unit vector). */
  const build = (u, withCourses) => {
    const foot = footOnLine(m3, u);
    const along = foot.s; // miles from the action point to the new CPA
    const timing = (relSpeed) => {
      const tcpaMin = along > 0 ? (along / relSpeed) * 60 : 0;
      return { relSpeed, tcpaMin, cpaTime: time + tcpaMin };
    };

    const courses = [];
    if (withCourses && ownSpeed > TINY) {
      // New own velocity O' with |O'| = ownSpeed and targetVel − O' = k·u, k > 0.
      const tu = dot(targetVel, u);
      const disc = tu * tu - dot(targetVel, targetVel) + ownSpeed * ownSpeed;
      if (disc >= -1e-9) {
        const sq = Math.sqrt(Math.max(0, disc));
        const ks = sq < 1e-7 ? [tu] : [tu + sq, tu - sq];
        for (const k of ks) {
          if (k <= TINY) continue;
          const vel = sub(targetVel, scale(u, k));
          const course = bearingOf(vel);
          courses.push({
            course,
            turn: norm180(course - sol.own.course),
            point: add(sol.e, scale(vel, tau)),
            ...timing(k),
          });
        }
        courses.sort((a, b) => Math.abs(a.turn) - Math.abs(b.turn));
      }
    }

    // New own velocity s·heading with targetVel − s·heading parallel to u.
    let speed = null;
    const den = cross(heading, u);
    if (Math.abs(den) > 1e-9) {
      const s = cross(targetVel, u) / den;
      const k = dot(sub(targetVel, scale(heading, s)), u);
      if (k > TINY && s > -1e-9) {
        const value = Math.max(0, s);
        speed = {
          speed: value,
          change: value < ownSpeed - 1e-6 ? 'slower' : value > ownSpeed + 1e-6 ? 'faster' : 'same',
          point: add(sol.e, scale(heading, value * tau)),
          ...timing(k),
        };
      }
    }

    const dcpa = len(foot.point);
    return {
      dir: u,
      relCourse: bearingOf(u),
      courses,
      speed,
      newCpa: { point: foot.point, dcpa, bearing: dcpa > TINY ? bearingOf(foot.point) : null },
    };
  };

  const base = {
    ok: true,
    mode: options.mode,
    time,
    m3,
    distance: options.distance,
    circle: { centre: sol.e, radius: ownSpeed * tau },
    through: sol.last.p,
  };

  if (options.mode === 'bow') {
    const pass = scale(heading, options.distance);
    const u = unit(sub(pass, m3));
    if (!u) return fail('distance');
    return { ...base, ...build(u, false), pass };
  }

  const tangents = tangentsFromPoint(m3, options.distance);
  if (!tangents.length) return fail('inside');
  // Which side of the line the own ship lies on: +1 left of the motion, −1 right of it.
  const sideOf = (point, dir) => Math.sign(cross(dir, scale(point, -1)));
  const candidates = tangents.map((t) => ({
    ...build(t.dir, true),
    tangentPoint: t.point,
    side: sideOf(m3, t.dir),
  }));

  const originalSide = sol.cpa.dcpa > TINY ? sideOf(sol.last.p, sol.rel.vel) : 0;
  let ordered;
  if (originalSide !== 0) {
    // Keep the target on the side it is already passing; "opposite" forces the other tangent.
    ordered = [...candidates].sort((a, b) => (a.side === originalSide ? -1 : 1) - (b.side === originalSide ? -1 : 1));
  } else {
    // Collision course: prefer the tangent reached with the smallest turn to starboard.
    const score = (c) => {
      const starboard = c.courses.filter((s) => s.turn > 0).map((s) => s.turn);
      return starboard.length ? Math.min(...starboard) : 1000;
    };
    ordered = [...candidates].sort((a, b) => score(a) - score(b));
  }
  const pick = options.side === 'opposite' && ordered.length > 1 ? ordered[1] : ordered[0];

  return {
    ...base,
    ...pick,
    alreadyClear: sol.cpa.dcpa >= options.distance,
    hasOtherSide: ordered.length > 1,
  };
}
