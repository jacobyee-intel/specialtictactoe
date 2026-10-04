import { describe, expect, it } from 'vitest';
import { completesLine, isFull } from '@/geometry';
import { emptyCells, headStatus, missingHeads } from '@/engine';
import { DRAWN_444, crafted, scenario, setCell } from './helpers';

/** P1 builds the row y=0,z=0; P2 builds y=0,z=2. After four turns P1 threatens (2,0,0). */
function threat() {
  const g = scenario();
  const nodes = g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2));
  return { g, nodes, head: nodes[3] as number };
}

describe('place (test 3)', () => {
  it('creates a child at T+1 and the parent stops being a head', () => {
    const g = scenario();
    const child = g.place(g.root, g.c(1, 1, 1));
    expect(child).toBe(1);
    expect(g.node(child)).toMatchObject({ parent: 0, step: 1, terminal: null, round: 1 });
    expect(g.node(child).origin).toEqual({ kind: 'place', cell: g.c(1, 1, 1) });
    expect(g.node(child).board[g.c(1, 1, 1)]).toBe(1);
    expect(g.node(0).board[g.c(1, 1, 1)]).toBe(0);
    expect(g.state.preview.children[0]).toEqual([1]);
    expect(headStatus(g.state, 0)).toBe('acted');
    expect(headStatus(g.state, child)).toBe('draftCreated');
    expect(g.state.nodes).toHaveLength(1);
    expect(g.state.preview.live).toBe(1);

    g.endTurn();
    expect(g.state.nodes).toHaveLength(2);
    expect(g.state.current).toBe(1);
    expect(g.heads()).toEqual([1]);
    expect(headStatus(g.state, 0)).toBe('history');
    expect(headStatus(g.state, 1)).toBe('needsAction');
    expect(emptyCells(g.state, 1)).toHaveLength(26);
  });
});

describe('place rejections (test 4)', () => {
  it('rejects an occupied cell, a second action on a head, and bad ids', () => {
    const { g, head } = threat();
    expect(g.rejects({ kind: 'place', head, cell: g.c(0, 0, 0) })).toBe('cellOccupied');
    expect(g.rejects({ kind: 'place', head, cell: g.c(0, 0, 2) })).toBe('cellOccupied');
    expect(g.rejects({ kind: 'place', head, cell: 27 })).toBe('badCell');
    expect(g.rejects({ kind: 'place', head, cell: -1 })).toBe('badCell');
    expect(g.rejects({ kind: 'place', head, cell: 1.5 })).toBe('badCell');
    expect(g.rejects({ kind: 'place', head: 99, cell: 0 })).toBe('unknownNode');
    expect(g.rejects({ kind: 'place', head: -1, cell: 0 })).toBe('unknownNode');
    const child = g.place(head, g.c(1, 1, 1));
    expect(g.rejects({ kind: 'place', head, cell: g.c(2, 2, 2) })).toBe('alreadyActed');
    expect(g.rejects({ kind: 'split', head })).toBe('alreadyActed');
    // A node created by this draft can only act next turn.
    expect(g.rejects({ kind: 'place', head: child, cell: g.c(2, 2, 2) })).toBe('notHead');
  });

  it('rejects a history node', () => {
    const { g } = threat();
    expect(g.rejects({ kind: 'place', head: g.root, cell: g.c(2, 2, 2) })).toBe('notHead');
    expect(g.rejects({ kind: 'split', head: 2 })).toBe('notHead');
  });

  it('rejects a head where the other player is to move', () => {
    // P2 splits; P1 wins one copy; P2's send-back creates a P1 head while P2 is to move.
    const g = scenario();
    const [, , n3] = g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0));
    const [a, b] = g.split(n3 as number);
    g.endTurn();
    g.place(a, g.c(2, 0, 0));
    g.place(b, g.c(1, 1, 1));
    g.endTurn();
    expect(g.state.phase).toBe('awaitSendBack');
    const sb = g.sendBack(1, g.c(2, 2, 2));
    expect(g.state.current).toBe(1);
    expect(g.node(sb).step % 2).toBe(0);
    expect(headStatus(g.state, sb)).toBe('waiting');
    expect(g.rejects({ kind: 'place', head: sb, cell: g.c(1, 1, 1) })).toBe('wrongParity');
  });
});

describe('winning and drawing in the draft (tests 5, 6)', () => {
  it('a completed line freezes the child; the score changes only at End Turn', () => {
    const { g, head } = threat();
    const won = g.place(head, g.c(2, 0, 0));
    expect(g.node(won).terminal).toEqual({ kind: 'win', winner: 0, lineId: expect.any(Number) });
    expect(headStatus(g.state, won)).toBe('frozen');
    expect(g.state.preview.live).toBe(0);
    expect(g.state.score).toEqual([0, 0]);
    expect(g.tree()).toContain('WON P1');
    expect(g.tree()).toContain('(frozen)');
    g.endTurn();
    expect(g.state.score).toEqual([1, 0]);
    expect(headStatus(g.state, won)).toBe('won');
    expect(g.tree()).toMatch(/WON P1 line \d+ ★/);
  });

  it('the drawn fixture really has no line', () => {
    const g = crafted({ n: 4, m: 4 }, [{ parent: null, board: DRAWN_444 }]);
    const board = g.node(0).board;
    expect(isFull(board)).toBe(true);
    for (let c = 0; c < 64; c++) {
      expect(completesLine(board, c, ((board[c] as number) - 1) as 0 | 1, g.state.lines)).toBe(-1);
    }
  });

  it('filling the board without a line is a draw; the non-filler owes the send-back', () => {
    // root -(P1 places g)-> n1 -(P2 places f)-> n2; P1 fills the last cell e of n2.
    const e = DRAWN_444.indexOf('1');
    const f = DRAWN_444.indexOf('2');
    const g0 = DRAWN_444.lastIndexOf('1');
    const n2 = setCell(DRAWN_444, e, 0);
    const n1 = setCell(n2, f, 0);
    const root = setCell(n1, g0, 0);
    const g = crafted({ n: 4, m: 4 }, [
      { parent: null, board: root },
      { parent: 0, board: n1 },
      { parent: 1, board: n2 },
    ]);
    expect(missingHeads(g.state)).toEqual([2]);
    const drawn = g.place(2, e);
    expect(g.node(drawn).terminal).toEqual({ kind: 'draw', filler: 0 });
    expect(headStatus(g.state, drawn)).toBe('frozen');
    expect(g.tree()).toContain('DRAWN by P1 (frozen)');
    g.endTurn();
    expect(headStatus(g.state, drawn)).toBe('drawn');
    expect(g.state.score).toEqual([0, 0]);
    expect(g.state.phase).toBe('awaitSendBack');
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: drawn });
    expect(g.state.events.at(-2)).toEqual({ type: 'timelineDrawn', node: drawn, filler: 0 });
  });
});
