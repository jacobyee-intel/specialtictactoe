/**
 * The 3D view's settings, kept outside the component so they survive moving between timelines,
 * plus the tracer's walk, which the 2D board highlights too. Plain signals: no three.js here,
 * so the main bundle stays free of the render chunk.
 */
import { signal } from '@preact/signals';
import type { CellId, NodeId } from '@/engine';

/** Ghost copies around the fundamental cube (wrapped spaces). Faces by default. */
export type GhostChoice = 'off' | 'faces' | 'all';
export const ghostChoice = signal<GhostChoice>('faces');

/** The tesseract's picture: the Schlegel diagram (true 4D) or the unfolded net. */
export const tesseractView = signal<'schlegel' | 'net'>('schlegel');

/** The tesseract's 4D orientation in radians; null is the default orientation. */
export const planes4 = signal<{
  readonly xw: number;
  readonly yw: number;
  readonly zw: number;
} | null>(null);

/** Auto-rotate in the XW plane (off by default; unavailable under reduced motion). */
export const autoRotate = signal(false);

/** The tracer's walk so far, for the 2D board: the cells visited and the walker's cell. */
export const traceHighlight = signal<{
  readonly node: NodeId;
  readonly cells: readonly CellId[];
  readonly current: CellId;
} | null>(null);
