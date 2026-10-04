import { describe, expect, it } from 'vitest';
import {
  addAction,
  sendBackTargets,
  submitSendBack,
  timeTravelTargets,
  transferTargets,
  type GameState,
} from '@/engine';
import { scenario } from '@/engine/__tests__/helpers';
import {
  IDLE,
  isPickingNode,
  step,
  syncFlow,
  targetsFor,
  type Flow,
  type FlowEvent,
  type FlowStep,
} from './flow';

/** Run events in order, failing on any error; returns the final step. */
function run(state: GameState, events: readonly FlowEvent[], from: Flow = IDLE) {
  let flow = from;
  let last: FlowStep = { flow };
  for (const [i, event] of events.entries()) {
    last = step(flow, event, state);
    if (last.error !== undefined) throw new Error(`event ${i} (${event.type}): ${last.error}`);
    flow = last.flow;
  }
  return last;
}

/** Two heads at step 3 for P2, each with a P2 mark, plus history: good for both flows. */
function twoHeads() {
  const g = scenario({ w: 3 });
  const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
  const [a, b] = g.split(n2 as number);
  g.endTurn();
  return { g, n2: n2 as number, a, b };
}

describe('time travel flow', () => {
  it('produces exactly the action of the picks', () => {
    // P1 to move on one head at step 2 with a P1 mark at (1,1,1).
    const g = scenario({ w: 3 });
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const head = n2 as number;
    const from = g.c(1, 1, 1);
    const targets = timeTravelTargets(g.state, head, from);
    expect(targets.map((t) => t.node)).toEqual([0]);

    let r = step(IDLE, { type: 'begin', kind: 'timeTravel', head, fromCell: from }, g.state);
    expect(r.flow).toEqual({ kind: 'timeTravel', head, fromCell: from, target: null, cell: null });
    expect(isPickingNode(r.flow)).toBe(true);
    expect(targetsFor(r.flow, g.state)).toEqual(targets);

    r = step(r.flow, { type: 'pickNode', node: 0 }, g.state);
    expect(isPickingNode(r.flow)).toBe(false);
    r = step(r.flow, { type: 'pickCell', cell: g.c(2, 2, 2) }, g.state);
    expect(r.action).toBeUndefined();
    r = step(r.flow, { type: 'confirm' }, g.state);
    expect(r.flow).toEqual(IDLE);
    expect(r.action).toEqual({
      kind: 'timeTravel',
      head,
      fromCell: from,
      target: 0,
      toCell: g.c(2, 2, 2),
    });
    expect(addAction(g.state, r.action as never).ok).toBe(true);
  });

  it('refuses to begin without a legal target, with the engine’s reason', () => {
    const g = scenario();
    const r = step(IDLE, { type: 'begin', kind: 'timeTravel', head: 0, fromCell: 0 }, g.state);
    expect(r.flow).toEqual(IDLE);
    expect(r.error).toBe('You have no mark of your own here to send.');
  });
});

describe('transfer flow', () => {
  it('produces exactly the action of the picks', () => {
    const { g, a, b } = twoHeads();
    expect(transferTargets(g.state, a).map((t) => t.node)).toEqual([b]);
    const r = run(g.state, [
      { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) },
      { type: 'pickNode', node: b },
      { type: 'pickCell', cell: g.c(2, 1, 0) },
      { type: 'confirm' },
    ]);
    expect(r.flow).toEqual(IDLE);
    expect(r.action).toEqual({
      kind: 'transfer',
      head: a,
      fromCell: g.c(0, 0, 0),
      targetHead: b,
      toCell: g.c(2, 1, 0),
    });
  });
});

describe('back and cancel', () => {
  it('steps back one pick at a time, then leaves the flow', () => {
    const { g, a, b } = twoHeads();
    const begin: FlowEvent = { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) };
    const picked = run(g.state, [
      begin,
      { type: 'pickNode', node: b },
      { type: 'pickCell', cell: 2 },
    ]);
    expect(picked.flow).toMatchObject({ target: b, cell: 2 });
    let r = step(picked.flow, { type: 'back' }, g.state);
    expect(r.flow).toMatchObject({ target: b, cell: null });
    r = step(r.flow, { type: 'back' }, g.state);
    expect(r.flow).toMatchObject({ kind: 'transfer', target: null, cell: null });
    r = step(r.flow, { type: 'back' }, g.state);
    expect(r.flow).toEqual(IDLE);
  });

  it('cancels a time travel or transfer from any point', () => {
    const { g, a, b } = twoHeads();
    const picked = run(g.state, [
      { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) },
      { type: 'pickNode', node: b },
    ]);
    expect(step(picked.flow, { type: 'cancel' }, g.state)).toEqual({ flow: IDLE });
  });
});

describe('invalid picks', () => {
  it('rejects nodes and cells the engine does not offer, keeping the flow', () => {
    const { g, n2, a, b } = twoHeads();
    const begun = run(g.state, [
      { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) },
    ]).flow;
    for (const node of [a, n2, 0, 99]) {
      const r = step(begun, { type: 'pickNode', node }, g.state);
      expect(r.error).toBe(`#${node} is not a valid target.`);
      expect(r.flow).toBe(begun);
    }
    expect(step(begun, { type: 'pickCell', cell: 2 }, g.state).error).toBe('Choose a node first.');
    expect(step(begun, { type: 'confirm' }, g.state).error).toBe('Choose a cell first.');
    const onB = step(begun, { type: 'pickNode', node: b }, g.state).flow;
    // (0,0,0) holds P2's mark and (1,1,1) P1's on b: not empty.
    for (const cell of [g.c(0, 0, 0), g.c(1, 1, 1), -1, 27]) {
      const r = step(onB, { type: 'pickCell', cell }, g.state);
      expect(r.error).toBe('That cell is not available.');
      expect(r.flow).toBe(onB);
    }
  });

  it('rejects events with no flow, and a new flow during a send-back', () => {
    const g = scenario();
    expect(step(IDLE, { type: 'pickNode', node: 0 }, g.state).error).toBe(
      'Nothing is being picked.',
    );
    expect(step(IDLE, { type: 'confirm' }, g.state).error).toBe('Nothing is being picked.');
    const sb: Flow = { kind: 'sendBack', player: 1, terminal: 3, target: null, cell: null };
    expect(step(sb, { type: 'begin', kind: 'transfer', head: 0, fromCell: 0 }, g.state).error).toBe(
      'Finish the forced send-back first.',
    );
  });
});

describe('send-back flow', () => {
  /** The chain from the engine's resolve tests: P1 wins, P2 must send back. */
  function chain() {
    const g = scenario({ w: 3 });
    const n = [
      0,
      ...g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2), g.c(1, 1, 0), g.c(0, 2, 2)),
    ];
    const won = g.place(n[6] as number, g.c(1, 2, 0));
    g.endTurn();
    return { g, n: n as number[], won };
  }

  it('is forced by the engine phase and follows a chain to the next sender', () => {
    const { g, n, won } = chain();
    // The flow is forced, whatever the UI was doing.
    let flow = syncFlow(IDLE, g.state);
    expect(flow).toEqual({ kind: 'sendBack', player: 1, terminal: won, target: null, cell: null });
    expect(syncFlow(flow, g.state)).toBe(flow);
    expect(targetsFor(flow, g.state)).toEqual(sendBackTargets(g.state));

    // P2 completes its own row on n5: that wins, so P1 owes the next send-back.
    let r = run(
      g.state,
      [
        { type: 'pickNode', node: n[5] as number },
        { type: 'pickCell', cell: g.c(2, 0, 2) },
        { type: 'confirm' },
      ],
      flow,
    );
    expect(r.sendBack).toEqual({ target: n[5], cell: g.c(2, 0, 2) });
    expect(r.flow).toEqual(IDLE);
    let next = submitSendBack(g.state, n[5] as number, g.c(2, 0, 2));
    if (!next.ok) throw new Error(next.message);
    const sb1 = g.state.nodes.length;
    flow = syncFlow(r.flow, next.state);
    expect(flow).toEqual({ kind: 'sendBack', player: 0, terminal: sb1, target: null, cell: null });

    // A stale send-back flow for the previous prompt is replaced too.
    const stale: Flow = {
      kind: 'sendBack',
      player: 1,
      terminal: won,
      target: n[5] as number,
      cell: null,
    };
    expect(syncFlow(stale, next.state)).toEqual(flow);

    // P1 answers on n4; then P2 on n3, which ends the chain and play continues.
    r = run(
      next.state,
      [
        { type: 'pickNode', node: n[4] as number },
        { type: 'pickCell', cell: g.c(2, 0, 0) },
        { type: 'confirm' },
      ],
      flow,
    );
    next = submitSendBack(next.state, r.sendBack?.target as number, r.sendBack?.cell as number);
    if (!next.ok) throw new Error(next.message);
    flow = syncFlow(r.flow, next.state);
    expect(flow).toMatchObject({ kind: 'sendBack', player: 1 });
    r = run(
      next.state,
      [
        { type: 'pickNode', node: n[3] as number },
        { type: 'pickCell', cell: g.c(2, 2, 2) },
        { type: 'confirm' },
      ],
      flow,
    );
    next = submitSendBack(next.state, r.sendBack?.target as number, r.sendBack?.cell as number);
    if (!next.ok) throw new Error(next.message);
    expect(next.state.phase).toBe('draft');
    expect(syncFlow(r.flow, next.state)).toEqual(IDLE);
  });

  it('cannot be cancelled, but Back unpicks the node', () => {
    const { g, n } = chain();
    const flow = syncFlow(IDLE, g.state);
    const r = step(flow, { type: 'cancel' }, g.state);
    expect(r.error).toBe('A forced send-back cannot be cancelled.');
    expect(r.flow).toBe(flow);
    const picked = step(flow, { type: 'pickNode', node: n[5] as number }, g.state).flow;
    expect(step(picked, { type: 'back' }, g.state).flow).toEqual(flow);
    // Back with nothing picked stays in the flow.
    expect(step(flow, { type: 'back' }, g.state).flow).toEqual(flow);
  });

  it('rejects nodes that are not send-back targets', () => {
    const { g, n, won } = chain();
    const flow = syncFlow(IDLE, g.state);
    for (const node of [n[4] as number, n[6] as number, won]) {
      expect(step(flow, { type: 'pickNode', node }, g.state).error).toBe(
        `#${node} is not a valid target.`,
      );
    }
  });
});

describe('syncFlow', () => {
  it('drops a time-travel or transfer flow whose head has acted or vanished', () => {
    const { g, a, b } = twoHeads();
    const flow = run(g.state, [
      { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) },
      { type: 'pickNode', node: b },
    ]).flow;
    expect(syncFlow(flow, g.state)).toBe(flow);
    g.place(a, g.c(2, 2, 2));
    expect(syncFlow(flow, g.state)).toEqual(IDLE);
    expect(syncFlow(flow, null)).toEqual(IDLE);
  });

  it('unpicks a target that is no longer offered', () => {
    const { g, a, b } = twoHeads();
    const flow = run(g.state, [
      { type: 'begin', kind: 'transfer', head: a, fromCell: g.c(0, 0, 0) },
      { type: 'pickNode', node: b },
      { type: 'pickCell', cell: 2 },
    ]).flow;
    g.place(b, g.c(2, 2, 2));
    // b has acted, so a has no transfer target left at all.
    expect(syncFlow(flow, g.state)).toEqual(IDLE);
  });
});
