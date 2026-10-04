import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAction, clear, endTurn, undo, type GameConfigInput, type GameState } from '@/engine';
import { navigate, route } from './router';
import {
  dispatch,
  game,
  guardRoute,
  hotSeatPlayer,
  lastConfig,
  lastError,
  liveCount,
  quit,
  startGame,
  update,
} from './store';

const FLAT: GameConfigInput = { topology: 'flat', n: 3, m: 3, w: 2, l: 10 };

function current(): GameState {
  const state = game.value;
  if (state === null) throw new Error('no game');
  return state;
}

const place = (cell: number) => (s: GameState) => addAction(s, { kind: 'place', head: 0, cell });

beforeEach(() => {
  quit();
  lastConfig.value = null;
});

describe('startGame', () => {
  it('rejects a bad config with field errors and changes nothing', () => {
    const check = startGame({ ...FLAT, n: 9, m: 1 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.map((e) => e.field)).toEqual(['n', 'm']);
    expect(game.value).toBeNull();
    expect(lastConfig.value).toBeNull();
    expect(route.value).toEqual({ screen: 'start' });
  });

  it('leaves a game in progress untouched when the new config is bad', () => {
    startGame(FLAT);
    const before = game.value;
    expect(startGame({ ...FLAT, w: 0 }).ok).toBe(false);
    expect(game.value).toBe(before);
  });

  it('starts a game, remembers the config and opens the multiverse', () => {
    const check = startGame(FLAT);
    expect(check.ok).toBe(true);
    const state = current();
    expect(state.config).toMatchObject({ ...FLAT, maxTimelines: 32 });
    expect(state.round).toBe(1);
    expect(lastConfig.value).toEqual(state.config);
    expect(route.value).toEqual({ screen: 'multiverse' });
    expect(hotSeatPlayer.value).toBe(0);
    expect(liveCount.value).toBe(1);
  });
});

describe('dispatch', () => {
  beforeEach(() => {
    startGame(FLAT);
  });

  it('swaps in the new state on success', () => {
    const before = current();
    expect(dispatch(place(0))).toBe(true);
    expect(game.value).not.toBe(before);
    expect(current().draft).toHaveLength(1);
    expect(lastError.value).toBeNull();
  });

  it('keeps the state and shows the engine message on rejection', () => {
    dispatch(place(0));
    const before = current();
    // The root has already acted, so a second action on it is rejected.
    expect(dispatch(place(1))).toBe(false);
    expect(game.value).toBe(before);
    expect(lastError.value).toMatch(/\w/);
  });

  it('clears the previous error on the next success', () => {
    dispatch(endTurn);
    expect(lastError.value).not.toBeNull();
    expect(dispatch(place(4))).toBe(true);
    expect(lastError.value).toBeNull();
  });

  it('reports an engine exception instead of throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = current();
    expect(
      dispatch(() => {
        throw new RangeError('No node #99.');
      }),
    ).toBe(false);
    expect(game.value).toBe(before);
    expect(lastError.value).toContain('No node #99.');
    spy.mockRestore();
  });

  it('follows the hot seat through End Turn', () => {
    dispatch(place(13));
    expect(dispatch(endTurn)).toBe(true);
    expect(hotSeatPlayer.value).toBe(1);
    expect(current().round).toBe(1);
  });

  it('refuses to act without a game', () => {
    quit();
    expect(dispatch(place(0))).toBe(false);
    expect(lastError.value).toBe('No game in progress.');
  });
});

describe('update (undo and clear)', () => {
  beforeEach(() => {
    startGame(FLAT);
    dispatch((s) => addAction(s, { kind: 'split', head: 0 }));
  });

  it('undo pops the last draft action', () => {
    expect(current().draft).toHaveLength(1);
    expect(liveCount.value).toBe(2);
    update(undo);
    expect(current().draft).toHaveLength(0);
    expect(liveCount.value).toBe(1);
  });

  it('clear empties the draft and the error', () => {
    dispatch(endTurn); // fine: the split acted on the only head
    dispatch((s) => addAction(s, { kind: 'split', head: 1 }));
    dispatch((s) => addAction(s, { kind: 'split', head: 1 })); // rejected: already acted
    expect(lastError.value).not.toBeNull();
    update(clear);
    expect(current().draft).toHaveLength(0);
    expect(lastError.value).toBeNull();
  });

  it('is a no-op without a game', () => {
    quit();
    update(undo);
    expect(game.value).toBeNull();
  });
});

describe('quit and routing', () => {
  it('drops the game and returns to start', () => {
    startGame(FLAT);
    dispatch(place(0));
    quit();
    expect(game.value).toBeNull();
    expect(lastError.value).toBeNull();
    expect(hotSeatPlayer.value).toBeNull();
    expect(liveCount.value).toBe(0);
    expect(route.value).toEqual({ screen: 'start' });
  });

  it('redirects every game route to start when there is no game', () => {
    navigate({ screen: 'multiverse' });
    expect(route.value).toEqual({ screen: 'start' });
    navigate({ screen: 'timeline', node: 0, readOnly: false });
    expect(route.value).toEqual({ screen: 'start' });
  });

  it('opens timelines of preview nodes only', () => {
    startGame(FLAT);
    dispatch((s) => addAction(s, { kind: 'split', head: 0 }));
    navigate({ screen: 'timeline', node: 2, readOnly: false }); // a draft-created node
    expect(route.value).toEqual({ screen: 'timeline', node: 2, readOnly: false });
    navigate({ screen: 'timeline', node: 7, readOnly: true });
    expect(route.value).toEqual({ screen: 'multiverse' });
  });

  it('guardRoute is pure and lets start through', () => {
    expect(guardRoute({ screen: 'start' }, null)).toEqual({ screen: 'start' });
    expect(guardRoute({ screen: 'multiverse' }, null)).toEqual({ screen: 'start' });
  });
});
