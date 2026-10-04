/**
 * Test-only scenario DSL (not imported by production code).
 *
 * ```ts
 * const g = scenario({ topology: 'flat' });      // N = M = 3 by default
 * const [n1, n2] = g.line(g.c(0, 0, 0), g.c(1, 1, 1)); // one place per turn on the only head
 * g.place(n2, g.c(2, 0, 0)); g.endTurn();
 * ```
 *
 * Every helper throws with the reason and an ASCII tree when the engine rejects something.
 */
import {
  addAction,
  clear,
  concede,
  endTurn,
  fromJSON,
  newGame,
  printTree,
  requiredHeads,
  serialize,
  submitSendBack,
  undo,
  type Action,
  type ActionResult,
  type CellId,
  type GameConfig,
  type GameConfigInput,
  type GameState,
  type IllegalReason,
  type NodeId,
  type Player,
  type SavedGame,
  type SavedNode,
  type TNode,
} from '@/engine';

export const DEFAULTS: GameConfigInput = { topology: 'flat', n: 3, m: 3, w: 3, l: 30 };

export class Scenario {
  state: GameState;
  readonly root: NodeId = 0;

  constructor(state: GameState) {
    this.state = state;
  }

  /** Cell at lattice coordinates. */
  c(...coords: number[]): CellId {
    return this.state.topology.cellAt(coords);
  }

  /** A node of the preview. */
  node(id: NodeId): TNode {
    const node = this.state.preview.nodes[id];
    if (!node) throw new Error(`no node #${id}\n${this.tree()}`);
    return node;
  }

  tree(): string {
    return printTree(this.state);
  }

  heads(player?: Player): NodeId[] {
    return requiredHeads(this.state, player);
  }

  private take(result: ActionResult, what: string): void {
    if (!result.ok) {
      throw new Error(`${what} rejected: ${result.reason} (${result.message})\n${this.tree()}`);
    }
    this.state = result.state;
  }

  /** Add a draft action; returns the ids of the preview nodes it created. */
  act(action: Action): NodeId[] {
    const before = this.state.preview.nodes.length;
    this.take(addAction(this.state, action), JSON.stringify(action));
    const after = this.state.preview.nodes.length;
    return Array.from({ length: after - before }, (_, i) => before + i);
  }

  place(head: NodeId, cell: CellId): NodeId {
    return this.act({ kind: 'place', head, cell })[0] as NodeId;
  }

  split(head: NodeId): [NodeId, NodeId] {
    const [a, b] = this.act({ kind: 'split', head });
    return [a as NodeId, b as NodeId];
  }

  timeTravel(head: NodeId, fromCell: CellId, target: NodeId, toCell: CellId) {
    const [source, arrival] = this.act({ kind: 'timeTravel', head, fromCell, target, toCell });
    return { source: source as NodeId, arrival: arrival as NodeId };
  }

  transfer(head: NodeId, fromCell: CellId, targetHead: NodeId, toCell: CellId) {
    const [source, win] = this.act({ kind: 'transfer', head, fromCell, targetHead, toCell });
    return { source: source as NodeId, win: win ?? null };
  }

  /** Expect `action` to be rejected and the state to stay identical; returns the reason. */
  rejects(action: Action): IllegalReason {
    const before = serialize(this.state);
    const result = addAction(this.state, action);
    if (result.ok) {
      throw new Error(`expected ${JSON.stringify(action)} to be rejected\n${this.tree()}`);
    }
    if (serialize(this.state) !== before) throw new Error('a rejected action changed the state');
    return result.reason;
  }

  endTurn(): this {
    this.take(endTurn(this.state), 'endTurn');
    return this;
  }

  /** Answer the pending send-back; returns the id of the new node. */
  sendBack(target: NodeId, cell: CellId): NodeId {
    const before = this.state.nodes.length;
    this.take(submitSendBack(this.state, target, cell), `sendBack(#${target}, c${cell})`);
    return before;
  }

  concede(by: Player): this {
    this.take(concede(this.state, by), `concede(P${by + 1})`);
    return this;
  }

  undo(): this {
    this.state = undo(this.state);
    return this;
  }

  clear(): this {
    this.state = clear(this.state);
    return this;
  }

  /**
   * Single-timeline play: for each cell, place it on the only required head and end the turn.
   * Returns the new node ids (one per cell).
   */
  line(...cells: CellId[]): NodeId[] {
    return cells.map((cell) => {
      const heads = this.heads();
      if (heads.length !== 1) throw new Error(`line() needs exactly one head\n${this.tree()}`);
      const id = this.place(heads[0] as NodeId, cell);
      this.endTurn();
      return id;
    });
  }
}

export function scenario(config: Partial<GameConfigInput> = {}): Scenario {
  return new Scenario(newGame({ ...DEFAULTS, ...config }));
}

export interface CraftedNode {
  readonly parent: NodeId | null;
  /** One digit per cell. */
  readonly board: string;
}

/**
 * A committed position built through the save format, for setups that would take dozens of
 * moves to reach by play (e.g. nearly full boards). Non-root nodes are recorded as splits.
 */
export function crafted(
  config: Partial<GameConfigInput>,
  nodes: readonly CraftedNode[],
  turn: { current?: Player; round?: number } = {},
): Scenario {
  const full: GameConfig = { maxTimelines: 32, ...DEFAULTS, ...config };
  const steps: number[] = [];
  const saved: SavedNode[] = nodes.map((n, id) => {
    const step = n.parent === null ? 0 : (steps[n.parent] as number) + 1;
    steps.push(step);
    return {
      parent: n.parent,
      step,
      board: n.board,
      terminal: null,
      origin: n.parent === null ? { kind: 'root' } : { kind: 'split' },
      received: null,
      round: id === 0 ? 0 : 1,
    };
  });
  const save: SavedGame = {
    version: 1,
    config: full,
    nodes: saved,
    current: turn.current ?? 0,
    round: turn.round ?? 1,
    score: [0, 0],
    phase: 'draft',
    draft: [],
    queue: [],
    pendingSendBack: null,
    resolveLedger: null,
    result: null,
    events: [],
  };
  return new Scenario(fromJSON(save));
}

/** Change one cell of a digit-string board. */
export function setCell(board: string, cell: CellId, value: 0 | 1 | 2): string {
  return board.slice(0, cell) + value + board.slice(cell + 1);
}

/**
 * A full 4×4×4 board with no line of 4 for either player (flat cube, 76 lines), found by local
 * search. 3×3×3 boards cannot be drawn at all, so draw tests use this one.
 */
export const DRAWN_444 = '1112211112221222211112212211211212222111211212221221122221112211';
