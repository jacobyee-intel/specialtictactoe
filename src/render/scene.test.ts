import { InstancedMesh, LineSegments, Mesh, Raycaster, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLineIndex,
  createTopology,
  lineCells,
  type TesseractSurface,
  type TopologyId,
} from '@/geometry';
import { createMaterials } from './materials';
import { ResourceRegistry } from './registry';
import { HEX_FACES, hexEdgeIndices, hexTriangles } from './hexahedron';
import { pickCell, pickHit } from './picking';
import {
  BALL_TRIANGLES,
  GHOST_LAYER,
  HoverBox,
  SCHLEGEL_PICK_SHRINK,
  buildScene,
  type BoardScene,
} from './scene';
import { buildSceneModel, toWorld, type SceneInput, type Vec3 } from './sceneModel';
import {
  CAMERA_W_FACTOR,
  cellCentre4,
  cellCorners4,
  project4to3,
  rotation4,
  type Planes4,
  type Vec4,
} from './four';
import { BALL, LAST_MOVE_SIZE, MARK_SIZE, THREAT_SIZE } from './marks4';
import { trace } from './tracer';

/** Marks in a mark mesh: instances of a glyph, or shapes merged into one projected geometry. */
const items = (mesh: Mesh) =>
  mesh instanceof InstancedMesh ? mesh.count : (mesh.geometry.userData as { items: number }).items;

function sample(id: TopologyId, n: number): SceneInput {
  const topology = createTopology(id, n);
  const board = new Uint8Array(topology.cellCount);
  board[0] = 1;
  board[1] = 1;
  board[2] = 2;
  board[5] = 2;
  board[9] = 1; // received
  const lines = buildLineIndex(topology, 3);
  return {
    topology,
    board,
    received: new Set([9]),
    lastMove: 5,
    win: { player: 0, cells: [...lineCells(lines, 0)] },
    threats: [
      { cell: 3, player: 0 },
      { cell: 4, player: 1 },
    ],
  };
}

describe('buildScene (node, no WebGL)', () => {
  // three.js reports misuse (e.g. adding a non-object) with console.error, not by throwing.
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error');
  });
  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it.each([
    ['flat', 3],
    ['tetracosm', 6],
    ['tesseract', 4],
  ] as const)('%s N=%i: one instance per mark and cell, few draw objects', (id, n) => {
    const input = sample(id, n);
    const model = buildSceneModel(input);
    const registry = new ResourceRegistry();
    const materials = createMaterials();
    const scene = buildScene(model, materials, registry);
    const { marks, cells, cellHexes, wires } = scene.parts;
    expect(items(marks[0])).toBe(2); // cells 0 and 1 (9 is received: drawn as a wire)
    expect(items(marks[1])).toBe(2);
    // The Schlegel diagram draws marks in their true projected shapes and picks by the cells'
    // true shapes, merged; elsewhere unit glyphs (instanced) and unit pick boxes.
    const schlegel = id === 'tesseract';
    expect(marks.every((m) => m instanceof InstancedMesh)).toBe(!schlegel);
    expect(scene.parts.projected === null).toBe(!schlegel);
    expect(cells?.count ?? cellHexes?.geometry.getAttribute('position').count).toBe(
      input.topology.cellCount * (schlegel ? 8 : 1),
    );
    expect(cells === null).toBe(schlegel);
    expect((cells ?? cellHexes)?.visible).toBe(false);
    expect(wires.geometry.getAttribute('position').count).toBe(model.wires.length / 3);
    // Pick tables mirror the instances.
    const [p1, p2, all] = scene.pickLayers;
    expect([p1?.table.cellOf(0), p1?.table.cellOf(1)]).toEqual([0, 1]);
    expect([p2?.table.cellOf(0), p2?.table.cellOf(1)]).toEqual([2, 5]);
    expect(all?.table.cellOf(input.topology.cellCount - 1)).toBe(input.topology.cellCount - 1);

    let lines = 0;
    let instanced = 0;
    scene.root.traverse((o) => {
      if (o instanceof LineSegments) lines++;
      if (o instanceof InstancedMesh) instanced++;
    });
    // grid, P1 cube edges, 1 received, 1 last move, 2 threats (a LineSegments2 is a Mesh).
    expect(lines).toBe(6);
    // 2 mark kinds and the pick boxes (merged in the Schlegel diagram), the win tube and joints.
    expect(instanced).toBe(schlegel ? 2 : 5);
    expect(scene.root.children.length).toBeLessThan(16);

    expect(registry.live).toBeGreaterThan(0);
    scene.dispose();
    expect(registry.live).toBe(0);
    expect(scene.root.children).toHaveLength(0);
    materials.dispose();
  });

  it('builds an empty board with zero mark instances', () => {
    const topology = createTopology('flat', 4);
    const model = buildSceneModel({
      topology,
      board: new Uint8Array(topology.cellCount),
      received: new Set(),
      lastMove: null,
      win: null,
      threats: [],
    });
    const registry = new ResourceRegistry();
    const scene = buildScene(model, createMaterials(), registry);
    expect(scene.parts.marks.map(items)).toEqual([0, 0]);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it('frees every material and the hover box', () => {
    const registry = new ResourceRegistry();
    const materials = createMaterials(registry);
    const hover = new HoverBox(materials);
    hover.show({ cell: 4, pos: [1, 2, 3], size: 0.5 }, [
      { cell: 4, pos: [5, 2, 3], size: 1 },
      { cell: 4, pos: [1, 6, 3], size: 1 },
    ]);
    expect(hover.object.visible).toBe(true);
    expect(hover.object.children[0]?.position.toArray()).toEqual([1, 2, 3]);
    expect(hover.object.children[0]?.children.some((c) => c instanceof Mesh)).toBe(true);
    expect(hover.copyCount).toBe(2);
    hover.show(null);
    expect(hover.object.visible).toBe(false);
    hover.dispose();
    expect(registry.live).toBeGreaterThan(0);
    materials.dispose();
    expect(registry.live).toBe(0);
  });
});

describe('buildScene: Phase B parts', () => {
  it('cover view: ghost marks, ghost picks and the F, all freed on dispose', () => {
    const input = sample('tetracosm', 4);
    const model = buildSceneModel(input, { ghosts: 'all' });
    const registry = new ResourceRegistry();
    const scene = buildScene(model, createMaterials(), registry);
    const [g1, g2] = scene.parts.ghostMarks ?? [];
    const copies = (m: typeof g1) => (m?.geometry.userData as { copies: number }).copies;
    // Received marks too: a ghost is always the faint solid glyph. Baked: one draw each.
    expect(copies(g1)).toBe(26 * 3);
    expect(copies(g2)).toBe(26 * 2);
    expect(g1?.geometry.getAttribute('position').count).toBe(26 * 3 * 24);
    // Opaque, on the ghost layer (drawn first, under the fundamental cube).
    expect(g1?.layers.isEnabled(GHOST_LAYER)).toBe(true);
    expect(g1?.layers.isEnabled(0)).toBe(false);
    expect((g1?.material as { transparent: boolean }).transparent).toBe(false);
    expect(scene.parts.landmark?.[0].count).toBe(3);
    expect((scene.parts.landmark?.[1].geometry.userData as { copies: number }).copies).toBe(26 * 3);
    // Every ghost of cell 5 resolves to cell 5.
    expect(scene.ghostTable?.instancesOf(5)).toHaveLength(26);
    expect(scene.pickLayers).toHaveLength(4);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it('tesseract: refresh rewrites the buffers in place for a new 4D orientation', () => {
    const input = sample('tesseract', 3);
    const a = buildSceneModel(input, { facet: 2 });
    const b = buildSceneModel(input, { facet: 2, planes4: { xw: 0.7, yw: 0.2, zw: 1.1 } });
    const registry = new ResourceRegistry();
    const scene = buildScene(a, createMaterials(), registry);
    const live = registry.live;
    const wires = scene.parts.wires.geometry.getAttribute('position');
    expect(scene.refresh(b)).toBe(true);
    expect(registry.live).toBe(live);
    expect(scene.parts.wires.geometry.getAttribute('position')).toBe(wires);
    expect(Array.from(wires.array.slice(0, 6))).toEqual(Array.from(b.wires.slice(0, 6)));
    // A different shape (another cube chosen) cannot be refreshed.
    expect(scene.refresh(buildSceneModel(input, { facet: 3, hoverFacet: 4 }))).toBe(false);
    expect(rotation4({ xw: 0.7, yw: 0.2, zw: 1.1 })).toHaveLength(16);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it('trace: the trail grows with the walk and the walker follows it', () => {
    const input = sample('torus3', 4);
    const t = input.topology;
    const up = t.localDirections(0).find((d) => d.join() === '0,0,1')!;
    const r = trace(t, 0, up);
    const model = buildSceneModel(input, { ghosts: 'faces', trace: r });
    const scene = buildScene(model, createMaterials());
    expect(scene.showTrace(0)).toEqual(model.trace?.stops[0]?.pos);
    expect(scene.parts.trail?.count).toBe(0);
    const mid = scene.showTrace(1.5);
    expect(scene.parts.trail?.count).toBe(2);
    const [p1, p2] = [
      model.trace?.stops[1]?.pos,
      model.trace?.stops[2]?.pos,
    ] as unknown as number[][];
    mid?.forEach((v, k) =>
      expect(v).toBeCloseTo(((p1?.[k] as number) + (p2?.[k] as number)) / 2, 9),
    );
    scene.showTrace(r.steps);
    expect(scene.parts.trail?.count).toBe(model.trace?.steps.flat().length);
    scene.dispose();
  });
});

/** Outward face planes of a convex hexahedron given as 24 floats (cellCorners4 order). */
function planes(c: ArrayLike<number>, at = 0): { n: Vec3; d: number }[] {
  const p = (i: number): Vec3 => [c[at + 3 * i]!, c[at + 3 * i + 1]!, c[at + 3 * i + 2]!];
  const mid = [0, 1, 2].map((k) => [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, i) => s + p(i)[k]!, 0) / 8);
  return HEX_FACES.map(([a, b, , e]) => {
    const o = p(a);
    const u = p(b).map((v, k) => v - o[k]!);
    const w = p(e).map((v, k) => v - o[k]!);
    let n: Vec3 = [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
    if (n[0] * (mid[0]! - o[0]) + n[1] * (mid[1]! - o[1]) + n[2] * (mid[2]! - o[2]) > 0) {
      n = [-n[0], -n[1], -n[2]];
    }
    return { n, d: n[0] * o[0] + n[1] * o[1] + n[2] * o[2] };
  });
}

/** Where a ray enters a convex hexahedron (Cyrus–Beck), or Infinity if it misses. */
function entry(o: Vector3, dir: Vector3, faces: { n: Vec3; d: number }[]): number {
  let t0 = 0;
  let t1 = Infinity;
  for (const { n, d } of faces) {
    const denom = n[0] * dir.x + n[1] * dir.y + n[2] * dir.z;
    const dist = d - (n[0] * o.x + n[1] * o.y + n[2] * o.z);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return Infinity;
    } else if (denom < 0) t0 = Math.max(t0, dist / denom);
    else t1 = Math.min(t1, dist / denom);
  }
  return t0 <= t1 ? t0 : Infinity;
}

describe('buildScene: Schlegel pick hexahedra', () => {
  it.each([0, 40, 80])('XW %i°: one shrunken hexahedron per cell; rays pick the nearest', (deg) => {
    const n = 3;
    const input = sample('tesseract', n);
    const t = input.topology as TesseractSurface;
    const planes4 = { xw: (deg * Math.PI) / 180, yw: 0, zw: 0 };
    const model = buildSceneModel({ ...input, board: new Uint8Array(t.cellCount) }, { planes4 });
    const registry = new ResourceRegistry();
    const scene = buildScene(model, createMaterials(), registry);
    const hexes = scene.parts.cellHexes as Mesh;
    const pos = hexes.geometry.getAttribute('position').array as Float32Array;
    expect(pos.length).toBe(t.cellCount * 24);
    expect(hexes.geometry.getIndex()?.count).toBe(t.cellCount * 36);
    expect(Array.from(hexes.geometry.getIndex()!.array.slice(36, 72))).toEqual(hexTriangles(1, 8));

    // Shrunken towards the centroid, inside the cell's full hexahedron.
    const shrunk = model.cells.map((_, c) => planes(pos, c * 24));
    model.cells.forEach((cell, c) => {
      const full = cell.corners!;
      const faces = planes(full.flat());
      const mid = [0, 1, 2].map((k) => full.reduce((s, p) => s + p[k]!, 0) / 8);
      for (let i = 0; i < 8; i++) {
        const q = [0, 1, 2].map((k) => pos[c * 24 + 3 * i + k]!);
        q.forEach((v, k) =>
          expect(v).toBeCloseTo(mid[k]! + SCHLEGEL_PICK_SHRINK * (full[i]![k]! - mid[k]!), 5),
        );
        for (const { n: nn, d } of faces) {
          expect(nn[0] * q[0]! + nn[1] * q[1]! + nn[2] * q[2]! - d).toBeLessThan(1e-6);
        }
      }
    });

    // A ray from a camera through each cell's shrunken centroid: the picked cell (triangle →
    // cell) is the nearest hexahedron along the ray, found independently by Cyrus–Beck.
    const layer = scene.pickLayers[2]!;
    expect(layer.mesh).toBe(hexes);
    const eye = new Vector3(9, 7, 11);
    const raycaster = new Raycaster();
    const picked = new Set<number>();
    for (let c = 0; c < t.cellCount; c++) {
      const centroid = new Vector3();
      for (let i = 0; i < 8; i++) centroid.add(new Vector3().fromArray(pos, c * 24 + 3 * i));
      centroid.divideScalar(8);
      const dir = centroid.clone().sub(eye).normalize();
      raycaster.set(eye, dir);
      const hits = raycaster.intersectObject(hexes, false);
      const cell = pickCell([
        { table: layer.table, hits: hits.map((h) => pickHit(h, layer.trianglesPerItem)) },
      ]);
      const entries = shrunk.map((f) => entry(eye, dir, f));
      const best = Math.min(...entries);
      expect(entries[c]).toBeLessThan(Infinity);
      expect(cell).not.toBeNull();
      expect(entries[cell!]).toBeCloseTo(best, 4);
      if (cell === c) picked.add(c);
    }
    // Through the gaps, many cells of several cubes are reached from this one eye.
    const facets = new Set([...picked].map((c) => t.facet(c).index));
    expect(picked.size).toBeGreaterThan(30);
    expect(facets.size).toBeGreaterThanOrEqual(4);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it('refresh rewrites the pick hexahedra in place', () => {
    const input = sample('tesseract', 3);
    const a = buildSceneModel(input);
    const b = buildSceneModel(input, { planes4: { xw: 0.7, yw: 0, zw: 0 } });
    const scene = buildScene(a, createMaterials());
    const attr = scene.parts.cellHexes!.geometry.getAttribute('position');
    const before = Array.from(attr.array.slice(0, 24));
    expect(scene.refresh(b)).toBe(true);
    expect(scene.parts.cellHexes!.geometry.getAttribute('position')).toBe(attr);
    expect(Array.from(attr.array.slice(0, 24))).not.toEqual(before);
    scene.dispose();
  });
});

describe('HoverBox in the Schlegel diagram', () => {
  it('draws the hexahedron through the cell corners, wound outwards either way', () => {
    const model = buildSceneModel(sample('tesseract', 3), {
      planes4: { xw: 0.7, yw: 0.2, zw: 0 },
    });
    const registry = new ResourceRegistry();
    const materials = createMaterials(registry);
    const hover = new HoverBox(materials);
    const [main, , , hex] = hover.object.children;
    const signs = new Set<number>();
    for (const cell of model.cells) {
      hover.show(cell);
      expect(main?.visible).toBe(false);
      expect(hex?.visible).toBe(true);
      const corners = hover.corners!;
      corners.forEach((p, i) =>
        p.forEach((v, k) => expect(v).toBeCloseTo(cell.corners![i]![k]!, 5)),
      );
      const fill = (hex?.children[0] as Mesh).geometry;
      const index = Array.from(fill.getIndex()!.array);
      const mid = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / 8);
      for (let k = 0; k < index.length; k += 3) {
        const [a, b, c] = [index[k], index[k + 1], index[k + 2]].map((i) => corners[i!]!);
        const u = b!.map((v, j) => v - a![j]!);
        const w = c!.map((v, j) => v - a![j]!);
        const nrm = [
          u[1]! * w[2]! - u[2]! * w[1]!,
          u[2]! * w[0]! - u[0]! * w[2]!,
          u[0]! * w[1]! - u[1]! * w[0]!,
        ];
        const out = nrm.reduce((s, v, j) => s + v * (a![j]! - mid[j]!), 0);
        expect(out).toBeGreaterThan(0);
      }
      signs.add(index[1] === 4 ? 1 : -1);
    }
    // Both windings occur: the projection mirrors some cells.
    expect(signs.size).toBe(2);
    // A cube (no corners) is the unit box again.
    hover.show({ cell: 0, pos: [1, 2, 3], size: 1 });
    expect(main?.visible).toBe(true);
    expect(hex?.visible).toBe(false);
    expect(hover.corners).toBeNull();
    hover.dispose();
    materials.dispose();
    expect(registry.live).toBe(0);
  });
});

describe('tintHex', () => {
  it('mixes a token colour into white like CSS opacity', async () => {
    const { tintHex } = await import('./materials');
    expect(tintHex('#000000', 0.5)).toBe('#808080');
    expect(tintHex('#e30613', 1)).toBe('#e30613');
    expect(tintHex('#005bbb', 0)).toBe('#ffffff');
  });
});

describe('buildScene: Schlegel marks in their projected shapes', () => {
  const n = 3;
  const n3 = n ** 3;
  // P1 and P2 marks in the outer (w+), inner (w−) and wedge cubes, and a received one of each.
  // Sorted: the model lists marks in cell order.
  const byId = (a: number, b: number) => a - b;
  const P1 = [0, 1, 6 * n3 + 13, 7 * n3 + 4, 2 * n3 + 13, 4 * n3 + 8].sort(byId);
  const P2 = [2, 5, 6 * n3 + 22, 7 * n3 + 20, 3 * n3 + 13, 5 * n3 + 0].sort(byId);
  function marked(): SceneInput {
    const base = sample('tesseract', n);
    const board = new Uint8Array(base.topology.cellCount);
    for (const c of [...P1, 9]) board[c] = 1;
    for (const c of [...P2, 30]) board[c] = 2;
    return { ...base, board, received: new Set([9, 30]) };
  }
  const t = marked().topology as TesseractSurface;
  const planesOf = (deg: number, yw = 0): Planes4 => ({ xw: (deg * Math.PI) / 180, yw, zw: 0 });

  /** The expected scene points, from the 4D construction (independent of `marks4.ts`). */
  function expected(planes4: Planes4) {
    const R = rotation4(planes4);
    const scene = (p: readonly number[]) =>
      toWorld(project4to3(p as unknown as Vec4, R, CAMERA_W_FACTOR * n).p);
    const box = (cell: number, f: number) => {
      const corners = cellCorners4(t, cell);
      const c = [0, 1, 2, 3].map((k) => corners.reduce((acc, p) => acc + p[k]!, 0) / 8);
      return corners.map((p) => scene(p.map((v, k) => c[k]! + f * (v - c[k]!))));
    };
    const ball = (cell: number) => {
      const centre = cellCentre4(t, cell);
      const corners = cellCorners4(t, cell);
      const axes = [1, 2, 4].map((b) => corners[b]!.map((v, k) => v - corners[0]![k]!));
      return Array.from({ length: BALL.count }, (_, v) =>
        scene(
          centre.map(
            (x, k) =>
              x +
              (MARK_SIZE / 2) *
                [0, 1, 2].reduce((acc, j) => acc + BALL.vertices[3 * v + j]! * axes[j]![k]!, 0),
          ),
        ),
      );
    };
    return { box, ball };
  }

  const vertices = (geometry: { getAttribute(name: 'position'): { array: ArrayLike<number> } }) => {
    const a = geometry.getAttribute('position').array;
    return Array.from({ length: a.length / 3 }, (_, i): Vec3 => [
      a[3 * i]!,
      a[3 * i + 1]!,
      a[3 * i + 2]!,
    ]);
  };
  const near = (got: readonly Vec3[], want: readonly Vec3[]) => {
    expect(got).toHaveLength(want.length);
    got.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(want[i]![k]!, 4)));
  };

  /** Check every projected part against the 4D construction; returns the fills' windings. */
  function check(scene: BoardScene, planes4: Planes4): Set<number> {
    const { box, ball } = expected(planes4);
    const pr = scene.parts.projected!;
    const [p1, p2] = pr.fills;
    near(
      vertices(p1.geometry),
      P1.flatMap((c) => box(c, MARK_SIZE)),
    );
    near(
      vertices(p2.geometry),
      P2.flatMap((c) => ball(c)),
    );
    // The white edges are drawn on the boxes' own vertices.
    expect(pr.edges.geometry.getAttribute('position')).toBe(p1.geometry.getAttribute('position'));
    near(vertices(pr.received[0]!.geometry), box(9, MARK_SIZE));
    near(vertices(pr.received[1]!.geometry), ball(30));
    expect(pr.received[1]!.geometry.getIndex()?.count).toBe(BALL.wire.length);
    near(vertices(pr.lastMove!.geometry), box(5, LAST_MOVE_SIZE));
    // Threats: the 12 edges of the 4D-shrunk cell, as dashed segments.
    for (const [p, cell] of [
      [0, 3],
      [1, 4],
    ] as const) {
      const corners = box(cell, THREAT_SIZE);
      near(
        vertices(pr.threats[p]!.geometry),
        hexEdgeIndices().map((i) => corners[i]!),
      );
      expect(Array.from(pr.threats[p]!.geometry.getAttribute('lineDistance').array)).toEqual(
        Array.from({ length: 24 }, (_, i) => i % 2),
      );
    }
    // Every filled triangle faces outwards, whichever way the projection turned its cell.
    const signs = new Set<number>();
    for (const [p, fill] of pr.fills.entries()) {
      const pos = vertices(fill.geometry);
      const index = Array.from(fill.geometry.getIndex()!.array);
      const per = p === 0 ? 8 : BALL.count;
      const tris = p === 0 ? 12 : BALL_TRIANGLES;
      for (let m = 0; m < index.length / (3 * tris); m++) {
        const own = pos.slice(m * per, (m + 1) * per);
        const mid = [0, 1, 2].map((k) => own.reduce((acc, q) => acc + q[k]!, 0) / per);
        for (let k = m * tris * 3; k < (m + 1) * tris * 3; k += 3) {
          const [a, b, c] = [0, 1, 2].map((j) => pos[index[k + j]!]!);
          expect(Math.floor(index[k]! / per)).toBe(m);
          const u = b!.map((v, j) => v - a![j]!);
          const w = c!.map((v, j) => v - a![j]!);
          const nrm = [
            u[1]! * w[2]! - u[2]! * w[1]!,
            u[2]! * w[0]! - u[0]! * w[2]!,
            u[0]! * w[1]! - u[1]! * w[0]!,
          ];
          const out = nrm.reduce(
            (acc, v, j) => acc + v * ((a![j]! + b![j]! + c![j]!) / 3 - mid[j]!),
            0,
          );
          expect(out).toBeGreaterThan(0);
        }
        if (p === 0) signs.add(index[m * 36 + 1]! - m * 8 === 4 ? 1 : -1);
      }
    }
    return signs;
  }

  it.each([0, 40, 80])('XW %i°: every mark is its cell’s 4D shape, projected', (deg) => {
    const planes4 = planesOf(deg);
    const registry = new ResourceRegistry();
    const scene = buildScene(buildSceneModel(marked(), { planes4 }), createMaterials(), registry);
    check(scene, planes4);
    const pr = scene.parts.projected!;
    expect(pr.fills.map(items)).toEqual([P1.length, P2.length]);
    expect(pr.fills.map((f) => f.name)).toEqual(['marks-p1', 'marks-p2']);
    expect(scene.parts.marks).toEqual(pr.fills);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it('a 4D turn rewrites every mark buffer in place, re-winding mirrored marks', () => {
    const registry = new ResourceRegistry();
    const scene = buildScene(buildSceneModel(marked()), createMaterials(), registry);
    const live = registry.live;
    const pr = scene.parts.projected!;
    const parts = [...pr.fills, pr.edges, ...pr.received, pr.lastMove, ...pr.threats];
    const attrs = parts.map((o) => o!.geometry.getAttribute('position'));
    const indices = parts.map((o) => o!.geometry.getIndex());
    const signs = new Set<number>();
    for (const [deg, yw] of [
      [40, 0],
      [80, 0.3],
      [130, 0.7],
      [200, 1.3],
      [300, 2.1],
    ] as const) {
      const planes4 = planesOf(deg, yw);
      expect(scene.refresh(buildSceneModel(marked(), { planes4 }))).toBe(true);
      for (const s of check(scene, planes4)) signs.add(s);
      parts.forEach((o, i) => {
        expect(o!.geometry.getAttribute('position')).toBe(attrs[i]);
        expect(o!.geometry.getIndex()).toBe(indices[i]);
      });
    }
    // The projection mirrored some marks along the way, and they were re-wound.
    expect(signs.size).toBe(2);
    expect(registry.live).toBe(live);
    // Other marks (same kinds, other cells) cannot be refreshed: the pick tables would be stale.
    const other = marked();
    const board = other.board.slice();
    board[P1[0]!] = 0;
    board[8] = 1;
    expect(scene.refresh(buildSceneModel({ ...other, board }))).toBe(false);
    scene.dispose();
    expect(registry.live).toBe(0);
  });

  it.each([0, 40, 80])('XW %i°: a ray picks the nearest mark by its projected shape', (deg) => {
    const scene = buildScene(
      buildSceneModel(marked(), { planes4: planesOf(deg) }),
      createMaterials(),
    );
    const pr = scene.parts.projected!;
    // Every mark is convex: its outward face planes, for an independent Cyrus–Beck test.
    const shapes = pr.fills.flatMap((fill, p) => {
      const pos = vertices(fill.geometry);
      const index = Array.from(fill.geometry.getIndex()!.array);
      const per = p === 0 ? 8 : BALL.count;
      const tris = (p === 0 ? 12 : BALL_TRIANGLES) * 3;
      return (p === 0 ? P1 : P2).map((cell, m) => {
        const own = pos.slice(m * per, (m + 1) * per);
        const mid = [0, 1, 2].map((k) => own.reduce((acc, q) => acc + q[k]!, 0) / per);
        const faces = [];
        for (let k = m * tris; k < (m + 1) * tris; k += 3) {
          const [a, b, c] = [0, 1, 2].map((j) => pos[index[k + j]!]!);
          const u = b!.map((v, j) => v - a![j]!);
          const w = c!.map((v, j) => v - a![j]!);
          let nn: Vec3 = [
            u[1]! * w[2]! - u[2]! * w[1]!,
            u[2]! * w[0]! - u[0]! * w[2]!,
            u[0]! * w[1]! - u[1]! * w[0]!,
          ];
          if (
            nn[0] * (mid[0]! - a![0]!) + nn[1] * (mid[1]! - a![1]!) + nn[2] * (mid[2]! - a![2]!) >
            0
          ) {
            nn = [-nn[0], -nn[1], -nn[2]];
          }
          faces.push({ n: nn, d: nn[0] * a![0]! + nn[1] * a![1]! + nn[2] * a![2]! });
        }
        return { cell, mid: new Vector3(...mid), faces };
      });
    });
    const eye = new Vector3(9, 7, 11);
    const raycaster = new Raycaster();
    let own = 0;
    for (const shape of shapes) {
      const dir = shape.mid.clone().sub(eye).normalize();
      raycaster.set(eye, dir);
      const cell = pickCell(
        scene.pickLayers.map((layer) => ({
          table: layer.table,
          hits: raycaster
            .intersectObject(layer.mesh, false)
            .map((h) => pickHit(h, layer.trianglesPerItem)),
        })),
      );
      const entries = shapes.map((s) => entry(eye, dir, s.faces));
      const best = shapes[entries.indexOf(Math.min(...entries))]!;
      expect(entries[shapes.indexOf(shape)]).toBeLessThan(Infinity);
      expect(cell).toBe(best.cell);
      if (cell === shape.cell) own++;
    }
    expect(own).toBeGreaterThanOrEqual(shapes.length / 2);
    scene.dispose();
  });

  it('the net and the cubic spaces keep instanced unit cubes and spheres', () => {
    const net = buildScene(buildSceneModel(marked(), { net: true }), createMaterials());
    expect(net.parts.projected).toBeNull();
    expect(net.parts.marks.every((m) => m instanceof InstancedMesh)).toBe(true);
    expect(net.parts.marks.map(items)).toEqual([P1.length, P2.length]);
    const geometryOf = (m: Mesh) => m.geometry.type;
    expect(net.parts.marks.map(geometryOf)).toEqual(['BoxGeometry', 'SphereGeometry']);
    net.dispose();
    const flat = buildScene(buildSceneModel(sample('flat', 3)), createMaterials());
    expect(flat.parts.projected).toBeNull();
    expect(flat.parts.marks.map(geometryOf)).toEqual(['BoxGeometry', 'SphereGeometry']);
    flat.dispose();
  });
});
