/**
 * Turn resolution: an interruptible state machine.
 *
 * End Turn moves the draft into a queue and replays it on the committed tree with the same
 * `applyAction` the preview used. Whenever a timeline ends, it is scored at once; if the game is
 * not over, the owing player must choose a forced send-back and resolution pauses in phase
 * `awaitSendBack`. "The send-back goes to the front of the queue" is implemented by resolving it,
 * and any chain it starts, before the next queued action is taken.
 *
 * Send-backs only add children to strict ancestors of terminal nodes. Those ancestors already
 * have children, so they are never a head that a queued action still needs, and resolution can
 * never invalidate a later draft action.
 */
import {
  applyAction,
  applySendBack,
  forkWork,
  invariant,
  reject,
  sendBackOptions,
  validateSendBack,
  type Work,
} from './actions';
import { NO_LEDGER, canEndTurn, missingHeads, staticPreview } from './draft';
import { headsOf, nodeAt } from './tree';
import type {
  Action,
  ActionResult,
  CellId,
  EngineEvent,
  GameState,
  Ledger,
  NodeId,
  PendingSendBack,
  Phase,
  Player,
  Result,
} from './types';

const other = (p: Player): Player => (p === 0 ? 1 : 0);

/** Mutable scratch state for one public call; turned back into a `GameState` by `finish`. */
interface Run {
  readonly state: GameState;
  readonly work: Work;
  current: Player;
  round: number;
  score: [number, number];
  phase: Phase | 'resolving';
  queue: Action[];
  pending: PendingSendBack | null;
  result: Result | null;
  events: EngineEvent[];
}

function startRun(state: GameState, ledger: Ledger, queue: readonly Action[]): Run {
  return {
    state,
    work: forkWork(state, ledger),
    current: state.current,
    round: state.round,
    score: [state.score[0], state.score[1]],
    phase: 'resolving',
    queue: [...queue],
    pending: state.pendingSendBack,
    result: state.result,
    events: [...state.events],
  };
}

function finish(run: Run): GameState {
  const phase = run.phase;
  invariant(phase !== 'resolving', 'resolution stopped mid-way');
  const paused = phase === 'awaitSendBack';
  const tree = { nodes: run.work.nodes, children: run.work.children };
  const resolveLedger = paused ? run.work.ledger : null;
  return {
    ...run.state,
    ...tree,
    current: run.current,
    round: run.round,
    score: run.score,
    phase,
    draft: [],
    queue: paused ? run.queue : [],
    pendingSendBack: paused ? run.pending : null,
    resolveLedger,
    result: run.result,
    events: run.events,
    preview: staticPreview(tree, resolveLedger ?? NO_LEDGER),
  };
}

const ctxOf = (run: Run) => ({ lines: run.state.lines, round: run.round });

function endGame(run: Run, result: Result): void {
  run.result = result;
  run.phase = 'over';
  run.queue = [];
  run.pending = null;
  run.events.push({ type: 'gameOver', result });
}

/** Apply queued actions until the queue is empty, a send-back is owed, or the game ends. */
function pump(run: Run): void {
  while (run.phase === 'resolving') {
    const action = run.queue.shift();
    if (action === undefined) {
      passControl(run);
      return;
    }
    const { created, terminal } = applyAction(run.work, action, ctxOf(run));
    run.events.push({ type: 'actionApplied', player: run.current, action, created });
    if (terminal !== null) onTerminal(run, terminal);
  }
}

/**
 * Score a terminal node, then either end the game or ask the owing player for a send-back:
 * the loser of a win, or the player who did not fill the board in a draw.
 */
function onTerminal(run: Run, id: NodeId): void {
  const t = nodeAt(run.work, id).terminal;
  invariant(t !== null, `#${id} is terminal`);
  let owed: Player;
  if (t.kind === 'win') {
    run.score[t.winner]++;
    run.events.push({ type: 'timelineWon', node: id, winner: t.winner, lineId: t.lineId });
    if (run.score[t.winner] >= run.state.config.w) {
      endGame(run, { kind: 'win', winner: t.winner, reason: 'score' });
      return;
    }
    owed = other(t.winner);
  } else {
    run.events.push({ type: 'timelineDrawn', node: id, filler: t.filler });
    owed = other(t.filler);
  }
  if (sendBackOptions(run.work, id, owed).length === 0) {
    run.events.push({ type: 'sendBackSkipped', player: owed, terminal: id });
    return;
  }
  run.pending = { player: owed, terminal: id };
  run.phase = 'awaitSendBack';
  run.events.push({ type: 'sendBackRequired', player: owed, terminal: id });
}

/**
 * Hand the turn to the next player. P2's phase ends the round; past round L the game is drawn.
 * A player with no required heads is skipped (the skipped phase still counts). If neither player
 * has a head, no timeline is left and the game is drawn. At most one skip can happen, because a
 * skip only happens when the other player has heads.
 */
function passControl(run: Run): void {
  const advance = (): boolean => {
    run.current = other(run.current);
    if (run.current === 0) run.round++;
    if (run.round > run.state.config.l) {
      endGame(run, { kind: 'draw', reason: 'turnLimit' });
      return false;
    }
    return true;
  };
  if (!advance()) return;
  if (headsOf(run.work, run.current).length === 0) {
    if (headsOf(run.work, other(run.current)).length === 0) {
      endGame(run, { kind: 'draw', reason: 'noTimelines' });
      return;
    }
    run.events.push({ type: 'turnSkipped', player: run.current, round: run.round });
    if (!advance()) return;
  }
  run.phase = 'draft';
  run.events.push({ type: 'controlPassed', player: run.current, round: run.round });
}

/** Commit the draft: resolve it action by action, pausing for forced send-backs. */
export function endTurn(state: GameState): ActionResult {
  if (state.phase === 'over') return reject('gameOver');
  if (state.phase !== 'draft') return reject('wrongPhase');
  if (!canEndTurn(state)) {
    const n = missingHeads(state).length;
    return reject(
      'turnIncomplete',
      n === 1 ? '1 timeline still needs an action.' : `${n} timelines still need an action.`,
    );
  }
  const run = startRun(state, NO_LEDGER, state.draft);
  pump(run);
  return { ok: true, state: finish(run) };
}

/** Answer the pending send-back prompt with a new mark on `cell` of the past node `target`. */
export function submitSendBack(state: GameState, target: NodeId, cell: CellId): ActionResult {
  const problem = validateSendBack(state, { target, cell });
  if (problem) return problem;
  const pending = state.pendingSendBack as PendingSendBack;
  const run = startRun(state, state.resolveLedger ?? NO_LEDGER, state.queue);
  run.pending = null;
  const applied = applySendBack(
    run.work,
    { target, cell },
    pending.player,
    pending.terminal,
    ctxOf(run),
  );
  run.events.push({
    type: 'sendBackApplied',
    player: pending.player,
    target,
    cell,
    node: applied.node,
  });
  if (applied.terminal) onTerminal(run, applied.node);
  pump(run);
  return { ok: true, state: finish(run) };
}

/**
 * The player in the hot seat gives up and the opponent wins: the current player while drafting,
 * or the sender during a send-back prompt. The draft and the rest of the queue are discarded.
 */
export function concede(state: GameState, by: Player): ActionResult {
  if (state.phase === 'over') return reject('gameOver');
  const seat = state.pendingSendBack?.player ?? state.current;
  if (by !== seat) return reject('notYourTurn');
  const run = startRun(state, NO_LEDGER, []);
  endGame(run, { kind: 'win', winner: other(by), reason: 'concede' });
  return { ok: true, state: finish(run) };
}
