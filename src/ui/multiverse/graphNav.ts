/**
 * Keyboard navigation of the multiverse graph (pure).
 *
 * | Key     | Action                                                       |
 * |---------|--------------------------------------------------------------|
 * | ← / →   | parent / first child                                         |
 * | ↑ / ↓   | the nearest node in the lane above / below, at the closest step |
 * | Enter   | open the node, or pick it in picking mode (Space too)        |
 * | N       | the next node needing action                                 |
 * | F       | fit                                                          |
 * | + / −   | zoom                                                         |
 * | L       | toggle the cross-links                                       |
 * | G       | switch between Graph and List                                |
 *
 * In the lanes layout every lane is one unbroken run of steps (a chain of first children ending
 * at a leaf), so "the closest step" in a lane is just the step clamped to that run.
 */
import type { NodeId } from '@/engine';
import type { GraphModel } from './graphModel';

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export type GraphCommand =
  | { readonly kind: 'move'; readonly key: ArrowKey }
  | { readonly kind: 'activate' }
  | { readonly kind: 'next' }
  | { readonly kind: 'fit' }
  | { readonly kind: 'zoomIn' }
  | { readonly kind: 'zoomOut' }
  | { readonly kind: 'links' }
  | { readonly kind: 'switchView' };

const ARROWS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

const LETTERS: Readonly<Record<string, GraphCommand>> = {
  n: { kind: 'next' },
  f: { kind: 'fit' },
  l: { kind: 'links' },
  g: { kind: 'switchView' },
  '+': { kind: 'zoomIn' },
  '=': { kind: 'zoomIn' },
  '-': { kind: 'zoomOut' },
  '−': { kind: 'zoomOut' },
  _: { kind: 'zoomOut' },
};

/** The command for a key press, or null for keys the graph does not use. */
export function graphCommand(
  key: string,
  mods: { readonly ctrl?: boolean; readonly meta?: boolean; readonly alt?: boolean } = {},
): GraphCommand | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (ARROWS.has(key)) return { kind: 'move', key: key as ArrowKey };
  if (key === 'Enter' || key === ' ') return { kind: 'activate' };
  return LETTERS[key.length === 1 ? key.toLowerCase() : key] ?? null;
}

/** The node an arrow key moves the focus to from `from`, or null when there is none. */
export function moveFocus(model: GraphModel, from: NodeId, key: ArrowKey): NodeId | null {
  const node = model.byId.get(from);
  if (node === undefined) return null;
  switch (key) {
    case 'ArrowLeft':
      return node.parent;
    case 'ArrowRight': {
      // The first child shares the lane and sits one step later.
      const row = model.rows[node.lane] ?? [];
      const next = row.find((n) => n.step === node.step + 1 && n.parent === node.id);
      if (next !== undefined) return next.id;
      return model.nodes.find((n) => n.parent === node.id)?.id ?? null;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const row = model.rows[node.lane + (key === 'ArrowUp' ? -1 : 1)];
      if (row === undefined || row.length === 0) return null;
      let best = row[0] as (typeof row)[number];
      for (const n of row) {
        const d = Math.abs(n.step - node.step);
        const bestD = Math.abs(best.step - node.step);
        if (d < bestD || (d === bestD && n.step < best.step)) best = n;
      }
      return best.id;
    }
  }
}
