/**
 * Colour tokens for code that cannot read CSS custom properties cheaply: SVG attributes built
 * in JS and, from Stage 7, three.js materials.
 *
 * `src/styles/theme.css` is the source of truth for the page; `tokens.test.ts` parses it and
 * fails if these values drift.
 */
import type { Player } from '@/engine';

export const COLORS = {
  white: '#ffffff',
  black: '#000000',
  grey60: '#666666',
  grey30: '#b3b3b3',
  grey10: '#e6e6e6',
  p1: '#e30613',
  p2: '#005bbb',
  done: '#00965e',
  p1Tint: '#fbdadc',
  p2Tint: '#d9e6f5',
  doneTint: '#d9efe7',
} as const;

export type ColorToken = keyof typeof COLORS;

/** The CSS custom property that declares each token in theme.css. */
export const CSS_VARS: Readonly<Record<ColorToken, string>> = {
  white: '--white',
  black: '--black',
  grey60: '--grey-60',
  grey30: '--grey-30',
  grey10: '--grey-10',
  p1: '--p1',
  p2: '--p2',
  done: '--done',
  p1Tint: '--p1-tint',
  p2Tint: '--p2-tint',
  doneTint: '--done-tint',
};

/** The accent of a player: red for Player 1, blue for Player 2. */
export function playerColor(player: Player): string {
  return player === 0 ? COLORS.p1 : COLORS.p2;
}

/** The CSS class that colours text in a player's accent. */
export function playerClass(player: Player): string {
  return player === 0 ? 'c-p1' : 'c-p2';
}

/** "Player 1" / "Player 2": players are 0-based in the engine but 1-based on screen. */
export function playerName(player: Player): string {
  return `Player ${player + 1}`;
}
