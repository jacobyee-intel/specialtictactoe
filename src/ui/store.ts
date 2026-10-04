/**
 * The game store: the single source of truth for the UI.
 *
 * The engine is immutable, so the store is just a few signals holding engine values; every
 * change is a reference swap that Preact picks up. Screens never edit a `GameState` themselves:
 *
 * - {@link dispatch} runs an engine operation that may be rejected (add an action, end the turn,
 *   a send-back, concede). A rejection never throws; its message goes to {@link lastError},
 *   which the `<Toast>` shows.
 * - {@link update} runs an operation that cannot fail (undo, clear).
 *
 * Everything here works without a DOM, so the store is tested in node.
 */
import { batch, computed, signal } from '@preact/signals';
import {
  hotSeat,
  newGame,
  validateConfig,
  type ActionResult,
  type CellId,
  type ConfigCheck,
  type GameConfig,
  type GameConfigInput,
  type GameState,
  type NodeId,
} from '@/engine';
import { START, navigate, setRouteGuard, type Route } from './router';

/** The game in progress, or null on the start screen before the first game / after quitting. */
export const game = signal<GameState | null>(null);

/** The last rejection message, shown by `<Toast>`; cleared by the next successful change. */
export const lastError = signal<string | null>(null);

/** The cell under the pointer, shared by the 2D board and (Stage 7) the 3D view. */
export const hover = signal<{ readonly node: NodeId; readonly cell: CellId } | null>(null);

/** The config of the most recent game, for "New game" (prefilled form) and "Rematch". */
export const lastConfig = signal<GameConfig | null>(null);

/** The player who must act now (the sender during a forced send-back), or null. */
export const hotSeatPlayer = computed(() => game.value && hotSeat(game.value));

/** Live timelines in the preview (the draft included), for "Timelines k / max". */
export const liveCount = computed(() => game.value?.preview.live ?? 0);

/**
 * Validate `input` and, if it is playable, start a new game (replacing any game in progress)
 * and go to the multiverse. On errors nothing changes; the errors are returned for the form.
 */
export function startGame(input: GameConfigInput): ConfigCheck {
  const check = validateConfig(input);
  if (!check.ok) return check;
  const state = newGame(check.config);
  batch(() => {
    game.value = state;
    lastConfig.value = check.config;
    lastError.value = null;
    hover.value = null;
  });
  navigate({ screen: 'multiverse' });
  return check;
}

/**
 * Apply an engine operation that may be rejected. On success the new state replaces the old
 * one and any previous error is cleared; on rejection the state is untouched and the engine's
 * message is shown. Returns whether it succeeded.
 *
 * An exception from the engine is a bug, not a rule violation; it is logged and reported in the
 * toast rather than crashing the whole UI.
 */
export function dispatch(op: (state: GameState) => ActionResult): boolean {
  const state = game.value;
  if (state === null) {
    lastError.value = 'No game in progress.';
    return false;
  }
  let result: ActionResult;
  try {
    result = op(state);
  } catch (error) {
    console.error(error);
    lastError.value = `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
    return false;
  }
  if (!result.ok) {
    lastError.value = result.message;
    return false;
  }
  batch(() => {
    game.value = result.state;
    lastError.value = null;
  });
  return true;
}

/** Apply an engine operation that always succeeds (undo, clear). No-op without a game. */
export function update(op: (state: GameState) => GameState): void {
  const state = game.value;
  if (state === null) return;
  batch(() => {
    game.value = op(state);
    lastError.value = null;
  });
}

/** Hide the current error message. */
export function dismissError(): void {
  lastError.value = null;
}

/** Abandon the game and return to the start screen (the form keeps its values). */
export function quit(): void {
  batch(() => {
    game.value = null;
    lastError.value = null;
    hover.value = null;
  });
  navigate(START);
}

/**
 * The route actually shown for a requested one: without a game only the start screen exists,
 * and a timeline route must name a node of the preview (draft-created nodes included).
 */
export function guardRoute(requested: Route, state: GameState | null): Route {
  if (requested.screen === 'start') return requested;
  if (state === null) return START;
  if (requested.screen === 'timeline' && state.preview.nodes[requested.node] === undefined) {
    return { screen: 'multiverse' };
  }
  return requested;
}

setRouteGuard((requested) => guardRoute(requested, game.value));
