/**
 * Turn a pure {@link SceneModel} into three.js objects. Everything here works in node (creating
 * geometry and materials needs no WebGL), so the build is smoke-tested without a browser.
 *
 * Draw calls are kept few and independent of N: one `LineSegments` for the whole cell grid, one
 * `LineSegments2` for the outline, one `InstancedMesh` per mark kind, one for the pick boxes
 * (in the Schlegel diagram: one merged mesh of the cells' true, skewed shapes).
 * Only the rare things (received marks, threats, the last move, the win tube) are small extra
 * objects.
 *
 * In the Schlegel diagram the marks are no uniform glyphs either: each is built in 4D in its
 * cell and projected like the cell (`marks4.ts`), so it is skewed like the cell. They are
 * merged per kind (P1 boxes, their edges, P2 balls, received wires, the last move, threats),
 * and a 4D turn rewrites their positions in place.
 *
 * A board is rebuilt from scratch when the node or its toggles change: at most 8·4³ = 512 cells
 * (plus 26·6³ ghosts), so this is cheap and keeps the code free of incremental-update bugs. The
 * one exception is turning the tesseract in 4D, which moves every point on every frame: then
 * {@link BoardScene.refresh} writes the new positions into the existing buffers (same counts, so
 * no GPU allocation). Every part is written by one `write(model)` function, used both to build
 * and to refresh, so the two paths cannot drift apart.
 *
 * The hover highlight is a separate, persistent object ({@link HoverBox}) because it changes on
 * every pointer move.
 */
import {
  IcosahedronGeometry,
  BufferAttribute,
  BoxGeometry,
  DynamicDrawUsage,
  OctahedronGeometry,
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
  Sphere,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import { schlegelRadius } from './four';
import {
  HEX_TRIANGLES,
  hexEdgeIndices,
  hexOrientation,
  hexTriangles,
  writeHex,
} from './hexahedron';
import {
  BALL,
  LAST_MOVE_SIZE,
  MARK_SIZE,
  THREAT_SIZE,
  orientation4,
  writeBall4,
  writeBox4,
  writeTriangles,
} from './marks4';
import type { Materials } from './materials';
import { PickTable } from './picking';
import { ResourceRegistry } from './registry';
import type { Bounds, Placement, SceneModel, Segment, Vec3 } from './sceneModel';

export { MARK_SIZE };
const WIN_RADIUS = 0.1;
const TRACE_RADIUS = 0.045;
const WALKER_SIZE = 0.5;
/** The translucent hover highlight is drawn after the opaque board. */
export const RENDER_ORDER = { hover: 3 } as const;

/**
 * The ghost copies live on their own three.js layer. The view draws that layer first, clears
 * depth, then draws the board: the fundamental cube is always on top (dominant, as the 2D
 * board's halos sit outside its frame), and the ghosts can be opaque, so thousands of them cost
 * no blending and have no sorting artefacts.
 */
export const GHOST_LAYER = 1;

export interface PickLayerObject {
  readonly mesh: InstancedMesh | Mesh;
  readonly table: PickTable;
  /** A merged mesh (the Schlegel pick hexahedra): triangles per table entry. */
  readonly trianglesPerItem?: number;
}

/**
 * The Schlegel diagram's marks, in their true projected shapes (see `marks4.ts`), one merged
 * geometry per kind. Each geometry's `userData` holds `items` and `verticesPerItem`.
 */
export interface ProjectedMarks {
  /** Solid P1 boxes (8 vertices, 12 triangles each) and P2 balls (`BALL`), filled. */
  readonly fills: readonly [Mesh, Mesh];
  /** The P1 boxes' 1 px white edges; they share the boxes' positions. */
  readonly edges: LineSegments;
  /** Received marks by player, as wire: the box's edges, the ball's lat/long lines. */
  readonly received: readonly [LineSegments | null, LineSegments | null];
  /** The last move: the edges of its cell's 4D cube shrunk by `LAST_MOVE_SIZE`. */
  readonly lastMove: LineSegments | null;
  /** Threats by player: dashed edges of the cell's 4D cube shrunk by `THREAT_SIZE`. */
  readonly threats: readonly [LineSegments | null, LineSegments | null];
}

export interface BoardScene {
  readonly root: Group;
  /** Raycast targets in priority order: visible marks first, then the invisible cell boxes. */
  readonly pickLayers: readonly PickLayerObject[];
  /** Ghost instances of each cell (cover view), for the hover highlight. */
  readonly ghostTable: PickTable | null;
  /** Named parts, for tests and debugging. */
  readonly parts: {
    readonly wires: LineSegments;
    readonly outline: LineSegments2;
    /**
     * The solid marks, by player: instanced unit cubes and spheres, or in the Schlegel diagram
     * the merged projected shapes (`projected.fills`).
     */
    readonly marks: readonly [Mesh, Mesh];
    /** The Schlegel diagram's marks in their true shapes; null elsewhere. */
    readonly projected: ProjectedMarks | null;
    /** The cell pick boxes (cubic spaces, cover and net), or null in the Schlegel diagram. */
    readonly cells: InstancedMesh | null;
    /** The Schlegel diagram's pick hexahedra, one per cell, merged; null elsewhere. */
    readonly cellHexes: Mesh | null;
    /** Baked meshes; `geometry.userData.copies` is the number of glyphs in each. */
    readonly ghostMarks: readonly [Mesh, Mesh] | null;
    readonly landmark: readonly [InstancedMesh, Mesh] | null;
    readonly trail: InstancedMesh | null;
    readonly walker: Mesh | null;
  };
  /**
   * Write a model with the same shape (counts) into the existing buffers: the tesseract turning
   * in 4D. Returns false, changing nothing, if the shapes differ (the caller rebuilds).
   */
  refresh(model: SceneModel): boolean;
  /**
   * Show the tracer's walk up to `t` steps (fractional: the walker is part-way along a step).
   * Returns the walker's scene position.
   */
  showTrace(t: number): Vec3 | null;
  dispose(): void;
}

/**
 * Pick boxes are cell-sized in the cubic spaces and the net (hovering the solid cube finds its
 * surface cell). In the Schlegel diagram the near cube's cells enclose all the others, so there
 * each cell's true shape is shrunk towards its centroid by this factor, leaving gaps through
 * which the inner cubes can be hovered.
 */
export const SCHLEGEL_PICK_SHRINK = MARK_SIZE;

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

function boxMatrix(b: Bounds): Matrix4 {
  return matrix.compose(
    position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2),
    identityQ,
    scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
  );
}

/** A cylinder of unit radius and length from a to b, scaled to `radius`. */
function segmentMatrix(a: Vec3, b: Vec3, radius: number, fraction = 1): Matrix4 {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const length = dir.length() * fraction;
  if (length < 1e-9) return matrix.makeScale(0, 0, 0);
  quaternion.setFromUnitVectors(yAxis, dir.normalize());
  return matrix.compose(
    from.addScaledVector(dir, length / 2),
    quaternion,
    scale.set(radius, length, radius),
  );
}

/** An instanced mesh with room for `capacity` instances (at least one slot). */
function instancedMesh(
  geometry: BufferGeometry,
  material: Material,
  capacity: number,
  registry: ResourceRegistry,
): InstancedMesh {
  return registry.track(new InstancedMesh(geometry, material, Math.max(1, capacity)));
}

function writeInstances(mesh: InstancedMesh, count: number, at: (i: number) => Matrix4): void {
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, at(i));
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

/** Overwrite a float attribute (same length) and flag it for upload. */
function writePositions(geometry: BufferGeometry, values: Float32Array): void {
  const attr = geometry.getAttribute('position');
  (attr.array as Float32Array).set(values);
  attr.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function writeLineSegments2(geometry: LineSegmentsGeometry, values: Float32Array): void {
  const attr = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined;
  if (attr === undefined) {
    geometry.setPositions(values);
    return;
  }
  (attr.data.array as Float32Array).set(values);
  attr.data.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** The edges of a unit box at every placement, baked into one position array. */
function bakeEdges(
  edges: BufferGeometry,
  placements: readonly Placement[],
  factor: number,
): Float32Array {
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
  return out;
}

/**
 * Many copies of one geometry baked into a single geometry: one draw call and no instancing.
 * Used for the ghost copies, which can number in the thousands: software renderers (SwiftShader)
 * pay a fixed cost per instance, so a merged mesh is far faster there, and no slower on a GPU.
 */
export function bakeGeometry(src: BufferGeometry, matrices: readonly Matrix4[]): BufferGeometry {
  const pos = src.getAttribute('position');
  const index = src.getIndex();
  const nv = pos.count;
  const out = new Float32Array(nv * 3 * matrices.length);
  const v = new Vector3();
  matrices.forEach((m, i) => {
    for (let k = 0; k < nv; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      out[(i * nv + k) * 3] = v.x;
      out[(i * nv + k) * 3 + 1] = v.y;
      out[(i * nv + k) * 3 + 2] = v.z;
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  if (index !== null) {
    const ni = index.count;
    const idx = new Uint32Array(ni * matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      for (let j = 0; j < ni; j++) idx[i * ni + j] = index.getX(j) + i * nv;
    }
    g.setIndex(new BufferAttribute(idx, 1));
  }
  g.computeBoundingSphere();
  g.userData = { copies: matrices.length, verticesPerCopy: nv };
  return g;
}

/**
 * The Schlegel pick shapes: one hexahedron (8 vertices, 12 triangles) per cell in one geometry,
 * so triangle t belongs to cell ⌊t / 12⌋. The index never changes; a 4D turn rewrites only the
 * positions (see {@link writeSchlegelPicks}). The mesh is never drawn, only raycast on the CPU.
 */
export function schlegelPickGeometry(cellCount: number, n: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(cellCount * 24), 3));
  const index = new Uint32Array(cellCount * 36);
  for (let c = 0; c < cellCount; c++) index.set(hexTriangles(1, c * 8), c * 36);
  geometry.setIndex(new BufferAttribute(index, 1));
  // Every 4D orientation projects into this ball, so the raycast's bound is never recomputed.
  geometry.boundingSphere = new Sphere(new Vector3(), schlegelRadius(n) * 1.01);
  return geometry;
}

/** Write each cell's corners, shrunk towards its centroid, into the pick geometry (in place). */
export function writeSchlegelPicks(geometry: BufferGeometry, cells: readonly Placement[]): void {
  const attr = geometry.getAttribute('position');
  const out = attr.array as Float32Array;
  for (let c = 0; c < cells.length; c++) {
    const corners = (cells[c] as Placement).corners;
    if (corners !== undefined) writeHex(corners, SCHLEGEL_PICK_SHRINK, out, c * 8);
  }
  attr.needsUpdate = true;
}

/** A P1 box's 12 triangles (wound for a right-handed frame) and 12 edges, from vertex 0. */
const BOX_TRIANGLES = hexTriangles(1);
const BOX_LINES = hexEdgeIndices();
/** Triangles per projected ball: the face → mark map of the P2 pick layer is `face / this`. */
export const BALL_TRIANGLES = BALL.triangles.length / 3;

/**
 * A merged geometry of `items` shapes of `vertices` each, positions rewritten in place on every
 * 4D turn. Every 4D orientation projects into the Schlegel ball, so its bound is fixed.
 */
function mergedGeometry(
  items: number,
  vertices: number,
  n: number,
  position?: BufferAttribute,
): BufferGeometry {
  const geometry = new BufferGeometry();
  const attr =
    position ??
    new BufferAttribute(new Float32Array(items * vertices * 3), 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', attr);
  geometry.boundingSphere = new Sphere(new Vector3(), schlegelRadius(n) * 1.01);
  geometry.userData = { items, verticesPerItem: vertices };
  return geometry;
}

/** An index of `items` copies of `template`, copy i shifted by i · `stride` vertices. */
function repeatedIndex(template: readonly number[], items: number, stride: number) {
  const out = new Uint32Array(template.length * items);
  for (let i = 0; i < items; i++) {
    for (let j = 0; j < template.length; j++) {
      out[i * template.length + j] = (template[j] as number) + i * stride;
    }
  }
  return new BufferAttribute(out, 1);
}

/** Scratch for one threat box's corners before they are spread over its 12 dashed edges. */
const threatCorners = new Float32Array(24);

/**
 * The Schlegel diagram's marks (see {@link ProjectedMarks}). Returns the objects to add, the
 * pick layers' meshes, and the writer that projects a model's marks into the buffers.
 */
function buildProjectedMarks(
  model: SceneModel,
  materials: Materials,
  track: <G extends BufferGeometry>(geometry: G) => G,
): { marks: ProjectedMarks; objects: Object3D[]; write: (m: SceneModel) => void } {
  const n = model.n;
  const kind = (p: 0 | 1, received: boolean) =>
    model.marks.filter((m) => m.player === p && m.received === received).length;
  const objects: Object3D[] = [];
  const named = <O extends Object3D>(object: O, name: string, items: number): O => {
    object.name = name;
    object.visible = items > 0;
    objects.push(object);
    return object;
  };

  // Solid marks: filled, wound outwards per mark (a mirrored cell re-winds its mark).
  const counts = [kind(0, false), kind(1, false)] as const;
  const shapes = [
    { vertices: 8, triangles: BOX_TRIANGLES },
    { vertices: BALL.count, triangles: BALL.triangles },
  ] as const;
  const fillGeometry = shapes.map(({ vertices, triangles }, p) => {
    const geometry = track(mergedGeometry(counts[p] as number, vertices, n));
    geometry.setIndex(repeatedIndex(triangles, counts[p] as number, vertices));
    return geometry;
  });
  const signs = counts.map((c) => new Int8Array(c).fill(1));
  const fill = (p: 0 | 1) =>
    named(
      new Mesh(fillGeometry[p] as BufferGeometry, materials.mark[p]),
      `marks-p${p + 1}`,
      counts[p],
    );
  const fills: [Mesh, Mesh] = [fill(0), fill(1)];
  const p1Positions = fillGeometry[0]?.getAttribute('position') as BufferAttribute;
  const edgeGeometry = track(mergedGeometry(counts[0], 8, n, p1Positions));
  edgeGeometry.setIndex(repeatedIndex(BOX_LINES, counts[0], 8));
  const edges = named(
    new LineSegments(edgeGeometry, materials.markEdge),
    'marks-p1-edges',
    counts[0],
  );

  // Received marks: wire only.
  const wires = [
    { vertices: 8, lines: BOX_LINES },
    { vertices: BALL.count, lines: BALL.wire },
  ] as const;
  const received = wires.map(({ vertices, lines }, p) => {
    const items = kind(p as 0 | 1, true);
    if (items === 0) return null;
    const geometry = track(mergedGeometry(items, vertices, n));
    geometry.setIndex(repeatedIndex(lines, items, vertices));
    return named(
      new LineSegments(geometry, materials.markWire[p]),
      `marks-p${p + 1}-received`,
      items,
    );
  }) as [LineSegments | null, LineSegments | null];

  let lastMove: LineSegments | null = null;
  if (model.lastMove !== null) {
    const geometry = track(mergedGeometry(1, 8, n));
    geometry.setIndex(BOX_LINES);
    lastMove = named(new LineSegments(geometry, materials.lastMove), 'last-move', 1);
  }

  // Threats: dashed, so not indexed (each edge needs its own line distances). The distances
  // run 0 → 1 along every edge, so the dashes follow the projected edge like the cell's grid.
  const threats = ([0, 1] as const).map((p) => {
    const items = model.threats.filter((t) => t.player === p).length;
    if (items === 0) return null;
    const geometry = track(mergedGeometry(items, 24, n));
    const distance = new Float32Array(items * 24);
    for (let k = 1; k < distance.length; k += 2) distance[k] = 1;
    geometry.setAttribute('lineDistance', new BufferAttribute(distance, 1));
    return named(new LineSegments(geometry, materials.threat[p]), `threats-p${p + 1}`, items);
  }) as [LineSegments | null, LineSegments | null];

  const none = new Float32Array(0);
  const array = (o: Mesh | LineSegments | null) =>
    o === null ? none : (o.geometry.getAttribute('position').array as Float32Array);
  const fillArrays = [array(fills[0]), array(fills[1])] as const;
  const receivedArrays = [array(received[0]), array(received[1])] as const;
  const lastArray = array(lastMove);
  const threatArrays = [array(threats[0]), array(threats[1])] as const;
  const indexArrays = fillGeometry.map((geometry) => geometry.getIndex()?.array as Uint32Array);
  const written = [...fills, ...received, lastMove, ...threats].filter(
    (o): o is Mesh | LineSegments => o !== null,
  );
  /** Next free slot per kind: P1, P2, received P1, received P2. */
  const slot = new Int32Array(4);
  const rewound = new Uint8Array(2);
  const threatSlot = new Int32Array(2);

  /** Allocation-free: one pass over the marks, each written at its kind's next slot. */
  const write = (m: SceneModel) => {
    const cameraW = m.cameraW ?? 1;
    slot.fill(0);
    rewound.fill(0);
    for (let i = 0; i < m.marks.length; i++) {
      const mark = m.marks[i] as (typeof m.marks)[number];
      const rot = mark.corners4;
      if (rot === undefined) continue;
      const p = mark.player;
      if (mark.received) {
        const item = slot[2 + p] as number;
        slot[2 + p] = item + 1;
        if (p === 0) writeBox4(rot, MARK_SIZE, cameraW, receivedArrays[0], 8 * item);
        else writeBall4(rot, MARK_SIZE / 2, cameraW, BALL, receivedArrays[1], BALL.count * item);
        continue;
      }
      const item = slot[p] as number;
      slot[p] = item + 1;
      if (p === 0) writeBox4(rot, MARK_SIZE, cameraW, fillArrays[0], 8 * item);
      else writeBall4(rot, MARK_SIZE / 2, cameraW, BALL, fillArrays[1], BALL.count * item);
      // The fill is seen from outside (front faces), so it must be wound outwards.
      const sign = orientation4(rot, cameraW);
      const itemSigns = signs[p] as Int8Array;
      if (sign !== itemSigns[item]) {
        const shape = shapes[p];
        itemSigns[item] = sign;
        const per = shape.triangles.length;
        writeTriangles(
          shape.triangles,
          sign,
          item * shape.vertices,
          indexArrays[p] as Uint32Array,
          item * per,
        );
        rewound[p] = 1;
      }
    }
    for (let p = 0; p < 2; p++) {
      const index = (fillGeometry[p] as BufferGeometry).getIndex();
      if (rewound[p] === 1 && index !== null) index.needsUpdate = true;
    }
    const last = m.lastMove?.corners4;
    if (last !== undefined && lastArray.length > 0) {
      writeBox4(last, LAST_MOVE_SIZE, cameraW, lastArray, 0);
    }
    threatSlot.fill(0);
    for (let i = 0; i < m.threats.length; i++) {
      const threat = m.threats[i] as (typeof m.threats)[number];
      const out = threatArrays[threat.player];
      if (threat.corners4 === undefined || out.length === 0) continue;
      writeBox4(threat.corners4, THREAT_SIZE, cameraW, threatCorners, 0);
      let o = (threatSlot[threat.player] as number) * 72;
      threatSlot[threat.player] = (threatSlot[threat.player] as number) + 1;
      for (let e = 0; e < 24; e++) {
        const c = BOX_LINES[e] as number;
        out[o++] = threatCorners[3 * c] as number;
        out[o++] = threatCorners[3 * c + 1] as number;
        out[o++] = threatCorners[3 * c + 2] as number;
      }
    }
    for (let i = 0; i < written.length; i++) {
      (written[i] as Mesh | LineSegments).geometry.getAttribute('position').needsUpdate = true;
    }
  };

  return { marks: { fills, edges, received, lastMove, threats }, objects, write };
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

function pathSegments(paths: readonly (readonly Vec3[])[]): {
  segments: Segment[];
  joints: Vec3[];
} {
  const segments: Segment[] = [];
  const joints: Vec3[] = [];
  for (const path of paths) {
    path.forEach((p, i) => {
      joints.push(p);
      const next = path[i + 1];
      if (next !== undefined) segments.push([p, next]);
    });
  }
  return { segments, joints };
}

const solidMarks = (model: SceneModel, p: 0 | 1) =>
  model.marks.filter((m) => m.player === p && !m.received);
const receivedMarks = (model: SceneModel, p: 0 | 1) =>
  model.marks.filter((m) => m.player === p && m.received);
const threatsOf = (model: SceneModel, p: 0 | 1) => model.threats.filter((t) => t.player === p);

/** Everything about a model that decides which objects exist and how big their buffers are. */
function shapeOf(model: SceneModel): string {
  return JSON.stringify([
    model.key,
    model.wires.length,
    model.outline.length,
    model.selectedOutline?.length ?? -1,
    // The cells too: the marks' pick tables are built with the objects, not rewritten.
    model.marks.map((m) => `${m.cell}${'abAB'[m.player + (m.received ? 2 : 0)]}`).join(''),
    model.lastMove !== null,
    model.threats.map((t) => t.player).join(''),
    model.win?.paths.map((p) => p.length) ?? null,
    model.ghosts?.cells.length ?? -1,
    model.ghosts?.marks.length ?? -1,
    model.landmark.length,
    model.trace?.steps.map((s) => s.length) ?? null,
  ]);
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
  const writers: ((m: SceneModel) => void)[] = [];
  // `Object3D.add()` with no arguments logs an error, so the parts are collected first.
  const parts: Object3D[] = [];

  // --- grid and outlines ---
  const wireGeometry = g(new BufferGeometry());
  wireGeometry.setAttribute('position', new Float32BufferAttribute(model.wires, 3));
  const wires = new LineSegments(wireGeometry, materials.wire);
  wires.name = 'wires';
  writers.push((m) => writePositions(wireGeometry, m.wires));

  const outlineGeometry = g(new LineSegmentsGeometry());
  outlineGeometry.setPositions(model.outline);
  const outline = new LineSegments2(outlineGeometry, materials.outline);
  outline.name = 'outline';
  writers.push((m) => writeLineSegments2(outlineGeometry, m.outline));
  parts.push(wires, outline);

  if (model.selectedOutline !== null) {
    const selGeometry = g(new LineSegmentsGeometry());
    selGeometry.setPositions(model.selectedOutline);
    const sel = new LineSegments2(selGeometry, materials.outlineBold);
    sel.name = 'selected-cube';
    writers.push((m) => m.selectedOutline && writeLineSegments2(selGeometry, m.selectedOutline));
    parts.push(sel);
  }

  // --- marks: true projected shapes in the Schlegel diagram, unit glyphs elsewhere ---
  const box = g(new BoxGeometry(1, 1, 1));
  const boxEdges = g(new EdgesGeometry(box));
  const markTable = (p: 0 | 1) => new PickTable(solidMarks(model, p).map((m) => m.cell));
  let marks: [Mesh, Mesh];
  let projected: ProjectedMarks | null = null;
  let markLayers: PickLayerObject[];
  if (model.mode === 'schlegel') {
    const built = buildProjectedMarks(model, materials, g);
    projected = built.marks;
    marks = [built.marks.fills[0], built.marks.fills[1]];
    writers.push(built.write);
    parts.push(...built.objects);
    // Picked by their projected triangles, which lie inside their cells.
    markLayers = [
      { mesh: marks[0], table: markTable(0), trianglesPerItem: HEX_TRIANGLES },
      { mesh: marks[1], table: markTable(1), trianglesPerItem: BALL_TRIANGLES },
    ];
  } else {
    const sphere = g(new SphereGeometry(0.5, 24, 16));
    const instanced: [InstancedMesh, InstancedMesh] = [
      instancedMesh(box, materials.mark[0], solidMarks(model, 0).length, registry),
      instancedMesh(sphere, materials.mark[1], solidMarks(model, 1).length, registry),
    ];
    instanced[0].name = 'marks-p1';
    instanced[1].name = 'marks-p2';
    writers.push((m) => {
      for (const p of [0, 1] as const) {
        const list = solidMarks(m, p);
        writeInstances(instanced[p], list.length, (i) =>
          placeMatrix(list[i] as Placement, MARK_SIZE),
        );
      }
    });
    marks = instanced;
    markLayers = [
      { mesh: instanced[0], table: markTable(0) },
      { mesh: instanced[1], table: markTable(1) },
    ];
    parts.push(...instanced);
  }

  let cells: InstancedMesh | null = null;
  let cellHexes: Mesh | null = null;
  let cellLayer: PickLayerObject;
  if (model.mode === 'schlegel') {
    const hexes = schlegelPickGeometry(model.cells.length, model.n);
    g(hexes);
    writers.push((m) => writeSchlegelPicks(hexes, m.cells));
    cellHexes = new Mesh(hexes, materials.pickHex);
    cellHexes.name = 'pick-cells';
    cellHexes.visible = false;
    cellLayer = {
      mesh: cellHexes,
      table: PickTable.identity(model.cells.length),
      trianglesPerItem: HEX_TRIANGLES,
    };
    parts.push(cellHexes);
  } else {
    const boxes = instancedMesh(box, materials.pick, model.cells.length, registry);
    boxes.name = 'pick-cells';
    boxes.visible = false;
    writers.push((m) =>
      writeInstances(boxes, m.cells.length, (i) => placeMatrix(m.cells[i] as Placement, 1)),
    );
    cells = boxes;
    cellLayer = { mesh: boxes, table: PickTable.identity(model.cells.length) };
    parts.push(boxes);
  }

  if (projected === null && solidMarks(model, 0).length > 0) {
    const edgeGeometry = g(new BufferGeometry());
    edgeGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(bakeEdges(boxEdges, solidMarks(model, 0), MARK_SIZE), 3),
    );
    const edges = new LineSegments(edgeGeometry, materials.markEdge);
    edges.name = 'marks-p1-edges';
    writers.push((m) =>
      writePositions(edgeGeometry, bakeEdges(boxEdges, solidMarks(m, 0), MARK_SIZE)),
    );
    parts.push(edges);
  }

  /** Copies of one line geometry, one per placement (few: received marks, threats). */
  const lineCopies = (
    geometry: BufferGeometry,
    material: Material,
    pick: (m: SceneModel) => readonly Placement[],
    factor: number,
    dashed = false,
  ) => {
    const lines = pick(model).map(() => {
      const line = new LineSegments(geometry, material);
      if (dashed) line.computeLineDistances();
      return line;
    });
    writers.push((m) =>
      pick(m).forEach((p, i) => {
        const line = lines[i] as LineSegments;
        line.position.set(...p.pos);
        line.scale.setScalar(p.size * factor);
      }),
    );
    parts.push(...lines);
  };
  if (projected === null) {
    const rings = g(ringsGeometry(0.5));
    lineCopies(boxEdges, materials.markWire[0], (m) => receivedMarks(m, 0), MARK_SIZE);
    lineCopies(rings, materials.markWire[1], (m) => receivedMarks(m, 1), MARK_SIZE);
    lineCopies(
      boxEdges,
      materials.lastMove,
      (m) => (m.lastMove === null ? [] : [m.lastMove]),
      LAST_MOVE_SIZE,
    );
  }
  for (const p of [0, 1] as const) {
    if (projected !== null || threatsOf(model, p).length === 0) continue;
    // Dashed lines need their own geometry: `computeLineDistances` writes into it.
    lineCopies(
      g(new EdgesGeometry(box)),
      materials.threat[p],
      (m) => threatsOf(m, p),
      THREAT_SIZE,
      true,
    );
  }

  // --- the win tube: a cylinder per segment and a ball per vertex, so bends are round ---
  const cylinder = g(new CylinderGeometry(1, 1, 1, 12, 1, true));
  const ball = g(new SphereGeometry(1, 12, 8));
  if (model.win !== null) {
    const { segments, joints } = pathSegments(model.win.paths);
    const tubes = instancedMesh(cylinder, materials.win, segments.length, registry);
    const balls = instancedMesh(ball, materials.win, joints.length, registry);
    tubes.name = 'win-tube';
    writers.push((m) => {
      const w = pathSegments(m.win?.paths ?? []);
      writeInstances(tubes, w.segments.length, (i) => {
        const [a, b] = w.segments[i] as Segment;
        return segmentMatrix(a, b, WIN_RADIUS);
      });
      writeInstances(balls, w.joints.length, (i) =>
        placeMatrix({ cell: -1, pos: w.joints[i] as Vec3, size: 1 }, WIN_RADIUS),
      );
    });
    parts.push(tubes, balls);
  }

  // --- ghost copies (cover view) ---
  let ghostMarks: [Mesh, Mesh] | null = null;
  let ghostTable: PickTable | null = null;
  const ghostLayers: PickLayerObject[] = [];
  if (model.ghosts !== null) {
    const gm = (p: 0 | 1) => (model.ghosts?.marks ?? []).filter((m) => m.player === p);
    // Coarser than the real marks (80 triangles): there can be thousands of ghosts, and an unlit
    // sphere is only its outline, which at ghost size reads as a disc either way.
    const ghostSphere = g(new IcosahedronGeometry(0.5, 1));
    const bake = (src: BufferGeometry, list: readonly Placement[]) =>
      g(
        bakeGeometry(
          src,
          list.map((m) => placeMatrix(m, MARK_SIZE).clone()),
        ),
      );
    const pair: [Mesh, Mesh] = [
      new Mesh(bake(box, gm(0)), materials.ghostMark[0]),
      new Mesh(bake(ghostSphere, gm(1)), materials.ghostMark[1]),
    ];
    pair.forEach((mesh, p) => {
      mesh.name = `ghost-marks-p${p + 1}`;
      mesh.layers.set(GHOST_LAYER);
    });
    ghostMarks = pair;
    const edgeGeometry = g(new BufferGeometry());
    edgeGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(bakeEdges(boxEdges, gm(0), MARK_SIZE), 3),
    );
    const ghostEdges = new LineSegments(edgeGeometry, materials.ghostMarkEdge);
    ghostEdges.name = 'ghost-marks-p1-edges';
    ghostEdges.layers.set(GHOST_LAYER);
    parts.push(ghostEdges);
    // Ghosts are picked with invisible boxes only: they are raycast on the CPU, never drawn.
    const gc = model.ghosts.cells;
    const ghostCells = instancedMesh(box, materials.pick, gc.length, registry);
    ghostCells.name = 'pick-ghosts';
    ghostCells.visible = false;
    writeInstances(ghostCells, gc.length, (i) => placeMatrix(gc[i] as Placement, 1));
    ghostTable = new PickTable(gc.map((c) => c.cell));
    ghostLayers.push({ mesh: ghostCells, table: ghostTable });
    const outlineGeom = g(new BufferGeometry());
    outlineGeom.setAttribute('position', new Float32BufferAttribute(model.ghosts.outlines, 3));
    const copies = new LineSegments(outlineGeom, materials.wire);
    copies.name = 'ghost-outlines';
    copies.layers.set(GHOST_LAYER);
    parts.push(...pair, ghostCells, copies);
  }

  let landmark: [InstancedMesh, Mesh] | null = null;
  if (model.landmark.length > 0) {
    const [own, ...others] = model.landmark;
    const boxes = (own?.boxes ?? []) as readonly Bounds[];
    const ghostBoxes = others.flatMap((c) => c.boxes);
    const solid = instancedMesh(box, materials.landmark, boxes.length, registry);
    writeInstances(solid, boxes.length, (i) => boxMatrix(boxes[i] as Bounds));
    const faint = new Mesh(
      g(
        bakeGeometry(
          box,
          ghostBoxes.map((b) => boxMatrix(b).clone()),
        ),
      ),
      materials.ghostLandmark,
    );
    solid.name = 'landmark';
    faint.name = 'landmark-ghosts';
    faint.layers.set(GHOST_LAYER);
    landmark = [solid, faint];
    parts.push(solid, faint);
  }

  // --- the tracer: a black trail of thin cylinders and an octahedral walker ---
  let trail: InstancedMesh | null = null;
  let trailJoints: InstancedMesh | null = null;
  let walker: Mesh | null = null;
  let current = model;
  if (model.trace !== null) {
    const total = model.trace.steps.reduce((s, st) => s + st.length, 0);
    trail = instancedMesh(cylinder, materials.trace, total, registry);
    trailJoints = instancedMesh(ball, materials.trace, total * 2, registry);
    trail.name = 'trace-trail';
    walker = new Mesh(g(new OctahedronGeometry(0.5)), materials.trace);
    walker.name = 'trace-walker';
    parts.push(trail, trailJoints, walker);
  }
  let traceT = 0;
  const showTrace = (t: number): Vec3 | null => {
    traceT = t;
    const tr = current.trace;
    if (tr === null || trail === null || trailJoints === null || walker === null) return null;
    const steps = tr.steps;
    const t1 = Math.max(0, Math.min(t, steps.length));
    const whole = Math.floor(t1);
    const frac = t1 - whole;
    const shown: [Vec3, Vec3, number][] = [];
    steps.forEach((segs, i) => {
      if (i < whole) for (const [a, b] of segs) shown.push([a, b, 1]);
    });
    let at: Vec3 = (tr.stops[whole] as Placement).pos;
    const partial = steps[whole];
    if (partial !== undefined && frac > 0) {
      // Walk `frac` of the step's length along its segments (a seam jump costs nothing).
      const lengths = partial.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      let left = frac * lengths.reduce((s, l) => s + l, 0);
      for (const [k, [a, b]] of partial.entries()) {
        const l = lengths[k] as number;
        const f = l === 0 ? 1 : Math.min(1, left / l);
        shown.push([a, b, f]);
        at = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        left -= l;
        if (left <= 0) break;
      }
    }
    const size = (
      tr.stops[Math.min(whole + (frac > 0.5 ? 1 : 0), tr.stops.length - 1)] as Placement
    ).size;
    writeInstances(trail, shown.length, (i) => {
      const [a, b, f] = shown[i] as [Vec3, Vec3, number];
      return segmentMatrix(a, b, TRACE_RADIUS * size, f);
    });
    writeInstances(trailJoints, shown.length, (i) => {
      const [a] = shown[i] as [Vec3, Vec3, number];
      return placeMatrix({ cell: -1, pos: a, size: size }, TRACE_RADIUS);
    });
    walker.position.set(...at);
    walker.scale.setScalar(WALKER_SIZE * size);
    return at;
  };

  const shape = shapeOf(model);
  for (const w of writers) w(model);
  showTrace(0);
  root.add(...parts);

  return {
    root,
    pickLayers: [...markLayers, cellLayer, ...ghostLayers],
    ghostTable,
    parts: {
      wires,
      outline,
      marks,
      projected,
      cells,
      cellHexes,
      ghostMarks,
      landmark,
      trail,
      walker,
    },
    refresh: (m) => {
      if (shapeOf(m) !== shape) return false;
      current = m;
      for (const w of writers) w(m);
      showTrace(traceT);
      return true;
    },
    showTrace,
    dispose: () => {
      root.removeFromParent();
      root.clear();
      registry.disposeAll();
    },
  };
}

/**
 * The persistent hover highlight: a grey-30 box with a black edge outline on the hovered cell,
 * and the same box with grey-60 edges on each of its ghost copies (cover view). In the Schlegel
 * diagram the cell is no cube, so the highlight is the hexahedron through its 8 projected
 * corners instead: 6 quads of fill and 12 black edges.
 */
export class HoverBox {
  readonly object = new Group();
  private readonly registry = new ResourceRegistry();
  private readonly main = new Group();
  private readonly hex = new Group();
  private readonly hexFill: BufferGeometry;
  private readonly hexEdges: BufferGeometry;
  /** The winding the fill's index has (see `hexOrientation`). */
  private hexSign = 1;
  private readonly copies: Mesh;
  private readonly copyEdges: LineSegments;
  private readonly unitBox: BufferGeometry;
  private readonly unitEdges: BufferGeometry;
  private copiesShown = 0;

  /** At most this many ghost copies are highlighted (26 neighbours). */
  static readonly MAX_COPIES = 26;

  constructor(materials: Materials) {
    const box = this.registry.track(new BoxGeometry(1, 1, 1));
    const edges = this.registry.track(new EdgesGeometry(box));
    this.unitBox = box;
    this.unitEdges = edges;
    this.main.add(new Mesh(box, materials.hoverFill), new LineSegments(edges, materials.hoverEdge));
    // The copies are baked into one mesh (no instancing: see `bakeGeometry`), rewritten on show.
    const slots = Array.from({ length: HoverBox.MAX_COPIES }, () => new Matrix4());
    const copyGeometry = this.registry.track(bakeGeometry(box, slots));
    copyGeometry.setDrawRange(0, 0);
    this.copies = new Mesh(copyGeometry, materials.hoverFill);
    this.copies.frustumCulled = false;
    const edgeGeometry = this.registry.track(new BufferGeometry());
    edgeGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        new Float32Array(edges.getAttribute('position').count * 3 * HoverBox.MAX_COPIES),
        3,
      ),
    );
    edgeGeometry.setDrawRange(0, 0);
    this.copyEdges = new LineSegments(edgeGeometry, materials.hoverGhostEdge);
    this.copyEdges.frustumCulled = false;
    // The copies' highlight belongs to the ghost pass, under the fundamental cube.
    this.copies.layers.set(GHOST_LAYER);
    this.copyEdges.layers.set(GHOST_LAYER);
    // The hexahedron: 8 corners rewritten on every show, its fill re-wound when it mirrors.
    const hexGeometry = (index: number[]) => {
      const geometry = this.registry.track(new BufferGeometry());
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(24), 3));
      geometry.setIndex(index);
      return geometry;
    };
    this.hexFill = hexGeometry(hexTriangles(1));
    this.hexEdges = hexGeometry(hexEdgeIndices());
    this.hex.add(
      new Mesh(this.hexFill, materials.hoverFill),
      new LineSegments(this.hexEdges, materials.hoverEdge),
    );
    this.hex.visible = false;
    this.object.add(this.main, this.copies, this.copyEdges, this.hex);
    this.object.name = 'hover';
    this.object.visible = false;
    // Drawn after the board and the ghosts so the translucent fill blends over them.
    this.main.renderOrder = RENDER_ORDER.hover;
    this.hex.renderOrder = RENDER_ORDER.hover;
    this.copies.renderOrder = RENDER_ORDER.hover;
  }

  /** Show the box around a placement and its ghost copies, or hide it. */
  show(at: Placement | null, copies: readonly Placement[] = []): void {
    this.object.visible = at !== null;
    if (at === null) return;
    const corners = at.corners;
    this.main.visible = corners === undefined;
    this.hex.visible = corners !== undefined;
    if (corners !== undefined) this.showHex(corners);
    this.main.position.set(...at.pos);
    this.main.scale.setScalar(at.size);
    const list = copies.slice(0, HoverBox.MAX_COPIES);
    this.copiesShown = list.length;
    const write = (geometry: BufferGeometry, src: BufferGeometry, count: number) => {
      const baked = bakeEdges(src, list, 1);
      const attr = geometry.getAttribute('position');
      (attr.array as Float32Array).set(baked);
      attr.needsUpdate = true;
      geometry.setDrawRange(0, count);
    };
    const perBox = this.unitBox.getIndex()?.count ?? 0;
    write(this.copies.geometry, this.unitBox, perBox * list.length);
    write(
      this.copyEdges.geometry,
      this.unitEdges,
      this.unitEdges.getAttribute('position').count * list.length,
    );
  }

  private showHex(corners: readonly Vec3[]): void {
    const attr = this.hexFill.getAttribute('position');
    const out = attr.array as Float32Array;
    for (let i = 0; i < 8; i++) out.set(corners[i] as Vec3, i * 3);
    attr.needsUpdate = true;
    const edges = this.hexEdges.getAttribute('position');
    (edges.array as Float32Array).set(out);
    edges.needsUpdate = true;
    // The fill is seen from inside (back faces), so it must be wound outwards.
    const sign = hexOrientation(out);
    const index = this.hexFill.getIndex();
    if (sign !== this.hexSign && index !== null) {
      (index.array as Uint16Array).set(hexTriangles(sign));
      index.needsUpdate = true;
      this.hexSign = sign;
    }
    this.hexFill.computeBoundingSphere();
    this.hexEdges.computeBoundingSphere();
  }

  /** The corners of the highlighted hexahedron (Schlegel diagram), for the debug hook. */
  get corners(): number[][] | null {
    if (!this.object.visible || !this.hex.visible) return null;
    const attr = this.hexFill.getAttribute('position');
    return Array.from({ length: 8 }, (_, i) => [attr.getX(i), attr.getY(i), attr.getZ(i)]);
  }

  /** How many ghost copies are highlighted (for the debug hook). */
  get copyCount(): number {
    return this.object.visible ? this.copiesShown : 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.registry.disposeAll();
  }
}
