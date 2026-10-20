// Colour helpers for the lights colour picker. Hex strings are always
// normalised to uppercase `#RRGGBB` (matches what govee.rgbIntToHex returns).

export const DEFAULT_PRESET_COLORS = [
  '#FFFFFF', '#FFD700', '#FF8C00', '#FF4500',
  '#FF1493', '#9400D3', '#0000FF', '#00BFFF',
  '#00FF7F', '#ADFF2F',
];

export const PRESET_COUNT = DEFAULT_PRESET_COLORS.length;
export const MAX_RECENT_COLORS = 6;

// Accepts "#abc", "abc", "#aabbcc", "aabbcc" (any case, surrounding spaces).
// Returns "#AABBCC" or null when invalid.
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

// h: 0–360, s/v: 0–1
export function hexToHsv(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    hue < 60  ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (ch) => Math.round((ch + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Wheel geometry (shared with scripts/generate-color-wheel.js): hue is the
// angle clockwise from 3 o'clock in screen coords, saturation the distance
// from the centre. Value is always 1 — brightness has its own slider.
export function wheelPointToHex(x, y, radius) {
  const dx = x - radius;
  const dy = y - radius;
  let h = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (h < 0) h += 360;
  const s = Math.min(Math.hypot(dx, dy) / radius, 1);
  return hsvToHex({ h, s, v: 1 });
}

// Inverse of wheelPointToHex — where to draw the thumb for a colour.
export function hexToWheelPoint(hex, radius) {
  const hsv = hexToHsv(hex);
  if (!hsv) return { x: radius, y: radius };
  const a = (hsv.h * Math.PI) / 180;
  return {
    x: radius + Math.cos(a) * hsv.s * radius,
    y: radius + Math.sin(a) * hsv.s * radius,
  };
}

// Most-recent-first, deduped, capped.
export function pushRecentColor(recents, hex, max = MAX_RECENT_COLORS) {
  const n = normalizeHex(hex);
  const list = (recents ?? []).map(normalizeHex).filter(Boolean);
  if (!n) return list.slice(0, max);
  return [n, ...list.filter((c) => c !== n)].slice(0, max);
}

export function removeRecentColor(recents, hex) {
  const n = normalizeHex(hex);
  return (recents ?? []).map(normalizeHex).filter((c) => c && c !== n);
}

// Linear RGB mix, t: 0–1
export function mixHex(a, b, t) {
  const x = normalizeHex(a);
  const y = normalizeHex(b);
  if (!x || !y) return x ?? y ?? null;
  const k = clamp01(t);
  const ch = (i) => {
    const p = parseInt(x.slice(i, i + 2), 16);
    const q = parseInt(y.slice(i, i + 2), 16);
    return Math.round(p + (q - p) * k).toString(16).padStart(2, '0');
  };
  return `#${ch(1)}${ch(3)}${ch(5)}`.toUpperCase();
}

// `count` colours evenly spread across 2+ equally spaced stops. A single
// colour gets the first stop.
export function gradientColors(stops, count) {
  const valid = (stops ?? []).map(normalizeHex).filter(Boolean);
  if (count <= 0 || valid.length === 0) return [];
  if (valid.length === 1 || count === 1) return Array(count).fill(valid[0]);
  const spans = valid.length - 1;
  return Array.from({ length: count }, (_, i) => {
    const pos = (i / (count - 1)) * spans;
    const seg = Math.min(Math.floor(pos), spans - 1);
    return mixHex(valid[seg], valid[seg + 1], pos - seg);
  });
}

// Pairs segments with colours and merges segments sharing a colour, so each
// distinct colour costs one API call. Groups keep first-appearance order.
export function groupSegmentsByColor(segments, colors) {
  const groups = new Map();
  segments.forEach((seg, i) => {
    const hex = normalizeHex(colors[i]);
    if (!hex) return;
    if (!groups.has(hex)) groups.set(hex, []);
    groups.get(hex).push(seg);
  });
  return [...groups].map(([hex, segs]) => ({ hex, segments: segs }));
}

// Pads/truncates a stored preset list to exactly PRESET_COUNT valid colours,
// filling gaps from the defaults.
export function sanitizePresets(list) {
  return DEFAULT_PRESET_COLORS.map((def, i) => normalizeHex(list?.[i]) ?? def);
}

// True when dark text reads better on top of `hex` (relative luminance).
export function isLightColor(hex) {
  const n = normalizeHex(hex);
  if (!n) return true;
  const lin = (i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5) > 0.4;
}

function clamp01(n) {
  return Math.min(Math.max(Number(n) || 0, 0), 1);
}
