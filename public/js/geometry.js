// Plane geometry for radar plotting.
// Coordinates: x = east, y = north, in nautical miles (or knots for velocities).
// Bearings and courses: degrees, clockwise from north.

export const DEG = Math.PI / 180;
export const ORIGIN = Object.freeze({ x: 0, y: 0 });

/** Normalise an angle to [0, 360). */
export function norm360(a) {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Normalise an angle to (-180, 180]. */
export function norm180(a) {
  const r = norm360(a);
  return r > 180 ? r - 360 : r;
}

/** Vector of the given length pointing along a bearing. */
export function vec(bearing, length) {
  const t = bearing * DEG;
  return { x: length * Math.sin(t), y: length * Math.cos(t) };
}

/** Bearing (direction) of a vector. */
export function bearingOf(v) {
  return norm360(Math.atan2(v.x, v.y) / DEG);
}

export const len = (v) => Math.hypot(v.x, v.y);
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
/** z component of a × b. Positive when b lies counter-clockwise (to the left) of a. */
export const cross = (a, b) => a.x * b.y - a.y * b.x;

/** Unit vector, or null for a zero vector. */
export function unit(v) {
  const l = len(v);
  return l < 1e-12 ? null : scale(v, 1 / l);
}

/**
 * Foot of the perpendicular from q onto the line p + s·d.
 * @returns {{s: number, point: {x: number, y: number}} | null}
 */
export function footOnLine(p, d, q = ORIGIN) {
  const dd = dot(d, d);
  if (dd < 1e-18) return null;
  const s = dot(sub(q, p), d) / dd;
  return { s, point: add(p, scale(d, s)) };
}

/**
 * Intersections of the line p + s·d with the circle (centre c, radius r), ordered by s.
 * @returns {{s: number, point: {x: number, y: number}}[]}
 */
export function lineCircle(p, d, c, r) {
  const a = dot(d, d);
  if (a < 1e-18) return [];
  const f = sub(p, c);
  const b = 2 * dot(f, d);
  const disc = b * b - 4 * a * (dot(f, f) - r * r);
  if (disc < -1e-12) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const s1 = (-b - sq) / (2 * a);
  const hits = [{ s: s1, point: add(p, scale(d, s1)) }];
  if (sq > 1e-9) {
    const s2 = (-b + sq) / (2 * a);
    hits.push({ s: s2, point: add(p, scale(d, s2)) });
  }
  return hits;
}

/**
 * Intersection of the lines p1 + s·d1 and p2 + t·d2.
 * @returns {{s: number, t: number, point: {x: number, y: number}} | null} null when parallel
 */
export function lineLine(p1, d1, p2, d2) {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(p2, p1);
  const s = cross(w, d2) / den;
  const t = cross(w, d1) / den;
  return { s, t, point: add(p1, scale(d1, s)) };
}

/**
 * Tangent lines from an external point p to the circle centred on the origin.
 * @returns {{dir: {x: number, y: number}, point: {x: number, y: number}}[]}
 *   unit direction from p and the tangent point; empty when p is not outside the circle
 */
export function tangentsFromPoint(p, r) {
  const d = len(p);
  if (!(r >= 0) || !(d > r)) return [];
  const toCentre = bearingOf(scale(p, -1));
  if (r === 0) return [{ dir: vec(toCentre, 1), point: { x: 0, y: 0 } }];
  const alpha = Math.asin(r / d) / DEG;
  const reach = Math.sqrt(d * d - r * r);
  return [1, -1].map((sign) => {
    const dir = vec(toCentre + sign * alpha, 1);
    return { dir, point: add(p, scale(dir, reach)) };
  });
}
