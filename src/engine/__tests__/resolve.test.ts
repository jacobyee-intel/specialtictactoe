import { describe, expect, it } from 'vitest';
import {
  addAction,
  concede,
  endTurn,
  headStatus,
  hotSeat,
  sendBackTargets,
  submitSendBack,
  type GameState,
} from '@/engine';
import { crafted, scenario, setCell } from './helpers';

/** P1 threatens (2,0,0) on the single head n4 (flat 3³). */
function threat(config = {}) {
  const g = scenario(config);
  const n = [0, ...g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2))];
  return { g, n };
}

/** P2 splits P1's threat at n3: two P1 heads `p`, `q`, both winning at (2,0,0). */
function twoThreats(config = {}) {
  const g = scenario(config);
  const n = [0, ...g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0))];
  const [p, q] = g.split(n[3] as number);
  g.endTurn();
  return { g, n, p, q };
}

const types = (s: GameState, from = 0) => s.events.slice(from).map((e) => e.type);

describe('a single win (tests 19, 20)', () => {
  it('scores, then waits for the loser to send back to a loser-parity strict ancestor', () => {
    const { g, n } = threat();
    const won = g.place(n[4] as number, g.c(2, 0, 0));
    const before = g.state.events.length;
    g.endTurn();
    expect(g.state.score).toEqual([1, 0]);
    expect(g.state.phase).toBe('awaitSendBack');
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: won });
    expect(g.state.current).toBe(0);
    expect(hotSeat(g.state)).toBe(1);
    expect(types(g.state, before)).toEqual(['actionApplied', 'timelineWon', 'sendBackRequired']);
    const targets = sendBackTargets(g.state);
    expect(targets.map((t) => t.node)).toEqual([n[1], n[3]]);
    expect(targets[0]?.cells).toHaveLength(26);
    expect(targets[1]?.cells).toHaveLength(24);
    expect(g.tree()).toContain('P2 must send back for #5');
    expect(headStatus(g.state, won)).toBe('won');
  });

  it('rejects bad send-backs and other moves during the prompt', () => {
    const { g, n } = threat();
    g.place(n[4] as number, g.c(2, 0, 0));
    g.endTurn();
    const s = g.state;
    const sb = (target: number, cell: number) => submitSendBack(s, target, cell);
    expect(sb(n[2] as number, 4)).toMatchObject({ ok: false, reason: 'targetWrongParity' });
    expect(sb(5, 4)).toMatchObject({ ok: false, reason: 'notAncestor' });
    expect(sb(99, 4)).toMatchObject({ ok: false, reason: 'unknownNode' });
    expect(sb(n[3] as number, g.c(0, 0, 0))).toMatchObject({ ok: false, reason: 'cellOccupied' });
    expect(sb(n[3] as number, 27)).toMatchObject({ ok: false, reason: 'badCell' });
    expect(addAction(s, { kind: 'split', head: 5 })).toMatchObject({ reason: 'wrongPhase' });
    expect(endTurn(s)).toMatchObject({ reason: 'wrongPhase' });
    expect(sendBackTargets(threat().g.state)).toEqual([]);
    expect(submitSendBack(threat().g.state, 1, 4)).toMatchObject({ reason: 'wrongPhase' });
  });

  it('may target the node just before the loser’s last move (test 20)', () => {
    const { g, n } = threat();
    g.place(n[4] as number, g.c(2, 0, 0));
    g.endTurn();
    // P2's last move was n3 → n4; n3 itself is a legal target.
    const sb = g.sendBack(n[3] as number, g.c(2, 2, 2));
    expect(g.node(sb)).toMatchObject({ parent: n[3], step: 4, terminal: null });
    expect(g.node(sb).origin).toEqual({ kind: 'sendBack', cell: g.c(2, 2, 2), terminal: 5 });
    expect(g.node(sb).board[g.c(2, 2, 2)]).toBe(2);
    expect(g.state.events.at(-3)).toEqual({
      type: 'sendBackApplied',
      player: 1,
      target: n[3],
      cell: g.c(2, 2, 2),
      node: sb,
    });
  });
});

describe('a send-back chain (tests 21, 24, 25)', () => {
  it('each send-back that wins makes the other player send back, and play continues', () => {
    const g = scenario({ w: 3 });
    // P1: (0,0,0) (1,0,0) (1,1,0) (1,2,0); P2: (0,0,2) (1,0,2) (0,2,2).
    const n = [
      0,
      ...g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2), g.c(1, 1, 0), g.c(0, 2, 2)),
    ];
    expect(g.state.round).toBe(4);
    const won = g.place(n[6] as number, g.c(1, 2, 0));
    g.endTurn();
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: won });

    // P2 completes its own row (0,0,2)-(1,0,2)-(2,0,2) on n5, the node before its last move.
    const sb1 = g.sendBack(n[5] as number, g.c(2, 0, 2));
    expect(g.node(sb1).terminal).toMatchObject({ kind: 'win', winner: 1 });
    expect(g.state.score).toEqual([1, 1]);
    expect(g.state.pendingSendBack).toEqual({ player: 0, terminal: sb1 });
    expect(sendBackTargets(g.state).map((t) => t.node)).toEqual([n[0], n[2], n[4]]);
    expect(hotSeat(g.state)).toBe(0);

    // P1 answers on n4 by completing (0,0,0)-(1,0,0)-(2,0,0).
    const sb2 = g.sendBack(n[4] as number, g.c(2, 0, 0));
    expect(g.node(sb2).terminal).toMatchObject({ kind: 'win', winner: 0 });
    expect(g.state.score).toEqual([2, 1]);
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: sb2 });
    expect(sendBackTargets(g.state).map((t) => t.node)).toEqual([n[1], n[3]]);

    // P2 cannot win on n3; the chain ends with a live, out-of-step node at step 4.
    const before = g.state.events.length;
    const sb3 = g.sendBack(n[3] as number, g.c(2, 2, 2));
    expect(g.node(sb3)).toMatchObject({ step: 4, terminal: null });
    expect(g.state.phase).toBe('draft');

    // Test 25: P2 has no heads, so its phase is skipped and still counts toward the round.
    expect(g.state.events.slice(before).map((e) => e.type)).toEqual([
      'sendBackApplied',
      'turnSkipped',
      'controlPassed',
    ]);
    expect(g.state.events.at(-2)).toEqual({ type: 'turnSkipped', player: 1, round: 4 });
    expect(g.state.events.at(-1)).toEqual({ type: 'controlPassed', player: 0, round: 5 });
    expect(g.state.current).toBe(0);
    expect(g.state.round).toBe(5);

    // Test 24: the out-of-step branch is simply P1's head now, then P2's.
    expect(g.heads()).toEqual([sb3]);
    const next = g.place(sb3, g.c(1, 1, 1));
    g.endTurn();
    expect(g.state.current).toBe(1);
    expect(g.heads()).toEqual([next]);
    expect(g.node(next).step).toBe(5);
    expect(g.tree()).toContain(`#${sb3} s4 P1 sendback +c${g.c(2, 2, 2)} (for #${sb2})`);
  });

  it('skips the send-back when no ancestor has the owing player’s parity', () => {
    // A crafted root where P1 already threatens a row: the win happens at step 1.
    const root = setCell(setCell('0'.repeat(27), 0, 1), 1, 1);
    const g = crafted({}, [{ parent: null, board: root }]);
    const won = g.place(0, 2);
    g.endTurn();
    expect(g.state.events.map((e) => e.type)).toEqual([
      'actionApplied',
      'timelineWon',
      'sendBackSkipped',
      'gameOver',
    ]);
    expect(g.state.events[2]).toEqual({ type: 'sendBackSkipped', player: 1, terminal: won });
    // Nobody has a live timeline left.
    expect(g.state.result).toEqual({ kind: 'draw', reason: 'noTimelines' });
    expect(g.state.phase).toBe('over');
    expect(hotSeat(g.state)).toBeNull();
    expect(g.tree()).toContain('over: draw (noTimelines)');
  });
});

describe('game over in the middle of the queue (test 22)', () => {
  it('drops the remaining queued actions', () => {
    const { g, p, q } = twoThreats({ w: 1 });
    const committed = g.state.nodes.length;
    g.place(p, g.c(2, 0, 0));
    g.place(q, g.c(2, 0, 0));
    g.endTurn();
    expect(g.state.phase).toBe('over');
    expect(g.state.result).toEqual({ kind: 'win', winner: 0, reason: 'score' });
    expect(g.state.score).toEqual([1, 0]);
    expect(g.state.nodes).toHaveLength(committed + 1);
    expect(g.state.children[q]).toEqual([]);
    expect(g.state.queue).toEqual([]);
    expect(g.state.events.at(-1)).toEqual({ type: 'gameOver', result: g.state.result });
    expect(g.tree()).toContain('over: P1 wins (score)');
    expect(headStatus(g.state, q)).toBe('waiting');
    // Nothing is possible any more.
    expect(addAction(g.state, { kind: 'split', head: q })).toMatchObject({ reason: 'gameOver' });
    expect(endTurn(g.state)).toMatchObject({ reason: 'gameOver' });
    expect(concede(g.state, 0)).toMatchObject({ reason: 'gameOver' });
    expect(submitSendBack(g.state, 0, 0)).toMatchObject({ reason: 'gameOver' });
  });
});

describe('two wins in one turn (test 23)', () => {
  it('resolve in draft order, each with its send-back before the next action', () => {
    const { g, n, p, q } = twoThreats({ w: 3 });
    const base = g.state.nodes.length;
    const pw = g.place(p, g.c(2, 0, 0));
    const qw = g.place(q, g.c(2, 0, 0));
    expect([pw, qw]).toEqual([base, base + 1]);
    const from = g.state.events.length;
    g.endTurn();
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: base });
    expect(g.state.queue).toEqual([{ kind: 'place', head: q, cell: g.c(2, 0, 0) }]);
    expect(g.state.children[q]).toEqual([]);
    expect(headStatus(g.state, q)).toBe('waiting');
    const sb1 = g.sendBack(n[1] as number, g.c(2, 2, 2));
    // The send-back took id base+1, so q's winning child is now base+2 (not the preview's id).
    expect(sb1).toBe(base + 1);
    expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: base + 2 });
    expect(g.state.nodes[base + 2]?.parent).toBe(q);
    expect(g.state.score).toEqual([2, 0]);
    g.sendBack(n[3] as number, g.c(2, 2, 2));
    expect(types(g.state, from)).toEqual([
      'actionApplied',
      'timelineWon',
      'sendBackRequired',
      'sendBackApplied',
      'actionApplied',
      'timelineWon',
      'sendBackRequired',
      'sendBackApplied',
      'turnSkipped',
      'controlPassed',
    ]);
    expect(g.state.phase).toBe('draft');
    expect(g.heads()).toEqual([sb1, base + 3]);
  });
});

describe('turn limit (test 26)', () => {
  it('ends in a draw after round L, whoever is ahead', () => {
    const { g, n } = threat({ w: 2, l: 3 });
    expect(g.state.round).toBe(3);
    g.place(n[4] as number, g.c(2, 0, 0));
    g.endTurn();
    g.sendBack(n[3] as number, g.c(2, 2, 2));
    // P2 has no head; the skipped phase ends round 3.
    expect(g.state.score).toEqual([1, 0]);
    expect(g.state.result).toEqual({ kind: 'draw', reason: 'turnLimit' });
    expect(g.state.round).toBe(4);
    expect(g.state.phase).toBe('over');
  });

  it('counts P1 then P2 as one round', () => {
    const g = scenario({ l: 1 });
    g.line(g.c(1, 1, 1));
    expect(g.state.phase).toBe('draft');
    g.line(g.c(0, 0, 0));
    expect(g.state.result).toEqual({ kind: 'draw', reason: 'turnLimit' });
    expect(g.state.round).toBe(2);
  });
});

describe('concede (test 27)', () => {
  it('is allowed for the current player while drafting, and discards the draft', () => {
    const { g, n } = threat();
    g.place(n[4] as number, g.c(2, 2, 2));
    expect(concede(g.state, 1)).toMatchObject({ ok: false, reason: 'notYourTurn' });
    g.concede(0);
    expect(g.state.result).toEqual({ kind: 'win', winner: 1, reason: 'concede' });
    expect(g.state.phase).toBe('over');
    expect(g.state.draft).toEqual([]);
    expect(g.state.nodes).toHaveLength(5);
    expect(g.state.events.at(-1)).toEqual({ type: 'gameOver', result: g.state.result });
  });

  it('is allowed only for the sender during a send-back prompt', () => {
    const { g, n } = threat();
    g.place(n[4] as number, g.c(2, 0, 0));
    g.endTurn();
    expect(concede(g.state, 0)).toMatchObject({ ok: false, reason: 'notYourTurn' });
    g.concede(1);
    expect(g.state.result).toEqual({ kind: 'win', winner: 0, reason: 'concede' });
    expect(g.state.pendingSendBack).toBeNull();
    expect(g.state.resolveLedger).toBeNull();
    expect(g.state.score).toEqual([1, 0]);
  });
});
