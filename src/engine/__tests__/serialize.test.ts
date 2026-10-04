import { describe, expect, it } from 'vitest';
import {
  SAVE_VERSION,
  deserialize,
  fromJSON,
  printTree,
  serialize,
  submitSendBack,
  toJSON,
  type GameState,
} from '@/engine';
import { threeHeads } from './fixtures';
import { scenario } from './helpers';

/** Round-trip and check that nothing observable changed. */
function roundTrip(state: GameState): GameState {
  const text = serialize(state);
  const back = deserialize(text);
  expect(serialize(back)).toBe(text);
  expect(back.preview.nodes).toEqual(state.preview.nodes);
  expect(back.preview.children).toEqual(state.preview.children);
  expect(back.preview.live).toBe(state.preview.live);
  expect([...back.preview.ledger.acted]).toEqual([...state.preview.ledger.acted]);
  expect([...back.preview.ledger.incoming]).toEqual([...state.preview.ledger.incoming]);
  expect(printTree(back)).toBe(printTree(state));
  expect(back.lines).toBe(state.lines);
  return back;
}

/** Mid-resolution: a transfer to x was applied, y won, and x's place is still queued. */
function pausedWithQueue() {
  const { g, s, x, y } = threeHeads();
  g.transfer(s, g.c(0, 0, 0), x, g.c(1, 0, 0));
  g.place(y, g.c(1, 1, 1));
  g.place(x, g.c(2, 2, 0));
  g.endTurn();
  return { g, s, x, y };
}

describe('serialization (test 28)', () => {
  it('round-trips a fresh game', () => {
    roundTrip(scenario().state);
  });

  it('round-trips mid-draft', () => {
    const { g, s, x, y } = threeHeads();
    g.transfer(s, g.c(0, 0, 0), x, g.c(1, 0, 0));
    g.split(x);
    g.timeTravel(y, g.c(2, 2, 2), 0, g.c(1, 1, 1));
    const back = roundTrip(g.state);
    expect(back.draft).toEqual(g.state.draft);
  });

  it('round-trips mid-awaitSendBack with a queued action and a pending incoming mark', () => {
    const { g, x } = pausedWithQueue();
    expect(g.state.phase).toBe('awaitSendBack');
    expect(g.state.queue).toHaveLength(1);
    expect(g.state.resolveLedger?.incoming.get(x)).toBeDefined();
    expect(g.state.preview.ledger.incoming.get(x)).toBeDefined();
    const back = roundTrip(g.state);
    // Both copies continue identically.
    const a = submitSendBack(g.state, 1, g.c(2, 2, 1));
    const b = submitSendBack(back, 1, g.c(2, 2, 1));
    if (!a.ok || !b.ok) throw new Error('send-back rejected');
    expect(serialize(b.state)).toBe(serialize(a.state));
    const child = a.state.children[x]?.[0] as number;
    expect(a.state.nodes[child]?.board[g.c(1, 0, 0)]).toBe(1);
  });

  it('round-trips a finished game', () => {
    const g = scenario();
    g.concede(0);
    roundTrip(g.state);
  });

  it('stores boards as digit strings and no geometry', () => {
    const g = scenario();
    g.place(0, 13);
    g.endTurn();
    const saved = toJSON(g.state);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.nodes[1]?.board).toBe('0'.repeat(13) + '1' + '0'.repeat(13));
    const text = serialize(g.state);
    expect(text).not.toContain('topology":{');
    expect(text).not.toContain('linesThrough');
  });
});

// Saved games are untyped JSON by nature; the corruption cases below poke at arbitrary fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

describe('loading invalid saves', () => {
  const base = (): Json => JSON.parse(serialize(pausedWithQueue().g.state));
  const draftBase = (): Json => {
    const { g, s } = threeHeads();
    g.split(s);
    return JSON.parse(serialize(g.state));
  };
  const bad = (data: Json, pattern: RegExp) => {
    expect(() => fromJSON(data)).toThrow(pattern);
  };
  const mutated = (mutate: (d: Json) => void, from = base) => {
    const d = from();
    mutate(d);
    return d;
  };

  it('accepts the unmodified bases', () => {
    expect(fromJSON(base()).phase).toBe('awaitSendBack');
    expect(fromJSON(draftBase()).draft).toHaveLength(1);
  });

  it('rejects wrong top-level data', () => {
    bad(null, /not an object/);
    bad([], /not an object/);
    bad(
      mutated((d) => (d.version = 2)),
      /unsupported version 2/,
    );
    bad(
      mutated((d) => delete d.config),
      /missing config/,
    );
    bad(
      mutated((d) => (d.config.m = 9)),
      /config \(M must be/,
    );
    expect(() => deserialize('{')).toThrow(SyntaxError);
  });

  it.each<[string, (d: Json) => void]>([
    ['no nodes', (d) => (d.nodes = [])],
    ['nodes not an array', (d) => (d.nodes = {})],
    ['a node that is not an object', (d) => (d.nodes[2] = 5)],
    ['a root with a parent', (d) => (d.nodes[0].parent = 0)],
    ['a forward parent', (d) => (d.nodes[2].parent = 3)],
    ['a wrong step', (d) => (d.nodes[2].step = 7)],
    ['a short board', (d) => (d.nodes[2].board = '012')],
    ['a bad board digit', (d) => (d.nodes[2].board = '3'.repeat(27))],
    ['a bad round', (d) => (d.nodes[2].round = -1)],
    ['a bad terminal', (d) => (d.nodes[2].terminal = { kind: 'lost' })],
    ['a bad origin', (d) => (d.nodes[2].origin = { kind: 'magic' })],
    ['a bad received mark', (d) => (d.nodes[2].received = { cell: 99, from: 0 })],
  ])('rejects %s', (_, mutate) => {
    bad(mutated(mutate), /Invalid saved game: (no nodes|node \d+)/);
  });

  it('rejects a terminal node with children', () => {
    bad(
      mutated((d) => (d.nodes[1].terminal = { kind: 'draw', filler: 0 })),
      /terminal node has children/,
    );
  });

  it.each<[string, (d: Json) => void, (() => Json)?]>([
    ['a bad player', (d) => (d.current = 2)],
    ['round 0', (d) => (d.round = 0)],
    ['a bad score', (d) => (d.score = [1])],
    ['a fractional score', (d) => (d.score = [0.5, 0])],
    ['an unknown phase', (d) => (d.phase = 'resolving')],
    ['a draft that is not an array', (d) => (d.draft = null)],
    ['a queue that is not an array', (d) => (d.queue = 'x')],
    ['a malformed queued action', (d) => (d.queue = [{ kind: 'place', head: 1 }])],
    ['an unknown queued action', (d) => (d.queue = [{ kind: 'jump', head: 1 }])],
    ['a queued action on an unknown node', (d) => (d.queue = [{ kind: 'split', head: 999 }])],
    ['events that are not an array', (d) => (d.events = {})],
    ['a bad result', (d) => (d.result = 'won')],
    ['a result while still playing', (d) => (d.result = { kind: 'draw', reason: 'turnLimit' })],
    ['a game over without a result', (d) => (d.phase = 'over')],
    ['draft actions while resolving', (d) => (d.draft = [{ kind: 'split', head: 1 }])],
    ['queued actions while drafting', (d) => (d.queue = [{ kind: 'split', head: 1 }]), draftBase],
  ])('rejects %s', (_, mutate, from) => {
    bad(mutated(mutate, from), /Invalid saved game: turn state/);
  });

  it.each<[string, (d: Json) => void]>([
    ['a missing prompt', (d) => (d.pendingSendBack = null)],
    ['a prompt for a bad player', (d) => (d.pendingSendBack.player = 3)],
    ['a prompt for a live node', (d) => (d.pendingSendBack.terminal = 0)],
    ['a prompt for an unknown node', (d) => (d.pendingSendBack.terminal = 999)],
  ])('rejects %s', (_, mutate) => {
    bad(mutated(mutate), /pending send-back/);
  });

  it.each<[string, (d: Json) => void]>([
    ['a missing ledger', (d) => (d.resolveLedger = null)],
    ['a bad acted list', (d) => (d.resolveLedger.acted = [999])],
    ['acted not an array', (d) => (d.resolveLedger.acted = 1)],
    ['incoming not an array', (d) => (d.resolveLedger.incoming = {})],
    ['a short incoming entry', (d) => (d.resolveLedger.incoming = [[1, 2]])],
    ['an incoming entry with a bad cell', (d) => (d.resolveLedger.incoming = [[1, 99, 0]])],
    ['an incoming entry with a bad node', (d) => (d.resolveLedger.incoming = [[999, 1, 0]])],
    ['an incoming entry with a bad sender', (d) => (d.resolveLedger.incoming = [[1, 1, -1]])],
  ])('rejects %s', (_, mutate) => {
    bad(mutated(mutate), /resolution ledger/);
  });

  it('re-validates the draft', () => {
    bad(
      mutated((d) => d.draft.push({ kind: 'place' }), draftBase),
      /draft action 1\.$/,
    );
    bad(
      mutated((d) => d.draft.push(d.draft[0]), draftBase),
      /draft action 1 \(That timeline already has an action this turn\.\)/,
    );
  });
});
