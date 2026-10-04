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
import { buildSceneModel, netToWorld, toWorld, type SceneInput, type Vec3 } from './sceneModel';

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
      expect(model.key).toBe(`flat/${n}/cube`);
      expect(model.mode).toBe('cube');
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
    // The 32 edges of the hypercube as the outline; no cell grids until a cube is chosen.
    expect(model.outline.length).toBe(32 * 6);
    expect(model.wires.length).toBe(0);
    expect(model.selectedOutline).toBeNull();
    const chosen = buildSceneModel(input(topology), { facet: 3, hoverFacet: 5 });
    expect(chosen.wires.length).toBe(2 * 3 * (n + 1) ** 2 * 6);
    expect(chosen.selectedOutline?.length).toBe(12 * 6);
    expect(buildSceneModel(input(topology), { facet: 3, hoverFacet: 3 }).wires.length).toBe(
      3 * (n + 1) ** 2 * 6,
    );
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

describe('buildSceneModel: ghost copies (cover view)', () => {
  it.each([
    ['faces', 6],
    ['all', 26],
  ] as const)(
    '%s: one ghost per cell and copy, ghost marks from the source cells',
    (range, copies) => {
      const n = 4;
      const topology = createTopology('tetracosm', n);
      const board = new Uint8Array(topology.cellCount);
      board[0] = 1;
      board[21] = 2;
      const model = buildSceneModel(input(topology, { board }), { ghosts: range });
      expect(model.mode).toBe('cover');
      expect(model.key).toBe(`tetracosm/4/cover/${range}`);
      expect(model.ghosts?.cells).toHaveLength(copies * n ** 3);
      expect(model.ghosts?.marks).toHaveLength(2 * copies);
      expect(model.ghosts?.outlines.length).toBe(copies * 12 * 6);
      expect(model.landmark).toHaveLength(copies + 1);
      // Ghosts lie outside the fundamental cube; the fundamental cells inside it.
      for (const g of model.ghosts?.cells ?? []) {
        expect(Math.max(...g.pos.map(Math.abs))).toBeGreaterThan(n / 2);
      }
      // The fit includes the F of the copy below (under the floor).
      expect(Math.min(...model.fitPoints.map((p) => p[1]))).toBeLessThan(-n);
    },
  );

  it('is off for the flat cube and when ghosts are off', () => {
    expect(buildSceneModel(input(createTopology('flat', 3)), { ghosts: 'all' }).ghosts).toBeNull();
    const off = buildSceneModel(input(createTopology('torus3', 3)), { ghosts: 'off' });
    expect(off.ghosts).toBeNull();
    expect(off.landmark).toEqual([]);
  });

  it('the F above is turned (tetracosm) or mirrored (amphicosm) in the scene too', () => {
    // Read the F back from the world boxes: world y is up, so the floor normal is +y.
    const frameOf = (boxes: readonly { min: Vec3; max: Vec3 }[]) => {
      const c = (b: { min: Vec3; max: Vec3 }) =>
        b.min.map((v, k) => (v + (b.max[k] as number)) / 2);
      const [stem, top] = boxes as [{ min: Vec3; max: Vec3 }, { min: Vec3; max: Vec3 }];
      const ext = [0, 2].map((k) => (stem.max[k] as number) - (stem.min[k] as number));
      const long = ext[0]! > ext[1]! ? 0 : 2;
      const across = long === 0 ? 2 : 0;
      const up = [0, 0, 0];
      const right = [0, 0, 0];
      up[long] = Math.sign((c(top)[long] as number) - (c(stem)[long] as number));
      right[across] = Math.sign((c(top)[across] as number) - (c(stem)[across] as number));
      // Handedness seen from above (+y): (right × up)·y.
      return {
        up,
        right,
        hand: (right[2] as number) * (up[0] as number) - (right[0] as number) * (up[2] as number),
      };
    };
    for (const [id, turned, hand] of [
      ['torus3', false, 1],
      ['tetracosm', true, 1],
      ['amphicosm1', false, -1],
    ] as const) {
      const model = buildSceneModel(input(createTopology(id, 4)), { ghosts: 'faces' });
      const base = frameOf(model.landmark[0]?.boxes ?? []);
      const above = frameOf(model.landmark.find((c) => c.offset.join() === '0,0,1')?.boxes ?? []);
      expect(base.hand).toBeGreaterThan(0);
      expect(Math.sign(above.hand)).toBe(hand);
      expect(above.up.join() !== base.up.join()).toBe(turned);
    }
  });

  it('a seam-crossing win line is one straight path through the cover', () => {
    const { topology, lines: all } = lines('torus3', 3, 3);
    let crossing = 0;
    for (const cells of all) {
      const model = buildSceneModel(input(topology, { win: { player: 0, cells } }), {
        ghosts: 'faces',
      });
      const paths = model.win?.paths ?? [];
      expect(paths).toHaveLength(1);
      const path = paths[0] ?? [];
      expect(path).toHaveLength(5);
      // Collinear, the M centres one step apart, half a step beyond each end.
      const a = path[0] as Vec3;
      const b = path[4] as Vec3;
      for (const p of path) expect(dist(a, p) + dist(p, b)).toBeCloseTo(dist(a, b), 9);
      const step = dist(path[1] as Vec3, path[2] as Vec3);
      expect(dist(path[2] as Vec3, path[3] as Vec3)).toBeCloseTo(step, 9);
      expect(dist(a, path[1] as Vec3)).toBeCloseTo(step / 2, 9);
      if (path.some((p) => p.some((v) => Math.abs(v) > 1.5 + 0.5 + 1e-9))) crossing++;
    }
    expect(crossing).toBeGreaterThan(0);
  });
});

describe('buildSceneModel: the net', () => {
  it('lays the net out by a proper rotation (true shape and handedness)', () => {
    const [x, y, z] = [netToWorld([1, 0, 0]), netToWorld([0, 1, 0]), netToWorld([0, 0, 1])];
    const det =
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
      x[1] * (y[0] * z[2] - y[2] * z[0]) +
      x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBe(1);
  });

  it('places 8 separate cubes with tags, and cuts lines only where the net does', () => {
    const n = 3;
    const { lines: all } = lines('tesseract', n, 3);
    const topology = createTopology('tesseract', n);
    const model = buildSceneModel(input(topology), { net: true });
    expect(model.mode).toBe('net');
    expect(model.outline.length).toBe(8 * 12 * 6);
    expect(model.tags.filter((t) => t.kind === 'ridge')).toHaveLength(34);
    let cut = 0;
    for (const cells of all) {
      const m = buildSceneModel(input(topology, { win: { player: 0, cells } }), { net: true });
      const pieces = m.win?.paths.length ?? 0;
      const lineTags = m.tags.filter((t) => t.kind === 'line');
      expect(lineTags).toHaveLength(2 * (pieces - 1));
      cut += pieces - 1;
      // Inside the net every piece is straight (unfolding is an isometry).
      for (const path of m.win?.paths ?? []) {
        const a = path[0] as Vec3;
        const b = path[path.length - 1] as Vec3;
        const len = dist(a, b);
        for (const p of path) expect(dist(a, p) + dist(p, b)).toBeCloseTo(len, 9);
      }
    }
    expect(cut).toBeGreaterThan(0);
  });
});

describe('buildSceneModel: trace', () => {
  it('cover: the walk runs straight half a copy into the ghosts, then re-enters', () => {
    const n = 4;
    const topology = createTopology('tetracosm', n);
    const cells: CellId[] = [];
    const dirs = [];
    let c = 0;
    let d = topology.localDirections(0).find((v) => v.join() === '0,0,1')!;
    for (let i = 0; i <= 4 * n; i++) {
      cells.push(c);
      dirs.push(d);
      const r = topology.step(c, d)!;
      c = r.cell;
      d = r.dir;
    }
    for (const [ghosts, breaks] of [
      ['off', 4],
      ['faces', 3],
    ] as const) {
      const model = buildSceneModel(input(topology), { ghosts, trace: { cells, dirs } });
      const steps = model.trace?.steps ?? [];
      expect(steps).toHaveLength(4 * n);
      expect(steps.filter((s) => s.length === 2)).toHaveLength(breaks);
      expect(model.trace?.stops).toHaveLength(4 * n + 1);
      for (const stop of model.trace?.stops ?? []) {
        expect(Math.max(...stop.pos.map(Math.abs))).toBeLessThanOrEqual(
          ghosts === 'off' ? n / 2 : n,
        );
      }
    }
  });
});
