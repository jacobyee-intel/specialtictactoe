import { describe, expect, it } from 'vitest';
import type { NodeId } from '@/engine';
import { scenario } from '@/engine/__tests__/helpers';
import { threeHeads } from '@/engine/__tests__/fixtures';
import { crossLinks } from './links';

/** P1 placed (1,1,1) on the root; P2 split it into `a` and `b` (P1 to move, step 2). */
function twoHeads() {
  const g = scenario();
  const [n1] = g.line(g.c(1, 1, 1));
  const [a, b] = g.split(n1 as NodeId);
  g.endTurn();
  return { g, a, b };
}

describe('crossLinks', () => {
  it('draws nothing for places and splits', () => {
    const { g, a, b } = twoHeads();
    g.place(a, g.c(0, 0, 0));
    g.split(b);
    expect(crossLinks(g.state)).toEqual([]);
    g.endTurn();
    expect(crossLinks(g.state)).toEqual([]);
  });

  it('links a time travel from the head whose mark left to the arrival', () => {
    const g = scenario();
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const { arrival } = g.timeTravel(n2 as NodeId, g.c(1, 1, 1), 0, g.c(2, 2, 2));
    const link = { kind: 'timeTravel', from: n2, to: arrival, player: 0, cell: g.c(2, 2, 2) };
    expect(crossLinks(g.state)).toEqual([{ ...link, draft: true }]);
    g.endTurn();
    expect(crossLinks(g.state)).toEqual([{ ...link, draft: false }]);
  });

  it('links a transfer to the receiving head, then to its child carrying the mark', () => {
    const { g, a, b } = twoHeads();
    g.transfer(a, g.c(1, 1, 1), b, g.c(2, 0, 0));
    const link = { kind: 'transfer', from: a, player: 0, cell: g.c(2, 0, 0), draft: true };
    expect(crossLinks(g.state)).toEqual([{ ...link, to: b }]);
    const b1 = g.place(b, g.c(0, 2, 0));
    expect(crossLinks(g.state)).toEqual([{ ...link, to: b1 }]);
    g.endTurn();
    expect(crossLinks(g.state)).toEqual([{ ...link, to: b1, draft: false }]);
  });

  it('points a transfer into a split at the first child (both carry the mark)', () => {
    const { g, a, b } = twoHeads();
    g.transfer(a, g.c(1, 1, 1), b, g.c(2, 0, 0));
    const [b1, b2] = g.split(b);
    expect(g.node(b2).received?.from).toBe(a);
    expect(crossLinks(g.state)).toEqual([
      { kind: 'transfer', from: a, to: b1, player: 0, cell: g.c(2, 0, 0), draft: true },
    ]);
  });

  it('draws one link when the received mark alone ends the timeline', () => {
    const { g, s, y } = threeHeads();
    const { win } = g.transfer(s, g.c(0, 0, 0), y, g.c(1, 1, 1));
    expect(win).not.toBeNull();
    expect(g.node(win as NodeId).origin.kind).toBe('transferWin');
    expect(crossLinks(g.state)).toEqual([
      { kind: 'transfer', from: s, to: win, player: 0, cell: g.c(1, 1, 1), draft: true },
    ]);
  });

  it('links each forced send-back of a chain from the terminal, in the sender’s colour', () => {
    const g = scenario();
    const moves = [
      g.c(0, 0, 0),
      g.c(0, 0, 2),
      g.c(1, 0, 0),
      g.c(1, 0, 2),
      g.c(1, 1, 0),
      g.c(0, 2, 2),
      g.c(1, 2, 0),
    ];
    const line = g.line(...moves);
    const won = line.at(-1) as NodeId;
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: won });
    const first = g.sendBack(line[4] as NodeId, g.c(2, 0, 2));
    expect(crossLinks(g.state)).toEqual([
      { kind: 'sendBack', from: won, to: first, player: 1, cell: g.c(2, 0, 2), draft: false },
    ]);
    // That send-back completed Player 2's row, so Player 1 owes the next one.
    expect(g.state.pendingSendBack).toEqual({ player: 0, terminal: first });
    const second = g.sendBack(line[3] as NodeId, g.c(2, 0, 0));
    expect(crossLinks(g.state).at(-1)).toEqual({
      kind: 'sendBack',
      from: first,
      to: second,
      player: 0,
      cell: g.c(2, 0, 0),
      draft: false,
    });
  });
});
