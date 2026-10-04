import type { HeadStatus, Player } from '@/engine';
import { COLORS, playerColor, playerName } from '../tokens';

/** Accessible names for the node statuses (also the legend labels). */
export const STATUS_LABELS: Readonly<Record<HeadStatus, string>> = {
  needsAction: 'Needs action',
  acted: 'Acted this turn',
  waiting: 'Waiting',
  history: 'History',
  won: 'Won',
  drawn: 'Drawn',
  frozen: 'Decided this turn',
  draftCreated: 'Created this turn',
};

interface StatusGlyphProps {
  readonly status: HeadStatus;
  /** The hot-seat player (colours needs-action and acted); null after the game. */
  readonly seat: Player | null;
  /** The player to move at the node (colours a waiting ring). */
  readonly mover: Player;
  /** Who won a won or frozen-won node. */
  readonly winner?: Player | null;
  /** A valid target in picking mode: a 3 px black ring and a crosshair. */
  readonly target?: boolean;
  /** A mark received by transfer, waiting at this head: a hollow badge top-right. */
  readonly incoming?: Player | null;
  /** The node being viewed: a 4 px bar underneath. */
  readonly current?: boolean;
  readonly title?: string;
}

const R = 12;
const BOX = 40;
const C = BOX / 2;

/**
 * A multiverse node in the design-system §7 vocabulary, as a 24 px circle in a 40 px box (room
 * for the target ring, the incoming badge and the current-view bar). Reused by the Stage 5 graph.
 */
export function StatusGlyph(props: StatusGlyphProps) {
  const { status, seat, mover, winner = null, target = false, incoming = null } = props;
  const seatColor = playerColor(seat ?? mover);
  let body;
  switch (status) {
    case 'needsAction':
      body = <circle cx={C} cy={C} r={R} fill={seatColor} />;
      break;
    case 'acted':
      body = (
        <>
          <circle
            cx={C}
            cy={C}
            r={R - 1.5}
            fill={COLORS.white}
            stroke={seatColor}
            stroke-width={3}
          />
          <circle cx={C} cy={C} r={3} fill={COLORS.black} />
        </>
      );
      break;
    case 'waiting':
      body = (
        <circle
          cx={C}
          cy={C}
          r={R - 0.5}
          fill={COLORS.white}
          stroke={playerColor(mover)}
          stroke-width={1}
        />
      );
      break;
    case 'history':
      body = <circle cx={C} cy={C} r={6} fill={COLORS.grey60} />;
      break;
    case 'won':
      body = (
        <>
          <circle cx={C} cy={C} r={R} fill={COLORS.done} />
          {winner === 1 ? (
            <circle cx={C} cy={C} r={5} fill={COLORS.white} />
          ) : (
            <rect x={C - 5} y={C - 5} width={10} height={10} fill={COLORS.white} />
          )}
        </>
      );
      break;
    case 'drawn':
      body = (
        <>
          <circle cx={C} cy={C} r={R} fill={COLORS.done} />
          <rect x={C - 5} y={C - 4} width={10} height={2} fill={COLORS.white} />
          <rect x={C - 5} y={C + 2} width={10} height={2} fill={COLORS.white} />
        </>
      );
      break;
    case 'frozen':
      body = (
        <circle
          cx={C}
          cy={C}
          r={R - 1.5}
          fill={COLORS.white}
          stroke={COLORS.done}
          stroke-width={3}
          stroke-dasharray="4 3"
        />
      );
      break;
    case 'draftCreated':
      body = (
        <circle
          cx={C}
          cy={C}
          r={R - 0.5}
          fill={COLORS.white}
          stroke={COLORS.black}
          stroke-width={1}
          stroke-dasharray="3 2"
        />
      );
      break;
  }
  const label = props.title ?? STATUS_LABELS[status];
  return (
    <svg
      class="status-glyph"
      width={BOX}
      height={BOX}
      viewBox={`0 0 ${BOX} ${BOX}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {target && (
        <g stroke={COLORS.black} fill="none">
          <circle cx={C} cy={C} r={R + 4.5} stroke-width={3} />
          <path
            d={`M${C} 0V6M${C} ${BOX - 6}V${BOX}M0 ${C}H6M${BOX - 6} ${C}H${BOX}`}
            stroke-width={1}
          />
        </g>
      )}
      {body}
      {incoming !== null && (
        <g aria-label={`Received a mark for ${playerName(incoming)}`}>
          {incoming === 0 ? (
            <rect
              x={BOX - 11}
              y={2}
              width={8}
              height={8}
              fill={COLORS.white}
              stroke={playerColor(0)}
              stroke-width={2}
            />
          ) : (
            <circle
              cx={BOX - 7}
              cy={6}
              r={4}
              fill={COLORS.white}
              stroke={playerColor(1)}
              stroke-width={2}
            />
          )}
        </g>
      )}
      {props.current && <rect x={C - R} y={BOX - 4} width={2 * R} height={4} fill={COLORS.black} />}
    </svg>
  );
}
