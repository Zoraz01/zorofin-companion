'use strict';

// Recolours the Zorofin theme. The theme is written in Zorofin green; every
// green colour in its stylesheets and scripts (accents, focus rings, tinted
// graphite backgrounds) is turned to the chosen accent's hue, keeping each
// colour's lightness so contrast stays as designed. Greys and other colours
// are left alone.

const BASE = { h: 142, s: 0.65 }; // Zorofin green, #42d779
const GREEN = { from: 80, to: 175 }; // hues the theme uses for its greens

const PRESETS = Object.freeze({
  zorofin: { label: 'Zorofin green', color: '#42d779' },
  ocean: { label: 'Ocean', color: '#3d9cff' },
  violet: { label: 'Violet', color: '#9d7bff' },
  rose: { label: 'Rose', color: '#ff6b9a' },
  amber: { label: 'Amber', color: '#f5a524' },
  crimson: { label: 'Crimson', color: '#ff5a5f' },
  graphite: { label: 'Graphite', color: '#c9ced1' },
});

const HEX = /^#[0-9a-f]{6}$/i;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const part = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [part(h + 1 / 3), part(h), part(h - 1 / 3)].map(v => Math.round(v * 255));
}

function hexToRgb(hex) {
  const value = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}

// The accent a setting asks for, as a hue and saturation, or null for Zorofin green.
function targetFor(colors, accent) {
  const hex = colors === 'custom' ? (HEX.test(accent || '') ? accent : null) : (PRESETS[colors] || {}).color;
  if (!hex || hex.toLowerCase() === PRESETS.zorofin.color) return null;
  const { h, s } = rgbToHsl(...hexToRgb(hex));
  return { h, s, key: hex.toLowerCase() };
}

function mapRgb(r, g, b, target) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.04 || h < GREEN.from || h > GREEN.to) return null;
  const nh = target.h + (h - BASE.h);
  const ns = Math.min(1, s * (target.s / BASE.s));
  return hslToRgb(nh, ns, l);
}

const hex2 = v => v.toString(16).padStart(2, '0');

function recolor(text, target) {
  if (!target) return text;
  return text
    .replace(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi, (match) => {
      const mapped = mapRgb(...hexToRgb(match), target);
      return mapped ? `#${mapped.map(hex2).join('')}` : match;
    })
    .replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*[\d.]+%?\s*)?\)/gi, (match, r, g, b, alpha) => {
      const mapped = mapRgb(Number(r), Number(g), Number(b), target);
      if (!mapped) return match;
      return alpha ? `rgba(${mapped.join(', ')}${alpha.replace(/\s+$/, '')})` : `rgb(${mapped.join(', ')})`;
    });
}

module.exports = { PRESETS, HEX, recolor, targetFor, rgbToHsl };
