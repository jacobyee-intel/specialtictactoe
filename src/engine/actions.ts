/**
 * Validation and application of single actions. This is the one apply path: the draft preview
 * and the resolution replay both call {@link applyAction}, so they cannot diverge.
 *
 * ## Parity facts the rules rely on
 *
 * - Every node is created by the player who is *not* to move at it: a child of a head of step T
 *   has step T+1; a time-travel arrival under an ancestor A (at the mover's parity) has step
 *   A.step+1; a send-back by p targets a node at p's parity. {@link addChild} asserts this.
 *   So nothing the current player does in the draft creates a head that the current player must
 *   act on, and the set of required heads is fixed for the whole draft.
 * - A non-terminal node never contains a completed line and is never full: every node that
 *   gains a mark is checked for the lines through that mark, and removing a mark cannot create
 *   a line. Hence split children, time-travel sources, and transfer sources are never terminal,
 *   and each action creates at most one terminal node.
 */
import { EMPTY, completesLine, isFull, markOf, type LineIndex } from '@/geometry';
import { effectiveBoard, emptyCellsOf, withMark, withoutMark } from './board';
import { hasNode, isHead, isStrictAncestor, nodeAt, parityPlayer, strictAncestors } from './tree';
import type {
  Action,
  CellId,
  GameState,
  IllegalReason,
  Incoming,
  NodeId,
  Origin,
  Player,
  Rejection,
  SendBack,
  TargetOption,
  Terminal,
  TNode,
  Tree,
} from './types';

/** The mutable counterpart of `Ledger`, used only inside a single apply/replay. */
export interface MutableLedger {
  acted: Set<NodeId>;
  incoming: Map<NodeId, Incoming>;
}

/**
 * A private working copy of a tree. The arrays are copies; the nodes and the inner child lists
 * are shared and are replaced (never mutated) when they change.
 */
export interface Work {
  nodes: TNode[];
  children: (readonly NodeId[])[];
  ledger: MutableLedger;
}

export interface ApplyContext {
  readonly lines: LineIndex;
  /** Stamped on every new node. */
  readonly round: number;
}

export interface Applied {
  /** New node ids in creation order. */
  readonly created: readonly NodeId[];
  /** The terminal node this action created, if any (at most one, see the module comment). */
  readonly terminal: NodeId | null;
}

const MESSAGES: Readonly<Record<IllegalReason, string>> = {
  gameOver: 'The game is over.',
  wrongPhase: 'That is not possible right now.',
  notYourTurn: 'Only the player in the hot seat can do that.',
  turnIncomplete: 'Every one of your timelines needs an action first.',
  unknownNode: 'There is no such node.',
  badCell: 'There is no such cell.',
  notHead: 'Only a live timeline from the start of this turn can act.',
  wrongParity: 'It is not your move on that timeline.',
  alreadyActed: 'That timeline already has an action this turn.',
  cellOccupied: 'That cell is not empty.',
  notOwnMark: 'You can only send one of your own marks.',
  receivedThisTurn: 'A mark received this turn cannot be sent on.',
  notAncestor: 'The target must be an earlier node of this timeline.',
  targetWrongParity: 'The target must be a node where you were to move.',
  sameHead: 'A transfer must go to a different timeline.',
  targetNotRequired: 'The target must be one of your live timelines this turn.',
  targetActed: 'The target timeline has already acted.',
  targetHasIncoming: 'The target timeline has already received a mark.',
  stepMismatch: 'Both timelines must be at the same step.',
  noTarget: 'There is no valid target.',
  timelineCap: 'Too many live timelines.',
};

export function reject(reason: IllegalReason, message: string = MESSAGES[reason]): Rejection {
  return { ok: false, reason, message };
}

/** Internal consistency check; a failure is an engine bug, never a user error. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Engine invariant violated: ${message}`);
}

/** A fresh copy of a tree plus ledger, safe to mutate. */
export function forkWork(
  tree: Tree,
  ledger: { acted: Iterable<NodeId>; incoming: Iterable<[NodeId, Incoming]> },
): Work {
  return {
    nodes: tree.nodes.slice(),
    children: tree.children.slice(),
    ledger: { acted: new Set(ledger.acted), incoming: new Map(ledger.incoming) },
  };
}

/**
 * Did placing `player`'s mark on `cells` (already written into `board`) end the timeline?
 * A win takes priority over a draw; the first winning cell decides the reported line.
 */
export function checkTerminal(
  board: Uint8Array,
  cells: readonly CellId[],
  player: Player,
  lines: LineIndex,
): Terminal | null {
  for (const cell of cells) {
    const lineId = completesLine(board, cell, player, lines);
    if (lineId >= 0) return { kind: 'win', winner: player, lineId };
  }
  return isFull(board) ? { kind: 'draw', filler: player } : null;
}

function addChild(
  work: Work,
  ctx: ApplyContext,
  creator: Player,
  parentId: NodeId,
  board: Uint8Array,
  terminal: Terminal | null,
  origin: Origin,
  received: Incoming | null = null,
): NodeId {
  const parent = nodeAt(work, parentId);
  const id = work.nodes.length;
  const step = parent.step + 1;
  invariant(parityPlayer(step) !== creator, `node #${id} would be its creator's move`);
  work.nodes.push({
    id,
    parent: parentId,
    step,
    board,
    terminal,
    origin,
    received,
    round: ctx.round,
  });
  work.children.push([]);
  work.children[parentId] = [...(work.children[parentId] ?? []), id];
  return id;
}

/** Apply a draft action that has already been validated. */
export function applyAction(work: Work, action: Action, ctx: ApplyContext): Applied {
  const head = nodeAt(work, action.head);
  const p = parityPlayer(head.step);
  const mark = markOf(p);
  const { ledger } = work;
  const received = ledger.incoming.get(head.id) ?? null;
  const eff = effectiveBoard(head, ledger);
  ledger.acted.add(head.id);

  switch (action.kind) {
    case 'place': {
      const board = withMark(eff, action.cell, mark);
      // The received mark is re-checked too, although a line through it alone would already have
      // ended this head when the transfer applied.
      const cells = received ? [action.cell, received.cell] : [action.cell];
      const terminal = checkTerminal(board, cells, p, ctx.lines);
      const id = addChild(work, ctx, p, head.id, board, terminal, place(action.cell), received);
      return { created: [id], terminal: terminal ? id : null };
    }
    case 'split': {
      const a = addChild(work, ctx, p, head.id, eff, null, { kind: 'split' }, received);
      const b = addChild(work, ctx, p, head.id, eff, null, { kind: 'split' }, received);
      return { created: [a, b], terminal: null };
    }
    case 'timeTravel': {
      const target = nodeAt(work, action.target);
      const sourceId = work.nodes.length;
      addChild(
        work,
        ctx,
        p,
        head.id,
        withoutMark(eff, action.fromCell),
        null,
        {
          kind: 'ttSource',
          cell: action.fromCell,
          arrival: sourceId + 1,
        },
        received,
      );
      const board = withMark(target.board, action.toCell, mark);
      const terminal = checkTerminal(board, [action.toCell], p, ctx.lines);
      const arrival = addChild(work, ctx, p, target.id, board, terminal, {
        kind: 'ttArrival',
        cell: action.toCell,
        source: sourceId,
      });
      return { created: [sourceId, arrival], terminal: terminal ? arrival : null };
    }
    case 'transfer': {
      const x = nodeAt(work, action.targetHead);
      const source = addChild(
        work,
        ctx,
        p,
        head.id,
        withoutMark(eff, action.fromCell),
        null,
        {
          kind: 'transferSource',
          cell: action.fromCell,
          to: x.id,
          toCell: action.toCell,
        },
        received,
      );
      ledger.incoming.set(x.id, { cell: action.toCell, from: head.id });
      const board = withMark(x.board, action.toCell, mark);
      const terminal = checkTerminal(board, [action.toCell], p, ctx.lines);
      if (terminal === null) return { created: [source], terminal: null };
      // The received mark alone ended X, so X is resolved and its action counts as done.
      ledger.acted.add(x.id);
      const id = addChild(work, ctx, p, x.id, board, terminal, {
        kind: 'transferWin',
        cell: action.toCell,
        from: head.id,
      });
      return { created: [source, id], terminal: id };
    }
  }
}

const place = (cell: CellId): Origin => ({ kind: 'place', cell });

/** Apply a validated send-back by `player`, owed because `terminal` ended. */
export function applySendBack(
  work: Work,
  sendBack: SendBack,
  player: Player,
  terminal: NodeId,
  ctx: ApplyContext,
): { node: NodeId; terminal: boolean } {
  const target = nodeAt(work, sendBack.target);
  const board = withMark(target.board, sendBack.cell, markOf(player));
  const end = checkTerminal(board, [sendBack.cell], player, ctx.lines);
  const node = addChild(work, ctx, player, target.id, board, end, {
    kind: 'sendBack',
    cell: sendBack.cell,
    terminal,
  });
  return { node, terminal: end !== null };
}

function checkCell(state: GameState, board: Uint8Array, cell: unknown): Rejection | null {
  if (
    !Number.isInteger(cell) ||
    (cell as number) < 0 ||
    (cell as number) >= state.topology.cellCount
  ) {
    return reject('badCell');
  }
  return board[cell as number] === EMPTY ? null : reject('cellOccupied');
}

/** Is `id` a committed head where the current player must act this turn? */
export function isRequiredHead(state: GameState, id: NodeId): boolean {
  return (
    hasNode(state, id) &&
    isHead(state, id) &&
    parityPlayer(nodeAt(state, id).step) === state.current
  );
}

/** The checks shared by every draft action on `head`. */
export function checkHead(state: GameState, id: unknown): Rejection | null {
  if (state.phase === 'over') return reject('gameOver');
  if (state.phase !== 'draft') return reject('wrongPhase');
  if (!hasNode(state.preview, id)) return reject('unknownNode');
  if (!hasNode(state, id)) {
    return reject('notHead', 'This node was created this turn; it can act next turn.');
  }
  if (!isHead(state, id)) return reject('notHead');
  if (parityPlayer(nodeAt(state, id).step) !== state.current) return reject('wrongParity');
  if (state.preview.ledger.acted.has(id)) return reject('alreadyActed');
  return null;
}

/**
 * Can `cell` of `head` be sent away (time travel or transfer)? Only the current player's marks
 * on the *committed* board qualify, so a mark received this turn never can.
 */
export function checkSendable(state: GameState, head: TNode, cell: unknown): Rejection | null {
  const incoming = state.preview.ledger.incoming.get(head.id);
  if (incoming !== undefined && incoming.cell === cell) return reject('receivedThisTurn');
  if (!Number.isInteger(cell) || head.board[cell as number] !== markOf(state.current)) {
    return reject('notOwnMark');
  }
  return null;
}

/**
 * Check a draft action against the rules, the committed tree, and the current ledger. The
 * timeline cap needs the action applied, so it is checked by the draft module.
 */
export function validateAction(state: GameState, action: Action): Rejection | null {
  const headProblem = checkHead(state, action.head);
  if (headProblem) return headProblem;
  const head = nodeAt(state, action.head);
  const ledger = state.preview.ledger;

  switch (action.kind) {
    case 'place':
      return checkCell(state, effectiveBoard(head, ledger), action.cell);
    case 'split':
      return null;
    case 'timeTravel': {
      const notSendable = checkSendable(state, head, action.fromCell);
      if (notSendable) return notSendable;
      if (!hasNode(state.preview, action.target)) return reject('unknownNode');
      if (!isStrictAncestor(state, action.target, head.id)) return reject('notAncestor');
      const target = nodeAt(state, action.target);
      invariant(target.step < head.step, 'an ancestor has an earlier step');
      if (parityPlayer(target.step) !== state.current) return reject('targetWrongParity');
      return checkCell(state, target.board, action.toCell);
    }
    case 'transfer': {
      const notSendable = checkSendable(state, head, action.fromCell);
      if (notSendable) return notSendable;
      if (action.targetHead === head.id) return reject('sameHead');
      if (!hasNode(state.preview, action.targetHead)) return reject('unknownNode');
      if (!isRequiredHead(state, action.targetHead)) return reject('targetNotRequired');
      if (ledger.acted.has(action.targetHead)) return reject('targetActed');
      if (ledger.incoming.has(action.targetHead)) return reject('targetHasIncoming');
      const target = nodeAt(state, action.targetHead);
      if (target.step !== head.step) return reject('stepMismatch');
      return checkCell(state, target.board, action.toCell);
    }
  }
}

/** Check a send-back against the pending prompt. */
export function validateSendBack(state: GameState, sendBack: SendBack): Rejection | null {
  const pending = state.pendingSendBack;
  if (state.phase === 'over') return reject('gameOver');
  if (state.phase !== 'awaitSendBack' || pending === null) return reject('wrongPhase');
  if (!hasNode(state, sendBack.target)) return reject('unknownNode');
  if (!isStrictAncestor(state, sendBack.target, pending.terminal)) return reject('notAncestor');
  const target = nodeAt(state, sendBack.target);
  invariant(target.step < nodeAt(state, pending.terminal).step, 'a send-back goes strictly back');
  if (parityPlayer(target.step) !== pending.player) return reject('targetWrongParity');
  return checkCell(state, target.board, sendBack.cell);
}

/**
 * Where `player` may send back for `terminal`: strict ancestors (so strictly earlier steps) at
 * the player's parity with an empty cell, root first.
 */
export function sendBackOptions(tree: Tree, terminal: NodeId, player: Player): TargetOption[] {
  const out: TargetOption[] = [];
  for (const id of strictAncestors(tree, terminal).reverse()) {
    const node = nodeAt(tree, id);
    if (parityPlayer(node.step) !== player) continue;
    const cells = emptyCellsOf(node.board);
    if (cells.length > 0) out.push({ node: id, cells });
  }
  return out;
}
