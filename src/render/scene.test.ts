import { InstancedMesh, LineSegments, Mesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLineIndex, createTopology, lineCells, type TopologyId } from '@/geometry';
import { createMaterials } from './materials';
import { ResourceRegistry } from './registry';
import { HoverBox, buildScene } from './scene';
import { buildSceneModel, type SceneInput } from './sceneModel';

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
    hover.show({ cell: 4, pos: [1, 2, 3], size: 0.5 });
    expect(hover.object.visible).toBe(true);
    expect(hover.object.position.toArray()).toEqual([1, 2, 3]);
    expect(hover.object.children.some((c) => c instanceof Mesh)).toBe(true);
    hover.show(null);
    expect(hover.object.visible).toBe(false);
    hover.dispose();
    expect(registry.live).toBeGreaterThan(0);
    materials.dispose();
    expect(registry.live).toBe(0);
  });
});
