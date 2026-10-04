/**
 * The board header's toggles. They live outside the timeline component so they survive moving
 * between timelines and the multiverse (and, from Stage 7, are shared with the 3D view).
 */
import { signal } from '@preact/signals';
import type { Player } from '@/engine';

/** Draw the ring of glued neighbours around each slice (wrapped spaces). On by default. */
export const showHalos = signal(true);
export const showThreats = signal(false);
export const showOpenLines = signal(false);
/** Whose open lines to count; null follows the hot seat. */
export const openLinesFor = signal<Player | null>(null);

/**
 * The tesseract cube filter: null shows all cubes. It is chosen once per board size (see
 * `defaultGroup`), then left to the player.
 */
export const cubeFilter = signal<{ readonly key: string; readonly group: number | null } | null>(
  null,
);
