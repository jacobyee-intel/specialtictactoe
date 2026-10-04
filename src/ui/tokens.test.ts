/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, CSS_VARS, type ColorToken } from './tokens';

const css = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');

/** Every `--name: #hex;` declaration in theme.css. */
function cssColors(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, hex] of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out.set(name as string, (hex as string).toLowerCase());
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

describe('colour tokens', () => {
  const declared = cssColors();
  const tokens = Object.keys(COLORS) as ColorToken[];

  it.each(tokens)('%s matches theme.css', (token) => {
    expect(declared.get(CSS_VARS[token])).toBe(COLORS[token]);
  });

  it('declares no colour in theme.css that tokens.ts lacks', () => {
    const mirrored = new Set(tokens.map((t) => CSS_VARS[t]));
    expect([...declared.keys()].filter((name) => !mirrored.has(name))).toEqual([]);
  });

  it('precomputes each tint as the accent at 15% over white', () => {
    const pairs: [ColorToken, ColorToken][] = [
      ['p1', 'p1Tint'],
      ['p2', 'p2Tint'],
      ['done', 'doneTint'],
    ];
    for (const [accent, tint] of pairs) {
      const expected = rgb(COLORS[accent]).map((c) => Math.round(0.15 * c + 0.85 * 255));
      expect(rgb(COLORS[tint])).toEqual(expected);
    }
  });
});
