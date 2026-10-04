/**
 * View model of the timeline screen: its mode, the cell selection, the action bar, the cursor
 * and the captions. Pure functions of engine state, so the component only renders and wires
 * events, and every rule-dependent decision comes from the engine's queries.
 */
import {
  emptyCells,
  headStatus,
  legalActionKinds,
  nodeAt,
  parityPlayer,
  sendableCells,
  timeTravelTargets,
  transferTargets,
  type CellId,
  type GameState,
  type NodeId,
  type Player,
} from '@/engine';
import type { Panel } from './board2d/layout';
import { coordLabel, statusCaption } from './describe';
import { cellsFor, type Flow } from './flow';
import { lineCountAt, boardOf } from './overlays';
import { playerName } from './tokens';

const other = (p: Player): Player => (p === 0 ? 1 : 0);

// --- Mode ----------------------------------------------------------------------------------------

export type TimelineMode =
  /** A flow is picking a cell on this node: only `cells` are clickable. */
  | { readonly kind: 'pickCell'; readonly cells: readonly CellId[] }
  /** The hot-seat player can act on this head. */
  | { readonly kind: 'act' }
  /** Nothing to do here; `reason` says why ("History", "Player 2 moves here", …). */
  | { readonly kind: 'read'; readonly reason: string };

/** What the timeline screen for preview node `node` lets the player do. */
export function timelineMode(
  state: GameState,
  node: NodeId,
  flow: Flow,
  routeReadOnly = false,
): TimelineMode {
  if (flow.kind !== 'idle' && flow.target === node) {
    const cells = cellsFor(flow, state, node);
    if (cells !== null) return { kind: 'pickCell', cells };
  }
  const status = headStatus(state, node);
  if (state.phase === 'draft' && status === 'needsAction' && flow.kind === 'idle') {
    if (!routeReadOnly) return { kind: 'act' };
    return { kind: 'read', reason: 'Read-only view' };
  }
  if (flow.kind !== 'idle' && status === 'needsAction') {
    return { kind: 'read', reason: 'Finish picking a target first' };
  }
  return { kind: 'read', reason: statusCaption(state, node) };
}

// --- Selection -----------------------------------------------------------------------------------

/** The act-mode selection: an empty cell to place on, or one of your marks to send. */
export type Selection =
  { readonly kind: 'none' } | { readonly kind: 'place' | 'send'; readonly cell: CellId };

export const NO_SELECTION: Selection = { kind: 'none' };

/**
 * Clicking a cell in act mode: an empty cell becomes the placement target, one of your sendable
 * marks becomes the mark to send, and clicking the selected cell again deselects it.
 */
export function clickCell(
  state: GameState,
  node: NodeId,
  selection: Selection,
  cell: CellId,
): Selection {
  if (selection.kind !== 'none' && selection.cell === cell) return NO_SELECTION;
  if (emptyCells(state, node).includes(cell)) return { kind: 'place', cell };
  if (sendableCells(state, node).includes(cell)) return { kind: 'send', cell };
  return NO_SELECTION;
}

/** Drop a selection that is no longer valid (after undo, or when the node changed). */
export function validSelection(state: GameState, node: NodeId, selection: Selection): Selection {
  if (selection.kind === 'none') return selection;
  const ok =
    selection.kind === 'place'
      ? emptyCells(state, node).includes(selection.cell)
      : sendableCells(state, node).includes(selection.cell);
  return ok ? selection : NO_SELECTION;
}

// --- Action bar ----------------------------------------------------------------------------------

export type ActId = 'place' | 'split' | 'timeTravel' | 'transfer' | 'undo' | 'clear';

export interface BarButton {
  readonly id: ActId;
  readonly label: string;
  readonly primary: boolean;
  /** Null when enabled; otherwise the tooltip that explains why not. */
  readonly disabledReason: string | null;
  /** Keyboard shortcut shown in the tooltip-free title. */
  readonly key: string;
}

const NEEDS_MARK = 'Select one of your marks first';

/** The act-mode buttons with their enabled state, in bar order. */
export function actButtons(state: GameState, node: NodeId, selection: Selection): BarButton[] {
  const legal = legalActionKinds(state, node);
  const send = selection.kind === 'send' ? selection.cell : null;
  const reason = (r: { ok: true } | { ok: false; message: string }) => (r.ok ? null : r.message);
  const draftEmpty = state.draft.length === 0;

  let timeTravel: string | null = send === null ? NEEDS_MARK : reason(legal.timeTravel);
  if (send !== null && timeTravel === null && timeTravelTargets(state, node, send).length === 0) {
    timeTravel = 'No earlier node can take that mark.';
  }
  let transfer: string | null = send === null ? NEEDS_MARK : reason(legal.transfer);
  if (send !== null && transfer === null && transferTargets(state, node).length === 0) {
    transfer = 'No other timeline can receive a mark.';
  }
  return [
    {
      id: 'place',
      label: 'Place',
      primary: true,
      key: 'Enter',
      disabledReason:
        selection.kind === 'place' ? reason(legal.place) : 'Select an empty cell first',
    },
    { id: 'split', label: 'Split', primary: false, key: 'S', disabledReason: reason(legal.split) },
    {
      id: 'timeTravel',
      label: 'Time travel',
      primary: false,
      key: 'T',
      disabledReason: timeTravel,
    },
    { id: 'transfer', label: 'Transfer', primary: false, key: 'R', disabledReason: transfer },
    {
      id: 'undo',
      label: 'Undo',
      primary: false,
      key: 'Ctrl+Z',
      disabledReason: draftEmpty ? 'Nothing to undo' : null,
    },
    {
      id: 'clear',
      label: 'Clear',
      primary: false,
      key: '',
      disabledReason: draftEmpty ? 'Nothing to clear' : null,
    },
  ];
}

/** The left-zone preview shown while Split is hovered or focused. */
export function splitPreviewText(state: GameState, node: NodeId): string {
  const n = nodeAt(state.preview, node);
  const next = playerName(other(parityPlayer(n.step)));
  return `Two timelines at T = ${n.step + 1} with this board. ${next} moves first in both.`;
}

// --- Flows ---------------------------------------------------------------------------------------

/** The prompt while a flow is picking a node (multiverse banner). */
export function pickPrompt(state: GameState, flow: Flow): string | null {
  switch (flow.kind) {
    case 'idle':
      return null;
    case 'timeTravel':
      return 'Choose a past node for your mark';
    case 'transfer':
      return 'Choose a timeline to receive your mark';
    case 'sendBack':
      return sendBackPrompt(state, flow.player, flow.terminal);
  }
}

/** "Player 2: forced send-back. Timeline #14 was won by Player 1. Choose a past node." */
export function sendBackPrompt(state: GameState, player: Player, terminal: NodeId): string {
  const { title, detail } = sendBackBanner(state, player, terminal);
  return `${title}. ${detail}`;
}

/** The send-back prompt split for the banner: a 48 px title and a detail line. */
export function sendBackBanner(
  state: GameState,
  player: Player,
  terminal: NodeId,
): { title: string; detail: string } {
  const t = nodeAt(state.preview, terminal).terminal;
  const why =
    t?.kind === 'win'
      ? `Timeline #${terminal} was won by ${playerName(t.winner)}.`
      : `Timeline #${terminal} was drawn.`;
  return { title: `${playerName(player)}: forced send-back`, detail: `${why} Choose a past node.` };
}

/**
 * The confirm line of a flow on its target's timeline: "Send (1, 2, 0) to #4 at (0, 0, 2)",
 * or what to pick next while no cell is chosen.
 */
export function confirmSentence(state: GameState, flow: Flow): string | null {
  if (flow.kind === 'idle' || flow.target === null) return null;
  const at = (c: CellId) => coordLabel(state.topology, c);
  if (flow.cell === null) {
    return flow.kind === 'sendBack'
      ? `Pick an empty cell on #${flow.target} for the new mark`
      : `Pick an empty cell on #${flow.target} for ${at(flow.fromCell)}`;
  }
  if (flow.kind === 'sendBack') {
    return `Send a new mark back to #${flow.target} at ${at(flow.cell)}`;
  }
  return `Send ${at(flow.fromCell)} to #${flow.target} at ${at(flow.cell)}`;
}

// --- Cursor and captions -------------------------------------------------------------------------

export type CursorKey =
  'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown';

/**
 * Move the keyboard cursor among the real cells of the visible panels: arrows within the
 * panel (stopping at its edges), PageUp/PageDown to the same position on the previous/next
 * panel. Without a cursor, any key lands on the first cell.
 */
export function moveCursor(
  panels: readonly Panel[],
  cursor: CellId | null,
  key: CursorKey,
): CellId | null {
  const real = panels.filter((p) => p.cells.some((c) => c.kind === 'cell'));
  const first = real[0]?.cells.find((c) => c.kind === 'cell')?.cell ?? null;
  if (cursor === null) return first;
  const pi = real.findIndex((p) => p.cells.some((c) => c.cell === cursor));
  const panel = real[pi];
  const at = panel?.cells.find((c) => c.cell === cursor);
  if (panel === undefined || at === undefined) return first;
  const find = (p: Panel, col: number, row: number) =>
    p.cells.find((c) => c.kind === 'cell' && c.col === col && c.row === row)?.cell ?? null;
  const dc = { ArrowLeft: -1, ArrowRight: 1 }[key as string] ?? 0;
  const dr = { ArrowUp: -1, ArrowDown: 1 }[key as string] ?? 0;
  if (dc !== 0 || dr !== 0) return find(panel, at.col + dc, at.row + dr) ?? cursor;
  const target = real[pi + (key === 'PageUp' ? -1 : 1)];
  return target === undefined ? cursor : (find(target, at.col, at.row) ?? cursor);
}

/** "(2, 0, 1) · 13 lines through this cell · empty". */
export function hoverCaption(state: GameState, node: NodeId, cell: CellId): string {
  const lines = lineCountAt(state.lines, cell);
  const value = boardOf(state, node)[cell];
  const n = nodeAt(state.preview, node);
  const content = value === 0 ? 'empty' : playerName((value === 1 ? 0 : 1) as Player);
  const received =
    n.received?.cell === cell || state.preview.ledger.incoming.get(node)?.cell === cell
      ? ', received'
      : '';
  return `${coordLabel(state.topology, cell)} · ${lines} ${lines === 1 ? 'line' : 'lines'} through this cell · ${content}${received}`;
}
