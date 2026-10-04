import type { HeadStatus, Player } from '@/engine';
import { STATUS_LABELS } from '../describe';
import { COLORS, playerColor, playerName } from '../tokens';

export { STATUS_LABELS };

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
  /**
   * Draw in a 32 × 32 box instead of 40 × 40 (the legend): the target ring hugs the circle and
   * the view bar sits right under it, so nothing leaves the box.
   */
  readonly compact?: boolean;
  readonly title?: string;
}

const R = 12;
/** The glyph's box: room around the 24 px circle for the target ring, badge and view bar. */
export const GLYPH_BOX = 40;
/** The compact box (legend rows). */
export const COMPACT_BOX = 32;

/**
 * The drawing of {@link StatusGlyph} without its `<svg>` wrapper, in a 40 × 40 box with the node
 * centre at (20, 20) (32 × 32 and (16, 16) when compact). The graph places it in its own SVG.
 */
export function StatusGlyphBody(props: Omit<StatusGlyphProps, 'title'>) {
  const { status, seat, mover, winner = null, target = false, incoming = null } = props;
  const compact = props.compact ?? false;
  const BOX = compact ? COMPACT_BOX : GLYPH_BOX;
  const C = BOX / 2;
  // Ring radius (3 px stroke) and crosshair tick length: the outer edge stays inside the box.
  const ringR = compact ? R + 2.5 : R + 4.5;
  const tick = compact ? 4 : 6;
  // The badge's top-left corner.
  const badge = compact ? { x: BOX - 9, y: 1 } : { x: BOX - 11, y: 2 };
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
  return (
    <>
      {target && (
        <g stroke={COLORS.black} fill="none">
          <circle cx={C} cy={C} r={ringR} stroke-width={3} />
          <path
            d={`M${C} 0V${tick}M${C} ${BOX - tick}V${BOX}M0 ${C}H${tick}M${BOX - tick} ${C}H${BOX}`}
            stroke-width={1}
          />
        </g>
      )}
      {body}
      {incoming !== null && (
        <g aria-label={`Received a mark for ${playerName(incoming)}`}>
          {incoming === 0 ? (
            <rect
              x={badge.x}
              y={badge.y}
              width={8}
              height={8}
              fill={COLORS.white}
              stroke={playerColor(0)}
              stroke-width={2}
            />
          ) : (
            <circle
              cx={badge.x + 4}
              cy={badge.y + 4}
              r={4}
              fill={COLORS.white}
              stroke={playerColor(1)}
              stroke-width={2}
            />
          )}
        </g>
      )}
      {props.current && <rect x={C - R} y={BOX - 4} width={2 * R} height={4} fill={COLORS.black} />}
    </>
  );
}

/**
 * A multiverse node in the design-system §7 vocabulary, as a 24 px circle in a 40 px box (room
 * for the target ring, the incoming badge and the current-view bar), or compact in 32 px. The
 * list and the legend use it; the graph draws the same {@link StatusGlyphBody}.
 */
export function StatusGlyph(props: StatusGlyphProps) {
  const label = props.title ?? STATUS_LABELS[props.status];
  const BOX = props.compact ? COMPACT_BOX : GLYPH_BOX;
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
      <StatusGlyphBody {...props} />
    </svg>
  );
}
