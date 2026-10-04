import type { Player } from '@/engine';
import { playerColor, playerName } from '../tokens';

/**
 * The player's shape in the player's colour: a square for Player 1, a circle for Player 2
 * (design-system §6). The shape is the colour-blind-safe half of the signal, so it is never
 * dropped. `outline` draws the received-mark variant.
 */
export function PlayerGlyph(props: { player: Player; size?: number; outline?: boolean }) {
  const { player, size = 16, outline = false } = props;
  const color = playerColor(player);
  const paint = outline
    ? { fill: 'none', stroke: color, 'stroke-width': 2 }
    : { fill: color, stroke: 'none' };
  // Outlines are inset by half the stroke so they are not clipped at the viewBox edge.
  const inset = outline ? 1 : 0;
  return (
    <svg
      class="player-glyph"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={playerName(player)}
    >
      {player === 0 ? (
        <rect x={inset} y={inset} width={size - 2 * inset} height={size - 2 * inset} {...paint} />
      ) : (
        <circle cx={size / 2} cy={size / 2} r={size / 2 - inset} {...paint} />
      )}
    </svg>
  );
}
