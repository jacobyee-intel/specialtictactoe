/**
 * Human-readable text for the game screens: coordinates, how a node came to be, what its status
 * means, results and engine events.
 *
 * Every sentence the UI shows about the game is built here, from engine data only, so the wording
 * is consistent across the timeline, the multiverse list and the toasts, and is tested in node.
 */
import {
  headStatus,
  incomingOf,
  nodeAt,
  parityPlayer,
  type CellId,
  type EngineEvent,
  type GameState,
  type HeadStatus,
  type NodeId,
  type Player,
  type Result,
  type TNode,
} from '@/engine';
import { TesseractSurface, type Topology } from '@/geometry';
import { playerName } from './tokens';

/** Axis names for lattice coordinates (the tesseract's fourth axis is w). */
const AXIS_NAMES = ['x', 'y', 'z', 'w'] as const;

/** "x", "y", "z" or "w" for axis 0–3. */
export function axisName(axis: number): string {
  const name = AXIS_NAMES[axis];
  if (name === undefined) throw new RangeError(`No axis ${axis}.`);
  return name;
}

const other = (p: Player): Player => (p === 0 ? 1 : 0);

/** The free axes of a tesseract facet with fixed axis `axis`, in increasing order. */
export function freeAxes(axis: number): [number, number, number] {
  return [0, 1, 2, 3].filter((k) => k !== axis) as [number, number, number];
}

/** "Cube w = 0" or "Cube x = 4": the tesseract facet a cell lies on, named by its 4D face. */
export function cubeLabel(topology: TesseractSurface, facet: number): string {
  const axis = facet >> 1;
  const value = facet & 1 ? topology.n : 0;
  return `Cube ${axisName(axis)} = ${value}`;
}

/**
 * Coordinates as shown on screen: "(2, 0, 1)" for the cubic spaces. On the tesseract the three
 * free coordinates of the cell's cube come first, in the cube's own axis order (the order the
 * slice panels use), then the cube: "(2, 0, 1) in cube w = 4".
 */
export function coordLabel(topology: Topology, cell: CellId): string {
  const q = topology.coords(cell);
  if (topology instanceof TesseractSurface) {
    const facet = topology.facet(cell);
    const free = freeAxes(facet.axis).map((k) => q[k]);
    return `(${free.join(', ')}) in ${cubeLabel(topology, facet.index).toLowerCase()}`;
  }
  return `(${q.join(', ')})`;
}

/** The player who created a node: never the one to move there (engine parity rule). */
export function creatorOf(node: TNode): Player {
  return other(parityPlayer(node.step));
}

/** "Player 2 to move". */
export function toMoveLabel(node: TNode): string {
  return `${playerName(parityPlayer(node.step))} to move`;
}

/**
 * One sentence on how node `id` of the preview came to exist, plus a second one when its board
 * includes a mark received by transfer (or a pending one, for a head this turn).
 */
export function originSentence(state: GameState, id: NodeId): string {
  const node = nodeAt(state.preview, id);
  const at = (cell: CellId) => coordLabel(state.topology, cell);
  const by = playerName(creatorOf(node));
  const o = node.origin;
  let text: string;
  switch (o.kind) {
    case 'root':
      text = 'The starting board, where every timeline begins.';
      break;
    case 'place':
      text = `Created when ${by} placed at ${at(o.cell)}.`;
      break;
    case 'split':
      text = `Created when ${by} split #${node.parent}.`;
      break;
    case 'ttSource':
      text = `Created when ${by} sent the mark at ${at(o.cell)} back in time to #${o.arrival}.`;
      break;
    case 'ttArrival':
      text = `Created when ${by} sent a mark back from #${o.source}; it landed at ${at(o.cell)}.`;
      break;
    case 'transferSource':
      text = `Created when ${by} moved the mark at ${at(o.cell)} to #${o.to} at ${at(o.toCell)}.`;
      break;
    case 'transferWin':
      text = `Received a mark from #${o.from} at ${at(o.cell)}, which ended this timeline.`;
      break;
    case 'sendBack':
      text = `Created by ${by}’s forced send-back at ${at(o.cell)}, owed for #${o.terminal}.`;
      break;
  }
  if (node.received !== null) {
    text += ` It includes a mark received from #${node.received.from} at ${at(node.received.cell)}.`;
  }
  const pending = node.terminal === null ? incomingOf(state, id) : null;
  if (pending !== null) {
    text += ` Received a mark from #${pending.from} at ${at(pending.cell)} this turn.`;
  }
  return text;
}

/** A short origin for list rows: "Placed (2, 0, 1)", "Split", "Mark from #4", … */
export function originSummary(state: GameState, id: NodeId): string {
  const node = nodeAt(state.preview, id);
  const at = (cell: CellId) => coordLabel(state.topology, cell);
  const o = node.origin;
  switch (o.kind) {
    case 'root':
      return 'Start';
    case 'place':
      return `Placed ${at(o.cell)}`;
    case 'split':
      return `Split of #${node.parent}`;
    case 'ttSource':
      return `Sent ${at(o.cell)} back to #${o.arrival}`;
    case 'ttArrival':
      return `Mark from #${o.source} at ${at(o.cell)}`;
    case 'transferSource':
      return `Moved ${at(o.cell)} to #${o.to}`;
    case 'transferWin':
      return `Ended by a mark from #${o.from}`;
    case 'sendBack':
      return `Send-back at ${at(o.cell)} for #${o.terminal}`;
  }
}

/** Names for the node statuses: the legend labels and the glyphs' accessible names. */
export const STATUS_LABELS: Readonly<Record<HeadStatus, string>> = {
  needsAction: 'Needs action',
  acted: 'Acted this turn',
  waiting: 'Waiting',
  history: 'History',
  won: 'Won',
  drawn: 'Drawn',
  frozen: 'Decided this turn',
  draftCreated: 'Created this turn',
};

/**
 * The accessible name of a graph node, e.g. "Node 12, step 6, Player 2 to move, needs action"
 * or "Node 8, step 5, won by Player 1". `target` adds "valid target" in picking mode.
 */
export function nodeAriaLabel(state: GameState, id: NodeId, target = false): string {
  const node = nodeAt(state.preview, id);
  const status = headStatus(state, id);
  const t = node.terminal;
  const parts = [`Node ${id}`, `step ${node.step}`];
  if (t === null) {
    parts.push(toMoveLabel(node), STATUS_LABELS[status].toLowerCase());
  } else {
    parts.push(t.kind === 'win' ? `won by ${playerName(t.winner)}` : 'drawn');
    if (status === 'frozen') parts.push('this turn');
  }
  if (t === null && incomingOf(state, id) !== null) parts.push('received a mark');
  if (target) parts.push('valid target');
  return parts.join(', ');
}

/**
 * What a node's status means for the player in the hot seat, e.g. "Needs your action",
 * "Player 2 moves here", "Won by Player 1". Used as the read-only reason on the timeline screen.
 */
export function statusCaption(state: GameState, id: NodeId): string {
  const node = nodeAt(state.preview, id);
  const t = node.terminal;
  switch (headStatus(state, id)) {
    case 'needsAction':
      return 'Needs your action';
    case 'acted':
      return 'Already acted this turn';
    case 'frozen':
      return t?.kind === 'win'
        ? `Won by ${playerName(t.winner)} this turn (scored at End turn)`
        : 'Drawn this turn (scored at End turn)';
    case 'draftCreated':
      return 'Created this turn; it can act next turn';
    case 'history':
      return 'History';
    case 'won':
      return t?.kind === 'win' ? `Won by ${playerName(t.winner)}` : 'Won';
    case 'drawn':
      return 'Drawn: the board is full';
    case 'waiting':
      if (state.phase === 'over') return 'Game over';
      if (state.phase === 'awaitSendBack') return 'Waiting for the forced send-back';
      return `${playerName(parityPlayer(node.step))} moves here`;
  }
}

/** "Player 1 wins 3–1", "Player 2 wins by concession", "Draw: round limit reached". */
export function resultSentence(result: Result, score: readonly [number, number]): string {
  if (result.kind === 'win') {
    if (result.reason === 'concede') return `${playerName(result.winner)} wins by concession`;
    const [a, b] = result.winner === 0 ? score : [score[1], score[0]];
    return `${playerName(result.winner)} wins ${a}–${b}`;
  }
  return result.reason === 'turnLimit'
    ? 'Draw: round limit reached'
    : 'Draw: no live timelines left';
}

/** One sentence per engine event, e.g. "Player 1 won timeline #14". */
export function eventSentence(state: GameState, event: EngineEvent): string {
  const at = (cell: CellId) => coordLabel(state.topology, cell);
  const who = (p: Player) => playerName(p);
  switch (event.type) {
    case 'actionApplied': {
      const a = event.action;
      switch (a.kind) {
        case 'place':
          return `${who(event.player)} placed at ${at(a.cell)} on #${a.head}`;
        case 'split':
          return `${who(event.player)} split #${a.head}`;
        case 'timeTravel':
          return `${who(event.player)} sent a mark from #${a.head} back to #${a.target}`;
        case 'transfer':
          return `${who(event.player)} moved a mark from #${a.head} to #${a.targetHead}`;
      }
      break;
    }
    case 'timelineWon':
      return `${who(event.winner)} won timeline #${event.node}`;
    case 'timelineDrawn':
      return `Timeline #${event.node} was drawn`;
    case 'sendBackRequired':
      return `${who(event.player)} owes a send-back for #${event.terminal}`;
    case 'sendBackApplied':
      return `${who(event.player)} sent a mark back to #${event.target}`;
    case 'sendBackSkipped':
      return `${who(event.player)} had nowhere to send back for #${event.terminal}`;
    case 'turnSkipped':
      return `${who(event.player)} had no timelines; turn skipped`;
    case 'controlPassed':
      return `${who(event.player)} to move, round ${event.round}`;
    case 'gameOver':
      return resultSentence(event.result, state.score);
  }
}

/** Events worth a line in the post-resolution toast (moves and hand-overs are left out). */
const NOTABLE: ReadonlySet<EngineEvent['type']> = new Set([
  'timelineWon',
  'timelineDrawn',
  'sendBackApplied',
  'sendBackSkipped',
  'turnSkipped',
  'gameOver',
]);

/**
 * The toast after a resolution step: the notable events from index `since` on, joined with
 * " · ", e.g. "Player 1 won timeline #14 · Player 2 sent a mark back to #6". Null if none.
 */
export function eventSummary(state: GameState, since: number): string | null {
  const parts = state.events
    .slice(since)
    .filter((e) => NOTABLE.has(e.type))
    .map((e) => eventSentence(state, e));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The text with each "(…)" coordinate group made unbreakable (no-break spaces), so a line never
 * wraps in the middle of "(1, 0, 0)". For display only; the sentences themselves use spaces.
 */
export function keepCoordsTogether(text: string): string {
  return text.replace(/\([^()]*\)/g, (group) => group.replace(/ /g, '\u00a0'));
}

/** "1 timeline still needs an action" / "2 timelines …", or null when End turn is possible. */
export function missingSentence(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? '1 timeline still needs an action'
    : `${count} timelines still need an action`;
}
