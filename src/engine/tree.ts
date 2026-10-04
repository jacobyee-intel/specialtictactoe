/**
 * Tree queries: parity, heads, ancestry, live-timeline counts, and an ASCII dump for debugging.
 */
import type { GameState, NodeId, Player, TNode, Tree } from './types';

/** The player to move at a node with this step: P1 (0) at even steps, P2 (1) at odd steps. */
export function parityPlayer(step: number): Player {
  return (step % 2) as Player;
}

/** The node with this id; throws `RangeError` for an unknown id. */
export function nodeAt(tree: Tree, id: NodeId): TNode {
  const node = tree.nodes[id];
  if (node === undefined) throw new RangeError(`No node #${id}.`);
  return node;
}

/** True when `id` is a valid node id of the tree. */
export function hasNode(tree: Tree, id: unknown): id is NodeId {
  return Number.isInteger(id) && (id as number) >= 0 && (id as number) < tree.nodes.length;
}

/** A head is a non-terminal node with no children: a timeline that is still being played. */
export function isHead(tree: Tree, id: NodeId): boolean {
  return nodeAt(tree, id).terminal === null && childrenOf(tree, id).length === 0;
}

export function childrenOf(tree: Tree, id: NodeId): readonly NodeId[] {
  return tree.children[id] ?? [];
}

/** Strict ancestors of `id`, nearest first (parent, grandparent, …, root). */
export function strictAncestors(tree: Tree, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let p = nodeAt(tree, id).parent; p !== null; p = nodeAt(tree, p).parent) out.push(p);
  return out;
}

/** True when `ancestor` lies strictly above `id` (never true for `ancestor === id`). */
export function isStrictAncestor(tree: Tree, ancestor: NodeId, id: NodeId): boolean {
  for (let p = nodeAt(tree, id).parent; p !== null; p = nodeAt(tree, p).parent) {
    if (p === ancestor) return true;
  }
  return false;
}

/** All heads, optionally only those where `player` is to move, in id order. */
export function headsOf(tree: Tree, player?: Player): NodeId[] {
  const out: NodeId[] = [];
  for (const node of tree.nodes) {
    if (node.terminal !== null || childrenOf(tree, node.id).length > 0) continue;
    if (player === undefined || parityPlayer(node.step) === player) out.push(node.id);
  }
  return out;
}

/** Number of live timelines (non-terminal heads). */
export function countLive(tree: Tree): number {
  let live = 0;
  for (const node of tree.nodes) {
    if (node.terminal === null && childrenOf(tree, node.id).length === 0) live++;
  }
  return live;
}

/** Child lists rebuilt from parent links. Ids grow with creation order, so order is preserved. */
export function buildChildren(nodes: readonly TNode[]): NodeId[][] {
  const children: NodeId[][] = nodes.map(() => []);
  for (const node of nodes) if (node.parent !== null) children[node.parent]?.push(node.id);
  return children;
}

const P = (p: Player): string => `P${p + 1}`;

/**
 * A readable dump of the preview tree, used in test failure messages and the debug panel.
 *
 * ```
 * round 3 · P1 to move · draft · score 1–0 · live 2/32
 * #0 s0 P1 root
 * └─ #1 s1 P2 place c13
 *    ├─ #2 s2 P1 split [needs action]
 *    └─ #3 s2 P1 split ⇐c4 from #2 [acted]
 * ```
 *
 * Each line shows id, step, the player to move there, how the node was made, and its status:
 * `★` marks a scored win, `(frozen)` a terminal created by the draft, `+draft` a draft node.
 */
export function printTree(state: GameState): string {
  const pv = state.preview;
  const status = state.result
    ? `over: ${state.result.kind === 'win' ? `${P(state.result.winner)} wins` : 'draw'} (${state.result.reason})`
    : state.phase === 'awaitSendBack' && state.pendingSendBack
      ? `${P(state.pendingSendBack.player)} must send back for #${state.pendingSendBack.terminal}`
      : `${P(state.current)} to move · draft`;
  const out = [
    `round ${state.round} · ${status} · score ${state.score[0]}–${state.score[1]} · live ${pv.live}/${state.config.maxTimelines}`,
  ];
  const stack: [NodeId, string, string][] = [[0, '', '']];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [id, lead, childLead] = item;
    out.push(lead + describeNode(state, id));
    const kids = childrenOf(pv, id);
    for (let i = kids.length - 1; i >= 0; i--) {
      const last = i === kids.length - 1;
      stack.push([
        kids[i] as NodeId,
        childLead + (last ? '└─ ' : '├─ '),
        childLead + (last ? '   ' : '│  '),
      ]);
    }
  }
  return out.join('\n');
}

function describeNode(state: GameState, id: NodeId): string {
  const pv = state.preview;
  const node = nodeAt(pv, id);
  const o = node.origin;
  const parts = [`#${id} s${node.step} ${P(parityPlayer(node.step))}`];
  switch (o.kind) {
    case 'root':
    case 'split':
      parts.push(o.kind);
      break;
    case 'place':
      parts.push(`place c${o.cell}`);
      break;
    case 'ttSource':
      parts.push(`tt-src -c${o.cell} →#${o.arrival}`);
      break;
    case 'ttArrival':
      parts.push(`tt-arr +c${o.cell} ←#${o.source}`);
      break;
    case 'transferSource':
      parts.push(`xfer-src -c${o.cell} →#${o.to}:c${o.toCell}`);
      break;
    case 'transferWin':
      parts.push(`xfer-win +c${o.cell} ←#${o.from}`);
      break;
    case 'sendBack':
      parts.push(`sendback +c${o.cell} (for #${o.terminal})`);
      break;
  }
  if (node.received) parts.push(`recv c${node.received.cell}←#${node.received.from}`);
  const draftNode = id >= state.nodes.length;
  const t = node.terminal;
  if (t) {
    const what =
      t.kind === 'win' ? `WON ${P(t.winner)} line ${t.lineId}` : `DRAWN by ${P(t.filler)}`;
    parts.push(draftNode ? `${what} (frozen)` : `${what}${t.kind === 'win' ? ' ★' : ''}`);
  } else {
    const incoming = pv.ledger.incoming.get(id);
    if (incoming) parts.push(`⇐c${incoming.cell} from #${incoming.from}`);
    const committedHead = !draftNode && childrenOf(state, id).length === 0;
    if (committedHead && state.phase === 'draft' && parityPlayer(node.step) === state.current) {
      parts.push(pv.ledger.acted.has(id) ? '[acted]' : '[needs action]');
    }
  }
  if (draftNode) parts.push('+draft');
  return parts.join(' ');
}
