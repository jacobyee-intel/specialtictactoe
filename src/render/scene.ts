/**
 * Turn a pure {@link SceneModel} into three.js objects. Everything here works in node (creating
 * geometry and materials needs no WebGL), so the build is smoke-tested without a browser.
 *
 * Draw calls are kept few and independent of N: one `LineSegments` for the whole cell grid, one
 * `LineSegments2` for the outline, one `InstancedMesh` per mark kind, one for the pick boxes.
 * Only the rare things (received marks, threats, the last move, the win tube) are small extra
 * objects.
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
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import type { Materials } from './materials';
import { PickTable } from './picking';
import { ResourceRegistry } from './registry';
import type { Bounds, Placement, SceneModel, Segment, Vec3 } from './sceneModel';

/** Mark size as a fraction of the cell, as in 2D (inset 20% on each side). */
export const MARK_SIZE = 0.6;
/** The last-move outline sits just outside the mark. */
const LAST_MOVE_SIZE = 0.76;
const THREAT_SIZE = 0.86;
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
  readonly mesh: InstancedMesh;
  readonly table: PickTable;
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
    readonly marks: readonly [InstancedMesh, InstancedMesh];
    readonly cells: InstancedMesh;
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
 * the boxes are mark-sized, leaving gaps through which the inner cubes can be hovered.
 */
function pickScale(model: SceneModel): number {
  return model.mode === 'schlegel' ? MARK_SIZE : 1;
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
    model.marks.map((m) => `${m.player}${m.received ? 'r' : ''}`).join(''),
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

  // --- marks ---
  const box = g(new BoxGeometry(1, 1, 1));
  const sphere = g(new SphereGeometry(0.5, 24, 16));
  const marks: [InstancedMesh, InstancedMesh] = [
    instancedMesh(box, materials.mark[0], solidMarks(model, 0).length, registry),
    instancedMesh(sphere, materials.mark[1], solidMarks(model, 1).length, registry),
  ];
  marks[0].name = 'marks-p1';
  marks[1].name = 'marks-p2';
  writers.push((m) => {
    for (const p of [0, 1] as const) {
      const list = solidMarks(m, p);
      writeInstances(marks[p], list.length, (i) => placeMatrix(list[i] as Placement, MARK_SIZE));
    }
  });

  const cells = instancedMesh(box, materials.pick, model.cells.length, registry);
  cells.name = 'pick-cells';
  cells.visible = false;
  writers.push((m) =>
    writeInstances(cells, m.cells.length, (i) =>
      placeMatrix(m.cells[i] as Placement, pickScale(m)),
    ),
  );
  parts.push(...marks, cells);

  const boxEdges = g(new EdgesGeometry(box));
  if (solidMarks(model, 0).length > 0) {
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
  const rings = g(ringsGeometry(0.5));
  lineCopies(boxEdges, materials.markWire[0], (m) => receivedMarks(m, 0), MARK_SIZE);
  lineCopies(rings, materials.markWire[1], (m) => receivedMarks(m, 1), MARK_SIZE);
  lineCopies(
    boxEdges,
    materials.lastMove,
    (m) => (m.lastMove === null ? [] : [m.lastMove]),
    LAST_MOVE_SIZE,
  );
  for (const p of [0, 1] as const) {
    if (threatsOf(model, p).length === 0) continue;
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
    pickLayers: [
      { mesh: marks[0], table: new PickTable(solidMarks(model, 0).map((m) => m.cell)) },
      { mesh: marks[1], table: new PickTable(solidMarks(model, 1).map((m) => m.cell)) },
      { mesh: cells, table: PickTable.identity(model.cells.length) },
      ...ghostLayers,
    ],
    ghostTable,
    parts: { wires, outline, marks, cells, ghostMarks, landmark, trail, walker },
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
 * and the same box with grey-60 edges on each of its ghost copies (cover view).
 */
export class HoverBox {
  readonly object = new Group();
  private readonly registry = new ResourceRegistry();
  private readonly main = new Group();
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
    this.object.add(this.main, this.copies, this.copyEdges);
    this.object.name = 'hover';
    this.object.visible = false;
    // Drawn after the board and the ghosts so the translucent fill blends over them.
    this.main.renderOrder = RENDER_ORDER.hover;
    this.copies.renderOrder = RENDER_ORDER.hover;
  }

  /** Show the box around a placement and its ghost copies, or hide it. */
  show(at: Placement | null, copies: readonly Placement[] = []): void {
    this.object.visible = at !== null;
    if (at === null) return;
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

  /** How many ghost copies are highlighted (for the debug hook). */
  get copyCount(): number {
    return this.object.visible ? this.copiesShown : 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.registry.disposeAll();
  }
}
