/**
 * Versioned JSON save format.
 *
 * Boards are stored as digit strings (one "0"/"1"/"2" per cell). The topology and line index are
 * not stored: they are rebuilt from the config, and child lists are rebuilt from parent links.
 * The draft is re-validated action by action on load, which also rebuilds the preview.
 */
import { NO_LEDGER, addAction, staticPreview } from './draft';
import { decodeBoard, encodeBoard } from './board';
import { validateConfig } from './config';
import { geometryFor } from './game';
import { buildChildren } from './tree';
import type {
  Action,
  CellId,
  EngineEvent,
  GameConfig,
  GameConfigInput,
  GameState,
  Incoming,
  Ledger,
  NodeId,
  Origin,
  PendingSendBack,
  Phase,
  Player,
  Result,
  Terminal,
  TNode,
} from './types';

export const SAVE_VERSION = 1;

export interface SavedNode {
  readonly parent: NodeId | null;
  readonly step: number;
  readonly board: string;
  readonly terminal: Terminal | null;
  readonly origin: Origin;
  readonly received: Incoming | null;
  readonly round: number;
}

export interface SavedLedger {
  readonly acted: readonly NodeId[];
  /** `[node, cell, from]` triples. */
  readonly incoming: readonly (readonly [NodeId, CellId, NodeId])[];
}

export interface SavedGame {
  readonly version: typeof SAVE_VERSION;
  readonly config: GameConfig;
  readonly nodes: readonly SavedNode[];
  readonly current: Player;
  readonly round: number;
  readonly score: readonly [number, number];
  readonly phase: Phase;
  readonly draft: readonly Action[];
  readonly queue: readonly Action[];
  readonly pendingSendBack: PendingSendBack | null;
  readonly resolveLedger: SavedLedger | null;
  readonly result: Result | null;
  readonly events: readonly EngineEvent[];
}

/** A plain JSON-compatible snapshot of the state (the preview is not stored). */
export function toJSON(state: GameState): SavedGame {
  const ledger = state.resolveLedger;
  return {
    version: SAVE_VERSION,
    config: state.config,
    nodes: state.nodes.map((n) => ({
      parent: n.parent,
      step: n.step,
      board: encodeBoard(n.board),
      terminal: n.terminal,
      origin: n.origin,
      received: n.received,
      round: n.round,
    })),
    current: state.current,
    round: state.round,
    score: state.score,
    phase: state.phase,
    draft: state.draft,
    queue: state.queue,
    pendingSendBack: state.pendingSendBack,
    resolveLedger: ledger && {
      acted: [...ledger.acted],
      incoming: [...ledger.incoming].map(([id, inc]) => [id, inc.cell, inc.from] as const),
    },
    result: state.result,
    events: state.events,
  };
}

export function serialize(state: GameState): string {
  return JSON.stringify(toJSON(state));
}

export function deserialize(text: string): GameState {
  return fromJSON(JSON.parse(text));
}

class SaveError extends Error {
  override name = 'SaveError';
}

function fail(what: string): never {
  throw new SaveError(`Invalid saved game: ${what}.`);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo = 0, hi = Infinity): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) < hi;
const isPlayer = (v: unknown): v is Player => v === 0 || v === 1;

const ACTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  place: ['head', 'cell'],
  split: ['head'],
  timeTravel: ['head', 'fromCell', 'target', 'toCell'],
  transfer: ['head', 'fromCell', 'targetHead', 'toCell'],
};

const ORIGIN_KINDS = [
  'root',
  'place',
  'split',
  'ttSource',
  'ttArrival',
  'transferSource',
  'transferWin',
  'sendBack',
];

/** Shape check: a known kind whose node fields are node ids and cell fields are cells. */
function isAction(v: unknown, nodeCount: number, cellCount: number): v is Action {
  if (!isRec(v) || typeof v.kind !== 'string') return false;
  const fields = ACTION_FIELDS[v.kind];
  return (
    fields !== undefined &&
    fields.every((f) => isInt(v[f], 0, /cell$/i.test(f) ? cellCount : nodeCount))
  );
}

function readNodes(raw: unknown, cellCount: number): TNode[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('no nodes');
  const nodes: TNode[] = [];
  raw.forEach((r: unknown, id) => {
    if (!isRec(r)) return fail(`node ${id}`);
    if (id === 0 ? r.parent !== null : !isInt(r.parent, 0, id)) fail(`node ${id} parent`);
    const parent = id === 0 ? null : (r.parent as NodeId);
    const step = parent === null ? 0 : (nodes[parent] as TNode).step + 1;
    const board = decodeBoard(r.board, cellCount);
    const { terminal, origin, received } = r;
    if (
      r.step !== step ||
      board === null ||
      !isInt(r.round) ||
      !(
        terminal === null ||
        (isRec(terminal) && (terminal.kind === 'win' || terminal.kind === 'draw'))
      ) ||
      !(isRec(origin) && ORIGIN_KINDS.includes(origin.kind as string)) ||
      !(received === null || (isRec(received) && isInt(received.cell, 0, cellCount)))
    ) {
      fail(`node ${id}`);
    }
    nodes.push({
      id,
      parent,
      step,
      board,
      terminal: terminal as Terminal | null,
      origin: origin as Origin,
      received: received as Incoming | null,
      round: r.round as number,
    });
  });
  return nodes;
}

function readLedger(raw: unknown, nodeCount: number, cellCount: number): Ledger {
  if (
    !isRec(raw) ||
    !Array.isArray(raw.acted) ||
    !raw.acted.every((id) => isInt(id, 0, nodeCount)) ||
    !Array.isArray(raw.incoming) ||
    !raw.incoming.every(
      (t) =>
        Array.isArray(t) &&
        t.length === 3 &&
        isInt(t[0], 0, nodeCount) &&
        isInt(t[1], 0, cellCount) &&
        isInt(t[2], 0, nodeCount),
    )
  ) {
    return fail('resolution ledger');
  }
  const incoming = (raw.incoming as [NodeId, CellId, NodeId][]).map(
    ([id, cell, from]) => [id, { cell, from }] as const,
  );
  return { acted: new Set(raw.acted as NodeId[]), incoming: new Map(incoming) };
}

/** Rebuild a state from {@link toJSON} output. Throws an `Error` describing the first problem. */
export function fromJSON(data: unknown): GameState {
  if (!isRec(data)) return fail('not an object');
  if (data.version !== SAVE_VERSION) fail(`unsupported version ${String(data.version)}`);
  if (!isRec(data.config)) fail('missing config');
  const check = validateConfig(data.config as unknown as GameConfigInput);
  if (!check.ok) return fail(`config (${check.errors.map((e) => e.message).join(' ')})`);
  const config = check.config;
  const { topology, lines } = geometryFor(config);
  const cellCount = topology.cellCount;
  const nodes = readNodes(data.nodes, cellCount);
  const children = buildChildren(nodes);
  if (nodes.some((n) => n.terminal !== null && (children[n.id] as NodeId[]).length > 0)) {
    fail('a terminal node has children');
  }

  const { current, round, score, phase, draft, queue, events, result } = data;
  const pending = data.pendingSendBack;
  if (
    !isPlayer(current) ||
    !isInt(round, 1) ||
    !(Array.isArray(score) && score.length === 2 && score.every((v) => isInt(v))) ||
    !(phase === 'draft' || phase === 'awaitSendBack' || phase === 'over') ||
    !Array.isArray(draft) ||
    !Array.isArray(queue) ||
    !queue.every((a) => isAction(a, nodes.length, cellCount)) ||
    !Array.isArray(events) ||
    !(result === null || isRec(result)) ||
    (phase === 'over') !== (result !== null) ||
    (phase !== 'draft' && draft.length > 0) ||
    (phase !== 'awaitSendBack' && queue.length > 0)
  ) {
    return fail('turn state');
  }
  let pendingSendBack: PendingSendBack | null = null;
  let resolveLedger: Ledger | null = null;
  if (phase === 'awaitSendBack') {
    if (
      !isRec(pending) ||
      !isPlayer(pending.player) ||
      !isInt(pending.terminal, 0, nodes.length) ||
      (nodes[pending.terminal] as TNode).terminal === null
    ) {
      return fail('pending send-back');
    }
    pendingSendBack = { player: pending.player, terminal: pending.terminal };
    resolveLedger = readLedger(data.resolveLedger, nodes.length, cellCount);
  }

  let state: GameState = {
    config,
    topology,
    lines,
    nodes,
    children,
    current,
    round,
    score: [score[0] as number, score[1] as number],
    phase,
    draft: [],
    queue: queue as Action[],
    pendingSendBack,
    resolveLedger,
    result: result as Result | null,
    events: events as EngineEvent[],
    preview: staticPreview({ nodes, children }, resolveLedger ?? NO_LEDGER),
  };
  draft.forEach((action: unknown, i) => {
    if (!isAction(action, nodes.length, cellCount)) return fail(`draft action ${i}`);
    const added = addAction(state, action);
    if (!added.ok) return fail(`draft action ${i} (${added.message})`);
    state = added.state;
  });
  return state;
}
