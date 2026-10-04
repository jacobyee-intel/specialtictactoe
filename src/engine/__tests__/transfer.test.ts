import { describe, expect, it } from 'vitest';
import {
  canEndTurn,
  emptyCells,
  hasIncoming,
  headStatus,
  incomingOf,
  legalActionKinds,
  sendableCells,
  transferTargets,
} from '@/engine';
import { threeHeads } from './fixtures';
import { DRAWN_444, crafted, scenario, setCell } from './helpers';

describe('parallel transfer (test 12)', () => {
  it('creates S′ without the mark; X shows it pending and its next child has both marks', () => {
    const { g, s, x, y } = threeHeads();
    const from = g.c(0, 0, 0);
    const to = g.c(1, 1, 1);
    expect(transferTargets(g.state, s).map((t) => t.node)).toEqual([x, y]);
    const { source, win } = g.transfer(s, from, x, to);
    expect(win).toBeNull();
    expect(g.node(source)).toMatchObject({ parent: s, step: 5, terminal: null });
    expect(g.node(source).origin).toEqual({
      kind: 'transferSource',
      cell: from,
      to: x,
      toCell: to,
    });
    expect(g.node(source).board[from]).toBe(0);
    expect(hasIncoming(g.state, x)).toBe(true);
    expect(incomingOf(g.state, x)).toEqual({ cell: to, from: s });
    expect(incomingOf(g.state, y)).toBeNull();
    expect(g.node(x).board[to]).toBe(0);
    expect(emptyCells(g.state, x)).not.toContain(to);
    expect(headStatus(g.state, x)).toBe('needsAction');
    expect(headStatus(g.state, s)).toBe('acted');
    expect(transferTargets(g.state, y)).toEqual([]);
    expect(g.tree()).toContain(`⇐c${to} from #${s}`);

    const placed = g.c(2, 0, 0);
    const child = g.place(x, placed);
    expect(g.node(child).board[to]).toBe(1);
    expect(g.node(child).board[placed]).toBe(1);
    expect(g.node(child).received).toEqual({ cell: to, from: s });
    expect(g.node(child).terminal).toBeNull();
    expect(g.tree()).toContain(`recv c${to}←#${s}`);
    g.place(y, g.c(2, 2, 0));
    g.endTurn();
    expect(g.state.nodes[child]?.board[to]).toBe(1);
    expect(hasIncoming(g.state, x)).toBe(false);
  });

  it('a place can win through the received mark', () => {
    const { g, s, x, y } = threeHeads();
    g.transfer(s, g.c(0, 0, 0), y, g.c(1, 0, 0));
    const won = g.place(y, g.c(2, 0, 0));
    expect(g.node(won).terminal).toMatchObject({ kind: 'win', winner: 0 });
    g.place(x, g.c(1, 1, 0));
    expect(canEndTurn(g.state)).toBe(true);
  });
});

describe('transfer rejections (test 13)', () => {
  const xfer = (head: number, fromCell: number, targetHead: number, toCell: number) =>
    ({ kind: 'transfer', head, fromCell, targetHead, toCell }) as const;

  it('rejects bad targets and cells', () => {
    const { g, s, x } = threeHeads();
    const mine = g.c(0, 0, 0);
    const empty = g.c(1, 1, 1);
    expect(g.rejects(xfer(s, mine, s, empty))).toBe('sameHead');
    expect(g.rejects(xfer(s, mine, x, g.c(0, 0, 2)))).toBe('cellOccupied');
    expect(g.rejects(xfer(s, mine, x, 27))).toBe('badCell');
    expect(g.rejects(xfer(s, g.c(0, 0, 2), x, empty))).toBe('notOwnMark');
    expect(g.rejects(xfer(s, mine, 99, empty))).toBe('unknownNode');
    expect(g.rejects(xfer(s, mine, 0, empty))).toBe('targetNotRequired');
  });

  it('rejects a target that already acted or already has an incoming mark', () => {
    const { g, s, x, y } = threeHeads();
    g.place(x, g.c(2, 2, 0));
    expect(g.rejects(xfer(s, g.c(0, 0, 0), x, g.c(1, 1, 1)))).toBe('targetActed');
    g.transfer(s, g.c(0, 0, 0), y, g.c(2, 1, 0));
    g.undo();
    g.clear();
    g.transfer(y, g.c(0, 0, 0), s, g.c(2, 1, 0));
    expect(g.rejects(xfer(x, g.c(0, 0, 0), s, g.c(1, 1, 1)))).toBe('targetHasIncoming');
  });

  it('rejects re-sending a received mark, by transfer or by time travel', () => {
    const { g, s, x, y } = threeHeads();
    const received = g.c(2, 1, 0);
    g.transfer(s, g.c(0, 0, 0), x, received);
    expect(g.rejects(xfer(x, received, y, g.c(1, 2, 0)))).toBe('receivedThisTurn');
    expect(
      g.rejects({ kind: 'timeTravel', head: x, fromCell: received, target: 0, toCell: 4 }),
    ).toBe('receivedThisTurn');
    expect(sendableCells(g.state, x)).toEqual([g.c(0, 0, 0)]);
  });

  it('rejects heads at different steps', () => {
    // P2 time-travels from n3 to n1, leaving P1 heads at steps 4 and 2.
    const g = scenario();
    const [n1, , n3] = g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(2, 2, 2));
    const { source, arrival } = g.timeTravel(
      n3 as number,
      g.c(0, 0, 2),
      n1 as number,
      g.c(1, 2, 1),
    );
    g.endTurn();
    expect(g.heads()).toEqual([source, arrival]);
    expect(g.node(source).step).toBe(4);
    expect(g.node(arrival).step).toBe(2);
    expect(g.rejects(xfer(source, g.c(0, 0, 0), arrival, g.c(1, 1, 1)))).toBe('stepMismatch');
    expect(transferTargets(g.state, source)).toEqual([]);
    expect(legalActionKinds(g.state, source).transfer).toMatchObject({
      ok: false,
      reason: 'noTarget',
    });
  });
});

describe('transfer win (test 14)', () => {
  it('X′ is terminal, X counts as acted, and X takes no further action', () => {
    const { g, s, x, y } = threeHeads();
    const { source, win } = g.transfer(s, g.c(0, 0, 0), y, g.c(1, 1, 1));
    expect(win).not.toBeNull();
    const X = g.node(win as number);
    expect(X).toMatchObject({ parent: y, step: 5, received: null });
    expect(X.terminal).toMatchObject({ kind: 'win', winner: 0 });
    expect(X.origin).toEqual({ kind: 'transferWin', cell: g.c(1, 1, 1), from: s });
    expect(g.node(source).terminal).toBeNull();
    expect(headStatus(g.state, y)).toBe('acted');
    expect(headStatus(g.state, win as number)).toBe('frozen');
    expect(g.rejects({ kind: 'place', head: y, cell: g.c(2, 1, 0) })).toBe('alreadyActed');
    expect(g.rejects({ kind: 'split', head: y })).toBe('alreadyActed');
    expect(legalActionKinds(g.state, y).place).toMatchObject({ ok: false, reason: 'alreadyActed' });
    g.place(x, g.c(2, 1, 0));
    g.endTurn();
    expect(g.state.score).toEqual([1, 0]);
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: win });
  });
});

describe('chained transfers (test 15)', () => {
  it('X may receive a mark and then transfer a different mark of its own to Y', () => {
    const { g, s, x, y } = threeHeads();
    const received = g.c(1, 0, 0);
    g.transfer(s, g.c(0, 0, 0), x, received);
    const { source } = g.transfer(x, g.c(0, 0, 0), y, g.c(2, 0, 0));
    // X′ keeps the received mark but not the one it sent on.
    expect(g.node(source).board[received]).toBe(1);
    expect(g.node(source).board[g.c(0, 0, 0)]).toBe(0);
    expect(g.node(source).received).toEqual({ cell: received, from: s });
    // Y now holds (0,0,0), (2,2,2) and the incoming (2,0,0): placing (1,0,0) wins the row.
    const won = g.place(y, g.c(1, 0, 0));
    expect(g.node(won).terminal).toMatchObject({ kind: 'win', winner: 0 });
    expect(canEndTurn(g.state)).toBe(true);
  });
});

describe('a received mark that fills the board (test 16)', () => {
  it('is a draw and the opponent owes the send-back', () => {
    // n1 -(split)-> sa, sb, both one cell (e) short of the drawn board.
    const e = DRAWN_444.indexOf('1');
    const f = DRAWN_444.indexOf('2');
    const near = setCell(DRAWN_444, e, 0);
    const g = crafted({ n: 4, m: 4 }, [
      { parent: null, board: setCell(near, f, 0) },
      { parent: 0, board: near },
      { parent: 1, board: near },
      { parent: 1, board: near },
    ]);
    // Steps 0, 1, 2, 2: nodes 2 and 3 are P1's heads.
    expect(g.heads()).toEqual([2, 3]);
    const mine = DRAWN_444.lastIndexOf('1');
    const { win } = g.transfer(2, mine, 3, e);
    expect(g.node(win as number).terminal).toEqual({ kind: 'draw', filler: 0 });
    expect(canEndTurn(g.state)).toBe(true);
    g.endTurn();
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: win });
    expect(g.state.score).toEqual([0, 0]);
  });
});
