/**
 * The multiverse graph as plain data: every node of the preview with a position and its status
 * glyph, the parent → child edges, and the cross-links. One model, many renderers: the SVG lanes
 * view draws it today, and a different {@link Layout} (Stage 9, the Poincaré disk) would swap
 * only the positions and the edge drawing.
 *
 * Building the model is O(nodes) and memoised on the preview object, which the engine replaces
 * whenever the draft or the tree changes, so re-renders for hover, focus or panning are free.
 */
import {
  headStatus,
  incomingOf,
  parityPlayer,
  type GameState,
  type HeadStatus,
  type NodeId,
  type Player,
  type Preview,
} from '@/engine';
import { laneLayout, type Layout } from './laneLayout';
import { crossLinks, type GraphLink } from './links';

export type { GraphLink, LinkKind } from './links';
export type { Layout, Placement } from './laneLayout';

export interface GraphNode {
  readonly id: NodeId;
  readonly parent: NodeId | null;
  readonly x: number;
  readonly y: number;
  readonly lane: number;
  readonly step: number;
  readonly status: HeadStatus;
  /** The player to move at the node. */
  readonly mover: Player;
  /** Who won a won (or frozen-won) node. */
  readonly winner: Player | null;
  /** Holds a mark received by transfer this turn, not yet played. */
  readonly incoming: boolean;
  /** Created by the current draft (id at or above `state.nodes.length`). */
  readonly draft: boolean;
}

/** A tree edge, parent → child; dashed when the child is a draft node. */
export interface GraphEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly draft: boolean;
}

export interface GraphModel {
  /** In id order. */
  readonly nodes: readonly GraphNode[];
  readonly byId: ReadonlyMap<NodeId, GraphNode>;
  readonly edges: readonly GraphEdge[];
  readonly links: readonly GraphLink[];
  /** Number of lanes (the layout's rows). */
  readonly lanes: number;
  /** Number of step columns (the largest step + 1). */
  readonly steps: number;
  /** Extent of the node centres; positions run from 0 to `width` × 0 to `height`. */
  readonly width: number;
  readonly height: number;
  /** Nodes by step, for culling to the visible columns. */
  readonly columns: readonly (readonly GraphNode[])[];
  /** Nodes by lane, each in step order, for keyboard navigation between lanes. */
  readonly rows: readonly (readonly GraphNode[])[];
}

interface Memo {
  readonly key: string;
  readonly layout: Layout;
  readonly model: GraphModel;
}

const memo = new WeakMap<Preview, Memo>();

/**
 * Statuses also depend on whose turn it is. The engine never changes those without a new
 * preview, but the key makes the memo safe even if it someday does.
 */
const statusKey = (state: GameState) => `${state.phase}/${state.current}/${state.nodes.length}`;

/** The graph of `state.preview`, placed by `layout` (memoised on the preview object). */
export function buildGraph(state: GameState, layout: Layout = laneLayout): GraphModel {
  const key = statusKey(state);
  const hit = memo.get(state.preview);
  if (hit !== undefined && hit.key === key && hit.layout === layout) return hit.model;
  const model = computeGraph(state, layout);
  memo.set(state.preview, { key, layout, model });
  return model;
}

/** {@link buildGraph} without the memo (for tests and benchmarks). */
export function computeGraph(state: GameState, layout: Layout): GraphModel {
  const tree = state.preview;
  const placed = layout(tree);
  const committed = state.nodes.length;
  const nodes: GraphNode[] = [];
  const byId = new Map<NodeId, GraphNode>();
  const edges: GraphEdge[] = [];
  const columns: GraphNode[][] = [];
  const rows: GraphNode[][] = [];
  let width = 0;
  let height = 0;
  for (const node of tree.nodes) {
    const at = placed.get(node.id);
    if (at === undefined) throw new RangeError(`The layout did not place node #${node.id}.`);
    const t = node.terminal;
    const g: GraphNode = {
      id: node.id,
      parent: node.parent,
      x: at.x,
      y: at.y,
      lane: at.lane,
      step: node.step,
      status: headStatus(state, node.id),
      mover: parityPlayer(node.step),
      winner: t?.kind === 'win' ? t.winner : null,
      incoming: t === null && incomingOf(state, node.id) !== null,
      draft: node.id >= committed,
    };
    nodes.push(g);
    byId.set(g.id, g);
    if (node.parent !== null) edges.push({ from: node.parent, to: node.id, draft: g.draft });
    (columns[g.step] ??= []).push(g);
    (rows[g.lane] ??= []).push(g);
    if (g.x > width) width = g.x;
    if (g.y > height) height = g.y;
  }
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];
  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] ??= []);
    row.sort((a, b) => a.step - b.step);
  }
  return {
    nodes,
    byId,
    edges,
    links: crossLinks(state),
    lanes: rows.length,
    steps: columns.length,
    width,
    height,
    columns,
    rows,
  };
}

/** The node in the lane above `n` at the same step, if any (lanes are unbroken step runs). */
export function nodeAbove(model: GraphModel, n: GraphNode): NodeId | undefined {
  const row = model.rows[n.lane - 1];
  const first = row?.[0];
  if (row === undefined || first === undefined) return undefined;
  const above = row[n.step - first.step];
  return above?.step === n.step ? above.id : undefined;
}

// --- Blocks (culling) ----------------------------------------------------------------------------

/** Culling block size: columns and lanes per block. */
export const BLOCK_STEPS = 4;
export const BLOCK_LANES = 8;

/** A drawn tree edge: the parent and child nodes. */
export interface EdgeRef {
  readonly from: GraphNode;
  readonly to: GraphNode;
}

/**
 * A rectangle of the lanes grid (`BLOCK_STEPS` columns × `BLOCK_LANES` lanes) with its nodes and
 * the edges that pass through it. The renderer draws whole blocks, each skipped unless its
 * contents or flags change, so panning a tree of thousands of nodes only diffs a few dozen
 * blocks. An edge belongs to every block its vertical drop crosses, so a long drop never
 * vanishes when its child is scrolled away.
 */
export interface Block {
  readonly key: string;
  readonly col: number;
  readonly row: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly EdgeRef[];
}

const blockMemo = new WeakMap<GraphModel, ReadonlyMap<string, Block>>();

/** The blocks of a model (memoised per model). */
export function graphBlocks(model: GraphModel): ReadonlyMap<string, Block> {
  const hit = blockMemo.get(model);
  if (hit !== undefined) return hit;
  const blocks = new Map<
    string,
    { col: number; row: number; nodes: GraphNode[]; edges: EdgeRef[] }
  >();
  const at = (col: number, row: number) => {
    const key = `${col}/${row}`;
    let b = blocks.get(key);
    if (b === undefined) {
      b = { col, row, nodes: [], edges: [] };
      blocks.set(key, b);
    }
    return b;
  };
  for (const n of model.nodes) {
    const col = Math.floor(n.step / BLOCK_STEPS);
    at(col, Math.floor(n.lane / BLOCK_LANES)).nodes.push(n);
    const p = n.parent === null ? undefined : model.byId.get(n.parent);
    if (p === undefined) continue;
    const r0 = Math.floor(Math.min(p.lane, n.lane) / BLOCK_LANES);
    const r1 = Math.floor(Math.max(p.lane, n.lane) / BLOCK_LANES);
    for (let row = r0; row <= r1; row++) at(col, row).edges.push({ from: p, to: n });
  }
  const out = new Map<string, Block>();
  for (const [key, b] of blocks) out.set(key, { key, ...b });
  blockMemo.set(model, out);
  return out;
}

/** The blocks that intersect a range of steps and lanes, in column-major order. */
export function blocksIn(
  model: GraphModel,
  range: { stepMin: number; stepMax: number; laneMin: number; laneMax: number },
): Block[] {
  const blocks = graphBlocks(model);
  const out: Block[] = [];
  const c0 = Math.max(0, Math.floor(range.stepMin / BLOCK_STEPS));
  const c1 = Math.floor(Math.max(0, range.stepMax) / BLOCK_STEPS);
  const r0 = Math.max(0, Math.floor(range.laneMin / BLOCK_LANES));
  const r1 = Math.floor(Math.max(0, range.laneMax) / BLOCK_LANES);
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const b = blocks.get(`${col}/${row}`);
      if (b !== undefined) out.push(b);
    }
  }
  return out;
}
