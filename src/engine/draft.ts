/**
 * The draft: the current player's ordered list of actions for this turn.
 *
 * The committed tree (`state.nodes`) is the turn-start snapshot and is not touched while
 * drafting. The preview is `replay(committed, draft)`; it is cached in the state so that the
 * many UI queries per frame are cheap. Adding an action applies it incrementally to a copy of
 * the cached preview, while undo and clear replay from the snapshot. Both use the same
 * `applyAction`, so the results are identical.
 *
 * Node ids created by the draft are the ids they will get at resolution only if no send-back
 * interleaves; once a send-back is inserted, later nodes shift. That is harmless because draft
 * actions may only reference committed nodes.
 */
import { applyAction, forkWork, reject, validateAction, type Work } from './actions';
import { countLive, headsOf } from './tree';
import type {
  Action,
  ActionResult,
  GameState,
  Ledger,
  NodeId,
  Player,
  Preview,
  Rejection,
  Tree,
} from './types';

/** The empty ledger (shared; ledgers are copied before they are modified). */
export const NO_LEDGER: Ledger = { acted: new Set(), incoming: new Map() };

function previewOf(work: Work): Preview {
  return { nodes: work.nodes, children: work.children, ledger: work.ledger, live: countLive(work) };
}

/** The preview of a tree with no draft applied. */
export function staticPreview(tree: Tree, ledger: Ledger = NO_LEDGER): Preview {
  return { nodes: tree.nodes, children: tree.children, ledger, live: countLive(tree) };
}

/** Apply `draft` to the committed tree of `state` (draft actions are assumed valid). */
export function replay(
  state: Pick<GameState, 'nodes' | 'children' | 'lines' | 'round'>,
  draft: readonly Action[],
): Preview {
  if (draft.length === 0) return staticPreview(state);
  const work = forkWork(state, NO_LEDGER);
  const ctx = { lines: state.lines, round: state.round };
  for (const action of draft) applyAction(work, action, ctx);
  return previewOf(work);
}

/** Copy only the fields that belong to the action's kind, so stray UI fields are not saved. */
function normalize(a: Action): Action {
  switch (a.kind) {
    case 'place':
      return { kind: a.kind, head: a.head, cell: a.cell };
    case 'split':
      return { kind: a.kind, head: a.head };
    case 'timeTravel':
      return {
        kind: a.kind,
        head: a.head,
        fromCell: a.fromCell,
        target: a.target,
        toCell: a.toCell,
      };
    case 'transfer':
      return {
        kind: a.kind,
        head: a.head,
        fromCell: a.fromCell,
        targetHead: a.targetHead,
        toCell: a.toCell,
      };
  }
}

/**
 * Validate `action` against the state and, if legal, return the preview with it applied.
 *
 * The timeline cap is exact: split and time travel are applied tentatively and rejected only if
 * the resulting preview has more than `maxTimelines` live heads. A time travel whose arrival
 * ends immediately adds no live timeline, so it is allowed even at the cap.
 */
export function tryAction(
  state: GameState,
  action: Action,
): { readonly ok: true; readonly preview: Preview } | Rejection {
  const problem = validateAction(state, action);
  if (problem) return problem;
  const work = forkWork(state.preview, state.preview.ledger);
  applyAction(work, action, { lines: state.lines, round: state.round });
  const preview = previewOf(work);
  const cap = state.config.maxTimelines;
  if ((action.kind === 'split' || action.kind === 'timeTravel') && preview.live > cap) {
    return reject(
      'timelineCap',
      `That would make ${preview.live} live timelines; the cap is ${cap}.`,
    );
  }
  return { ok: true, preview };
}

/** Append an action to the draft, or explain why it is illegal. */
export function addAction(state: GameState, action: Action): ActionResult {
  const tried = tryAction(state, action);
  if (!tried.ok) return tried;
  return {
    ok: true,
    state: { ...state, draft: [...state.draft, normalize(action)], preview: tried.preview },
  };
}

/** Remove the last draft action (no-op when there is none). */
export function undo(state: GameState): GameState {
  if (state.phase !== 'draft' || state.draft.length === 0) return state;
  const draft = state.draft.slice(0, -1);
  return { ...state, draft, preview: replay(state, draft) };
}

/** Remove every draft action (no-op when there is none). */
export function clear(state: GameState): GameState {
  if (state.phase !== 'draft' || state.draft.length === 0) return state;
  return { ...state, draft: [], preview: replay(state, []) };
}

/** The cached preview: the committed tree with the draft applied. */
export function preview(state: GameState): Preview {
  return state.preview;
}

/**
 * Committed heads where `player` is to move. Nodes created by the current player always have
 * the opponent's parity, so this set does not change while drafting.
 */
export function requiredHeads(state: GameState, player: Player = state.current): NodeId[] {
  return headsOf(state, player);
}

/** Required heads that have not acted yet in the draft (empty outside the draft phase). */
export function missingHeads(state: GameState): NodeId[] {
  if (state.phase !== 'draft') return [];
  return requiredHeads(state).filter((id) => !state.preview.ledger.acted.has(id));
}

/** End Turn is enabled once every required head has acted (directly or via transfer). */
export function canEndTurn(state: GameState): boolean {
  return state.phase === 'draft' && missingHeads(state).length === 0;
}
