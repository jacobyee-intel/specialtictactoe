import { describe, expect, it } from 'vitest';
import { addAction, concede, newGame, type GameState } from '@/engine';
import { hudModel } from './hud';

const fresh = () => newGame({ topology: 'tetracosm', n: 3, m: 3, w: 2, l: 12 });

describe('hudModel', () => {
  it('shows Player 1 at the start', () => {
    expect(hudModel(fresh())).toEqual({
      label: 'Player 1',
      player: 0,
      caption: null,
      round: 1,
      roundLimit: 12,
      score: [0, 0],
      live: 1,
      maxTimelines: 32,
      space: 'Quarter-turn space',
      alertBar: null,
    });
  });

  it('counts draft timelines', () => {
    const r = addAction(fresh(), { kind: 'split', head: 0 });
    if (!r.ok) throw new Error(r.message);
    expect(hudModel(r.state).live).toBe(2);
  });

  it('shows the sender during a forced send-back', () => {
    const s: GameState = {
      ...fresh(),
      phase: 'awaitSendBack',
      pendingSendBack: { player: 1, terminal: 0 },
    };
    expect(hudModel(s)).toMatchObject({
      label: 'Player 2',
      player: 1,
      caption: 'Forced send-back',
      alertBar: 1,
    });
  });

  it('shows the result when the game is over', () => {
    const r = concede(fresh(), 0);
    if (!r.ok) throw new Error(r.message);
    expect(hudModel(r.state)).toMatchObject({
      label: 'Player 2 wins',
      player: 1,
      caption: 'By concession',
      alertBar: null,
    });
    const draw: GameState = {
      ...fresh(),
      phase: 'over',
      round: 13,
      result: { kind: 'draw', reason: 'turnLimit' },
    };
    expect(hudModel(draw)).toMatchObject({
      label: 'Draw',
      player: null,
      caption: 'Round limit reached',
      round: 12,
    });
  });
});
