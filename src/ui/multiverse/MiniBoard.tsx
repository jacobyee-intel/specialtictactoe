import { useMemo } from 'preact/hooks';
import { TesseractSurface } from '@/geometry';
import type { GameState, NodeId } from '@/engine';
import { boardView } from '../board2d/boardView';
import { filterGroup, layoutPanels, panelGroups, type Panel } from '../board2d/layout';
import { COLORS, playerColor } from '../tokens';

/** Cell pitches to try (px, a square plus its 1 px white gap), largest first; 6 px is the floor. */
export const MINI_CELLS = [10, 8, 6] as const;
const MINI_GAP = 8;
/** The width the mini board may use: the right column (cols 10–12) at a 1440 px window. */
export const MINI_WIDTH = 288;

/** The largest cell pitch at which `panels` panels of `size` cells fit `width` (at least 6 px). */
export function miniCell(panels: number, size: number, width = MINI_WIDTH): number {
  for (const cell of MINI_CELLS) {
    if (panels * size * cell + (panels - 1) * MINI_GAP <= width) return cell;
  }
  return 6;
}

/**
 * The panels the mini board shows: the real slices only (no halos, no seam panel), and on the
 * tesseract only the first cube, with how many cubes are left out.
 */
export function miniPanels(state: GameState): { panels: Panel[]; hiddenGroups: number } {
  const all = layoutPanels(state.topology, { halos: false }).filter((p) => p.frame !== 'ghost');
  if (!(state.topology instanceof TesseractSurface)) return { panels: all, hiddenGroups: 0 };
  const groups = panelGroups(all);
  return {
    panels: filterGroup(all, groups[0]?.index ?? null),
    hiddenGroups: Math.max(0, groups.length - 1),
  };
}

/**
 * A tiny read-only board for the node card: the slices side by side at 6–10 px per cell (the
 * largest that fits the column; N = 6 and the tesseract's 4 × 4 cubes at N = 4 still fit at
 * 6 px), using the same panel layout as the 2D board so the slices read the same way.
 */
export function MiniBoard(props: { readonly state: GameState; readonly node: NodeId }) {
  const { state, node } = props;
  const { panels, hiddenGroups } = useMemo(() => miniPanels(state), [state.topology]);
  const view = boardView(state, node, { threats: false, openFor: null });
  const win = new Set(view.win?.cells ?? []);
  const size = panels[0]?.cols ?? 0;
  const cellPx = miniCell(panels.length, size);
  const pitch = size * cellPx + MINI_GAP;
  const width = Math.max(0, panels.length * pitch - MINI_GAP);
  const height = size * cellPx;
  const s = cellPx - 1;

  return (
    <figure class="mini-board">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Board of #${node}`}
      >
        {panels.map((panel, i) => (
          <g key={panel.key} transform={`translate(${i * pitch} 0)`}>
            {panel.cells.map(({ cell, col, row }) => {
              if (cell === null) return null;
              const x = col * cellPx;
              const y = row * cellPx;
              const v = view.board[cell] ?? 0;
              const hollow = view.received.has(cell);
              const color = v === 0 ? COLORS.grey10 : playerColor(v === 1 ? 0 : 1);
              const paint = hollow
                ? { fill: COLORS.white, stroke: color, 'stroke-width': 1 }
                : { fill: color };
              return (
                <g key={cell}>
                  {v === 2 ? (
                    <circle
                      cx={x + s / 2}
                      cy={y + s / 2}
                      r={hollow ? s / 2 - 0.5 : s / 2}
                      {...paint}
                    />
                  ) : (
                    <rect
                      x={hollow ? x + 0.5 : x}
                      y={hollow ? y + 0.5 : y}
                      width={hollow ? s - 1 : s}
                      height={hollow ? s - 1 : s}
                      {...paint}
                    />
                  )}
                  {win.has(cell) && (
                    <rect
                      x={x - 0.5}
                      y={y - 0.5}
                      width={s + 1}
                      height={s + 1}
                      fill="none"
                      stroke={COLORS.done}
                      stroke-width={1}
                    />
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {hiddenGroups > 0 && (
        <figcaption class="t-caption t-grey">
          {panels[0]?.group} shown, +{hiddenGroups} cubes
        </figcaption>
      )}
    </figure>
  );
}
