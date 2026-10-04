/**
 * Data for the board overlays, from the geometry's line analysis.
 *
 * - **Threats**: every line where a player has M−1 marks and one empty cell. The missing cell
 *   gets a dashed outline in that player's colour; hovering it highlights the rest of the line.
 * - **Open lines**: for one player, how many still-winnable lines (no opponent mark) pass
 *   through each cell. It shows the geometry's character at a glance: on the 3-torus every cell
 *   of an empty board has the same count (the space is homogeneous), while on the flat cube the
 *   centre dominates and the corners and edges trail.
 *
 * Both take the *effective* board of a node (its own marks plus a mark it received by transfer
 * this turn), which is what the player is about to move on.
 */
import {
  lineCells,
  linesThroughCell,
  openLines,
  threats,
  type CellId,
  type LineIndex,
  type Player,
} from '@/geometry';
import { effectiveBoard, nodeAt, type GameState, type NodeId } from '@/engine';

/** A missing cell that would complete one or more of `player`'s lines. */
export interface ThreatMark {
  readonly cell: CellId;
  readonly player: Player;
  readonly lineIds: readonly number[];
  /** The other cells of those lines (already `player`'s), for the hover highlight. */
  readonly others: readonly CellId[];
}

/** Threats of both players, one entry per (cell, player), ordered by cell then player. */
export function threatMarks(board: Uint8Array, lines: LineIndex): ThreatMark[] {
  const byKey = new Map<string, { cell: CellId; player: Player; lineIds: number[] }>();
  for (const player of [0, 1] as const) {
    for (const t of threats(board, player, lines)) {
      const key = `${t.missingCell}:${player}`;
      const entry = byKey.get(key) ?? { cell: t.missingCell, player, lineIds: [] };
      entry.lineIds.push(t.lineId);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.cell - b.cell || a.player - b.player)
    .map((e) => {
      const others = new Set<CellId>();
      for (const id of e.lineIds)
        for (const c of lineCells(lines, id)) if (c !== e.cell) others.add(c);
      return { ...e, others: [...others].sort((a, b) => a - b) };
    });
}

export interface OpenLineCounts {
  readonly player: Player;
  /** Open lines through each cell (occupied cells included; the board shows empty ones). */
  readonly counts: Int32Array;
  /** The largest count over the empty cells (0 if none), for scaling the tint. */
  readonly max: number;
}

/** How many of `player`'s open lines pass through each cell. */
export function openLineCounts(
  board: Uint8Array,
  player: Player,
  lines: LineIndex,
): OpenLineCounts {
  const counts = new Int32Array(lines.cellCount);
  for (const id of openLines(board, player, lines)) {
    for (const c of lineCells(lines, id)) counts[c] = (counts[c] as number) + 1;
  }
  let max = 0;
  for (let c = 0; c < counts.length; c++) if (board[c] === 0) max = Math.max(max, counts[c] ?? 0);
  return { player, counts, max };
}

/** Number of lines through a cell, whatever the marks (for the hover caption). */
export function lineCountAt(lines: LineIndex, cell: CellId): number {
  return linesThroughCell(lines, cell).length;
}

/** The effective board of preview node `id` (with any mark received this turn). */
export function boardOf(state: GameState, id: NodeId): Uint8Array {
  return effectiveBoard(nodeAt(state.preview, id), state.preview.ledger);
}
