/**
 * Turn a pure {@link SceneModel} into three.js objects. Everything here works in node (creating
 * geometry and materials needs no WebGL), so the build is smoke-tested without a browser.
 *
 * Draw calls are kept few and independent of N: one `LineSegments` for the whole cell grid, one
 * `LineSegments2` for the outline, one `InstancedMesh` per mark kind, one for the pick boxes.
 * Only the rare things (received marks, threats, the last move, the win tube) are small extra
 * objects.
 *
 * A board is rebuilt from scratch when the node or its toggles change: at most 8·4³ = 512 cells,
 * so this is cheap and keeps the code free of incremental-update bugs. The hover highlight is a
 * separate, persistent object ({@link HoverBox}) because it changes on every pointer move.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Materials } from './materials';
import { PickTable } from './picking';
import { ResourceRegistry } from './registry';
import type { Placement, SceneModel, Vec3 } from './sceneModel';

/** Mark size as a fraction of the cell, as in 2D (inset 20% on each side). */
export const MARK_SIZE = 0.6;
/** The last-move outline sits just outside the mark. */
const LAST_MOVE_SIZE = 0.76;
const THREAT_SIZE = 0.86;
const WIN_RADIUS = 0.1;

export interface PickLayerObject {
  readonly mesh: InstancedMesh;
  readonly table: PickTable;
}

export interface BoardScene {
  readonly root: Group;
  /** Raycast targets in priority order: visible marks first, then the invisible cell boxes. */
  readonly pickLayers: readonly PickLayerObject[];
  /** Named parts, for tests and debugging. */
  readonly parts: {
    readonly wires: LineSegments;
    readonly outline: LineSegments2;
    readonly marks: readonly [InstancedMesh, InstancedMesh];
    readonly cells: InstancedMesh;
  };
  dispose(): void;
}

/**
 * Pick boxes are cell-sized in the cubic spaces (hovering the solid cube finds its surface
 * cell). In the Schlegel diagram the near cube's cells enclose all the others, so there the
 * boxes are mark-sized, leaving gaps through which the inner cubes can be hovered.
 */
function pickScale(model: SceneModel): number {
  return model.key.startsWith('tesseract/') ? MARK_SIZE : 1;
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const identityQ = new Quaternion();
const position = new Vector3();
const scale = new Vector3();
const yAxis = new Vector3(0, 1, 0);

function placeMatrix(at: Placement, factor: number): Matrix4 {
  const s = at.size * factor;
  return matrix.compose(position.set(...at.pos), identityQ, scale.set(s, s, s));
}

function instanced(
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  factor: number,
  registry: ResourceRegistry,
): InstancedMesh {
  // An InstancedMesh needs at least one slot; an empty board gets count 0.
  const mesh = registry.track(
    new InstancedMesh(geometry, material, Math.max(1, placements.length)),
  );
  placements.forEach((p, i) => mesh.setMatrixAt(i, placeMatrix(p, factor)));
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** Copies of one line geometry, one per placement (few: received marks, threats). */
function lineCopies(
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  factor: number,
  dashed = false,
): LineSegments[] {
  return placements.map((p) => {
    const line = new LineSegments(geometry, material);
    line.position.set(...p.pos);
    line.scale.setScalar(p.size * factor);
    if (dashed) line.computeLineDistances();
    return line;
  });
}

/**
 * The edges of a unit box at every placement, baked into one geometry (one draw call however
 * many marks there are).
 */
function bakedEdges(
  edges: BufferGeometry,
  placements: readonly Placement[],
  factor: number,
): BufferGeometry {
  const src = edges.getAttribute('position');
  const out = new Float32Array(src.count * 3 * placements.length);
  const v = new Vector3();
  placements.forEach((p, i) => {
    const m = placeMatrix(p, factor);
    for (let k = 0; k < src.count; k++) {
      v.fromBufferAttribute(src, k).applyMatrix4(m);
      out.set([v.x, v.y, v.z], (i * src.count + k) * 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  return g;
}

/** Three orthogonal great circles: the wire version of a sphere. */
function ringsGeometry(radius: number, segments = 32): BufferGeometry {
  const points: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < segments; i++) {
      for (const k of [i, i + 1]) {
        const a = (2 * Math.PI * k) / segments;
        const u = radius * Math.cos(a);
        const v = radius * Math.sin(a);
        const p = axis === 0 ? [0, u, v] : axis === 1 ? [u, 0, v] : [u, v, 0];
        points.push(...p);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return g;
}

/**
 * The win tube: one cylinder per segment of each path, plus a ball at every vertex so bends (a
 * tesseract ridge) and ends are round. Two instanced draws.
 */
function winTube(
  paths: readonly (readonly Vec3[])[],
  material: Material,
  registry: ResourceRegistry,
  radius: number,
): Object3D[] {
  const segments: [Vec3, Vec3][] = [];
  const joints: Vec3[] = [];
  for (const path of paths) {
    path.forEach((p, i) => {
      joints.push(p);
      const next = path[i + 1];
      if (next !== undefined) segments.push([p, next]);
    });
  }
  const cylinder = registry.track(new CylinderGeometry(1, 1, 1, 12, 1, true));
  const ball = registry.track(new SphereGeometry(1, 12, 8));
  const tubes = registry.track(new InstancedMesh(cylinder, material, Math.max(1, segments.length)));
  segments.forEach(([a, b], i) => {
    const from = new Vector3(...a);
    const dir = new Vector3(...b).sub(from);
    const length = dir.length();
    quaternion.setFromUnitVectors(yAxis, dir.normalize());
    tubes.setMatrixAt(
      i,
      matrix.compose(
        from.addScaledVector(dir, length / 2),
        quaternion,
        scale.set(radius, length, radius),
      ),
    );
  });
  tubes.count = segments.length;
  const balls = instanced(
    ball,
    material,
    joints.map((pos) => ({ cell: -1, pos, size: 1 })),
    radius,
    registry,
  );
  tubes.computeBoundingSphere();
  return [tubes, balls];
}

/** Build the board objects of a scene model. The registry receives every resource created. */
export function buildScene(
  model: SceneModel,
  materials: Materials,
  registry = new ResourceRegistry(),
): BoardScene {
  const root = new Group();
  root.name = 'board';
  const g = <G extends BufferGeometry>(geometry: G) => registry.track(geometry);

  const wireGeometry = g(new BufferGeometry());
  wireGeometry.setAttribute('position', new Float32BufferAttribute(model.wires, 3));
  const wires = new LineSegments(wireGeometry, materials.wire);
  wires.name = 'wires';

  const outlineGeometry = g(new LineSegmentsGeometry());
  outlineGeometry.setPositions(model.outline);
  const outline = new LineSegments2(outlineGeometry, materials.outline);
  outline.name = 'outline';

  const box = g(new BoxGeometry(1, 1, 1));
  const sphere = g(new SphereGeometry(0.5, 24, 16));
  const solid = (p: 0 | 1) => model.marks.filter((m) => m.player === p && !m.received);
  const p1 = solid(0);
  const p2 = solid(1);
  const marks: [InstancedMesh, InstancedMesh] = [
    instanced(box, materials.mark[0], p1, MARK_SIZE, registry),
    instanced(sphere, materials.mark[1], p2, MARK_SIZE, registry),
  ];
  marks[0].name = 'marks-p1';
  marks[1].name = 'marks-p2';

  const cells = instanced(box, materials.pick, model.cells, pickScale(model), registry);
  cells.name = 'pick-cells';
  cells.visible = false;

  // `Object3D.add()` with no arguments logs an error, so the optional parts are collected first.
  const parts: Object3D[] = [wires, outline, ...marks, cells];

  const boxEdges = g(new EdgesGeometry(box));
  if (p1.length > 0) {
    const edges = new LineSegments(g(bakedEdges(boxEdges, p1, MARK_SIZE)), materials.markEdge);
    edges.name = 'marks-p1-edges';
    parts.push(edges);
  }
  const rings = g(ringsGeometry(0.5));
  const received = (p: 0 | 1) => model.marks.filter((m) => m.player === p && m.received);
  parts.push(
    ...lineCopies(boxEdges, materials.markWire[0], received(0), MARK_SIZE),
    ...lineCopies(rings, materials.markWire[1], received(1), MARK_SIZE),
  );

  if (model.lastMove !== null) {
    parts.push(...lineCopies(boxEdges, materials.lastMove, [model.lastMove], LAST_MOVE_SIZE));
  }

  if (model.threats.length > 0) {
    // Dashed lines need their own geometry: `computeLineDistances` writes into it.
    for (const p of [0, 1] as const) {
      const mine = model.threats.filter((t) => t.player === p);
      if (mine.length === 0) continue;
      const edges = g(new EdgesGeometry(box));
      parts.push(...lineCopies(edges, materials.threat[p], mine, THREAT_SIZE, true));
    }
  }

  if (model.win !== null) {
    parts.push(...winTube(model.win.paths, materials.win, registry, WIN_RADIUS));
  }
  root.add(...parts);

  return {
    root,
    pickLayers: [
      { mesh: marks[0], table: new PickTable(p1.map((m) => m.cell)) },
      { mesh: marks[1], table: new PickTable(p2.map((m) => m.cell)) },
      { mesh: cells, table: PickTable.identity(model.cells.length) },
    ],
    parts: { wires, outline, marks, cells },
    dispose: () => {
      root.removeFromParent();
      root.clear();
      registry.disposeAll();
    },
  };
}

/** The persistent hover highlight: a grey-30 box with a black edge outline. */
export class HoverBox {
  readonly object = new Group();
  private readonly registry = new ResourceRegistry();

  constructor(materials: Materials) {
    const box = this.registry.track(new BoxGeometry(1, 1, 1));
    const edges = this.registry.track(new EdgesGeometry(box));
    this.object.add(
      new Mesh(box, materials.hoverFill),
      new LineSegments(edges, materials.hoverEdge),
    );
    this.object.name = 'hover';
    this.object.visible = false;
    // Drawn after the board so the translucent fill blends over the grid.
    this.object.renderOrder = 1;
  }

  /** Show the box around a placement, or hide it. */
  show(at: Placement | null): void {
    this.object.visible = at !== null;
    if (at === null) return;
    this.object.position.set(...at.pos);
    this.object.scale.setScalar(at.size);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.registry.disposeAll();
  }
}
