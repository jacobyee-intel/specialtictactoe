/**
 * The lanes layout of the timeline tree (Stage 5): x is local time, y is a lane.
 *
 * - **Columns.** x = step × {@link COLUMN}. Every node sits in the column of its own step, so a
 *   branch that grows out of the past (time travel, send-back) visibly starts in the past.
 * - **Lanes.** y = lane × {@link LANE}. The tree is walked depth-first with children in creation
 *   order; each leaf takes the next lane, and each internal node takes the lane of its *first*
 *   child. So the main line of every branch is one straight horizontal run, and every subtree
 *   occupies a contiguous interval of lanes, which is what keeps tree edges from ever crossing.
 *
 * Inserting a branch shifts the lanes below it by one. Lane numbers are never shown, so that is
 * fine; the renderer animates the shift.
 */
import type { NodeId, Tree } from '@/engine';

/** Column width: one step of local time (px at zoom 1). */
export const COLUMN = 64;
/** Lane height, on the 8 px baseline (px at zoom 1). */
export const LANE = 48;

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly lane: number;
}

/**
 * A layout places every node of a tree. The lanes layout is the only one so far; a Poincaré-disk
 * layout (Stage 9) would plug in here and reuse the rest of the graph model.
 */
export type Layout = (tree: Tree) => Map<NodeId, Placement>;

/**
 * Lane of every node, indexed by id. Iterative (no recursion), so a long single timeline cannot
 * overflow the stack. Runs in O(nodes).
 */
export function assignLanes(tree: Tree): Int32Array {
  const count = tree.nodes.length;
  const lanes = new Int32Array(count).fill(-1);
  if (count === 0) return lanes;
  // Pre-order with children in creation order: leaves appear in lane order.
  const order: NodeId[] = [];
  const stack: NodeId[] = [0];
  let next = 0;
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    order.push(id);
    const kids = tree.children[id] ?? [];
    if (kids.length === 0) lanes[id] = next++;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as NodeId);
  }
  // Children come after their parent in pre-order, so walking it backwards settles every first
  // child before its parent.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i] as NodeId;
    const first = tree.children[id]?.[0];
    if (first !== undefined) lanes[id] = lanes[first] as number;
  }
  return lanes;
}

/** The lanes layout: columns by step, compact crossing-free lanes. */
export const laneLayout: Layout = (tree) => {
  const lanes = assignLanes(tree);
  const out = new Map<NodeId, Placement>();
  for (const node of tree.nodes) {
    const lane = lanes[node.id] as number;
    out.set(node.id, { x: node.step * COLUMN, y: lane * LANE, lane });
  }
  return out;
};

/**
 * The orthogonal route of a tree edge (SVG path data): leave the parent horizontally, drop
 * vertically half a column before the child, then run into the child. A first child shares its
 * parent's lane, so its edge is a straight line.
 */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  if (from.y === to.y) return `M${from.x} ${from.y}H${to.x}`;
  const drop = to.x - COLUMN / 2;
  return `M${from.x} ${from.y}H${drop}V${to.y}H${to.x}`;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LinkCurve {
  /** SVG path data of the cubic Bézier, trimmed to the node outlines. */
  readonly d: string;
  /** The Bézier's four points (trimmed start, controls, tip). */
  readonly points: readonly [Point, Point, Point, Point];
  /** Where the arrowhead's tip goes (on the target's outline). */
  readonly tip: Point;
  /** Unit direction of travel at the tip, for orienting the arrowhead. */
  readonly dir: Point;
  /** The curve's midpoint. */
  readonly mid: Point;
  /** Unit normal towards the outside of the bow: the label sits on this side of `mid`. */
  readonly normal: Point;
}

/**
 * A cross-link as a cubic Bézier from `a` to `b`, bowing away from the chord so it does not run
 * along the lanes and through the nodes on them. By default (`side` 1) the bow goes to the
 * lower right, towards the future and the newer lanes, where the empty space usually is; `side`
 * −1 bows the other way. The bow grows with the distance, up to 80 px, and both ends stop
 * `clearance` px short of the node centres.
 */
export function linkCurve(
  a: Point,
  b: Point,
  opts: { readonly side?: 1 | -1; readonly bow?: number; readonly clearance?: number } = {},
): LinkCurve {
  const { side = 1, bow = 1, clearance = 14 } = opts;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (nx + ny < 0 || (nx + ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  nx *= side;
  ny *= side;
  // Control points at the chord's quarters, pushed out by 4/3 h: the curve's apex is then h out.
  const h = bow * Math.min(80, 8 + 0.2 * length);
  const push = (h * 4) / 3;
  const c1 = { x: a.x + dx / 4 + nx * push, y: a.y + dy / 4 + ny * push };
  const c2 = { x: a.x + (3 * dx) / 4 + nx * push, y: a.y + (3 * dy) / 4 + ny * push };
  const toward = (from: Point, to: Point) => {
    const ux = to.x - from.x;
    const uy = to.y - from.y;
    const ul = Math.hypot(ux, uy) || 1;
    return { x: ux / ul, y: uy / ul };
  };
  const u0 = toward(a, c1);
  const u1 = toward(b, c2);
  const start = { x: a.x + u0.x * clearance, y: a.y + u0.y * clearance };
  const tip = { x: b.x + u1.x * clearance, y: b.y + u1.y * clearance };
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M${r(start.x)} ${r(start.y)}C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(tip.x)} ${r(tip.y)}`,
    points: [start, c1, c2, tip],
    tip,
    dir: { x: -u1.x, y: -u1.y },
    mid: bezierAt([start, c1, c2, tip], 0.5),
    normal: { x: nx, y: ny },
  };
}

/** A point of a cubic Bézier. */
export function bezierAt(p: readonly [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const [p0, p1, p2, p3] = p;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * The lanes layout's link: whichever of the default bow, the opposite bow and a nearly straight
 * line passes furthest from the other nodes (sampled along the curve). The default wins unless
 * another is clearly better. `isNode(step, lane)` says whether a node sits at a grid position.
 */
export function routeLink(
  a: Point,
  b: Point,
  isNode: (step: number, lane: number) => boolean,
): LinkCurve {
  const ends = new Set([`${a.x}/${a.y}`, `${b.x}/${b.y}`]);
  const clearanceOf = (curve: LinkCurve) => {
    let best = Infinity;
    for (const t of [0.25, 0.4, 0.5, 0.6, 0.75]) {
      const p = bezierAt(curve.points, t);
      const s0 = Math.round(p.x / COLUMN);
      const l0 = Math.round(p.y / LANE);
      for (let s = s0 - 1; s <= s0 + 1; s++) {
        for (let l = l0 - 1; l <= l0 + 1; l++) {
          if (s < 0 || l < 0 || !isNode(s, l) || ends.has(`${s * COLUMN}/${l * LANE}`)) continue;
          best = Math.min(best, Math.hypot(p.x - s * COLUMN, p.y - l * LANE));
        }
      }
    }
    return best;
  };
  let best = linkCurve(a, b, { side: 1 });
  let bestClearance = clearanceOf(best);
  for (const curve of [linkCurve(a, b, { side: -1 }), linkCurve(a, b, { bow: 0.25 })]) {
    const c = clearanceOf(curve);
    if (c > bestClearance + 4) {
      best = curve;
      bestClearance = c;
    }
  }
  return best;
}

/** A link label's anchor point at zoom 1, and which way the text runs from it. */
export interface LinkLabel extends Point {
  readonly anchor: 'start' | 'end';
}

/**
 * Where a link's cell label goes, at zoom 1. Nodes sit on the lanes and their "#id" labels just
 * above them, so the free space is the upper half of the band between two lanes. The label goes
 * there, at the crossing nearest the curve's middle, 4 px to the side the curve leaves free: to
 * the right of a curve that rises to the left, to the left of one that rises to the right.
 */
export function linkLabelAt(curve: LinkCurve): LinkLabel {
  const band = (y: number) => Math.max(0, Math.floor((y - 12) / LANE));
  const place = (t: number, p: Point, b: number): LinkLabel => {
    const q = bezierAt(curve.points, Math.min(1, t + 0.02));
    const risesRight = (q.x - p.x) * (q.y - p.y) < 0;
    return risesRight
      ? { x: p.x - 4, y: b * LANE + 22, anchor: 'end' }
      : { x: p.x + 4, y: b * LANE + 22, anchor: 'start' };
  };
  for (const dt of [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2, 0.25, -0.25]) {
    const p = bezierAt(curve.points, 0.5 + dt);
    const b = band(p.y);
    const local = p.y - b * LANE;
    if (local >= 12 && local <= 26) return place(0.5 + dt, p, b);
  }
  return place(0.5, curve.mid, band(curve.mid.y));
}
