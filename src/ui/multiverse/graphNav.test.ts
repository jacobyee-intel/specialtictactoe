import { describe, expect, it } from 'vitest';
import { crafted } from '@/engine/__tests__/helpers';
import { buildGraph } from './graphModel';
import { graphCommand, moveFocus } from './graphNav';

const EMPTY = '0'.repeat(27);

/**
 * ```
 * step  0    1    2    3
 *       #0 ─ #1 ─ #2 ─ #4      lane 0
 *       │    └─── #3           lane 1
 *       └─── #5                lane 2
 * ```
 */
function smallTree() {
  const g = crafted({}, [
    { parent: null, board: EMPTY },
    { parent: 0, board: EMPTY },
    { parent: 1, board: EMPTY },
    { parent: 1, board: EMPTY },
    { parent: 2, board: EMPTY },
    { parent: 0, board: EMPTY },
  ]);
  const model = buildGraph(g.state);
  expect(model.nodes.map((n) => [n.id, n.step, n.lane])).toEqual([
    [0, 0, 0],
    [1, 1, 0],
    [2, 2, 0],
    [3, 2, 1],
    [4, 3, 0],
    [5, 1, 2],
  ]);
  return model;
}

describe('moveFocus', () => {
  const model = smallTree();

  it('← goes to the parent', () => {
    expect(moveFocus(model, 4, 'ArrowLeft')).toBe(2);
    expect(moveFocus(model, 3, 'ArrowLeft')).toBe(1);
    expect(moveFocus(model, 5, 'ArrowLeft')).toBe(0);
    expect(moveFocus(model, 0, 'ArrowLeft')).toBeNull();
  });

  it('→ goes to the first child', () => {
    expect(moveFocus(model, 0, 'ArrowRight')).toBe(1);
    expect(moveFocus(model, 1, 'ArrowRight')).toBe(2);
    expect(moveFocus(model, 4, 'ArrowRight')).toBeNull();
    expect(moveFocus(model, 3, 'ArrowRight')).toBeNull();
  });

  it('↓ goes to the lane below, at the closest step', () => {
    expect(moveFocus(model, 4, 'ArrowDown')).toBe(3);
    expect(moveFocus(model, 0, 'ArrowDown')).toBe(3);
    expect(moveFocus(model, 3, 'ArrowDown')).toBe(5);
    expect(moveFocus(model, 5, 'ArrowDown')).toBeNull();
  });

  it('↑ goes to the lane above, at the closest step', () => {
    expect(moveFocus(model, 5, 'ArrowUp')).toBe(3);
    expect(moveFocus(model, 3, 'ArrowUp')).toBe(2);
    expect(moveFocus(model, 0, 'ArrowUp')).toBeNull();
  });

  it('returns null for an unknown node', () => {
    expect(moveFocus(model, 99, 'ArrowUp')).toBeNull();
  });
});

describe('graphCommand', () => {
  it('maps the documented keys', () => {
    expect(graphCommand('ArrowUp')).toEqual({ kind: 'move', key: 'ArrowUp' });
    expect(graphCommand('Enter')).toEqual({ kind: 'activate' });
    expect(graphCommand(' ')).toEqual({ kind: 'activate' });
    expect(graphCommand('n')).toEqual({ kind: 'next' });
    expect(graphCommand('N')).toEqual({ kind: 'next' });
    expect(graphCommand('f')).toEqual({ kind: 'fit' });
    expect(graphCommand('+')).toEqual({ kind: 'zoomIn' });
    expect(graphCommand('=')).toEqual({ kind: 'zoomIn' });
    expect(graphCommand('-')).toEqual({ kind: 'zoomOut' });
    expect(graphCommand('l')).toEqual({ kind: 'links' });
    expect(graphCommand('g')).toEqual({ kind: 'switchView' });
  });

  it('ignores other keys and modified keys', () => {
    expect(graphCommand('x')).toBeNull();
    expect(graphCommand('Escape')).toBeNull();
    expect(graphCommand('F5')).toBeNull();
    expect(graphCommand('f', { ctrl: true })).toBeNull();
    expect(graphCommand('n', { meta: true })).toBeNull();
  });
});
