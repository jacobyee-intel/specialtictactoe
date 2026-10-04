import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  countLive,
  effectiveBoard,
  emptyCells,
  headStatus,
  headsOf,
  hotSeat,
  isHead,
  isStrictAncestor,
  legalActionKinds,
  nodeAt,
  parityPlayer,
  printTree,
  sendableCells,
  strictAncestors,
  timeTravelTargets,
  transferTargets,
} from '@/engine';
import { threeHeads } from './fixtures';
import { crafted, scenario, setCell } from './helpers';

describe('tree helpers', () => {
  it('walk ancestry and find heads', () => {
    const { g, s, x, y } = threeHeads();
    const t = g.state;
    expect(strictAncestors(t, s)).toEqual([4, 2, 1, 0]);
    expect(isStrictAncestor(t, 0, s)).toBe(true);
    expect(isStrictAncestor(t, s, s)).toBe(false);
    expect(isStrictAncestor(t, x, s)).toBe(false);
    expect(headsOf(t)).toEqual([s, x, y]);
    expect(headsOf(t, 1)).toEqual([]);
    expect(countLive(t)).toBe(3);
    expect(isHead(t, s)).toBe(true);
    expect(isHead(t, 0)).toBe(false);
    expect(childrenOf(t, 99)).toEqual([]);
    expect(parityPlayer(7)).toBe(1);
    expect(() => nodeAt(t, 99)).toThrow(RangeError);
    expect(() => headStatus(t, 99)).toThrow(RangeError);
  });

  it('effectiveBoard adds the received mark only', () => {
    const { g, s, x } = threeHeads();
    expect(effectiveBoard(g.node(x), g.state.preview.ledger)).toBe(g.node(x).board);
    g.transfer(s, g.c(0, 0, 0), x, 13);
    const eff = effectiveBoard(g.node(x), g.state.preview.ledger);
    expect(eff[13]).toBe(1);
    expect(g.node(x).board[13]).toBe(0);
  });

  it('printTree draws every origin and status', () => {
    const { g, s, x, y } = threeHeads();
    g.transfer(s, g.c(0, 0, 0), x, g.c(1, 0, 0));
    g.place(x, g.c(2, 2, 0));
    g.timeTravel(y, g.c(2, 2, 2), 0, g.c(1, 1, 1));
    expect(g.tree()).toBe(
      [
        'round 3 · P1 to move · draft · score 0–0 · live 4/32',
        '#0 s0 P1 root',
        '├─ #1 s1 P2 place c0',
        '│  ├─ #2 s2 P1 split',
        '│  │  ├─ #4 s3 P2 split',
        '│  │  │  └─ #7 s4 P1 place c18 [acted]',
        '│  │  │     └─ #10 s5 P2 xfer-src -c0 →#8:c1 +draft',
        '│  │  └─ #5 s3 P2 split',
        '│  │     └─ #8 s4 P1 place c18 ⇐c1 from #7 [acted]',
        '│  │        └─ #11 s5 P2 place c8 recv c1←#7 +draft',
        '│  └─ #3 s2 P1 split',
        '│     └─ #6 s3 P2 place c26',
        '│        └─ #9 s4 P1 place c18 [acted]',
        '│           └─ #12 s5 P2 tt-src -c26 →#13 +draft',
        '└─ #13 s1 P2 tt-arr +c13 ←#12 +draft',
      ].join('\n'),
    );
  });

  it('printTree shows transfer wins and send-backs', () => {
    const { g, s, y } = threeHeads();
    g.transfer(s, g.c(0, 0, 0), y, g.c(1, 1, 1));
    expect(g.tree()).toContain(`xfer-win +c13 ←#${s} WON P1 line`);
  });
});

describe('UI queries', () => {
  it('report statuses for every kind of node', () => {
    const { g, s, x, y } = threeHeads();
    const { win } = g.transfer(s, g.c(0, 0, 0), y, g.c(1, 1, 1));
    expect(headStatus(g.state, 0)).toBe('history');
    expect(headStatus(g.state, s)).toBe('acted');
    expect(headStatus(g.state, x)).toBe('needsAction');
    expect(headStatus(g.state, win as number)).toBe('frozen');
    g.place(x, 4);
    g.endTurn();
    expect(headStatus(g.state, win as number)).toBe('won');
    expect(headStatus(g.state, 0)).toBe('history');
    expect(hotSeat(g.state)).toBe(1);
  });

  it('offer place and split at the start, but nothing to send', () => {
    const g = scenario();
    const kinds = legalActionKinds(g.state, 0);
    expect(kinds.place).toEqual({ ok: true });
    expect(kinds.split).toEqual({ ok: true });
    expect(kinds.timeTravel).toMatchObject({ ok: false, reason: 'notOwnMark' });
    expect(kinds.transfer).toMatchObject({ ok: false, reason: 'notOwnMark' });
    expect(sendableCells(g.state, 0)).toEqual([]);
    expect(emptyCells(g.state, 0)).toHaveLength(27);
    expect(transferTargets(g.state, 99)).toEqual([]);
    expect(timeTravelTargets(g.state, 99, 0)).toEqual([]);
    g.place(0, 4);
    expect(legalActionKinds(g.state, 0).split).toMatchObject({ reason: 'alreadyActed' });
    expect(sendableCells(g.state, 0)).toEqual([]);
  });

  it('explain a time travel with nowhere to go', () => {
    // A crafted root that already holds a P1 mark has no ancestors to travel to.
    const g = crafted({}, [{ parent: null, board: setCell('0'.repeat(27), 5, 1) }]);
    expect(sendableCells(g.state, 0)).toEqual([5]);
    expect(legalActionKinds(g.state, 0).timeTravel).toMatchObject({ reason: 'noTarget' });
    expect(legalActionKinds(g.state, 0).transfer).toMatchObject({ reason: 'noTarget' });
  });

  it('agree with printTree on the phase header during a prompt', () => {
    const g = scenario();
    g.concede(0);
    expect(printTree(g.state)).toContain('over: P2 wins (concede)');
    expect(headStatus(g.state, 0)).toBe('waiting');
  });
});
