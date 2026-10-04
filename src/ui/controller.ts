/**
 * The turn controller: the glue between the store, the picking flows and the router.
 *
 * Screens call these functions instead of combining `dispatch`, `step` and `navigate`
 * themselves, so the list multiverse of Stage 4 and the graph of Stage 5 share one tested
 * implementation of "pick a target", "end the turn", "send back" and "hand over the seat".
 *
 * - {@link flow} is the picking flow the UI is in. It is derived from the user's picks and the
 *   engine state, so a pending send-back always forces the send-back flow (and a chain restarts
 *   it for the next sender) without any screen having to remember to.
 * - {@link handoff} is the player who must take the seat before play continues: the
 *   "Player 2, your turn" screen hides the board until they press Start turn.
 * - {@link notice} summarises what resolution did ("Player 1 won timeline #14 · …").
 *
 * Like the store, everything here runs in node; `play.test.ts` plays whole games through it.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import {
  addAction,
  canEndTurn,
  clear,
  concede,
  endTurn,
  hotSeat,
  missingHeads,
  submitSendBack,
  undo,
  type Action,
  type ActionResult,
  type GameState,
  type NodeId,
  type Player,
} from '@/engine';
import { eventSummary, missingSentence } from './describe';
import { IDLE, step, syncFlow, type Flow, type FlowEvent } from './flow';
import { navigate } from './router';
import { dispatch, game, lastConfig, lastError, startGame, update } from './store';

/** The user's flow before it is reconciled with the engine state; see {@link flow}. */
const picked = signal<Flow>(IDLE);

/** The picking flow in effect (a pending send-back always wins). */
export const flow = computed(() => syncFlow(picked.value, game.value));

/** The player who must take the seat before play continues, or null. */
export const handoff = signal<Player | null>(null);

/** What the last resolution did, shown in the message area until dismissed or replaced. */
export const notice = signal<string | null>(null);

/** The timeline the player looked at last: the graph marks it with the current-view bar. */
export const lastViewed = signal<NodeId | null>(null);

/** Index into `state.events` where the turn being resolved began (for the summary). */
let turnStart = 0;

/**
 * A new game or quitting drops all turn UI state of the previous game. Nodes are immutable and
 * shared by every state of one game, so the root node object identifies the game.
 */
let gameRoot: object | null = null;
effect(() => {
  const root = game.value?.nodes[0] ?? null;
  if (root === gameRoot) return;
  gameRoot = root;
  resetTurnUi();
});

/** Forget all turn UI state (new game, rematch, quit). */
function resetTurnUi(): void {
  batch(() => {
    picked.value = IDLE;
    handoff.value = null;
    notice.value = null;
    lastViewed.value = null;
  });
  turnStart = 0;
}

/**
 * Who must take the seat after a resolution step turned `before` into `after`: the new hot-seat
 * player when it changed (control passed, or a send-back is owed by the other player), else
 * nobody. Nobody either once the game is over.
 */
export function handoffAfter(before: GameState, after: GameState): Player | null {
  const seat = hotSeat(after);
  if (seat === null || after.phase === 'over') return null;
  return seat === hotSeat(before) ? null : seat;
}

/** Why End turn is disabled ("2 timelines still need an action"), or null when it is enabled. */
export function endTurnBlocker(state: GameState): string | null {
  if (state.phase === 'over') return 'The game is over.';
  if (state.phase === 'awaitSendBack') return 'Finish the forced send-back first.';
  if (canEndTurn(state)) return null;
  return missingSentence(missingHeads(state).length);
}

/** The next required head without an action, after `after` in id order (wrapping), or null. */
export function nextNeedingAction(state: GameState, after: NodeId | null = null): NodeId | null {
  const missing = missingHeads(state);
  if (missing.length === 0) return null;
  if (after === null) return missing[0] ?? null;
  return missing.find((id) => id > after) ?? missing[0] ?? null;
}

/** Run a resolution step (End turn, a send-back, concede) and update the turn UI around it. */
function resolve(op: (state: GameState) => ActionResult): boolean {
  const before = game.value;
  if (before === null || !dispatch(op)) return false;
  const after = game.value as GameState;
  batch(() => {
    picked.value = IDLE;
    notice.value = eventSummary(after, turnStart);
    handoff.value = handoffAfter(before, after);
  });
  navigate({ screen: 'multiverse' });
  return true;
}

/**
 * Open a node's timeline. It is read-only unless the node needs an action from the hot seat;
 * `timelineMode` decides that from the engine, so every caller gets the same rule.
 */
export function openTimeline(node: NodeId): void {
  navigate({ screen: 'timeline', node, readOnly: false });
}

/** Add a draft action (place, split) and return to the multiverse. */
export function act(action: Action): boolean {
  if (!dispatch((s) => addAction(s, action))) return false;
  picked.value = IDLE;
  navigate({ screen: 'multiverse' });
  return true;
}

export function undoAction(): void {
  update(undo);
}

export function clearDraft(): void {
  update(clear);
}

/** Commit the draft. A forced send-back or a change of player brings up the handoff. */
export function endTurnNow(): boolean {
  const state = game.value;
  if (state === null) return false;
  const start = turnStart;
  turnStart = state.events.length;
  const ok = resolve(endTurn);
  if (!ok) turnStart = start;
  return ok;
}

/** The player in the hot seat gives up (also allowed during a send-back prompt). */
export function concedeNow(): boolean {
  const state = game.value;
  const seat = state && hotSeat(state);
  if (seat === null || seat === undefined) return false;
  return resolve((s) => concede(s, seat));
}

/** Dismiss the handoff screen: the new player has taken the seat. */
export function startTurn(): void {
  handoff.value = null;
  navigate({ screen: 'multiverse' });
}

/** A new game with the same config as the last one. */
export function rematch(): boolean {
  const config = lastConfig.value;
  if (config === null) return false;
  return startGame(config).ok;
}

/**
 * Feed one user event to the flow. Navigation follows the flow: picking a node happens on the
 * multiverse, picking a cell on the target's timeline, and a completed flow is dispatched (an
 * action goes into the draft; a send-back resolves at once). Returns false, with the reason in
 * `lastError`, when the event was rejected.
 */
export function flowEvent(event: FlowEvent): boolean {
  const state = game.value;
  if (state === null) return false;
  const current = flow.value;
  const result = step(current, event, state);
  if (result.error !== undefined) {
    lastError.value = result.error;
    return false;
  }
  if (result.action !== undefined) {
    const action = result.action;
    return act(action);
  }
  if (result.sendBack !== undefined) {
    const { target, cell } = result.sendBack;
    return resolve((s) => submitSendBack(s, target, cell));
  }
  const next = result.flow;
  batch(() => {
    picked.value = next;
    lastError.value = null;
  });
  if (next.kind === 'idle') {
    // Cancelled: back to the timeline the mark was taken from.
    if (current.kind === 'timeTravel' || current.kind === 'transfer') {
      navigate({ screen: 'timeline', node: current.head, readOnly: false });
    }
  } else if (next.target === null) {
    navigate({ screen: 'multiverse' });
  } else if (event.type === 'pickNode') {
    navigate({ screen: 'timeline', node: next.target, readOnly: false });
  }
  return true;
}
