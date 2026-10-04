/**
 * A complete hotseat game played through the UI's store, controller and flow APIs only (no DOM):
 * the same calls the screens make. Flat cube, N = M = 3, first to W = 2.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  missingHeads,
  printTree,
  sendBackTargets,
  type CellId,
  type GameState,
  type NodeId,
} from '@/engine';
import {
  act,
  clearDraft,
  endTurnBlocker,
  endTurnNow,
  flow,
  flowEvent,
  handoff,
  nextNeedingAction,
  notice,
  rematch,
  startTurn,
  undoAction,
} from './controller';
import { route } from './router';
import { game, lastError, quit, startGame } from './store';

const c = (x: number, y: number, z: number): CellId => x + 3 * (y + 3 * z);

function state(): GameState {
  if (game.value === null) throw new Error('no game');
  return game.value;
}

function expectOk(ok: boolean): void {
  if (!ok) throw new Error(`rejected: ${lastError.value}\n${printTree(state())}`);
}

/** Place on a head through the controller; returns the new node's id. */
function place(head: NodeId, cell: CellId): NodeId {
  const id = state().preview.nodes.length;
  expectOk(act({ kind: 'place', head, cell }));
  expect(route.value).toEqual({ screen: 'multiverse' });
  return id;
}

/** End the turn; the next player (if any) takes the seat. */
function endTurn(): void {
  expect(endTurnBlocker(state())).toBeNull();
  expectOk(endTurnNow());
  if (handoff.value !== null) startTurn();
}

describe('a full game through the store and flow APIs', () => {
  beforeEach(() => quit());

  it('plays every action, a forced send-back and a win by score', () => {
    expect(startGame({ topology: 'flat', n: 3, m: 3, w: 2, l: 30 }).ok).toBe(true);
    expect(route.value).toEqual({ screen: 'multiverse' });
    expect(endTurnBlocker(state())).toBe('1 timeline still needs an action');
    expect(nextNeedingAction(state())).toBe(0);

    // Round 1, P1: undo and clear, then place (0,0,0).
    place(0, c(1, 1, 1));
    undoAction();
    expect(state().draft).toEqual([]);
    expectOk(act({ kind: 'split', head: 0 }));
    expect(state().preview.live).toBe(2);
    clearDraft();
    expect(state().draft).toEqual([]);
    expect(state().preview.live).toBe(1);
    const n1 = place(0, c(0, 0, 0));
    expect(endTurnBlocker(state())).toBeNull();
    expectOk(endTurnNow());
    // Control passed: Player 2 must take the seat.
    expect(handoff.value).toBe(1);
    startTurn();
    expect(handoff.value).toBeNull();

    // Round 1, P2.
    const n2 = place(n1, c(0, 2, 2));
    endTurn();

    // Round 2, P1: split.
    const a = state().preview.nodes.length;
    expectOk(act({ kind: 'split', head: n2 }));
    const b = a + 1;
    endTurn();
    expect(state().round).toBe(2);

    // Round 2, P2: one move on each split timeline.
    expect(endTurnBlocker(state())).toBe('2 timelines still need an action');
    const h5 = place(a, c(2, 2, 2));
    const h6 = place(b, c(1, 2, 2));
    endTurn();

    // Round 3, P1: transfer (0,0,0) from h5 to (1,0,0) of h6 via the flow…
    expectOk(flowEvent({ type: 'begin', kind: 'transfer', head: h5, fromCell: c(0, 0, 0) }));
    expect(route.value).toEqual({ screen: 'multiverse' });
    expect(flow.value).toMatchObject({ kind: 'transfer', target: null });
    // An invalid pick is refused and leaves the flow alone.
    expect(flowEvent({ type: 'pickNode', node: n1 })).toBe(false);
    expect(lastError.value).toBe(`#${n1} is not a valid target.`);
    expectOk(flowEvent({ type: 'pickNode', node: h6 }));
    expect(route.value).toEqual({ screen: 'timeline', node: h6, readOnly: false });
    expectOk(flowEvent({ type: 'pickCell', cell: c(1, 0, 0) }));
    const h7 = state().preview.nodes.length;
    expectOk(flowEvent({ type: 'confirm' }));
    expect(flow.value).toEqual({ kind: 'idle' });
    expect(route.value).toEqual({ screen: 'multiverse' });
    expect(state().draft.at(-1)).toEqual({
      kind: 'transfer',
      head: h5,
      fromCell: c(0, 0, 0),
      targetHead: h6,
      toCell: c(1, 0, 0),
    });
    // …then complete the row on h6: a win, frozen until End turn.
    const won = place(h6, c(2, 0, 0));
    expect(state().preview.nodes[won]?.terminal).toMatchObject({ kind: 'win', winner: 0 });
    expectOk(endTurnNow());
    expect(state().score).toEqual([1, 0]);
    expect(notice.value).toBe(`Player 1 won timeline #${won}`);

    // The forced send-back: Player 2 takes the seat and the flow is forced.
    expect(state().phase).toBe('awaitSendBack');
    expect(handoff.value).toBe(1);
    startTurn();
    expect(flow.value).toEqual({
      kind: 'sendBack',
      player: 1,
      terminal: won,
      target: null,
      cell: null,
    });
    expect(endTurnBlocker(state())).toBe('Finish the forced send-back first.');
    expect(flowEvent({ type: 'cancel' })).toBe(false);
    expect(sendBackTargets(state()).map((t) => t.node)).toEqual([n1, b]);
    expectOk(flowEvent({ type: 'pickNode', node: n1 }));
    expectOk(flowEvent({ type: 'back' }));
    expect(flow.value).toMatchObject({ kind: 'sendBack', target: null });
    expectOk(flowEvent({ type: 'pickNode', node: b }));
    expectOk(flowEvent({ type: 'pickCell', cell: c(1, 1, 1) }));
    const sb = state().nodes.length;
    expectOk(flowEvent({ type: 'confirm' }));
    expect(state().nodes[sb]?.origin).toEqual({
      kind: 'sendBack',
      cell: c(1, 1, 1),
      terminal: won,
    });
    expect(state().phase).toBe('draft');
    expect(flow.value).toEqual({ kind: 'idle' });
    // Player 2 was already in the seat for the send-back, so there is no second handoff.
    expect(handoff.value).toBeNull();
    expect(state().current).toBe(1);
    expect(notice.value).toBe(`Player 1 won timeline #${won} · Player 2 sent a mark back to #${b}`);

    // Round 3, P2: time travel (2,2,2) from h7 back to n1 via the flow.
    expect(nextNeedingAction(state())).toBe(h7);
    expectOk(flowEvent({ type: 'begin', kind: 'timeTravel', head: h7, fromCell: c(2, 2, 2) }));
    expectOk(flowEvent({ type: 'pickNode', node: n1 }));
    expectOk(flowEvent({ type: 'pickCell', cell: c(2, 2, 0) }));
    const h10 = state().preview.nodes.length;
    const h11 = h10 + 1;
    expectOk(flowEvent({ type: 'confirm' }));
    expect(state().draft.at(-1)).toEqual({
      kind: 'timeTravel',
      head: h7,
      fromCell: c(2, 2, 2),
      target: n1,
      toCell: c(2, 2, 0),
    });
    endTurn();

    // Round 4, P1: three timelines (the send-back node, the time-travel source and arrival).
    // Cancelling a flow returns to the timeline the mark was taken from.
    expect(state().round).toBe(4);
    expect(endTurnBlocker(state())).toBe('3 timelines still need an action');
    expectOk(flowEvent({ type: 'begin', kind: 'timeTravel', head: sb, fromCell: c(0, 0, 0) }));
    expectOk(flowEvent({ type: 'cancel' }));
    expect(route.value).toEqual({ screen: 'timeline', node: sb, readOnly: false });
    expect(flow.value).toEqual({ kind: 'idle' });
    const h12 = place(sb, c(1, 0, 0));
    const h13 = place(h10, c(1, 1, 1));
    const h14 = place(h11, c(0, 1, 0));
    endTurn();

    // Round 4, P2: three safe moves that leave P1's row (0,0,0)-(1,0,0) open on h12.
    const h15 = place(h12, c(2, 2, 1));
    place(h13, c(0, 0, 1));
    place(h14, c(2, 1, 1));
    endTurn();

    // Round 5, P1: complete the row on h15 for the second win: game over by score.
    const heads = missingHeads(state());
    expect(heads).toHaveLength(3);
    place(h15, c(2, 0, 0));
    for (const h of heads.filter((h) => h !== h15)) place(h, c(2, 1, 2));
    expectOk(endTurnNow());

    const s = state();
    expect(s.phase).toBe('over');
    expect(s.result).toEqual({ kind: 'win', winner: 0, reason: 'score' });
    expect(s.score).toEqual([2, 0]);
    expect(s.round).toBe(5);
    expect(handoff.value).toBeNull();
    expect(flow.value).toEqual({ kind: 'idle' });
    expect(notice.value).toMatch(/^Player 1 won timeline #\d+ · Player 1 wins 2–0$/);
    expect(endTurnBlocker(s)).toBe('The game is over.');
    expect(s.events.filter((e) => e.type === 'timelineWon')).toHaveLength(2);
    expect(s.events.filter((e) => e.type === 'sendBackApplied')).toHaveLength(1);
    const kinds = s.events.flatMap((e) => (e.type === 'actionApplied' ? [e.action.kind] : []));
    expect(new Set(kinds)).toEqual(new Set(['place', 'split', 'transfer', 'timeTravel']));

    // Rematch: same config, fresh game, no leftover turn state.
    const config = s.config;
    expect(rematch()).toBe(true);
    expect(state().config).toEqual(config);
    expect(state().nodes).toHaveLength(1);
    expect(notice.value).toBeNull();
  });
});
