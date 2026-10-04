/**
 * View model of the list multiverse: the preview's nodes grouped by what they mean for the player
 * in the hot seat, with the picking state of the current flow.
 *
 * Stage 5 replaces the list with a graph, but the grouping, the row facts and the picking rules
 * here stay the same, so the graph can reuse this module.
 */
import {
  headStatus,
  incomingOf,
  parityPlayer,
  type GameState,
  type HeadStatus,
  type NodeId,
  type Player,
} from '@/engine';
import { originSummary } from './describe';
import { targetsFor, type Flow } from './flow';

export type GroupId = 'targets' | 'needs' | 'done' | 'waiting' | 'completed' | 'history';

export const GROUP_TITLES: Readonly<Record<GroupId, string>> = {
  targets: 'Valid targets',
  needs: 'Needs your action',
  done: 'Done this turn',
  waiting: 'Waiting',
  completed: 'Completed',
  history: 'History',
};

const GROUP_OF: Readonly<Record<HeadStatus, Exclude<GroupId, 'targets'>>> = {
  needsAction: 'needs',
  acted: 'done',
  draftCreated: 'done',
  waiting: 'waiting',
  won: 'completed',
  drawn: 'completed',
  frozen: 'completed',
  history: 'history',
};

export interface NodeRow {
  readonly id: NodeId;
  readonly step: number;
  /** The player to move at the node. */
  readonly mover: Player;
  readonly status: HeadStatus;
  /** The winner of a won (or frozen-won) node. */
  readonly winner: Player | null;
  readonly origin: string;
  /** A mark received by transfer this turn, waiting to be played with the next action. */
  readonly incoming: { readonly player: Player; readonly from: NodeId } | null;
  /** A valid target of the current flow (picking mode). */
  readonly target: boolean;
  /** Dropped to 30% because the flow is picking and this is not a target. */
  readonly dimmed: boolean;
}

export interface RowGroup {
  readonly id: GroupId;
  readonly title: string;
  readonly rows: readonly NodeRow[];
  /** Collapsed unless opened (History), except while one of its rows is a target. */
  readonly collapsed: boolean;
}

/** The status group of a node (outside picking). */
export function groupOf(status: HeadStatus): Exclude<GroupId, 'targets'> {
  return GROUP_OF[status];
}

/**
 * The rows of the list multiverse in group order, each group in node id order. Empty groups are
 * kept (with no rows) so the headings stay put as play moves nodes between them. While a flow is
 * picking a node, its targets are lifted into a first "Valid targets" group (they are usually
 * history nodes, far down the list) and every other row is dimmed.
 */
export function multiverseGroups(state: GameState, flow: Flow, historyOpen = false): RowGroup[] {
  const picking = flow.kind !== 'idle' && flow.target === null;
  const targets = new Set(picking ? targetsFor(flow, state).map((t) => t.node) : []);
  const order = (Object.keys(GROUP_TITLES) as GroupId[]).filter((g) => picking || g !== 'targets');
  const byGroup = new Map<GroupId, NodeRow[]>(order.map((g) => [g, []]));
  for (const node of state.preview.nodes) {
    const status = headStatus(state, node.id);
    const incoming = node.terminal === null ? incomingOf(state, node.id) : null;
    const t = node.terminal;
    const target = targets.has(node.id);
    byGroup.get(target ? 'targets' : groupOf(status))?.push({
      id: node.id,
      step: node.step,
      mover: parityPlayer(node.step),
      status,
      winner: t?.kind === 'win' ? t.winner : null,
      origin: originSummary(state, node.id),
      incoming: incoming && { player: parityPlayer(node.step), from: incoming.from },
      target,
      dimmed: picking && !target,
    });
  }
  return [...byGroup].map(([id, rows]) => ({
    id,
    title: GROUP_TITLES[id],
    rows,
    collapsed: id === 'history' && !historyOpen,
  }));
}
