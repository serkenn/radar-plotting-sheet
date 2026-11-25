// Number formatting shared by the sheet and the result table.

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Bearing or course: three integer digits, one decimal only when needed ("083.5°", "300°"). */
export function fmtBearing(value) {
  if (!finite(value)) return '—';
  let rounded = Math.round(value * 10) / 10;
  if (rounded >= 360) rounded -= 360;
  const [whole, fraction] = rounded.toFixed(1).split('.');
  return `${whole.padStart(3, '0')}${fraction === '0' ? '' : `.${fraction}`}°`;
}

/** Plain angle without zero padding ("35.3°", "57°"). */
export function fmtAngle(value) {
  if (!finite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}°`;
}

/** Fixed number of decimals. */
export function fmtNum(value, digits = 1) {
  return finite(value) ? value.toFixed(digits) : '—';
}

/** "右へ57.5°" / "左へ96.6°". */
export function fmtTurn(turn) {
  if (!finite(turn)) return '—';
  if (Math.abs(turn) < 0.05) return '変針なし';
  return turn > 0 ? `右へ${fmtAngle(turn)}` : `左へ${fmtAngle(-turn)}`;
}

/** "R35.3°", "G35.5°", "0°（正船首）", "180°（正船尾）". */
export function fmtAspect(aspect) {
  if (!aspect) return '—';
  if (aspect.side === 'bow') return '0°（正船首）';
  if (aspect.side === 'stern') return '180°（正船尾）';
  return `${aspect.side}${fmtAngle(aspect.angle)}`;
}

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
export const roman = (index) => ROMAN[index] ?? String(index + 1);
