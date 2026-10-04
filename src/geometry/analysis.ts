/**
 * Board queries on top of a {@link LineIndex}. Boards are `Uint8Array`s indexed by cell:
 * 0 = empty, 1 = player 0's mark, 2 = player 1's mark.
 */
import { lineCells, linesThroughCell, type LineIndex } from './lines';
import type { CellId, Player } from './types';

export const EMPTY = 0;

/** The board value written by `player`. */
export function markOf(player: Player): 1 | 2 {
  return player === 0 ? 1 : 2;
}

/**
 * The first line through `cell` whose other cells all hold `player`'s mark, or −1.
 *
 * `cell` itself is treated as `player`'s, so this works both before and after the mark is
 * written. Only the lines through `cell` are examined.
 */
export function completesLine(
  board: Uint8Array,
  cell: CellId,
  player: Player,
  index: LineIndex,
): number {
  const mark = markOf(player);
  for (const lineId of linesThroughCell(index, cell)) {
    if (lineCells(index, lineId).every((c) => c === cell || board[c] === mark)) return lineId;
  }
  return -1;
}

/** A line that `player` can complete with one more mark at `missingCell`. */
export interface Threat {
  readonly lineId: number;
  readonly missingCell: CellId;
}

/** All lines holding M−1 of `player`'s marks and one empty cell. */
export function threats(board: Uint8Array, player: Player, index: LineIndex): Threat[] {
  const mark = markOf(player);
  const out: Threat[] = [];
  for (let lineId = 0; lineId < index.lineCount; lineId++) {
    let missingCell = -1;
    let ok = true;
    for (const c of lineCells(index, lineId)) {
      if (board[c] === mark) continue;
      if (board[c] !== EMPTY || missingCell !== -1) {
        ok = false;
        break;
      }
      missingCell = c;
    }
    if (ok && missingCell !== -1) out.push({ lineId, missingCell });
  }
  return out;
}

/** Ids of the lines that `player` could still complete (no opponent marks on them). */
export function openLines(board: Uint8Array, player: Player, index: LineIndex): number[] {
  const opponent = markOf(player === 0 ? 1 : 0);
  const out: number[] = [];
  for (let lineId = 0; lineId < index.lineCount; lineId++) {
    if (lineCells(index, lineId).every((c) => board[c] !== opponent)) out.push(lineId);
  }
  return out;
}

/** True when no cell is empty. */
export function isFull(board: Uint8Array): boolean {
  return board.every((v) => v !== EMPTY);
}
