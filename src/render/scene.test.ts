import { InstancedMesh, LineSegments, Mesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLineIndex, createTopology, lineCells, type TopologyId } from '@/geometry';
import { createMaterials } from './materials';
import { ResourceRegistry } from './registry';
import { GHOST_LAYER, HoverBox, buildScene } from './scene';
import { buildSceneModel, type SceneInput } from './sceneModel';
import { rotation4 } from './four';
import { trace } from './tracer';

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
    const { marks, cells, wires } = scene.parts;
    expect(marks[0].count).toBe(2); // cells 0 and 1 (9 is received: drawn as a wire)
    expect(marks[1].count).toBe(2);
    expect(cells.count).toBe(input.topology.cellCount);
    expect(cells.visible).toBe(false);
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
    // 2 mark kinds, the pick boxes, the win tube and its joints.
    expect(instanced).toBe(5);
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
    expect(scene.parts.marks.map((m) => m.count)).toEqual([0, 0]);
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

describe('tintHex', () => {
  it('mixes a token colour into white like CSS opacity', async () => {
    const { tintHex } = await import('./materials');
    expect(tintHex('#000000', 0.5)).toBe('#808080');
    expect(tintHex('#e30613', 1)).toBe('#e30613');
    expect(tintHex('#005bbb', 0)).toBe('#ffffff');
  });
});
