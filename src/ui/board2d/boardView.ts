/**
 * What the 2D board draws for one node, as plain data: the effective board, which marks were
 * received, the last move, the winning line and the overlays. `Board2D` only turns this into SVG.
 */
import { lineCells } from '@/geometry';
import {
  incomingOf,
  nodeAt,
  type CellId,
  type GameState,
  type NodeId,
  type Player,
} from '@/engine';
import {
  boardOf,
  openLineCounts,
  threatMarks,
  type OpenLineCounts,
  type ThreatMark,
} from '../overlays';

export interface BoardView {
  /** 0 empty, 1 Player 1, 2 Player 2: the node's board plus any mark received this turn. */
  readonly board: Uint8Array;
  /** Marks that arrived from another node (transfer or time travel): drawn hollow with →. */
  readonly received: ReadonlySet<CellId>;
  /** The cell the node's creating move touched (corner tick), if any. */
  readonly lastMove: CellId | null;
  /** The completed line of a won node, in traversal order. */
  readonly win: { readonly player: Player; readonly cells: readonly CellId[] } | null;
  readonly threats: readonly ThreatMark[];
  readonly open: OpenLineCounts | null;
}

export interface BoardViewOptions {
  readonly threats: boolean;
  /** Show open-line counts for this player, or null for off. */
  readonly openFor: Player | null;
}

export function boardView(state: GameState, id: NodeId, opts: BoardViewOptions): BoardView {
  const node = nodeAt(state.preview, id);
  const board = boardOf(state, id);
  const received = new Set<CellId>();
  if (node.received !== null) received.add(node.received.cell);
  const pending = node.terminal === null ? incomingOf(state, id) : null;
  if (pending !== null) received.add(pending.cell);
  const o = node.origin;
  if (o.kind === 'transferWin' || o.kind === 'ttArrival') received.add(o.cell);
  const lastMove = 'cell' in o ? o.cell : null;
  const t = node.terminal;
  const win =
    t?.kind === 'win'
      ? { player: t.winner, cells: Array.from(lineCells(state.lines, t.lineId)) }
      : null;
  return {
    board,
    received,
    lastMove,
    win,
    threats: opts.threats ? threatMarks(board, state.lines) : [],
    open: opts.openFor === null ? null : openLineCounts(board, opts.openFor, state.lines),
  };
}
