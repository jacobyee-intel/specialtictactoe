/**
 * The engine's data model.
 *
 * The multiverse is an append-only tree of immutable nodes. `nodes[id]` never changes after it is
 * created and `id` is its index, so nodes (and their boards) can be shared freely between states.
 * Every public operation takes a {@link GameState} and returns a new one, which is what Preact
 * signals need: a new object means "something changed".
 *
 * Everything here is plain data (plus typed arrays), so a state can be saved as JSON; only the
 * topology and line index are rebuilt from the config on load.
 */
import type { CellId, LineIndex, Player, Topology, TopologyId } from '@/geometry';

export type { CellId, Player };

/** Index of a node in `GameState.nodes`. */
export type NodeId = number;

export interface GameConfig {
  readonly topology: TopologyId;
  /** Cells per edge of each cubic block. */
  readonly n: number;
  /** Marks in a row needed to win a timeline. */
  readonly m: number;
  /** Timelines a player must win to win the game. */
  readonly w: number;
  /** Round limit: when the round counter exceeds L the game is a draw. */
  readonly l: number;
  /** Cap on live timelines that splits and time travel may not exceed (default 32). */
  readonly maxTimelines: number;
}

/** A config as entered by the user; `maxTimelines` defaults to 32. */
export type GameConfigInput = Omit<GameConfig, 'maxTimelines'> & {
  readonly maxTimelines?: number;
};

/** Why a node ended. A terminal node never gets children. */
export type Terminal =
  | { readonly kind: 'win'; readonly winner: Player; readonly lineId: number }
  /** The board filled up without a line. `filler` placed the last mark. */
  | { readonly kind: 'draw'; readonly filler: Player };

/**
 * How a node came to exist. Cells are where a mark was added (or removed, for sources); the
 * linked node ids let the UI draw time-travel and transfer arrows.
 */
export type Origin =
  | { readonly kind: 'root' }
  | { readonly kind: 'place'; readonly cell: CellId }
  | { readonly kind: 'split' }
  /** The head after its mark `cell` left for the past; `arrival` is where it landed. */
  | { readonly kind: 'ttSource'; readonly cell: CellId; readonly arrival: NodeId }
  /** A past node plus the time-travelling mark at `cell`. */
  | { readonly kind: 'ttArrival'; readonly cell: CellId; readonly source: NodeId }
  /** The head after its mark `cell` moved sideways to `toCell` of head `to`. */
  | {
      readonly kind: 'transferSource';
      readonly cell: CellId;
      readonly to: NodeId;
      readonly toCell: CellId;
    }
  /** The receiving head ended (win or draw) from the received mark alone. */
  | { readonly kind: 'transferWin'; readonly cell: CellId; readonly from: NodeId }
  /** A forced send-back placed a new mark at `cell`, owed because `terminal` ended. */
  | { readonly kind: 'sendBack'; readonly cell: CellId; readonly terminal: NodeId };

/** A mark received this turn by parallel transfer, at `cell`, sent from head `from`. */
export interface Incoming {
  readonly cell: CellId;
  readonly from: NodeId;
}

export interface TNode {
  readonly id: NodeId;
  readonly parent: NodeId | null;
  /**
   * Local time T. The player to move at a node is `step % 2` (P1 at even steps). A node is
   * always created by the other player, so the creator never moves next at its own node.
   */
  readonly step: number;
  /** 0 = empty, 1 = player 0, 2 = player 1. Never mutated. */
  readonly board: Uint8Array;
  readonly terminal: Terminal | null;
  readonly origin: Origin;
  /** Set when the parent had a pending transfer: the board already contains that mark. */
  readonly received: Incoming | null;
  /** Round in which the node was created (the root has round 0). */
  readonly round: number;
}

/**
 * A draft action. Every node id it mentions is a *committed* node (a turn-start head or one of
 * its ancestors), never a node created by the draft, so ids stay valid during resolution.
 */
export type Action =
  | { readonly kind: 'place'; readonly head: NodeId; readonly cell: CellId }
  | { readonly kind: 'split'; readonly head: NodeId }
  | {
      readonly kind: 'timeTravel';
      readonly head: NodeId;
      readonly fromCell: CellId;
      readonly target: NodeId;
      readonly toCell: CellId;
    }
  | {
      readonly kind: 'transfer';
      readonly head: NodeId;
      readonly fromCell: CellId;
      readonly targetHead: NodeId;
      readonly toCell: CellId;
    };

export type ActionKind = Action['kind'];

/** A forced send-back: a new mark on `cell` of the past node `target`. */
export interface SendBack {
  readonly target: NodeId;
  readonly cell: CellId;
}

/** A node the player may target, with the cells that are legal there. */
export interface TargetOption {
  readonly node: NodeId;
  readonly cells: readonly CellId[];
}

/** Per-turn bookkeeping: which heads have acted and which hold a received mark. */
export interface Ledger {
  readonly acted: ReadonlySet<NodeId>;
  readonly incoming: ReadonlyMap<NodeId, Incoming>;
}

/** A node array with its child lists (`children[id]`, in creation order). */
export interface Tree {
  readonly nodes: readonly TNode[];
  readonly children: readonly (readonly NodeId[])[];
}

/**
 * The tree as the UI should show it: the committed tree plus the draft (in phase `draft`), or
 * the partially resolved tree plus the resolution ledger (in phase `awaitSendBack`).
 */
export interface Preview extends Tree {
  readonly ledger: Ledger;
  /** Live timelines: non-terminal heads. */
  readonly live: number;
}

export type Phase = 'draft' | 'awaitSendBack' | 'over';

export interface PendingSendBack {
  /** The player who must send back (the hot seat during the prompt). */
  readonly player: Player;
  /** The terminal node that caused it; targets are its strict ancestors. */
  readonly terminal: NodeId;
}

export type Result =
  | { readonly kind: 'win'; readonly winner: Player; readonly reason: 'score' | 'concede' }
  | { readonly kind: 'draw'; readonly reason: 'turnLimit' | 'noTimelines' };

/** Small, serializable notifications appended in order, for UI animation and history. */
export type EngineEvent =
  | {
      readonly type: 'actionApplied';
      readonly player: Player;
      readonly action: Action;
      readonly created: readonly NodeId[];
    }
  | {
      readonly type: 'timelineWon';
      readonly node: NodeId;
      readonly winner: Player;
      readonly lineId: number;
    }
  | { readonly type: 'timelineDrawn'; readonly node: NodeId; readonly filler: Player }
  | { readonly type: 'sendBackRequired'; readonly player: Player; readonly terminal: NodeId }
  | {
      readonly type: 'sendBackApplied';
      readonly player: Player;
      readonly target: NodeId;
      readonly cell: CellId;
      readonly node: NodeId;
    }
  | { readonly type: 'sendBackSkipped'; readonly player: Player; readonly terminal: NodeId }
  | { readonly type: 'turnSkipped'; readonly player: Player; readonly round: number }
  | { readonly type: 'controlPassed'; readonly player: Player; readonly round: number }
  | { readonly type: 'gameOver'; readonly result: Result };

export interface GameState extends Tree {
  readonly config: GameConfig;
  readonly topology: Topology;
  readonly lines: LineIndex;
  /** Whose turn it is. During a send-back prompt the hot seat is `pendingSendBack.player`. */
  readonly current: Player;
  readonly round: number;
  readonly score: readonly [number, number];
  readonly phase: Phase;
  readonly draft: readonly Action[];
  /** Draft actions not yet applied while resolution is paused on a send-back. */
  readonly queue: readonly Action[];
  readonly pendingSendBack: PendingSendBack | null;
  /** The ledger of the turn being resolved (phase `awaitSendBack` only). */
  readonly resolveLedger: Ledger | null;
  readonly result: Result | null;
  readonly events: readonly EngineEvent[];
  /** Cached {@link Preview}; recomputed whenever the draft or the tree changes. */
  readonly preview: Preview;
}

export type IllegalReason =
  | 'gameOver'
  | 'wrongPhase'
  | 'notYourTurn'
  | 'turnIncomplete'
  | 'unknownNode'
  | 'badCell'
  | 'notHead'
  | 'wrongParity'
  | 'alreadyActed'
  | 'cellOccupied'
  | 'notOwnMark'
  | 'receivedThisTurn'
  | 'notAncestor'
  | 'targetWrongParity'
  | 'sameHead'
  | 'targetNotRequired'
  | 'targetActed'
  | 'targetHasIncoming'
  | 'stepMismatch'
  | 'noTarget'
  | 'timelineCap';

export interface Rejection {
  readonly ok: false;
  readonly reason: IllegalReason;
  readonly message: string;
}

export type ActionResult = { readonly ok: true; readonly state: GameState } | Rejection;
