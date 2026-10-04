import { describe, expect, it } from 'vitest';
import {
  buildLineIndex,
  createTopology,
  lineCells,
  type CellId,
  type Player,
  type Topology,
  type TopologyId,
} from '@/geometry';
import { buildSceneModel, toWorld, type SceneInput, type Vec3 } from './sceneModel';

function input(topology: Topology, extra: Partial<SceneInput> = {}): SceneInput {
  return {
    topology,
    board: new Uint8Array(topology.cellCount),
    received: new Set(),
    lastMove: null,
    win: null,
    threats: [],
    ...extra,
  };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Line ids with their cells, for a space and line length. */
function lines(id: TopologyId, n: number, m: number) {
  const topology = createTopology(id, n);
  const index = buildLineIndex(topology, m);
  const out: CellId[][] = [];
  for (let l = 0; l < index.lineCount; l++) out.push([...lineCells(index, l)]);
  return { topology, lines: out };
}

describe('toWorld', () => {
  it('puts engine z up and is a proper rotation (keeps handedness)', () => {
    const x = toWorld([1, 0, 0]);
    const y = toWorld([0, 1, 0]);
    const z = toWorld([0, 0, 1]);
    expect(z).toEqual([0, 1, 0]);
    const det =
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
      x[1] * (y[0] * z[2] - y[2] * z[0]) +
      x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBe(1);
  });
});

describe('buildSceneModel: cubic spaces', () => {
  it('places one unit cell per cell, centred on the origin, with an N-cube grid', () => {
    for (const n of [3, 4, 5, 6]) {
      const topology = createTopology('flat', n);
      const model = buildSceneModel(input(topology));
      expect(model.cells).toHaveLength(n ** 3);
      expect(model.cells.every((c, i) => c.cell === i && c.size === 1)).toBe(true);
      expect(model.marks).toHaveLength(0);
      // 3 (N+1)² grid lines and the cube's 12 edges, two xyz endpoints each.
      expect(model.wires.length).toBe(3 * (n + 1) ** 2 * 6);
      expect(model.outline.length).toBe(12 * 6);
      expect(model.bounds).toEqual({ min: [-n / 2, -n / 2, -n / 2], max: [n / 2, n / 2, n / 2] });
      expect(model.key).toBe(`flat/${n}`);
      const first = model.cells[0]?.pos as Vec3;
      expect(first).toEqual(toWorld([0.5 - n / 2, 0.5 - n / 2, 0.5 - n / 2]));
    }
  });

  it('has one mark instance per occupied cell, received marks flagged', () => {
    const topology = createTopology('torus3', 4);
    const board = new Uint8Array(topology.cellCount);
    const p1 = [0, 5, 17, 63];
    const p2 = [1, 2, 40];
    for (const c of p1) board[c] = 1;
    for (const c of p2) board[c] = 2;
    const model = buildSceneModel(
      input(topology, { board, received: new Set([17, 40]), lastMove: 5 }),
    );
    expect(model.marks).toHaveLength(p1.length + p2.length);
    const of = (p: Player) =>
      model.marks
        .filter((m) => m.player === p)
        .map((m) => m.cell)
        .sort((a, b) => a - b);
    expect(of(0)).toEqual(p1);
    expect(of(1)).toEqual(p2);
    expect(model.marks.filter((m) => m.received).map((m) => m.cell)).toEqual([17, 40]);
    for (const m of model.marks) expect(m.pos).toEqual(model.cells[m.cell]?.pos);
    expect(model.lastMove?.cell).toBe(5);
  });

  it('places threats on their missing cells', () => {
    const topology = createTopology('flat', 3);
    const model = buildSceneModel(
      input(topology, {
        threats: [
          { cell: 2, player: 0 },
          { cell: 7, player: 1 },
        ],
      }),
    );
    expect(model.threats.map((t) => [t.cell, t.player])).toEqual([
      [2, 0],
      [7, 1],
    ]);
    expect(model.threats[1]?.pos).toEqual(model.cells[7]?.pos);
  });

  it('draws a flat win line as one straight path through its M centres', () => {
    const { topology, lines: all } = lines('flat', 4, 4);
    for (const cells of all) {
      const model = buildSceneModel(input(topology, { win: { player: 0, cells } }));
      const win = model.win;
      expect(win?.points).toHaveLength(4);
      // One straight path: the centres, plus half a step beyond each end.
      const path = win?.paths[0] ?? [];
      expect(win?.paths).toHaveLength(1);
      expect(path.slice(1, -1)).toEqual(win?.points);
      const [p0, p1] = win?.points ?? [];
      const step = dist(p0 as Vec3, p1 as Vec3);
      expect(dist(path[0] as Vec3, p0 as Vec3)).toBeCloseTo(step / 2, 9);
      expect(Math.max(...path.flatMap((p) => p.map(Math.abs)))).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it.each(['torus3', 'tetracosm', 'amphicosm1'] as const)(
    '%s: win lines break only at seams, leaving and re-entering through the walls',
    (id) => {
      const n = 4;
      const { topology, lines: all } = lines(id, n, 3);
      let crossings = 0;
      for (const cells of all) {
        const model = buildSceneModel(input(topology, { win: { player: 1, cells } }));
        const { points, paths } = model.win ?? { points: [], paths: [] };
        expect(points).toHaveLength(3);
        // Each path stays inside the cube. Apart from the line's two ends (half a step past its
        // end cells), a point that is not a cell centre is where the line meets a wall.
        const centres = new Set(points.map((p) => p.join()));
        const ends = new Set([paths[0]?.[0], paths.at(-1)?.at(-1)]);
        for (const path of paths) {
          for (const p of path) {
            expect(Math.max(...p.map(Math.abs))).toBeLessThanOrEqual(n / 2 + 1e-9);
            if (!centres.has(p.join()) && !ends.has(p)) {
              expect(p.some((v) => Math.abs(Math.abs(v) - n / 2) < 1e-9)).toBe(true);
            }
          }
          // Consecutive points are at most one full diagonal step apart.
          for (let i = 1; i < path.length; i++) {
            expect(dist(path[i - 1] as Vec3, path[i] as Vec3)).toBeLessThanOrEqual(
              Math.sqrt(3) + 1e-9,
            );
          }
        }
        crossings += paths.length - 1;
      }
      expect(crossings).toBeGreaterThan(0);
    },
  );
});

describe('buildSceneModel: tesseract', () => {
  it('projects 8N³ cells with the near cube enclosing the far one', () => {
    const n = 4;
    const topology = createTopology('tesseract', n);
    const model = buildSceneModel(input(topology));
    expect(model.cells).toHaveLength(8 * n ** 3);
    // The 32 edges of the hypercube as the outline; a grid per facet as the wires.
    expect(model.outline.length).toBe(32 * 6);
    expect(model.wires.length).toBe(8 * 3 * (n + 1) ** 2 * 6);
    const near = model.cells.filter((c) => topology.facet(c.cell).index === 7);
    const far = model.cells.filter((c) => topology.facet(c.cell).index === 6);
    const extent = (cs: typeof near) => Math.max(...cs.flatMap((c) => c.pos.map(Math.abs)));
    expect(extent(near)).toBeGreaterThan(extent(far));
    expect(Math.min(...near.map((c) => c.size))).toBeGreaterThan(
      Math.max(...far.map((c) => c.size)),
    );
    for (const c of model.cells) {
      for (let k = 0; k < 3; k++) {
        expect(c.pos[k]).toBeGreaterThan(model.bounds.min[k] as number);
        expect(c.pos[k]).toBeLessThan(model.bounds.max[k] as number);
      }
    }
  });

  it('draws every win line as one path, bending on the ridges it crosses', () => {
    const { lines: all } = lines('tesseract', 3, 3);
    const topology = createTopology('tesseract', 3);
    let bends = 0;
    for (const cells of all) {
      const model = buildSceneModel(input(topology, { win: { player: 0, cells } }));
      const paths = model.win?.paths ?? [];
      expect(paths).toHaveLength(1);
      const facets = cells.map((c) => topology.facet(c).index);
      const ridges = facets.filter((f, i) => i > 0 && f !== facets[i - 1]).length;
      // The centres, a bend point per ridge, and the two half-step ends.
      expect(paths[0]).toHaveLength(cells.length + ridges + 2);
      bends += ridges;
    }
    expect(bends).toBeGreaterThan(0);
  });
});
