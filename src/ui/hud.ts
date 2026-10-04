/**
 * What the HUD bar says, as plain data (design-system §5). The `<Hud>` component only lays it
 * out, so all the phase-dependent wording is tested here in node.
 */
import { hotSeat, type GameState, type Player, type Result } from '@/engine';
import { TOPOLOGY_INFO } from '@/geometry';
import { playerName } from './tokens';

export interface HudModel {
  /** The big label: the hot-seat player, or the result once the game is over. */
  readonly label: string;
  /** Colour and glyph of the label; null for a draw. */
  readonly player: Player | null;
  /** Small caption under the label ("Forced send-back", "By concession", …), if any. */
  readonly caption: string | null;
  /** Shown as `Round r / L`; r never exceeds L, even after the round limit ends the game. */
  readonly round: number;
  readonly roundLimit: number;
  readonly score: readonly [number, number];
  readonly live: number;
  readonly maxTimelines: number;
  readonly space: string;
  /** A full-width bar in this player's colour under the HUD (forced send-back prompt). */
  readonly alertBar: Player | null;
}

function resultLabel(result: Result): Pick<HudModel, 'label' | 'player' | 'caption'> {
  if (result.kind === 'win') {
    return {
      label: `${playerName(result.winner)} wins`,
      player: result.winner,
      caption: result.reason === 'concede' ? 'By concession' : 'By score',
    };
  }
  return {
    label: 'Draw',
    player: null,
    caption: result.reason === 'turnLimit' ? 'Round limit reached' : 'No live timelines left',
  };
}

export function hudModel(state: GameState): HudModel {
  const { config } = state;
  const seat = hotSeat(state);
  const sendBack = state.phase === 'awaitSendBack' && state.pendingSendBack !== null;
  let head: Pick<HudModel, 'label' | 'player' | 'caption'>;
  if (state.phase === 'over' && state.result !== null) head = resultLabel(state.result);
  else if (seat === null) head = { label: 'Game over', player: null, caption: null };
  else
    head = { label: playerName(seat), player: seat, caption: sendBack ? 'Forced send-back' : null };
  return {
    ...head,
    round: Math.min(state.round, config.l),
    roundLimit: config.l,
    score: state.score,
    live: state.preview.live,
    maxTimelines: config.maxTimelines,
    space: TOPOLOGY_INFO[config.topology].displayName,
    alertBar: sendBack ? seat : null,
  };
}
