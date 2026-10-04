/**
 * Copy-on-write board helpers. Boards inside nodes are never mutated, so every change makes a
 * new `Uint8Array`.
 */
import { EMPTY, markOf } from '@/geometry';
import type { CellId, Ledger, TNode } from './types';
import { parityPlayer } from './tree';

/** A copy of `board` with `value` written at `cell`. */
export function withMark(board: Uint8Array, cell: CellId, value: number): Uint8Array {
  const out = board.slice();
  out[cell] = value;
  return out;
}

/** A copy of `board` with `cell` emptied. */
export function withoutMark(board: Uint8Array, cell: CellId): Uint8Array {
  return withMark(board, cell, EMPTY);
}

/**
 * The board a head's next action starts from: its own board plus the mark it received by
 * transfer this turn, if any. Transfers only go to heads of the mover's parity, so the received
 * mark belongs to the player to move at `node`.
 */
export function effectiveBoard(node: TNode, ledger: Ledger): Uint8Array {
  const incoming = ledger.incoming.get(node.id);
  if (incoming === undefined) return node.board;
  return withMark(node.board, incoming.cell, markOf(parityPlayer(node.step)));
}

/** The empty cells of a board, in increasing order. */
export function emptyCellsOf(board: Uint8Array): number[] {
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) if (board[c] === EMPTY) out.push(c);
  return out;
}

/** Compact save format: one digit per cell ("0", "1" or "2"). */
export function encodeBoard(board: Uint8Array): string {
  return board.join('');
}

/** Inverse of {@link encodeBoard}; null if the string is not `cellCount` digits 0–2. */
export function decodeBoard(text: unknown, cellCount: number): Uint8Array | null {
  if (typeof text !== 'string' || text.length !== cellCount || !/^[012]*$/.test(text)) return null;
  return Uint8Array.from(text, (ch) => Number(ch));
}
