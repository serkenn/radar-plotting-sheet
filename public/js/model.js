// Turns the form state (text typed by the user) into solved targets.

import { vec } from './geometry.js';
import { parseNumber, parseTime, solveAvoidance, solveTarget } from './solve.js';

const RANGES = [1.5, 3, 6, 12, 24, 48, 96];

/**
 * @param {{own: {course: string, speed: string},
 *   targets: {obs: {time: string, bearing: string, range: string}[],
 *     avoid: {on: boolean, time: string, mode: 'cpa' | 'bow', dist: string, side: string}}[]}} state
 */
export function buildModel(state) {
  const own = { course: parseNumber(state.own.course), speed: parseNumber(state.own.speed) };
  const ownOk =
    Number.isFinite(own.course) && own.course >= 0 && own.course <= 360 && Number.isFinite(own.speed) && own.speed >= 0;

  const targets = state.targets.map((t, index) => {
    const filled = t.obs
      .filter((o) => o.time.trim() || o.bearing.trim() || o.range.trim())
      .map((o) => ({ time: parseTime(o.time), bearing: parseNumber(o.bearing), range: parseNumber(o.range) }));
    const rows = filled.filter(
      (o) => o.time !== null && Number.isFinite(o.bearing) && o.bearing >= 0 && o.bearing <= 360 && o.range > 0,
    );

    let sol;
    if (filled.length !== rows.length) sol = { ok: false, error: 'observation' };
    else if (rows.length < 2) sol = { ok: false, error: 'few' };
    else if (!ownOk) sol = { ok: false, error: 'own' };
    else sol = solveTarget(own, rows);

    const avoidGiven = { time: parseTime(t.avoid.time), mode: t.avoid.mode, distance: parseNumber(t.avoid.dist) };
    let avoid = null;
    if (sol.ok && t.avoid.on) {
      avoid = solveAvoidance(sol, {
        time: avoidGiven.time ?? NaN,
        mode: avoidGiven.mode,
        distance: avoidGiven.distance,
        side: t.avoid.side,
      });
    }
    return {
      index,
      sol,
      avoid,
      avoidOn: t.avoid.on,
      avoidGiven,
      rows,
      points: rows.map((o) => vec(o.bearing, o.range)),
      farthest: Math.max(0, ...rows.map((o) => o.range)),
    };
  });
  return { own: ownOk ? own : null, targets };
}

/** Sheet range in miles: the chosen one, or the smallest standard range that holds every plot. */
export function chooseRange(model, choice) {
  if (choice !== 'auto') return Number(choice);
  const need = Math.max(0, ...model.targets.map((t) => t.farthest));
  if (!need) return 12;
  return RANGES.find((r) => r >= need - 1e-9) ?? RANGES[RANGES.length - 1];
}

/**
 * Scale of the speed vectors drawn from the centre: how many knots one mile of the
 * sheet stands for. The smallest round figure that keeps every vector on the sheet.
 */
export function chooseSpeedScale(model, range) {
  const speeds = [model.own?.speed ?? 0, ...model.targets.filter((t) => t.sol.ok).map((t) => t.sol.true.speed)];
  const fastest = Math.max(0, ...speeds);
  return [1, 2, 4, 5, 10, 20].find((knots) => fastest / knots <= range) ?? 50;
}
