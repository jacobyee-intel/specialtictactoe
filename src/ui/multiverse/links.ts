/**
 * Cross-links of the multiverse graph: the dashed arrows for time travel, transfers and forced
 * send-backs. They are derived from node origins alone (no extra engine state), so they can never
 * disagree with the tree.
 *
 * | Origin of node n     | Link                                                              |
 * |----------------------|-------------------------------------------------------------------|
 * | `ttSource`           | time travel from n's parent (the head whose mark left) to arrival |
 * | `transferSource`     | transfer from n's parent (head S) to the receiving head X, or to  |
 * |                      | X's child carrying the received mark once X has acted             |
 * | `transferWin`        | transfer from head S to n (the received mark alone ended X)       |
 * | `sendBack`           | send-back from the terminal node that owed it to n                |
 *
 * A `transferWin` and the `transferSource` of the same transfer describe one arrow, so the
 * source row is dropped when the win row exists. Every link is drawn in the colour of the player
 * who made the move: the creator of n, i.e. the player to move at n's parent.
 */
import {
  childrenOf,
  nodeAt,
  parityPlayer,
  type CellId,
  type GameState,
  type NodeId,
  type Player,
  type Tree,
} from '@/engine';

export type LinkKind = 'timeTravel' | 'transfer' | 'sendBack';

export interface GraphLink {
  readonly kind: LinkKind;
  readonly from: NodeId;
  readonly to: NodeId;
  /** The player who moved the mark (the sender, for a send-back). */
  readonly player: Player;
  /** Where the mark landed. */
  readonly cell: CellId;
  /** Created by the current draft (the node carrying the origin is not committed yet). */
  readonly draft: boolean;
}

/** The child of `head` whose board includes the mark received from `from`, if it acted. */
function receivingChild(tree: Tree, head: NodeId, from: NodeId): NodeId | null {
  for (const child of childrenOf(tree, head)) {
    if (nodeAt(tree, child).received?.from === from) return child;
  }
  return null;
}

/** Did the transfer from `from` end `head` at once (a `transferWin` child)? */
function endedByTransfer(tree: Tree, head: NodeId, from: NodeId): boolean {
  return childrenOf(tree, head).some((child) => {
    const o = nodeAt(tree, child).origin;
    return o.kind === 'transferWin' && o.from === from;
  });
}

/** Every cross-link of the preview, in the id order of the node carrying the origin. */
export function crossLinks(state: GameState): GraphLink[] {
  const tree = state.preview;
  const committed = state.nodes.length;
  const out: GraphLink[] = [];
  for (const node of tree.nodes) {
    const o = node.origin;
    if (node.parent === null) continue;
    const player = parityPlayer(nodeAt(tree, node.parent).step);
    const draft = node.id >= committed;
    switch (o.kind) {
      case 'ttSource': {
        const arrival = nodeAt(tree, o.arrival).origin;
        const cell = arrival.kind === 'ttArrival' ? arrival.cell : o.cell;
        out.push({ kind: 'timeTravel', from: node.parent, to: o.arrival, player, cell, draft });
        break;
      }
      case 'transferSource': {
        if (endedByTransfer(tree, o.to, node.parent)) break;
        const to = receivingChild(tree, o.to, node.parent) ?? o.to;
        out.push({ kind: 'transfer', from: node.parent, to, player, cell: o.toCell, draft });
        break;
      }
      case 'transferWin':
        out.push({ kind: 'transfer', from: o.from, to: node.id, player, cell: o.cell, draft });
        break;
      case 'sendBack':
        out.push({ kind: 'sendBack', from: o.terminal, to: node.id, player, cell: o.cell, draft });
        break;
      default:
        break;
    }
  }
  return out;
}
