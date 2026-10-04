import type { CellId, Player } from '@/engine';
import { COLORS } from '../tokens';
import { Cell, type CellLook } from './Cell';
import { PANEL_TITLE, type Packing, type Panel } from './layout';
import type { BoardView } from './boardView';

/**
 * The axis hint ("x → y ↓") sits beside the first panel's title and may run into the 24 px
 * gutter, but no further: below this panel width (small cells, e.g. all eight tesseract cubes at
 * N = 3) it would collide with the next title, so it is left out.
 */
const AXES_MIN_WIDTH = 64;

export interface BoardInteraction {
  readonly hovered: CellId | null;
  readonly selected: CellId | null;
  readonly cursor: CellId | null;
  /** Picking mode: the cells on offer (others are greyed); null outside picking. */
  readonly pickable: ReadonlySet<CellId> | null;
  /** Act mode: cells are clickable. */
  readonly interactive: boolean;
  readonly onCellClick: (cell: CellId) => void;
  readonly onHover: (cell: CellId | null) => void;
  /** Accessible label for a cell, e.g. "(2, 0, 1), empty". */
  readonly label: (cell: CellId) => string;
  /** The 3D view's geodesic tracer: the cells walked so far and the walker's cell. */
  readonly trace?: { readonly visited: ReadonlySet<CellId>; readonly current: CellId } | null;
}

/**
 * The 2D board: every panel of a packing as an SVG of cells, with titles, frames, the axis hint
 * on the first panel and the winning line. All decisions come from `layout.ts` and
 * `boardView.ts`; this only draws them.
 */
export function Board2D(props: {
  readonly packing: Packing;
  readonly view: BoardView;
  readonly interaction: BoardInteraction;
}) {
  const { packing, view, interaction } = props;
  const size = packing.cellSize;

  // Hovering a threat cell highlights the rest of its line(s).
  const threatLine = new Map<CellId, Player>();
  const threatsAt = new Map<CellId, Player[]>();
  for (const t of view.threats) {
    threatsAt.set(t.cell, [...(threatsAt.get(t.cell) ?? []), t.player]);
    if (t.cell === interaction.hovered) for (const c of t.others) threatLine.set(c, t.player);
  }
  const winSet = new Set(view.win?.cells ?? []);

  const lookOf = (real: CellId, ghost: boolean): CellLook => ({
    value: view.board[real] ?? 0,
    ghost,
    received: view.received.has(real),
    lastMove: view.lastMove === real,
    selected: !ghost && interaction.selected === real,
    cursor: !ghost && interaction.cursor === real,
    hovered: interaction.hovered === real,
    win: !ghost && winSet.has(real),
    threats: ghost ? [] : (threatsAt.get(real) ?? []),
    threatLine: threatLine.get(real) ?? null,
    open:
      view.open === null
        ? null
        : { count: view.open.counts[real] ?? 0, max: view.open.max, player: view.open.player },
    pickable: interaction.pickable === null ? null : !ghost && interaction.pickable.has(real),
    interactive: interaction.interactive,
    trace:
      interaction.trace == null
        ? null
        : interaction.trace.current === real
          ? 'current'
          : interaction.trace.visited.has(real)
            ? 'visited'
            : null,
  });

  return (
    <div
      class="board2d t-num"
      style={{ width: `${packing.width}px`, height: `${packing.height}px` }}
      role="grid"
      aria-label="Board slices"
    >
      {packing.headings.map((h) => (
        <p
          key={h.text}
          class="t-caption t-bold board-heading"
          style={{ left: `${h.x}px`, top: `${h.y}px` }}
        >
          {h.text}
        </p>
      ))}
      {packing.panels.map(({ panel, x, y, width }, i) => (
        <div
          key={panel.key}
          class={`board-panel board-panel--${panel.frame}`}
          style={{ left: `${x}px`, top: `${y}px`, width: `${width}px` }}
          data-panel={panel.key}
        >
          <p class="t-caption board-panel-title" style={{ height: `${PANEL_TITLE}px` }}>
            <span>{panel.title}</span>
            {i === 0 && width >= AXES_MIN_WIDTH && (
              <span
                class="board-axes t-grey"
                aria-label={`${panel.axes.col} to the right, ${panel.axes.row} down`}
              >
                {panel.axes.col} → {panel.axes.row} ↓
              </span>
            )}
          </p>
          <PanelSvg
            panel={panel}
            size={size}
            lookOf={lookOf}
            view={view}
            interaction={interaction}
          />
        </div>
      ))}
    </div>
  );
}

function PanelSvg(props: {
  panel: Panel;
  size: number;
  view: BoardView;
  interaction: BoardInteraction;
  lookOf: (real: CellId, ghost: boolean) => CellLook;
}) {
  const { panel, size, view, interaction, lookOf } = props;
  const w = panel.cols * size;
  const h = panel.rows * size;
  const inner = panel.inner;
  const ix = inner.col * size;
  const iy = inner.row * size;
  const is = inner.size * size;

  // The winning line's connecting stroke, between consecutive cells that are neighbours here.
  const centres = new Map<CellId, [number, number]>();
  for (const c of panel.cells) {
    if (c.kind === 'cell' && c.cell !== null) {
      centres.set(c.cell, [(c.col + 0.5) * size, (c.row + 0.5) * size]);
    }
  }
  const segments: string[] = [];
  const line = view.win?.cells ?? [];
  for (let i = 1; i < line.length; i++) {
    const a = centres.get(line[i - 1] as CellId);
    const b = centres.get(line[i] as CellId);
    if (a && b && Math.abs(a[0] - b[0]) <= size && Math.abs(a[1] - b[1]) <= size) {
      segments.push(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`);
    }
  }

  return (
    <svg class="board-panel-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {panel.cells.map((c) => {
        const real = c.cell ?? c.ghostOf;
        if (real === undefined || real === null) return null;
        const ghost = c.kind !== 'cell';
        return (
          <Cell
            key={`${c.col}-${c.row}`}
            cell={real}
            x={c.col * size}
            y={c.row * size}
            size={size}
            look={lookOf(real, ghost)}
            label={interaction.label(real)}
            onClick={ghost ? undefined : interaction.onCellClick}
            onHover={interaction.onHover}
          />
        );
      })}
      {segments.length > 0 && (
        <path
          d={segments.join('')}
          fill="none"
          stroke={COLORS.done}
          stroke-width={Math.max(2, Math.round(size / 16))}
          stroke-linecap="square"
          pointer-events="none"
        />
      )}
      {panel.frame === 'boundary' && (
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          fill="none"
          stroke={COLORS.black}
          stroke-width={2}
          pointer-events="none"
        />
      )}
      {(panel.frame === 'seam' || panel.frame === 'ghost') && (
        <rect
          x={ix + 0.5}
          y={iy + 0.5}
          width={is - 1}
          height={is - 1}
          fill="none"
          stroke={COLORS.black}
          stroke-width={1}
          stroke-dasharray="4 3"
          pointer-events="none"
        />
      )}
    </svg>
  );
}
