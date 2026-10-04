/**
 * The picking flows as a pure state machine: time travel, transfer and the forced send-back.
 *
 * Each flow is "pick a node, then a cell on it, then confirm", with the multiverse used for the
 * node and the timeline screen for the cell. The reducer only accepts nodes and cells that the
 * engine's own target queries offer, so the UI never re-implements a rule; the engine validates
 * again when the result is dispatched.
 *
 * `step` never dispatches anything itself. When a flow completes it returns the `Action` (or
 * the `SendBack`) for the caller to dispatch, and the flow goes back to idle. A send-back that
 * starts a chain shows up as a *new* pending send-back in the next state; {@link syncFlow} turns
 * that into a fresh send-back flow for the new sender.
 */
import {
  legalActionKinds,
  sendBackTargets,
  timeTravelTargets,
  transferTargets,
  type Action,
  type CellId,
  type GameState,
  type NodeId,
  type Player,
  type SendBack,
  type TargetOption,
} from '@/engine';

export type Flow =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'timeTravel' | 'transfer';
      readonly head: NodeId;
      readonly fromCell: CellId;
      readonly target: NodeId | null;
      readonly cell: CellId | null;
    }
  | {
      readonly kind: 'sendBack';
      /** Who must send back, and the terminal node that caused it (identifies the prompt). */
      readonly player: Player;
      readonly terminal: NodeId;
      readonly target: NodeId | null;
      readonly cell: CellId | null;
    };

export type FlowKind = Flow['kind'];

export type FlowEvent =
  | {
      readonly type: 'begin';
      readonly kind: 'timeTravel' | 'transfer';
      readonly head: NodeId;
      readonly fromCell: CellId;
    }
  | { readonly type: 'pickNode'; readonly node: NodeId }
  | { readonly type: 'pickCell'; readonly cell: CellId }
  | { readonly type: 'confirm' }
  /** One step back: unpick the cell, else the node (else, for time travel/transfer, cancel). */
  | { readonly type: 'back' }
  | { readonly type: 'cancel' };

export interface FlowStep {
  readonly flow: Flow;
  readonly action?: Action;
  readonly sendBack?: SendBack;
  readonly error?: string;
}

export const IDLE: Flow = { kind: 'idle' };

/** The nodes (with their legal cells) the flow may pick from, straight from the engine. */
export function targetsFor(flow: Flow, state: GameState): TargetOption[] {
  switch (flow.kind) {
    case 'idle':
      return [];
    case 'timeTravel':
      return timeTravelTargets(state, flow.head, flow.fromCell);
    case 'transfer':
      return transferTargets(state, flow.head);
    case 'sendBack':
      return sendBackTargets(state);
  }
}

/** The cells the flow may pick on `node`, or null if `node` is not a target. */
export function cellsFor(flow: Flow, state: GameState, node: NodeId): readonly CellId[] | null {
  return targetsFor(flow, state).find((t) => t.node === node)?.cells ?? null;
}

/** A fresh send-back flow for the state's pending prompt (null when none is pending). */
function sendBackFlow(state: GameState): Flow | null {
  const p = state.pendingSendBack;
  if (state.phase !== 'awaitSendBack' || p === null) return null;
  return { kind: 'sendBack', player: p.player, terminal: p.terminal, target: null, cell: null };
}

/**
 * The flow the UI should actually be in for `state`. The engine's phase wins: a pending
 * send-back forces the send-back flow (fresh for each new prompt, so chains restart at "pick a
 * node"), and no flow survives into a state where its picks are no longer offered.
 */
export function syncFlow(flow: Flow, state: GameState | null): Flow {
  if (state === null) return IDLE;
  const forced = sendBackFlow(state);
  if (forced !== null && forced.kind === 'sendBack') {
    const same =
      flow.kind === 'sendBack' &&
      flow.player === forced.player &&
      flow.terminal === forced.terminal;
    return same ? flow : forced;
  }
  if (flow.kind === 'idle' || flow.kind === 'sendBack') return IDLE;
  const targets = targetsFor(flow, state);
  if (targets.length === 0) return IDLE;
  if (flow.target === null) return flow;
  const option = targets.find((t) => t.node === flow.target);
  if (option === undefined) return { ...flow, target: null, cell: null };
  if (flow.cell !== null && !option.cells.includes(flow.cell)) return { ...flow, cell: null };
  return flow;
}

const fail = (flow: Flow, error: string): FlowStep => ({ flow, error });

function begin(state: GameState, event: Extract<FlowEvent, { type: 'begin' }>): FlowStep {
  const flow: Flow = {
    kind: event.kind,
    head: event.head,
    fromCell: event.fromCell,
    target: null,
    cell: null,
  };
  if (targetsFor(flow, state).length > 0) return { flow };
  const why = legalActionKinds(state, event.head)[event.kind];
  return fail(IDLE, why.ok ? 'There is no valid target for that mark.' : why.message);
}

/** The result of a completed flow, ready to dispatch. */
function complete(flow: Flow, target: NodeId, cell: CellId): FlowStep {
  switch (flow.kind) {
    case 'timeTravel':
      return {
        flow: IDLE,
        action: {
          kind: 'timeTravel',
          head: flow.head,
          fromCell: flow.fromCell,
          target,
          toCell: cell,
        },
      };
    case 'transfer':
      return {
        flow: IDLE,
        action: {
          kind: 'transfer',
          head: flow.head,
          fromCell: flow.fromCell,
          targetHead: target,
          toCell: cell,
        },
      };
    case 'sendBack':
      return { flow: IDLE, sendBack: { target, cell } };
    case 'idle':
      return fail(flow, 'Nothing to confirm.');
  }
}

/** Advance the flow by one user event. Invalid events leave the flow as it was, with `error`. */
export function step(flow: Flow, event: FlowEvent, state: GameState): FlowStep {
  if (event.type === 'begin') {
    if (flow.kind === 'sendBack') return fail(flow, 'Finish the forced send-back first.');
    return begin(state, event);
  }
  if (flow.kind === 'idle') return fail(flow, 'Nothing is being picked.');

  switch (event.type) {
    case 'pickNode': {
      if (cellsFor(flow, state, event.node) === null) {
        return fail(flow, `#${event.node} is not a valid target.`);
      }
      return { flow: { ...flow, target: event.node, cell: null } };
    }
    case 'pickCell': {
      if (flow.target === null) return fail(flow, 'Choose a node first.');
      const cells = cellsFor(flow, state, flow.target);
      if (cells === null || !cells.includes(event.cell)) {
        return fail(flow, 'That cell is not available.');
      }
      return { flow: { ...flow, cell: event.cell } };
    }
    case 'confirm': {
      if (flow.target === null || flow.cell === null) return fail(flow, 'Choose a cell first.');
      const cells = cellsFor(flow, state, flow.target);
      if (cells === null || !cells.includes(flow.cell)) {
        return fail(flow, 'That cell is not available.');
      }
      return complete(flow, flow.target, flow.cell);
    }
    case 'back': {
      if (flow.cell !== null) return { flow: { ...flow, cell: null } };
      if (flow.target !== null) return { flow: { ...flow, target: null } };
      if (flow.kind === 'sendBack') return { flow };
      return { flow: IDLE };
    }
    case 'cancel': {
      if (flow.kind === 'sendBack') return fail(flow, 'A forced send-back cannot be cancelled.');
      return { flow: IDLE };
    }
  }
}

/** True while a node is being picked (the multiverse is in picking mode). */
export function isPickingNode(flow: Flow): boolean {
  return flow.kind !== 'idle' && flow.target === null;
}
