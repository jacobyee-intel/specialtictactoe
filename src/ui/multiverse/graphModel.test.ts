import { describe, expect, it } from 'vitest';
import type { NodeId } from '@/engine';
import { scenario } from '@/engine/__tests__/helpers';
import {
  BLOCK_LANES,
  BLOCK_STEPS,
  blocksIn,
  buildGraph,
  computeGraph,
  graphBlocks,
  nodeAbove,
} from './graphModel';
import { laneLayout } from './laneLayout';
import { syntheticState } from './__tests__/synthetic';

/**
 * A split, a transfer whose receiving head then wins (forcing a send-back), and a time travel
 * still in the draft. Ids are asserted as the scenario goes so the expectations below read
 * directly against the tree.
 */
function mixedGame() {
  const g = scenario();
  const [n1] = g.line(g.c(1, 1, 1));
  expect(g.split(n1 as NodeId)).toEqual([2, 3]);
  g.endTurn();
  // P1 moves (1,1,1) from #2 to #3, then completes the diagonal on #3.
  expect(g.transfer(2, g.c(1, 1, 1), 3, g.c(0, 0, 0))).toEqual({ source: 4, win: null });
  expect(g.place(3, g.c(2, 2, 2))).toBe(5);
  g.endTurn();
  expect(g.state.pendingSendBack).toEqual({ player: 1, terminal: 5 });
  expect(g.sendBack(1, g.c(2, 0, 0))).toBe(6);
  expect(g.place(4, g.c(0, 0, 1))).toBe(7);
  g.endTurn();
  expect(g.timeTravel(6, g.c(1, 1, 1), 0, g.c(0, 2, 0))).toEqual({ source: 8, arrival: 9 });
  expect(g.place(7, g.c(2, 2, 1))).toBe(10);
  return g;
}

describe('buildGraph', () => {
  it('places, colours and links a mixed game', () => {
    const g = mixedGame();
    const model = buildGraph(g.state, laneLayout);
    expect(model.nodes.map((n) => [n.id, n.step, n.lane, n.x, n.y])).toEqual([
      [0, 0, 0, 0, 0],
      [1, 1, 0, 64, 0],
      [2, 2, 0, 128, 0],
      [3, 2, 1, 128, 48],
      [4, 3, 0, 192, 0],
      [5, 3, 1, 192, 48],
      [6, 2, 2, 128, 96],
      [7, 4, 0, 256, 0],
      [8, 3, 2, 192, 96],
      [9, 1, 3, 64, 144],
      [10, 5, 0, 320, 0],
    ]);
    expect(model.nodes.map((n) => n.status)).toEqual([
      'history',
      'history',
      'history',
      'history',
      'history',
      'won',
      'acted',
      'acted',
      'draftCreated',
      'draftCreated',
      'draftCreated',
    ]);
    expect(model.byId.get(5)?.winner).toBe(0);
    expect(model.nodes.filter((n) => n.draft).map((n) => n.id)).toEqual([8, 9, 10]);
    expect(model.edges.filter((e) => e.draft).map((e) => [e.from, e.to])).toEqual([
      [6, 8],
      [0, 9],
      [7, 10],
    ]);
    expect(model.edges).toHaveLength(10);
    expect(model.links).toEqual([
      { kind: 'transfer', from: 2, to: 5, player: 0, cell: g.c(0, 0, 0), draft: false },
      { kind: 'sendBack', from: 5, to: 6, player: 1, cell: g.c(2, 0, 0), draft: false },
      { kind: 'timeTravel', from: 6, to: 9, player: 0, cell: g.c(0, 2, 0), draft: true },
    ]);
    expect(model).toMatchObject({ lanes: 4, steps: 6, width: 320, height: 144 });
    expect(model.columns.map((c) => c.map((n) => n.id))).toEqual([
      [0],
      [1, 9],
      [2, 3, 6],
      [4, 5, 8],
      [7],
      [10],
    ]);
    expect(model.rows.map((r) => r.map((n) => n.id))).toEqual([
      [0, 1, 2, 4, 7, 10],
      [3, 5],
      [6, 8],
      [9],
    ]);
  });

  it('marks a head holding a received mark', () => {
    const g = scenario();
    const [n1] = g.line(g.c(1, 1, 1));
    const [a, b] = g.split(n1 as NodeId);
    g.endTurn();
    g.transfer(a, g.c(1, 1, 1), b, g.c(0, 0, 0));
    const model = buildGraph(g.state);
    expect(model.byId.get(b)).toMatchObject({ incoming: true, status: 'needsAction' });
    expect(model.byId.get(a)).toMatchObject({ incoming: false, status: 'acted' });
  });

  it('is memoised on the preview and rebuilt when it changes', () => {
    const g = scenario();
    const first = buildGraph(g.state);
    expect(buildGraph({ ...g.state })).toBe(first);
    g.place(0, g.c(0, 0, 0));
    const second = buildGraph(g.state);
    expect(second).not.toBe(first);
    expect(second.nodes).toHaveLength(2);
  });
});

describe('performance', () => {
  it('builds and lays out 5,000 nodes in under 50 ms', () => {
    const state = syntheticState(5000, 7);
    computeGraph(state, laneLayout); // warm up the JIT
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const model = computeGraph(state, laneLayout);
      times.push(performance.now() - t0);
      expect(model.nodes).toHaveLength(5000);
    }
    times.sort((a, b) => a - b);
    const median = times[2] as number;
    console.info(
      `buildGraph + laneLayout, 5,000 nodes: median ${median.toFixed(1)} ms, ` +
        `best ${(times[0] as number).toFixed(1)} ms, worst ${(times[4] as number).toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(50);
  });
});

describe('graphBlocks', () => {
  it('puts every node in exactly one block and every edge in each block it crosses', () => {
    const model = computeGraph(syntheticState(800, 3), laneLayout);
    const blocks = [...graphBlocks(model).values()];
    const seen = blocks.flatMap((b) => b.nodes.map((n) => n.id)).sort((a, b) => a - b);
    expect(seen).toEqual(model.nodes.map((n) => n.id));
    for (const b of blocks) {
      for (const n of b.nodes) {
        expect(Math.floor(n.step / BLOCK_STEPS)).toBe(b.col);
        expect(Math.floor(n.lane / BLOCK_LANES)).toBe(b.row);
      }
    }
    for (const e of model.edges) {
      const to = model.byId.get(e.to) as (typeof model.nodes)[number];
      const from = model.byId.get(e.from) as (typeof model.nodes)[number];
      const rows = blocks
        .filter((b) => b.edges.some((x) => x.to === to))
        .map((b) => b.row)
        .sort((a, b) => a - b);
      const lo = Math.floor(Math.min(from.lane, to.lane) / BLOCK_LANES);
      const hi = Math.floor(Math.max(from.lane, to.lane) / BLOCK_LANES);
      expect(rows).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    }
    expect(graphBlocks(model)).toBe(graphBlocks(model));
  });

  it('selects the blocks intersecting a range', () => {
    const model = computeGraph(syntheticState(800, 3), laneLayout);
    const range = { stepMin: 5, stepMax: 9, laneMin: 10, laneMax: 20 };
    const picked = blocksIn(model, range);
    expect(picked.length).toBeGreaterThan(0);
    for (const b of picked) {
      expect(b.col).toBeGreaterThanOrEqual(1);
      expect(b.col).toBeLessThanOrEqual(2);
      expect(b.row).toBeGreaterThanOrEqual(1);
      expect(b.row).toBeLessThanOrEqual(2);
    }
    const all = [...graphBlocks(model).values()].filter(
      (b) => b.col >= 1 && b.col <= 2 && b.row >= 1 && b.row <= 2,
    );
    expect(picked).toHaveLength(all.length);
  });
});

describe('nodeAbove', () => {
  it('finds the node in the previous lane at the same step', () => {
    const g = mixedGame();
    const model = buildGraph(g.state);
    const at = (id: number) => model.byId.get(id) as (typeof model.nodes)[number];
    expect(nodeAbove(model, at(3))).toBe(2); // step 2: lane 1 under lane 0
    expect(nodeAbove(model, at(8))).toBe(5); // step 3: lane 2 under lane 1
    expect(nodeAbove(model, at(9))).toBeUndefined(); // step 1, lane 3: lane 2 starts at step 2
    expect(nodeAbove(model, at(0))).toBeUndefined();
  });
});
