import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
// Token blocks contain no nested braces, so the first "}" after the selector closes the block.
const block = (selector: string) => {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`missing block ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};
const hexVars = (body: string) =>
  Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2].toUpperCase()]));
const barOf = (body: string) => {
  const m = body.match(/--bar:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
  if (!m) throw new Error('missing --bar');
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h: string) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg: number[], a: number, bg: string) =>
  '#' + fg.map((v, i) => Math.round(a * v + (1 - a) * rgb(bg)[i]).toString(16).padStart(2, '0')).join('').toUpperCase();

const B4 = ['canvas', 'canvas-alt', 'surface', 'surface-raised'];
const TEXT: [string, string[]][] = [
  ['ink', [...B4, 'fill', 'bar*', 'awaiting-tint', 'cleared-tint', 'danger-tint']],
  ['ink-2', [...B4, 'fill', 'bar*', 'awaiting-tint', 'danger-tint']],
  ['link', [...B4, 'fill', 'awaiting-tint', 'cleared-tint', 'danger-tint']],
  ['action-ink', ['action', 'action-hover', 'action-pressed']],
  ['canvas', ['ink']],
  ['awaiting-text', [...B4, 'awaiting-tint', 'fill']],
  ['cleared-text', [...B4, 'cleared-tint', 'fill']],
  ['cleared-ink', ['cleared']],
  ['danger-text', [...B4, 'danger-tint', 'fill']],
  ['danger-ink', ['danger']],
];
const UI: [string, string[]][] = [
  ['hairline-strong', B4],
  ['action', [...B4, 'fill']],
  ['focus', [...B4, 'fill', 'bar*', 'awaiting-tint', 'danger-tint']],
  ['danger', ['canvas', 'surface', 'surface-raised']],
];

describe('design tokens', () => {
  const light = block(':root {');
  const darkSystem = block(':root:not([data-theme="light"]) {');
  const darkForced = block(':root[data-theme="dark"] {');

  it('keeps the two dark blocks identical', () => {
    expect(darkSystem.replace(/\s+/g, ' ').trim()).toBe(darkForced.replace(/\s+/g, ' ').trim());
  });

  it('keeps the default Tailwind breakpoints (07 D144)', () => expect(css).not.toMatch(/--breakpoint-/));

  for (const [mode, body, under] of [['light', light, '#000000'], ['dark', darkForced, '#FFFFFF']] as const) {
    const t: Record<string, string> = hexVars(body);
    const bar = barOf(body);
    t['bar*'] = over(bar.rgb, bar.a, under); // worst case: black under a light bar, white under a dark bar
    for (const [list, min] of [[TEXT, 4.5], [UI, 3]] as const) {
      for (const [fg, bgs] of list) for (const bg of bgs) {
        it(`${mode}: ${fg} on ${bg} ≥ ${min}`, () => expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min));
      }
    }
  }
});
