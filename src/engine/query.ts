/**
 * Read-only queries for the UI. All of them look at the cached preview, so they reflect the
 * draft, and none of them changes the state.
 */
import { markOf } from '@/geometry';
import { checkHead, checkSendable, checkTerminal, reject, sendBackOptions } from './actions';
import { effectiveBoard, emptyCellsOf, withMark } from './board';
import { requiredHeads, tryAction } from './draft';
import { childrenOf, nodeAt, parityPlayer, strictAncestors } from './tree';
import type {
  ActionKind,
  CellId,
  GameState,
  Incoming,
  NodeId,
  Player,
  Rejection,
  TargetOption,
} from './types';

export type HeadStatus =
  /** A committed head the current player still has to act on. */
  | 'needsAction'
  /** A committed head that has an action in the draft (or ended by a received mark). */
  | 'acted'
  /** A terminal node created by the draft: decided, but not scored until End Turn. */
  | 'frozen'
  /** A live head where the other player is to move (or any head outside the draft phase). */
  | 'waiting'
  /** A committed node that already has children. */
  | 'history'
  | 'won'
  | 'drawn'
  /** A live node created by the draft. */
  | 'draftCreated';

/** How the UI should draw node `id` of the preview. Throws `RangeError` for an unknown id. */
export function headStatus(state: GameState, id: NodeId): HeadStatus {
  const node = nodeAt(state.preview, id);
  const committed = id < state.nodes.length;
  if (node.terminal) {
    if (!committed) return 'frozen';
    return node.terminal.kind === 'win' ? 'won' : 'drawn';
  }
  if (!committed) return 'draftCreated';
  if (childrenOf(state, id).length > 0) return 'history';
  if (state.phase !== 'draft' || parityPlayer(node.step) !== state.current) return 'waiting';
  return state.preview.ledger.acted.has(id) ? 'acted' : 'needsAction';
}

/** The mark node `id` received by transfer this turn, if any. */
export function incomingOf(state: GameState, id: NodeId): Incoming | null {
  return state.preview.ledger.incoming.get(id) ?? null;
}

export function hasIncoming(state: GameState, id: NodeId): boolean {
  return state.preview.ledger.incoming.has(id);
}

/** The player who must act now (the sender during a send-back prompt), or null when over. */
export function hotSeat(state: GameState): Player | null {
  if (state.phase === 'over') return null;
  return state.pendingSendBack?.player ?? state.current;
}

/** Live timelines in the preview, for the "Timelines k/32" HUD. */
export function liveTimelines(state: GameState): number {
  return state.preview.live;
}

/** Empty cells of a preview node's board, including any mark it received this turn. */
export function emptyCells(state: GameState, id: NodeId): CellId[] {
  return emptyCellsOf(effectiveBoard(nodeAt(state.preview, id), state.preview.ledger));
}

/** Cells of `head` whose mark the current player may send (empty if the head cannot act). */
export function sendableCells(state: GameState, head: NodeId): CellId[] {
  if (checkHead(state, head)) return [];
  const node = nodeAt(state, head);
  const out: CellId[] = [];
  for (let c = 0; c < node.board.length; c++) if (!checkSendable(state, node, c)) out.push(c);
  return out;
}

export type Availability = { readonly ok: true } | Rejection;

const OK: Availability = { ok: true };

/**
 * Which action kinds `head` offers right now, each with a reason when disabled (for button
 * tooltips). An enabled kind is guaranteed to have at least one legal choice of arguments.
 */
export function legalActionKinds(
  state: GameState,
  head: NodeId,
): Readonly<Record<ActionKind, Availability>> {
  const problem = checkHead(state, head);
  if (problem) return { place: problem, split: problem, timeTravel: problem, transfer: problem };
  const split = tryAction(state, { kind: 'split', head });
  const sendable = sendableCells(state, head);
  const noMark = reject('notOwnMark', 'You have no mark of your own here to send.');

  let timeTravel: Availability = noMark;
  const from = sendable[0];
  if (from !== undefined) {
    if (timeTravelTargets(state, head, from).length > 0) timeTravel = OK;
    else if (timeTravelOptions(state, head, false).length > 0) {
      timeTravel = reject('timelineCap', 'Time travel would exceed the timeline cap.');
    } else {
      timeTravel = reject('noTarget', 'No earlier node where you were to move has an empty cell.');
    }
  }
  let transfer: Availability = noMark;
  if (sendable.length > 0) {
    transfer =
      transferTargets(state, head).length > 0
        ? OK
        : reject('noTarget', 'No other timeline at the same step can receive a mark.');
  }
  // A live head is never full, so there is always a cell to place on.
  return { place: OK, split: split.ok ? OK : split, timeTravel, transfer };
}

/** Ancestors of `head` the current player may time-travel to, with their legal cells. */
function timeTravelOptions(state: GameState, head: NodeId, withCap: boolean): TargetOption[] {
  const player = state.current;
  const mark = markOf(player);
  // The source child replaces the head, so only a non-terminal arrival adds a live timeline:
  // with no free slot only an arrival that ends at once fits, and over the cap nothing does.
  const room = state.config.maxTimelines - state.preview.live;
  if (withCap && room < 0) return [];
  const atCap = withCap && room === 0;
  const out: TargetOption[] = [];
  for (const id of strictAncestors(state, head).reverse()) {
    const node = nodeAt(state, id);
    if (parityPlayer(node.step) !== player) continue;
    let cells = emptyCellsOf(node.board);
    if (atCap) {
      cells = cells.filter(
        (c) => checkTerminal(withMark(node.board, c, mark), [c], player, state.lines) !== null,
      );
    }
    if (cells.length > 0) out.push({ node: id, cells });
  }
  return out;
}

/** Legal time-travel destinations for sending the mark at `fromCell` of `head`, root first. */
export function timeTravelTargets(
  state: GameState,
  head: NodeId,
  fromCell: CellId,
): TargetOption[] {
  if (checkHead(state, head) || checkSendable(state, nodeAt(state, head), fromCell)) return [];
  return timeTravelOptions(state, head, true);
}

/** Heads that may receive a transfer from `head`, with their empty cells. */
export function transferTargets(state: GameState, head: NodeId): TargetOption[] {
  if (checkHead(state, head)) return [];
  const step = nodeAt(state, head).step;
  const { ledger } = state.preview;
  const out: TargetOption[] = [];
  for (const id of requiredHeads(state)) {
    if (id === head || ledger.acted.has(id) || ledger.incoming.has(id)) continue;
    const node = nodeAt(state, id);
    if (node.step !== step) continue;
    const cells = emptyCellsOf(node.board);
    if (cells.length > 0) out.push({ node: id, cells });
  }
  return out;
}

/** Legal targets for the pending send-back (empty when none is pending). */
export function sendBackTargets(state: GameState): TargetOption[] {
  const pending = state.pendingSendBack;
  if (pending === null) return [];
  return sendBackOptions(state, pending.terminal, pending.player);
}

export { canEndTurn, missingHeads, requiredHeads } from './draft';
