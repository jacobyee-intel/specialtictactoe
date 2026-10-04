import type { CellId, Player } from '@/engine';
import { COLORS, playerColor } from '../tokens';

/** Everything that decides how one board position looks (design-system §6). */
export interface CellLook {
  /** 0 empty, 1 Player 1, 2 Player 2. */
  readonly value: number;
  /** A halo or seam ghost of a real cell: drawn faint, never a target. */
  readonly ghost: boolean;
  /** The mark came from another node: outline glyph plus a small arrow. */
  readonly received: boolean;
  readonly lastMove: boolean;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly hovered: boolean;
  /** Part of the node's winning line: green 4 px outline. */
  readonly win: boolean;
  /** Players threatening to complete a line here (dashed outline per player). */
  readonly threats: readonly Player[];
  /** Part of the line(s) of the hovered threat: solid outline in that player's colour. */
  readonly threatLine: Player | null;
  /** Open-line count for the overlay (empty cells only), scaled against `max`. */
  readonly open: { readonly count: number; readonly max: number; readonly player: Player } | null;
  /** Picking mode: whether this cell is one of the offered cells (null outside picking). */
  readonly pickable: boolean | null;
  /** Act mode: clicking does something here. */
  readonly interactive: boolean;
  /** On the tracer's walk: a black dot, or a black ring for the walker's cell. */
  readonly trace?: 'visited' | 'current' | null;
}

interface CellProps {
  readonly cell: CellId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly look: CellLook;
  readonly label: string;
  readonly onClick?: ((cell: CellId) => void) | undefined;
  readonly onHover?: (cell: CellId | null) => void;
}

/** The player's mark: a solid square (P1) or circle (P2) inset 20%, or its outline. */
function Mark(props: { x: number; y: number; size: number; player: Player; outline: boolean }) {
  const { x, y, size, player, outline } = props;
  const color = playerColor(player);
  const inset = size * 0.2;
  const sw = outline ? Math.max(2, Math.round(size / 16)) : 0;
  const paint = outline
    ? { fill: COLORS.white, stroke: color, 'stroke-width': sw }
    : { fill: color, stroke: 'none' };
  if (player === 0) {
    const s = size - 2 * inset - sw;
    return <rect x={x + inset + sw / 2} y={y + inset + sw / 2} width={s} height={s} {...paint} />;
  }
  return <circle cx={x + size / 2} cy={y + size / 2} r={size / 2 - inset - sw / 2} {...paint} />;
}

/** A small → at the bottom right: this mark arrived from another node. */
function Arrow(props: { x: number; y: number; size: number }) {
  const s = Math.max(6, Math.round(props.size / 5));
  const x1 = props.x + props.size - 3;
  const y1 = props.y + props.size - 3 - s / 2;
  return (
    <path
      d={`M${x1 - s} ${y1}H${x1}M${x1 - s / 2} ${y1 - s / 2}L${x1} ${y1}L${x1 - s / 2} ${y1 + s / 2}`}
      fill="none"
      stroke={COLORS.black}
      stroke-width={1.5}
    />
  );
}

/** An outline inset by `inset` px with a given stroke, drawn inside the cell. */
function Outline(props: {
  x: number;
  y: number;
  size: number;
  inset: number;
  width: number;
  color: string;
  dash?: string;
}) {
  const o = props.inset + props.width / 2;
  return (
    <rect
      x={props.x + o}
      y={props.y + o}
      width={props.size - 2 * o}
      height={props.size - 2 * o}
      fill="none"
      stroke={props.color}
      stroke-width={props.width}
      stroke-dasharray={props.dash}
    />
  );
}

/**
 * One board position. Empty cells are grey-10 squares with a 1 px white gap; marks, overlays and
 * states are layered on top in a fixed order so they never hide each other's meaning.
 */
export function Cell(props: CellProps) {
  const { x, y, size, look, cell } = props;
  const g = 1;
  const greyed = look.pickable === false;
  const openField = look.open !== null && look.value === 0 && !look.ghost;
  let fill: string = COLORS.grey10;
  if (look.hovered && !greyed) fill = COLORS.grey30;
  else if (look.ghost || openField) fill = COLORS.white;
  const mark = look.value === 0 ? null : ((look.value - 1) as Player);
  const clickable =
    !look.ghost && (look.pickable === true || (look.pickable === null && look.interactive));
  const tick = Math.max(6, Math.round(size * 0.3));
  const open = look.open;

  return (
    <g
      class={clickable ? 'cell cell--clickable' : 'cell'}
      data-cell={cell}
      data-kind={look.ghost ? 'ghost' : 'cell'}
      role={look.ghost ? undefined : 'gridcell'}
      aria-label={look.ghost ? undefined : props.label}
      aria-selected={look.selected ? 'true' : undefined}
      onClick={() => props.onClick?.(cell)}
      onMouseEnter={() => props.onHover?.(cell)}
      onMouseLeave={() => props.onHover?.(null)}
    >
      <rect x={x + g / 2} y={y + g / 2} width={size - g} height={size - g} fill={fill} />
      {look.ghost && (
        <Outline x={x} y={y} size={size} inset={g / 2} width={1} color={COLORS.grey30} />
      )}
      {open !== null && openField && open.max > 0 && open.count > 0 && (
        <OpenField x={x} y={y} size={size} {...open} />
      )}
      {mark !== null && (
        <g opacity={look.ghost ? 0.3 : 1}>
          {greyed ? (
            <g fill={COLORS.grey30}>
              {mark === 0 ? (
                <rect
                  x={x + size * 0.2}
                  y={y + size * 0.2}
                  width={size * 0.6}
                  height={size * 0.6}
                />
              ) : (
                <circle cx={x + size / 2} cy={y + size / 2} r={size * 0.3} />
              )}
            </g>
          ) : (
            <Mark x={x} y={y} size={size} player={mark} outline={look.received} />
          )}
          {look.received && !look.ghost && <Arrow x={x} y={y} size={size} />}
        </g>
      )}
      {look.lastMove && !look.ghost && (
        <path
          d={`M${x + 5} ${y + 5 + tick}V${y + 5}H${x + 5 + tick}`}
          fill="none"
          stroke={COLORS.black}
          stroke-width={4}
          stroke-linecap="square"
        />
      )}
      {look.pickable === true && (
        <Outline x={x} y={y} size={size} inset={1} width={1} color={COLORS.black} />
      )}
      {look.threatLine !== null && !look.ghost && (
        <Outline x={x} y={y} size={size} inset={1} width={2} color={playerColor(look.threatLine)} />
      )}
      {look.threats.map((p, i) => (
        <Outline
          key={p}
          x={x}
          y={y}
          size={size}
          inset={1 + 3 * i}
          width={2}
          color={playerColor(p)}
          dash="4 3"
        />
      ))}
      {look.win && <Outline x={x} y={y} size={size} inset={0} width={4} color={COLORS.done} />}
      {look.trace != null && (
        <g class="cell-trace" data-trace={look.trace} opacity={look.ghost ? 0.5 : 1}>
          <circle
            cx={x + size / 2}
            cy={y + size / 2}
            r={Math.max(2, size * 0.09)}
            fill={COLORS.black}
          />
          {look.trace === 'current' && (
            <circle
              cx={x + size / 2}
              cy={y + size / 2}
              r={Math.max(4, size * 0.36)}
              fill="none"
              stroke={COLORS.black}
              stroke-width={2}
            />
          )}
        </g>
      )}
      {look.cursor && (
        <Outline x={x} y={y} size={size} inset={5} width={1} color={COLORS.black} dash="2 2" />
      )}
      {look.selected && (
        <Outline x={x} y={y} size={size} inset={0} width={3} color={COLORS.black} />
      )}
    </g>
  );
}

/** The open-lines overlay: a tint square whose area grows with the count, and the numeral. */
function OpenField(props: {
  x: number;
  y: number;
  size: number;
  count: number;
  max: number;
  player: Player;
}) {
  const { x, y, size, count, max, player } = props;
  const side = (size - 2) * Math.sqrt(count / max);
  const tint = player === 0 ? COLORS.p1Tint : COLORS.p2Tint;
  return (
    <>
      <rect
        x={x + (size - side) / 2}
        y={y + (size - side) / 2}
        width={side}
        height={side}
        fill={tint}
      />
      {size >= 20 && (
        <text
          class="cell-numeral t-num"
          x={x + size / 2}
          y={y + size / 2}
          text-anchor="middle"
          dominant-baseline="central"
        >
          {count}
        </text>
      )}
    </>
  );
}
