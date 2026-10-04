/**
 * Test-only: large synthetic game states for the layout property and performance tests. Playing
 * thousands of real moves would be slow and would hit the timeline cap, so the tree is built
 * directly: every node is a split child (same board as the root), and the preview is the tree.
 */
import { newGame, type GameState, type NodeId, type TNode } from '@/engine';

/** A small deterministic PRNG (mulberry32), so failures reproduce. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A state whose tree has `count` nodes. Each new node usually extends a random current leaf (so
 * timelines grow long) and sometimes branches off a random earlier node (like time travel), which
 * gives many lanes and out-of-step branches.
 */
export function syntheticState(count: number, seed = 1): GameState {
  const base = newGame({ topology: 'flat', n: 3, m: 3, w: 3, l: 30 });
  const root = base.nodes[0] as TNode;
  const random = rng(seed);
  const nodes: TNode[] = [root];
  const children: NodeId[][] = [[]];
  const leaves: NodeId[] = [0];
  for (let id = 1; id < count; id++) {
    let parent: NodeId;
    if (random() < 0.8) {
      const i = Math.floor(random() * leaves.length);
      parent = leaves[i] as NodeId;
      leaves[i] = id;
    } else {
      parent = Math.floor(random() * id);
      if ((children[parent] ?? []).length === 0) leaves.splice(leaves.indexOf(parent), 1, id);
      else leaves.push(id);
    }
    const p = nodes[parent] as TNode;
    nodes.push({ ...root, id, parent, step: p.step + 1, origin: { kind: 'split' }, round: 1 });
    children.push([]);
    (children[parent] as NodeId[]).push(id);
  }
  const preview = {
    nodes,
    children,
    ledger: { acted: new Set<NodeId>(), incoming: new Map() },
    live: leaves.length,
  };
  return { ...base, nodes, children, preview };
}
