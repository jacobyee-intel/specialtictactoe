/**
 * Pure, serializable game rules and state transitions, without DOM or three.js.
 *
 * Every operation takes a `GameState` and returns a new one (or a rejection with a reason), so
 * the UI can keep the state in a signal and compare by reference.
 */
export type {
  Action,
  ActionKind,
  ActionResult,
  CellId,
  EngineEvent,
  GameConfig,
  GameConfigInput,
  GameState,
  IllegalReason,
  Incoming,
  Ledger,
  NodeId,
  Origin,
  PendingSendBack,
  Phase,
  Player,
  Preview,
  Rejection,
  Result,
  SendBack,
  TargetOption,
  Terminal,
  TNode,
  Tree,
} from './types';
export {
  DEFAULT_CONFIG,
  DEFAULT_MAX_TIMELINES,
  validateConfig,
  type ConfigCheck,
  type ConfigError,
} from './config';
export { geometryFor, newGame } from './game';
export {
  childrenOf,
  countLive,
  headsOf,
  isHead,
  isStrictAncestor,
  nodeAt,
  parityPlayer,
  printTree,
  strictAncestors,
} from './tree';
export { effectiveBoard } from './board';
export { checkTerminal, validateAction } from './actions';
export { addAction, canEndTurn, clear, missingHeads, preview, requiredHeads, undo } from './draft';
export { concede, endTurn, submitSendBack } from './resolve';
export {
  emptyCells,
  hasIncoming,
  headStatus,
  hotSeat,
  incomingOf,
  legalActionKinds,
  liveTimelines,
  sendBackTargets,
  sendableCells,
  timeTravelTargets,
  transferTargets,
  type Availability,
  type HeadStatus,
} from './query';
export {
  SAVE_VERSION,
  deserialize,
  fromJSON,
  serialize,
  toJSON,
  type SavedGame,
  type SavedLedger,
  type SavedNode,
} from './serialize';
