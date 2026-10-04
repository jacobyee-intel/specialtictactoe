import { describe, expect, it } from 'vitest';
import { canEndTurn, headStatus, missingHeads } from '@/engine';
import { threeHeads } from './fixtures';
import { scenario } from './helpers';

describe('split (test 7)', () => {
  it('makes two identical children at T+1; the opponent must act in both', () => {
    const g = scenario();
    const [a, b] = g.split(g.root);
    for (const id of [a, b]) {
      expect(g.node(id)).toMatchObject({ parent: 0, step: 1, terminal: null, received: null });
      expect(g.node(id).origin).toEqual({ kind: 'split' });
      expect(g.node(id).board).toEqual(g.node(0).board);
    }
    expect(g.state.preview.live).toBe(2);
    expect(headStatus(g.state, a)).toBe('draftCreated');
    g.endTurn();
    expect(g.state.current).toBe(1);
    expect(g.heads()).toEqual([a, b]);
    g.place(a, g.c(1, 1, 1));
    expect(missingHeads(g.state)).toEqual([b]);
    expect(canEndTurn(g.state)).toBe(false);
    expect(() => g.endTurn()).toThrow(/turnIncomplete/);
    g.place(b, g.c(0, 0, 0));
    expect(canEndTurn(g.state)).toBe(true);
    g.endTurn();
    expect(g.heads()).toHaveLength(2);
  });
});

describe('split after a transfer (test 8)', () => {
  it('both children contain the received mark', () => {
    const { g, s, x, y } = threeHeads();
    const cell = g.c(2, 0, 0);
    g.transfer(s, g.c(0, 0, 0), x, cell);
    const [a, b] = g.split(x);
    for (const id of [a, b]) {
      expect(g.node(id).board[cell]).toBe(1);
      expect(g.node(id).received).toEqual({ cell, from: s });
      expect(g.node(id).terminal).toBeNull();
    }
    expect(g.node(x).board[cell]).toBe(0);
    g.place(y, g.c(2, 2, 0));
    g.endTurn();
    expect(g.state.nodes[a]?.board[cell]).toBe(1);
    expect(g.heads()).toContain(b);
  });
});
