import { describe, expect, it } from 'vitest';
import { scenario } from '@/engine/__tests__/helpers';
import { IDLE, syncFlow, type Flow } from './flow';
import { endTurnBlocker, handoffAfter, nextNeedingAction } from './controller';
import { groupOf, multiverseGroups } from './multiverseModel';

const ids = (groups: ReturnType<typeof multiverseGroups>) =>
  Object.fromEntries(groups.map((g) => [g.id, g.rows.map((r) => r.id)]));

describe('multiverseGroups', () => {
  it('groups nodes by status in id order', () => {
    const g = scenario({ w: 3 });
    const [n1, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    expect(ids(multiverseGroups(g.state, IDLE))).toEqual({
      needs: [n2],
      done: [],
      waiting: [],
      completed: [],
      history: [0, n1],
    });
    const [a, b] = g.split(n2 as number);
    const groups = multiverseGroups(g.state, IDLE);
    expect(ids(groups)).toEqual({
      needs: [],
      done: [n2, a, b],
      waiting: [],
      completed: [],
      history: [0, n1],
    });
    expect(groups.find((x) => x.id === 'history')?.collapsed).toBe(true);
    expect(multiverseGroups(g.state, IDLE, true).find((x) => x.id === 'history')?.collapsed).toBe(
      false,
    );
    const row = groups.find((x) => x.id === 'done')?.rows[1];
    expect(row).toMatchObject({
      id: a,
      step: 3,
      mover: 1,
      status: 'draftCreated',
      origin: `Split of #${n2}`,
    });
  });

  it('lifts the flow targets into a first group while picking and dims the rest', () => {
    const g = scenario({ w: 3 });
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const flow: Flow = {
      kind: 'timeTravel',
      head: n2 as number,
      fromCell: g.c(1, 1, 1),
      target: null,
      cell: null,
    };
    const groups = multiverseGroups(g.state, flow);
    expect(groups[0]).toMatchObject({ id: 'targets', title: 'Valid targets', collapsed: false });
    expect(groups[0]?.rows.map((r) => [r.id, r.target, r.dimmed])).toEqual([[0, true, false]]);
    const rest = groups.slice(1).flatMap((x) => x.rows);
    expect(rest.map((r) => r.id)).toEqual([n2, 1]);
    expect(rest.every((r) => r.dimmed && !r.target)).toBe(true);
    // Outside picking there is no targets group.
    expect(multiverseGroups(g.state, IDLE).some((x) => x.id === 'targets')).toBe(false);
  });

  it('files won, frozen and drawn nodes under Completed', () => {
    expect(['won', 'drawn', 'frozen'].map((s) => groupOf(s as never))).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(groupOf('waiting')).toBe('waiting');
  });

  it('shows a pending transfer as an incoming badge', () => {
    const g = scenario({ w: 3 });
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const [a, b] = g.split(n2 as number);
    g.endTurn();
    g.transfer(a, g.c(0, 0, 0), b, g.c(2, 2, 2));
    const row = multiverseGroups(g.state, IDLE)
      .flatMap((x) => x.rows)
      .find((r) => r.id === b);
    expect(row?.incoming).toEqual({ player: 1, from: a });
  });
});

describe('turn helpers', () => {
  it('explains a blocked End turn and finds the next head', () => {
    const g = scenario({ w: 3 });
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const [a, b] = g.split(n2 as number);
    g.endTurn();
    expect(endTurnBlocker(g.state)).toBe('2 timelines still need an action');
    expect(nextNeedingAction(g.state)).toBe(a);
    expect(nextNeedingAction(g.state, a)).toBe(b);
    expect(nextNeedingAction(g.state, b)).toBe(a);
    g.place(a, g.c(2, 2, 2));
    expect(endTurnBlocker(g.state)).toBe('1 timeline still needs an action');
    expect(nextNeedingAction(g.state, b)).toBe(b);
    g.place(b, g.c(2, 2, 2));
    expect(endTurnBlocker(g.state)).toBeNull();
    expect(nextNeedingAction(g.state)).toBeNull();
  });

  it('hands over the seat when the hot seat changes, not when it stays or the game ends', () => {
    const g = scenario({ w: 3 });
    const before = g.state;
    g.place(0, g.c(1, 1, 1));
    g.endTurn();
    expect(handoffAfter(before, g.state)).toBe(1);
    expect(handoffAfter(g.state, g.state)).toBeNull();
    const ended = g.concede(1).state;
    expect(handoffAfter(before, ended)).toBeNull();
    expect(syncFlow(IDLE, ended)).toEqual(IDLE);
  });
});
