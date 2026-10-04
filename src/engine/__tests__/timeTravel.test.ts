import { describe, expect, it } from 'vitest';
import { headStatus, sendBackTargets, timeTravelTargets } from '@/engine';
import { longLine, threeHeads } from './fixtures';

describe('time travel (test 9)', () => {
  it('H′ lacks the mark and A′ = A + mark at A.step+1; both are the opponent’s move', () => {
    const { g, n } = longLine();
    const head = n[6] as number;
    const target = n[2] as number;
    const from = g.c(0, 0, 0);
    const to = g.c(2, 1, 1);
    const { source, arrival } = g.timeTravel(head, from, target, to);
    const H = g.node(source);
    const A = g.node(arrival);
    expect(H).toMatchObject({ parent: head, step: 7, terminal: null });
    expect(H.origin).toEqual({ kind: 'ttSource', cell: from, arrival });
    expect(H.board[from]).toBe(0);
    expect([...H.board].filter((v, c) => v !== g.node(head).board[c])).toEqual([0]);
    expect(A).toMatchObject({ parent: target, step: 3, terminal: null });
    expect(A.origin).toEqual({ kind: 'ttArrival', cell: to, source });
    expect(A.board[to]).toBe(1);
    expect([...A.board].filter((v, c) => v !== g.node(target).board[c])).toEqual([1]);
    // Both new nodes are at odd steps: P2 is to move there next turn.
    expect(H.step % 2).toBe(1);
    expect(A.step % 2).toBe(1);
    expect(g.state.preview.live).toBe(2);
    expect(g.tree()).toContain(`tt-src -c${from} →#${arrival}`);
    expect(g.tree()).toContain(`tt-arr +c${to} ←#${source}`);
    g.endTurn();
    expect(g.heads()).toEqual([source, arrival]);
  });

  it('lists the legal targets: P1-parity strict ancestors with their empty cells', () => {
    const { g, n } = longLine();
    const targets = timeTravelTargets(g.state, n[6] as number, g.c(0, 0, 0));
    expect(targets.map((t) => t.node)).toEqual([n[0], n[2], n[4]]);
    expect(targets[0]?.cells).toHaveLength(27);
    expect(targets[2]?.cells).toHaveLength(23);
    expect(timeTravelTargets(g.state, n[6] as number, g.c(0, 0, 2))).toEqual([]);
    expect(timeTravelTargets(g.state, n[5] as number, g.c(0, 0, 0))).toEqual([]);
  });
});

describe('time travel rejections (test 10)', () => {
  it('rejects bad targets, cells, and marks', () => {
    const { g, n } = longLine();
    const head = n[6] as number;
    const tt = (fromCell: number, target: number, toCell: number) =>
      g.rejects({ kind: 'timeTravel', head, fromCell, target, toCell });
    const mine = g.c(0, 0, 0);
    const empty = g.c(2, 1, 1);
    expect(tt(mine, head, empty)).toBe('notAncestor');
    expect(tt(mine, 99, empty)).toBe('unknownNode');
    expect(tt(mine, n[3] as number, empty)).toBe('targetWrongParity');
    expect(tt(mine, n[2] as number, g.c(0, 0, 2))).toBe('cellOccupied');
    expect(tt(mine, n[2] as number, 99)).toBe('badCell');
    expect(tt(g.c(0, 0, 2), n[2] as number, empty)).toBe('notOwnMark');
    expect(tt(empty, n[2] as number, empty)).toBe('notOwnMark');
    expect(tt(-3, n[2] as number, empty)).toBe('notOwnMark');
  });

  it('rejects a target on another branch and a mark received this turn', () => {
    const { g, s, x, y } = threeHeads();
    const tt = (head: number, fromCell: number, target: number) =>
      g.rejects({ kind: 'timeTravel', head, fromCell, target, toCell: g.c(1, 2, 1) });
    expect(tt(s, g.c(0, 0, 0), x)).toBe('notAncestor');
    // y's parent chain does not include s's parent.
    expect(tt(y, g.c(0, 0, 0), g.node(s).parent as number)).toBe('notAncestor');
    const received = g.c(2, 1, 0);
    g.transfer(s, g.c(0, 0, 0), x, received);
    expect(tt(x, received, 0)).toBe('receivedThisTurn');
    // x's own committed mark may still travel.
    g.timeTravel(x, g.c(0, 0, 0), 0, g.c(1, 1, 1));
  });
});

describe('time-travel win (test 11)', () => {
  it('an arrival that completes a line wins; the opponent sends back at resolve', () => {
    const { g, n } = longLine();
    const { source, arrival } = g.timeTravel(
      n[6] as number,
      g.c(1, 1, 1),
      n[4] as number,
      g.c(2, 0, 0),
    );
    expect(g.node(arrival).terminal).toMatchObject({ kind: 'win', winner: 0 });
    expect(g.node(source).terminal).toBeNull();
    expect(headStatus(g.state, arrival)).toBe('frozen');
    expect(g.state.preview.live).toBe(1);
    g.endTurn();
    expect(g.state.score).toEqual([1, 0]);
    expect(g.state.phase).toBe('awaitSendBack');
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: arrival });
    expect(sendBackTargets(g.state).map((t) => t.node)).toEqual([n[1], n[3]]);
    const sb = g.sendBack(n[3] as number, g.c(2, 2, 0));
    expect(g.state.phase).toBe('draft');
    expect(g.state.current).toBe(1);
    expect(g.heads()).toEqual([source]);
    expect(g.heads(0)).toEqual([sb]);
  });
});
