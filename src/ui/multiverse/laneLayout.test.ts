import { describe, expect, it } from 'vitest';
import type { NodeId, Tree } from '@/engine';
import { scenario } from '@/engine/__tests__/helpers';
import {
  COLUMN,
  LANE,
  assignLanes,
  edgePath,
  laneLayout,
  linkCurve,
  linkLabelAt,
  routeLink,
} from './laneLayout';
import { syntheticState } from './__tests__/synthetic';

/** The lane interval [min, max] of every subtree, checking contiguity on the way up. */
function subtreeLanes(tree: Tree, lanes: Int32Array, id: NodeId): [number, number, number] {
  const own = lanes[id] as number;
  let min = own;
  let max = own;
  let leaves = (tree.children[id] ?? []).length === 0 ? 1 : 0;
  for (const child of tree.children[id] ?? []) {
    const [lo, hi, n] = subtreeLanes(tree, lanes, child);
    min = Math.min(min, lo);
    max = Math.max(max, hi);
    leaves += n;
  }
  // Contiguous: an interval of exactly as many lanes as the subtree has leaves.
  expect(max - min + 1, `subtree of #${id}`).toBe(leaves);
  return [min, max, leaves];
}

function checkLayout(tree: Tree) {
  const placed = laneLayout(tree);
  const lanes = assignLanes(tree);
  expect(placed.size).toBe(tree.nodes.length);
  const cells = new Set<string>();
  for (const node of tree.nodes) {
    const at = placed.get(node.id);
    expect(at, `#${node.id} placed`).toBeDefined();
    expect(at?.x).toBe(node.step * COLUMN);
    expect(at?.y).toBe((at?.lane ?? -1) * LANE);
    const first = tree.children[node.id]?.[0];
    if (first !== undefined) expect(placed.get(first)?.lane).toBe(at?.lane);
    const key = `${node.step}/${at?.lane}`;
    expect(cells.has(key), `(step, lane) ${key} used twice`).toBe(false);
    cells.add(key);
  }
  const leafCount = tree.nodes.filter((n) => (tree.children[n.id] ?? []).length === 0).length;
  expect([...new Set(lanes)].sort((a, b) => a - b)).toEqual(
    Array.from({ length: leafCount }, (_, i) => i),
  );
  subtreeLanes(tree, lanes, 0);
}

describe('laneLayout', () => {
  it('lays a single timeline out on lane 0, one column per step', () => {
    const g = scenario();
    g.line(g.c(0, 0, 0), g.c(1, 1, 1), g.c(2, 2, 0));
    const placed = laneLayout(g.state.preview);
    expect([...placed.values()]).toEqual([
      { x: 0, y: 0, lane: 0 },
      { x: 64, y: 0, lane: 0 },
      { x: 128, y: 0, lane: 0 },
      { x: 192, y: 0, lane: 0 },
    ]);
  });

  it('gives each leaf the next lane and each parent its first child’s lane', () => {
    const g = scenario();
    const [n1] = g.line(g.c(1, 1, 1));
    const [a, b] = g.split(n1 as NodeId);
    g.endTurn();
    const a1 = g.place(a, g.c(0, 0, 0));
    const [b1, b2] = g.split(b);
    const lanes = assignLanes(g.state.preview);
    expect(Array.from(lanes)).toEqual([0, 0, 0, 1, 0, 1, 2]);
    expect([a1, b1, b2]).toEqual([4, 5, 6]);
    checkLayout(g.state.preview);
  });

  it('places a time-travel arrival at its own earlier step, below its ancestor’s lane', () => {
    const g = scenario();
    const [, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
    const { source, arrival } = g.timeTravel(n2 as NodeId, g.c(1, 1, 1), 0, g.c(2, 2, 2));
    const placed = laneLayout(g.state.preview);
    expect(placed.get(arrival)).toEqual({ x: 1 * COLUMN, y: LANE, lane: 1 });
    expect(placed.get(source)).toEqual({ x: 3 * COLUMN, y: 0, lane: 0 });
    checkLayout(g.state.preview);
  });

  it('keeps every invariant on random trees', () => {
    for (const seed of [1, 2, 3, 4, 5]) checkLayout(syntheticState(400, seed).preview);
  });

  it('is deterministic for the same tree', () => {
    const tree = syntheticState(300, 9).preview;
    expect([...laneLayout(tree)]).toEqual([...laneLayout(tree)]);
  });

  it('handles a very long single timeline without recursion', () => {
    const tree = syntheticState(1, 1).preview;
    const nodes = [...tree.nodes];
    const children: NodeId[][] = [[]];
    for (let id = 1; id < 20000; id++) {
      nodes.push({ ...(nodes[0] as (typeof nodes)[number]), id, parent: id - 1, step: id });
      children[id - 1] = [id];
      children.push([]);
    }
    const lanes = assignLanes({ nodes, children });
    expect(lanes.every((l) => l === 0)).toBe(true);
  });
});

describe('edgePath', () => {
  it('is a straight line within a lane', () => {
    expect(edgePath({ x: 0, y: 48 }, { x: 64, y: 48 })).toBe('M0 48H64');
  });

  it('drops half a column before the child', () => {
    expect(edgePath({ x: 64, y: 0 }, { x: 128, y: 96 })).toBe('M64 0H96V96H128');
  });
});

describe('linkCurve', () => {
  it('bows a vertical link to the right and stops at the node outlines', () => {
    const curve = linkCurve({ x: 128, y: 0 }, { x: 128, y: 96 });
    expect(curve.mid.x).toBeGreaterThan(128 + 30);
    expect(curve.mid.y).toBeCloseTo(48);
    expect(Math.hypot(curve.tip.x - 128, curve.tip.y - 96)).toBeCloseTo(14);
    // The arrow arrives heading back towards the target.
    expect(curve.dir.x).toBeLessThan(0);
    expect(curve.d.startsWith('M')).toBe(true);
  });

  it('bows a link into the past downwards, away from the main line', () => {
    const curve = linkCurve({ x: 320, y: 0 }, { x: 64, y: 48 });
    const chordY = 24;
    expect(curve.mid.y).toBeGreaterThan(chordY + 30);
    expect(Math.hypot(curve.dir.x, curve.dir.y)).toBeCloseTo(1);
  });

  it('caps the bow for long links', () => {
    const curve = linkCurve({ x: 0, y: 0 }, { x: 0, y: 2000 });
    expect(curve.mid.x).toBeGreaterThan(76);
    expect(curve.mid.x).toBeLessThan(84);
  });

  it('bows the other way on request', () => {
    const curve = linkCurve({ x: 128, y: 0 }, { x: 128, y: 96 }, { side: -1 });
    expect(curve.mid.x).toBeLessThan(128 - 20);
    expect(curve.normal.x).toBe(-1);
    expect(curve.normal.y).toBeCloseTo(0);
  });
});

describe('routeLink', () => {
  const a = { x: 128, y: 0 };
  const b = { x: 128, y: 96 };

  it('keeps the default side when it is clear', () => {
    expect(routeLink(a, b, () => false).mid.x).toBeGreaterThan(128);
  });

  it('switches sides to avoid a node in the way', () => {
    // A node one column right of the link's middle (step 4, lane 1).
    const curve = routeLink(a, b, (step, lane) => step === 3 && lane === 1);
    expect(linkCurve(a, b).mid.x).toBeGreaterThan(128);
    expect(curve.mid.x).toBeLessThan(128);
  });

  it('runs a short link almost straight between nodes on both sides', () => {
    // #5 (step 4, lane 0) to #8 (step 5, lane 1), with #6 (4, 1) and #7 (5, 0) beside it.
    const isNode = (s: number, l: number) => (s === 4 && l === 1) || (s === 5 && l === 0);
    const curve = routeLink({ x: 256, y: 0 }, { x: 320, y: 48 }, isNode);
    expect(Math.hypot(curve.mid.x - 288, curve.mid.y - 24)).toBeLessThan(10);
  });
});

describe('linkLabelAt', () => {
  it('puts the label between lanes, where the curve crosses, flush left of it', () => {
    const curve = linkCurve({ x: 128, y: 0 }, { x: 128, y: 96 });
    const at = linkLabelAt(curve);
    expect([at.y % LANE, at.y >= 0]).toEqual([22, true]);
    expect(at.x).toBeGreaterThan(128);
  });

  it('puts the label on the side the curve leaves free', () => {
    // Rising to the left (from lower right to upper left): text runs to the right.
    const left = linkLabelAt(linkCurve({ x: 256, y: 96 }, { x: 64, y: 0 }));
    // Rising to the right (from lower left to upper right): text runs to the left.
    const right = linkLabelAt(linkCurve({ x: 64, y: 96 }, { x: 256, y: 0 }));
    expect([left.anchor, right.anchor]).toEqual(['start', 'end']);
  });

  it('never goes above the first lane', () => {
    const curve = linkCurve({ x: 320, y: 0 }, { x: 64, y: 0 }, { side: -1 });
    expect(linkLabelAt(curve).y).toBe(22);
  });
});
