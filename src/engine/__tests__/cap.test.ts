import { describe, expect, it } from 'vitest';
import { legalActionKinds, liveTimelines, timeTravelTargets } from '@/engine';
import { scenario } from './helpers';

/** Cap 3: P1 has three heads (n5, n6, n7 at step 4) and the count is exactly 3. */
function atCap() {
  const g = scenario({ maxTimelines: 3 });
  const [, n2] = g.line(g.c(0, 0, 0), g.c(0, 0, 2));
  const [n3, n4] = g.split(n2 as number);
  g.endTurn();
  const n5 = g.place(n3, g.c(2, 2, 2));
  const [n6, n7] = g.split(n4);
  g.endTurn();
  return { g, n5, n6, n7 };
}

/**
 * Cap 2: after a1 b1 a2 b2 a3 on one timeline, P2 split n5 into p and q (step 6), so the count is
 * 2. n4 holds P1's open threat at (2,0,0); n5 holds P2's at (2,0,2).
 */
function capTwo() {
  const g = scenario({ maxTimelines: 2 });
  const n = [
    0,
    ...g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2), g.c(1, 1, 1)),
  ] as number[];
  const [p, q] = g.split(n[5] as number);
  g.endTurn();
  return { g, n, p, q };
}

describe('timeline cap (test 29)', () => {
  it('blocks split and time travel at the cap but not place or transfer', () => {
    const { g, n5, n6, n7 } = atCap();
    expect(liveTimelines(g.state)).toBe(3);
    expect(g.rejects({ kind: 'split', head: n5 })).toBe('timelineCap');
    expect(
      g.rejects({ kind: 'timeTravel', head: n5, fromCell: g.c(0, 0, 0), target: 0, toCell: 13 }),
    ).toBe('timelineCap');
    const kinds = legalActionKinds(g.state, n5);
    expect(kinds.split).toMatchObject({ ok: false, reason: 'timelineCap' });
    expect(kinds.split).toMatchObject({
      message: 'That would make 4 live timelines; the cap is 3.',
    });
    expect(kinds.timeTravel).toMatchObject({ ok: false, reason: 'timelineCap' });
    expect(kinds.place).toEqual({ ok: true });
    expect(kinds.transfer).toEqual({ ok: true });
    expect(timeTravelTargets(g.state, n5, g.c(0, 0, 0))).toEqual([]);
    g.place(n5, g.c(1, 1, 1));
    g.transfer(n6, g.c(0, 0, 0), n7, g.c(1, 1, 1));
    g.place(n7, g.c(2, 1, 1));
    expect(liveTimelines(g.state)).toBe(3);
    g.endTurn();
  });
});

describe('time travel that wins at the cap (test 30)', () => {
  it('is allowed, because the arrival adds no live timeline', () => {
    const { g, n, p, q } = capTwo();
    expect(liveTimelines(g.state)).toBe(2);
    expect(g.rejects({ kind: 'split', head: p })).toBe('timelineCap');
    expect(
      g.rejects({ kind: 'timeTravel', head: q, fromCell: g.c(0, 0, 0), target: 0, toCell: 13 }),
    ).toBe('timelineCap');
    // At the cap only the winning cell is offered.
    expect(timeTravelTargets(g.state, p, g.c(1, 1, 1))).toEqual([
      { node: n[4], cells: [g.c(2, 0, 0)] },
    ]);
    expect(legalActionKinds(g.state, p).timeTravel).toEqual({ ok: true });
    const { arrival } = g.timeTravel(p, g.c(1, 1, 1), n[4] as number, g.c(2, 0, 0));
    expect(g.node(arrival).terminal).toMatchObject({ kind: 'win', winner: 0 });
    expect(liveTimelines(g.state)).toBe(2);
  });
});

describe('forced send-backs and the cap (test 31)', () => {
  it('a send-back may exceed the cap; split and time travel stay blocked until there is room', () => {
    const { g, n, p, q } = capTwo();
    const { source } = g.timeTravel(p, g.c(1, 1, 1), n[4] as number, g.c(2, 0, 0));
    g.place(q, g.c(2, 2, 0));
    g.endTurn();
    const sb = g.sendBack(n[3] as number, g.c(2, 2, 2));
    expect(g.state.phase).toBe('draft');
    expect(liveTimelines(g.state)).toBe(3);
    expect(g.state.config.maxTimelines).toBe(2);

    const [p2, q2] = g.heads();
    expect(p2).toBe(source);
    expect(g.heads(0)).toEqual([sb]);
    const winningTT = {
      kind: 'timeTravel',
      head: q2 as number,
      fromCell: g.c(0, 0, 2),
      target: n[5] as number,
      toCell: g.c(2, 0, 2),
    } as const;
    // Over the cap even a time travel that wins at once is blocked: it would leave 3 > 2.
    expect(g.rejects({ kind: 'split', head: q2 as number })).toBe('timelineCap');
    expect(g.rejects(winningTT)).toBe('timelineCap');
    expect(timeTravelTargets(g.state, q2 as number, g.c(0, 0, 2))).toEqual([]);

    // Winning p2 in the draft brings the count down to the cap: the winning time travel fits
    // again, a split (which always adds one) still does not.
    g.place(p2 as number, g.c(2, 0, 2));
    expect(liveTimelines(g.state)).toBe(2);
    expect(g.rejects({ kind: 'split', head: q2 as number })).toBe('timelineCap');
    g.act(winningTT);
    expect(liveTimelines(g.state)).toBe(2);
  });
});

describe('undo frees a slot (test 32)', () => {
  it('undoing a split makes room for another split', () => {
    const g = scenario({ maxTimelines: 3 });
    const [a, b] = g.split(g.root);
    g.endTurn();
    g.split(a);
    expect(liveTimelines(g.state)).toBe(3);
    expect(g.rejects({ kind: 'split', head: b })).toBe('timelineCap');
    g.undo();
    expect(liveTimelines(g.state)).toBe(2);
    g.split(b);
    expect(liveTimelines(g.state)).toBe(3);
    expect(g.rejects({ kind: 'split', head: a })).toBe('timelineCap');
  });
});
