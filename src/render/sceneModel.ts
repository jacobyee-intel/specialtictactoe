/**
 * The 3D board as plain data: where every cell sits, which marks to draw and how, and the
 * polylines of the overlays. Pure (no three.js, no DOM), so it is tested in node; `scene.ts`
 * turns it into meshes.
 *
 * ## Frames
 *
 * Cells are first placed in a *model frame*: lattice coordinates centred on the origin (3D for
 * the cubic spaces, 4D for the tesseract). A {@link Placer} maps model points to the scene:
 *
 * - cubic spaces: engine (x, y, z) → three (x, z, −y). Engine z is "up" (the 2D seam panel shows
 *   the slice *above* the top one), and the map is a proper rotation, so handedness survives:
 *   that matters for the chiral landmark of Phase B.
 * - tesseract: rotate in 4D, Schlegel-project to 3D (`four.ts`), then the same axis map.
 *
 * Half-steps (`centre + d/2`) are computed in the model frame before placing, which is what makes
 * win lines exact: across a tesseract ridge the half-steps from both cells meet on the ridge
 * (the line bends there), and across a seam of a wrapped space they land on opposite walls (the
 * line leaves through one wall and comes back through the glued one).
 *
 * ## Phase B views
 *
 * - **cover** (wrapped cubic spaces with ghosts on): ghost copies of every cell placed by the
 *   deck transforms (`cover.ts`), the chiral F in every copy, and win lines drawn straight in
 *   the cover.
 * - **schlegel** (tesseract): only the 32 hypercube edges are heavy; cell grids are drawn just
 *   for the cube chosen in the 2D filter and the hovered cube, so the diagram stays legible.
 * - **net** (tesseract): the 8 cubes unfolded by rigid motions (`net.ts`), with letter tags on
 *   faces that are glued in 4D but cut apart in the net.
 * - **trace**: the tracer's walk, as segments per step, straight through the shown copies.
 */
import {
  CubicQuotient,
  TesseractSurface,
  type CellId,
  type Dir,
  type Player,
  type Topology,
} from '@/geometry';
import {
  blockOf,
  cellCentre as cubicCentre,
  ghostInstances,
  ghostOffsets,
  landmarkCopies,
  lineCoverPath,
  type Box3,
  type GhostRange,
  type Offset,
} from './cover';
import {
  CAMERA_W_FACTOR,
  DEFAULT_PLANES4,
  apply4,
  cellCentre4,
  cellCorners4,
  hypercubeEdges4,
  project4to3,
  rotation4,
  schlegelRadius,
  type Mat4,
  type Planes4,
  type Vec3,
  type Vec4,
} from './four';
import { netPlacements, netPoint, netRidges, ridgeOf, type NetPlacement } from './net';

export type { Vec3, Vec4 };

/** What the scene model needs from a node: structurally the 2D board's `BoardView`. */
export interface SceneInput {
  readonly topology: Topology;
  /** 0 empty, 1 Player 1, 2 Player 2 (the effective board). */
  readonly board: Uint8Array;
  readonly received: ReadonlySet<CellId>;
  readonly lastMove: CellId | null;
  readonly win: { readonly player: Player; readonly cells: readonly CellId[] } | null;
  /** Missing cells of one-away lines; empty when the Threats toggle is off. */
  readonly threats: readonly { readonly cell: CellId; readonly player: Player }[];
}

export type GhostSetting = 'off' | GhostRange;

export interface SceneOptions {
  /** The tesseract's 4D orientation (ignored by the cubic spaces). */
  readonly planes4?: Planes4 | undefined;
  /** Ghost copies around the fundamental cube (wrapped cubic spaces only). Default off. */
  readonly ghosts?: GhostSetting | undefined;
  /** Tesseract: show the unfolded net instead of the Schlegel diagram. */
  readonly net?: boolean | undefined;
  /** Tesseract: the cube (facet index) chosen in the 2D filter, outlined in black. */
  readonly facet?: number | null | undefined;
  /** Tesseract: the cube of the hovered cell, whose grid is drawn faintly. */
  readonly hoverFacet?: number | null | undefined;
  /** A tracer walk to draw: its cells and the local direction on arrival at each. */
  readonly trace?: { readonly cells: readonly CellId[]; readonly dirs: readonly Dir[] } | null;
}

/** Which picture of the space the model is. */
export type ViewMode = 'cube' | 'cover' | 'schlegel' | 'net';

export type Segment = readonly [Vec3, Vec3];

/** A label placed at a 3D point (drawn as HTML over the canvas). */
export interface SceneTag {
  readonly text: string;
  readonly pos: Vec3;
  /** A glued face of the net, or where a line leaves one cube of the net and enters another. */
  readonly kind: 'ridge' | 'line';
}

/** A cell's place in the scene: its centre and the edge length of its (unit) box there. */
export interface Placement {
  readonly cell: CellId;
  readonly pos: Vec3;
  /** 1 in the cubic spaces; the perspective scale of the cell's depth in the tesseract. */
  readonly size: number;
  /**
   * Schlegel diagram only: the cell's true shape there, a skewed hexahedron, as its 8 projected
   * corners in the order of `cellCorners4` (see `hexahedron.ts`). The hover highlight and the
   * pick shapes follow it.
   */
  readonly corners?: readonly Vec3[];
  /**
   * Schlegel diagram only: the same 8 corners in R⁴ after the 4D rotation, before the
   * projection. The marks, the last-move outline and the threat boxes are built from them in
   * 4D and projected vertex by vertex (`marks4.ts`), so they share the cell's skew.
   */
  readonly corners4?: readonly Vec4[];
}

export interface MarkInstance extends Placement {
  readonly player: Player;
  /** Arrived by transfer or time travel: drawn as a wire version of the glyph. */
  readonly received: boolean;
}

export interface ThreatInstance extends Placement {
  readonly player: Player;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface SceneModel {
  /** Changes only with the space, its size and the view mode: the camera is refitted then. */
  readonly key: string;
  readonly mode: ViewMode;
  readonly n: number;
  /** Schlegel diagram only: the 4D eye's w, which projects the marks' 4D vertices; else null. */
  readonly cameraW: number | null;
  /** One placement per cell, indexed by `CellId` (the pick targets and the hover box). */
  readonly cells: readonly Placement[];
  /** The cells' wire edges as segment endpoints, xyz xyz, for one `LineSegments`. */
  readonly wires: Float32Array;
  /**
   * The heavy outline, as segment endpoints: the fundamental cube's 12 edges, or the
   * tesseract's 32 edges (where three cubes meet).
   */
  readonly outline: Float32Array;
  readonly marks: readonly MarkInstance[];
  readonly lastMove: Placement | null;
  readonly win: {
    readonly player: Player;
    /** The centres of the line's M cells, in traversal order. */
    readonly points: readonly Vec3[];
    /** Continuous pieces to draw: a seam crossing in a wrapped space starts a new piece. */
    readonly paths: readonly (readonly Vec3[])[];
  } | null;
  readonly threats: readonly ThreatInstance[];
  /** Axis-aligned box around the outline. */
  readonly bounds: Bounds;
  /** Points the default camera must frame. */
  readonly fitPoints: readonly Vec3[];
  /** Ghost copies (cover mode): their cells (pick targets), marks and copy outlines. */
  readonly ghosts: {
    readonly offsets: readonly Offset[];
    readonly cells: readonly Placement[];
    readonly marks: readonly MarkInstance[];
    readonly outlines: Float32Array;
  } | null;
  /** The chiral F of the fundamental cube (first) and of every shown copy, as world boxes. */
  readonly landmark: readonly { readonly offset: Offset; readonly boxes: readonly Bounds[] }[];
  /** Tesseract: the 12 edges of the cube chosen in the 2D filter (heavier outline). */
  readonly selectedOutline: Float32Array | null;
  readonly tags: readonly SceneTag[];
  /** The tracer's walk: per step, the segments to draw (two at a seam, a ridge or a cut). */
  readonly trace: {
    readonly cells: readonly CellId[];
    readonly steps: readonly (readonly Segment[])[];
    /** The marker's position and size at each cell of the walk. */
    readonly stops: readonly Placement[];
  } | null;
}

/** Engine-frame (x, y, z) → three.js frame (x, z, −y): z up, a proper rotation. */
export function toWorld(p: readonly number[]): Vec3 {
  // `0 - y` rather than `-y`, so no -0 leaks into positions.
  return [p[0] as number, p[2] as number, 0 - (p[1] as number)];
}

/** Maps a space's model frame to the scene. */
export interface Placer {
  /** The centre of a cell in the model frame. */
  centre(cell: CellId): readonly number[];
  /**
   * A model-frame point in the scene, with the local scale there. `cell` is the cell the point
   * belongs to, which the net needs (a point on a ridge is in two places once it is cut).
   */
  place(p: readonly number[], cell?: CellId): { readonly pos: Vec3; readonly scale: number };
  /** The Schlegel diagram's 4D rotation and eye (tesseract, not the net). */
  readonly schlegel?: { readonly R: Mat4; readonly cameraW: number };
}

function cubicPlacer(topology: Topology): Placer {
  const h = topology.n / 2;
  return {
    centre: (cell) => topology.coords(cell).map((v) => v + 0.5 - h),
    place: (p) => ({ pos: toWorld(p), scale: 1 }),
  };
}

function tesseractPlacer(t: TesseractSurface, planes: Planes4): Placer {
  const R = rotation4(planes);
  const cameraW = CAMERA_W_FACTOR * t.n;
  return {
    schlegel: { R, cameraW },
    centre: (cell) => cellCentre4(t, cell),
    place: (p) => {
      const { p: q, scale } = project4to3(p as unknown as Vec4, R, cameraW);
      return { pos: toWorld(q), scale };
    },
  };
}

/**
 * Net frame (x, y, z) → three.js (z, x, y): a proper rotation (a cyclic permutation, det +1),
 * so the cubes keep their true shape and handedness. It lays the net's long column (four cubes
 * along z) left to right, which fits the wide viewport far better than standing it up.
 */
export function netToWorld(p: readonly number[]): Vec3 {
  return [p[2] as number, p[0] as number, p[1] as number];
}

function netPlacer(t: TesseractSurface): Placer {
  const placements = netPlacements(t.n);
  const root = placements[6] as NetPlacement;
  return {
    centre: (cell) => cellCentre4(t, cell),
    place: (p, cell) => ({
      pos: netToWorld(
        netPoint(cell === undefined ? root : (placements[t.facet(cell).index] as NetPlacement), p),
      ),
      scale: 1,
    }),
  };
}

export function placerFor(topology: Topology, opts: SceneOptions = {}): Placer {
  if (!(topology instanceof TesseractSurface)) return cubicPlacer(topology);
  return opts.net
    ? netPlacer(topology)
    : tesseractPlacer(topology, opts.planes4 ?? DEFAULT_PLANES4);
}

/** The view a space and its options give. */
export function viewModeOf(topology: Topology, opts: SceneOptions = {}): ViewMode {
  if (topology instanceof TesseractSurface) return opts.net ? 'net' : 'schlegel';
  if (topology instanceof CubicQuotient && topology.wrapped && (opts.ghosts ?? 'off') !== 'off') {
    return 'cover';
  }
  return 'cube';
}

const add = (a: readonly number[], b: readonly number[], k: number) =>
  a.map((v, i) => v + k * (b[i] as number));

const same = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);

/** Where a drawn path is cut: the two cells and the scene points on either side of the cut. */
export interface PathBreak {
  readonly from: CellId;
  readonly to: CellId;
  readonly out: Vec3;
  readonly into: Vec3;
}

const near3 = (a: Vec3, b: Vec3) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;

/**
 * The scene segments of one step from a to b: a → a + d/2 and b − d′/2 → b, where d′ is the
 * direction on arrival. When the two half-steps meet in the scene (straight on, or bending on a
 * tesseract ridge, or across a face the net keeps together) the step is one piece; when they do
 * not (a seam of a wrapped space, a face the net cuts) it is two, and `broken` is set.
 */
function stepSegments(
  placer: Placer,
  a: CellId,
  b: CellId,
  d: readonly number[],
  arrive: readonly number[],
): { segments: Segment[]; broken: boolean; out: Vec3; into: Vec3 } {
  const ca = placer.centre(a);
  const cb = placer.centre(b);
  const pa = placer.place(ca, a).pos;
  const pb = placer.place(cb, b).pos;
  const outM = add(ca, d, 0.5);
  const out = placer.place(outM, a).pos;
  const into = placer.place(add(cb, arrive, -0.5), b).pos;
  if (near3(out, into)) {
    // One piece; keep the meeting point only where the line bends (a tesseract ridge).
    const bends = !same(add(ca, d, 1), cb);
    return {
      segments: bends
        ? [
            [pa, out],
            [out, pb],
          ]
        : [[pa, pb]],
      broken: false,
      out,
      into,
    };
  }
  return {
    segments: [
      [pa, out],
      [into, pb],
    ],
    broken: true,
    out,
    into,
  };
}

/**
 * The scene paths of a line through `cells` (consecutive cells one step apart). Each step is
 * drawn by {@link stepSegments}; a broken step starts a new piece.
 *
 * With `ends`, the path also runs half a step past the first and last cells, to their far faces,
 * so the line reads as a line and not just as the gaps between its marks. `breaks` collects the
 * cuts (the net tags them).
 */
export function linePaths(
  topology: Topology,
  placer: Placer,
  cells: readonly CellId[],
  { ends = false, breaks }: { ends?: boolean; breaks?: PathBreak[] } = {},
): Vec3[][] {
  const paths: Vec3[][] = [];
  if (cells.length === 0) return paths;
  const at = (p: readonly number[], cell: CellId) => placer.place(p, cell).pos;
  const first = cells[0] as CellId;
  let current: Vec3[] = [at(placer.centre(first), first)];
  if (ends && cells.length > 1) {
    const second = cells[1] as CellId;
    const exit = stepTo(topology, first, second, placer.centre(first), placer.centre(second));
    if (exit !== null) current.unshift(at(add(placer.centre(first), exit.d, -0.5), first));
  }
  let arrive: readonly number[] | null = null;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1] as CellId;
    const b = cells[i] as CellId;
    const exit = stepTo(topology, a, b, placer.centre(a), placer.centre(b));
    if (exit === null) {
      // Not one step apart: should not happen for a real line, but never draw nonsense.
      paths.push(current);
      current = [at(placer.centre(b), b)];
      continue;
    }
    arrive = exit.arrive;
    const step = stepSegments(placer, a, b, exit.d, exit.arrive);
    if (step.broken) {
      current.push(step.out);
      paths.push(current);
      current = [step.into, at(placer.centre(b), b)];
      breaks?.push({ from: a, to: b, out: step.out, into: step.into });
    } else {
      for (const [, q] of step.segments) current.push(q);
    }
  }
  const last = cells[cells.length - 1] as CellId;
  if (ends && arrive !== null) current.push(at(add(placer.centre(last), arrive, 0.5), last));
  paths.push(current);
  return paths;
}

/**
 * The direction that steps from a to b, and the direction on arrival. A direction that needs no
 * seam (b = a + d in the model frame) is preferred, so small boards where b is reachable both
 * ways still draw the short way.
 */
function stepTo(
  topology: Topology,
  a: CellId,
  b: CellId,
  ca: readonly number[],
  cb: readonly number[],
): { d: readonly number[]; arrive: readonly number[] } | null {
  let found: { d: readonly number[]; arrive: readonly number[] } | null = null;
  for (const d of topology.localDirections(a)) {
    const r = topology.step(a, d);
    if (r === null || r.cell !== b) continue;
    if (same(add(ca, d, 1), cb)) return { d, arrive: r.dir };
    found ??= { d, arrive: r.dir };
  }
  return found;
}

/** Grid lines of an N³ block, as segments along each axis, in a model frame of `dim` axes. */
function gridSegments(
  n: number,
  axes: readonly [number, number, number],
  base: readonly number[],
): [number[], number[]][] {
  const h = n / 2;
  const out: [number[], number[]][] = [];
  for (let k = 0; k < 3; k++) {
    const along = axes[k] as number;
    const u = axes[(k + 1) % 3] as number;
    const v = axes[(k + 2) % 3] as number;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = [...base];
        p[u] = i - h;
        p[v] = j - h;
        const q = [...p];
        p[along] = -h;
        q[along] = h;
        out.push([p, q]);
      }
    }
  }
  return out;
}

function flatten(segments: readonly (readonly [Vec3, Vec3])[]): Float32Array {
  const out = new Float32Array(segments.length * 6);
  segments.forEach(([a, b], i) => out.set([...a, ...b], i * 6));
  return out;
}

function boundsOf(points: Float32Array): Bounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = points[i + k] as number;
      min[k] = Math.min(min[k] as number, v);
      max[k] = Math.max(max[k] as number, v);
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** The free axes of a tesseract facet with fixed axis `axis`. */
const freeOf = (axis: number) => [0, 1, 2, 3].filter((k) => k !== axis) as [number, number, number];

/** A facet's grid in the 4D model frame (one N³ block on its hyperplane). */
function facetGrid(n: number, facet: number): [number[], number[]][] {
  const base = [0, 0, 0, 0];
  base[facet >> 1] = facet & 1 ? n / 2 : -n / 2;
  return gridSegments(n, freeOf(facet >> 1), base);
}

/** A facet's 12 edges in the 4D model frame. */
function facetEdges(n: number, facet: number): [number[], number[]][] {
  const h = n / 2;
  return facetGrid(n, facet).filter(([p]) =>
    p.every((v, k) => k === facet >> 1 || Math.abs(Math.abs(v) - h) < 1e-9),
  );
}

/** The wire grid and heavy outline of a space, as scene segments. */
function frame(
  topology: Topology,
  placer: Placer,
  mode: ViewMode,
  opts: SceneOptions,
): { wires: Float32Array; outline: Float32Array; selected: Float32Array | null } {
  const n = topology.n;
  const h = n / 2;
  const n3 = n * n * n;
  const placeIn =
    (cell: CellId) =>
    ([a, b]: readonly [readonly number[], readonly number[]]): [Vec3, Vec3] => [
      placer.place(a, cell).pos,
      placer.place(b, cell).pos,
    ];
  if (topology instanceof TesseractSurface) {
    // A cell of each facet, so the net places the facet's points in that facet's cube.
    const facetCell = (f: number) => f * n3;
    const shown = [...new Set([opts.facet ?? null, opts.hoverFacet ?? null])].filter(
      (f): f is number => f !== null,
    );
    const wires = shown.flatMap((f) => facetGrid(n, f).map(placeIn(facetCell(f))));
    const sel = opts.facet ?? null;
    const selected = sel === null ? null : flatten(facetEdges(n, sel).map(placeIn(facetCell(sel))));
    if (mode === 'net') {
      // Each cube's 12 edges: every one is a hypercube edge, where lines stop.
      const outline: [Vec3, Vec3][] = [];
      for (let f = 0; f < 8; f++) outline.push(...facetEdges(n, f).map(placeIn(facetCell(f))));
      return { wires: flatten(wires), outline: flatten(outline), selected };
    }
    // Every grid at once hides the picture, so only the chosen and the hovered cube get one.
    return {
      wires: flatten(wires),
      outline: flatten(hypercubeEdges4(n).map(placeIn(0))),
      selected,
    };
  }
  const wires = gridSegments(n, [0, 1, 2], [0, 0, 0]);
  // The 12 edges of the cube are the grid lines that start at a corner.
  const outline = wires.filter(([p]) => p.every((v) => Math.abs(Math.abs(v) - h) < 1e-9));
  return {
    wires: flatten(wires.map(placeIn(0))),
    outline: flatten(outline.map(placeIn(0))),
    selected: null,
  };
}

/** A box of the engine frame in the scene (`toWorld` maps boxes to boxes). */
function worldBox(b: Box3): Bounds {
  return {
    min: [b.min[0], b.min[2], 0 - b.max[1]],
    max: [b.max[0], b.max[2], 0 - b.min[1]],
  };
}

const boxCorners = (b: Bounds): Vec3[] => {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push([(i & 1 ? b.max : b.min)[0], (i & 2 ? b.max : b.min)[1], (i & 4 ? b.max : b.min)[2]]);
  }
  return out;
};

/** The 12 edges of the unit-scaled cube block at a cover offset, in the scene. */
function blockEdges(n: number, offset: Offset): [Vec3, Vec3][] {
  const h = n / 2;
  const out: [Vec3, Vec3][] = [];
  for (const [p, q] of gridSegments(n, [0, 1, 2], [0, 0, 0])) {
    if (!p.every((v) => Math.abs(Math.abs(v) - h) < 1e-9)) continue;
    const shift = (v: number[]) => v.map((x, k) => x + n * (offset[k] as number));
    out.push([toWorld(shift(p)), toWorld(shift(q))]);
  }
  return out;
}

/**
 * The tracer's walk in a cubic space, as model-frame segments per step. The walk is drawn
 * straight in the cover for as long as it stays in the *window*: the fundamental cube, plus
 * the half of each shown ghost copy next to it. When it would leave the window, it re-enters
 * the fundamental cube at the same cell and goes on straight from there. So every piece runs
 * straight through the seam into a ghost copy, and the whole walk stays in view. With no
 * ghosts the window is the cube itself: exactly the seam-broken path of the 2D board's halos.
 */
function cubicTraceSteps(
  topology: CubicQuotient,
  cells: readonly CellId[],
  dirs: readonly Dir[],
  shown: ReadonlySet<string>,
): { steps: Segment[][]; stops: Vec3[] } {
  const n = topology.n;
  const reach = n / 2 + (shown.size > 1 ? n / 2 : 0);
  const inShown = (p: Vec3) =>
    shown.has(blockOf(n, p).join()) && p.every((v) => Math.abs(v) <= reach + 1e-9);
  const first = cells[0] as CellId;
  let p = cubicCentre(topology, first);
  let d = dirs[0] as Dir;
  const stops: Vec3[] = [p];
  const steps: Segment[][] = [];
  const plus = (a: Vec3, v: readonly number[], k: number): Vec3 => [
    a[0] + k * (v[0] as number),
    a[1] + k * (v[1] as number),
    a[2] + k * (v[2] as number),
  ];
  for (let i = 1; i < cells.length; i++) {
    const next = plus(p, d, 1);
    if (inShown(next)) {
      steps.push([[toWorld(p), toWorld(next)]]);
      p = next;
    } else {
      const local = dirs[i] as Dir;
      const q = cubicCentre(topology, cells[i] as CellId);
      steps.push([
        [toWorld(p), toWorld(plus(p, d, 0.5))],
        [toWorld(plus(q, local, -0.5)), toWorld(q)],
      ]);
      p = q;
      d = local;
    }
    stops.push(p);
  }
  return { steps, stops: stops.map(toWorld) };
}

/**
 * The corners of every tesseract cell as indices into the distinct 4D lattice points they use
 * (neighbouring cells share corners), so each point is projected once per frame: at N = 4 that
 * is 544 points instead of 4096 corners. Built once per topology.
 */
const cornerTables = new WeakMap<
  TesseractSurface,
  { readonly points: readonly Vec4[]; readonly index: Int32Array }
>();

function cornerTable(t: TesseractSurface): { points: readonly Vec4[]; index: Int32Array } {
  const cached = cornerTables.get(t);
  if (cached !== undefined) return cached;
  const h = t.n / 2;
  const slots = new Map<number, number>();
  const points: Vec4[] = [];
  const index = new Int32Array(t.cellCount * 8);
  for (let c = 0; c < t.cellCount; c++) {
    cellCorners4(t, c).forEach((p, i) => {
      // Corner coordinates are integers once shifted by h, in 0..N.
      const key = p.reduce((k, v) => k * (t.n + 1) + (v + h), 0);
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = points.length;
        slots.set(key, slot);
        points.push(p);
      }
      index[c * 8 + i] = slot;
    });
  }
  const table = { points, index };
  cornerTables.set(t, table);
  return table;
}

/**
 * The 8 corners of every tesseract cell, in `cellCorners4` order: in R⁴ after the rotation R
 * (`corners4`), and projected into the scene (`corners`, the same arithmetic as
 * `project4to3`). Each lattice point is rotated and projected once.
 */
export function projectedCorners(
  t: TesseractSurface,
  R: Mat4,
  cameraW: number,
): { corners: Vec3[][]; corners4: Vec4[][] } {
  const { points, index } = cornerTable(t);
  const rot = points.map((p) => apply4(R, p));
  const at = rot.map(([x, y, z, w]) => {
    const scale = cameraW / (cameraW - w);
    return toWorld([x * scale, y * scale, z * scale]);
  });
  const corners: Vec3[][] = [];
  const corners4: Vec4[][] = [];
  for (let c = 0; c < t.cellCount; c++) {
    const scene: Vec3[] = [];
    const four: Vec4[] = [];
    for (let i = 0; i < 8; i++) {
      const slot = index[c * 8 + i] as number;
      scene.push(at[slot] as Vec3);
      four.push(rot[slot] as Vec4);
    }
    corners.push(scene);
    corners4.push(four);
  }
  return { corners, corners4 };
}

/** Build the 3D board of a node. */
export function buildSceneModel(input: SceneInput, opts: SceneOptions = {}): SceneModel {
  const { topology, board } = input;
  const mode = viewModeOf(topology, opts);
  const placer = placerFor(topology, opts);
  const schlegel = mode === 'schlegel' ? (placer.schlegel ?? null) : null;
  const shapes =
    schlegel === null
      ? null
      : projectedCorners(topology as TesseractSurface, schlegel.R, schlegel.cameraW);
  const cells: Placement[] = [];
  for (let c = 0; c < topology.cellCount; c++) {
    const { pos, scale } = placer.place(placer.centre(c), c);
    const corners = shapes?.corners[c];
    const corners4 = shapes?.corners4[c];
    cells.push(
      corners === undefined || corners4 === undefined
        ? { cell: c, pos, size: scale }
        : { cell: c, pos, size: scale, corners, corners4 },
    );
  }
  const marks: MarkInstance[] = [];
  for (let c = 0; c < topology.cellCount; c++) {
    const v = board[c] ?? 0;
    if (v === 0) continue;
    const at = cells[c] as Placement;
    marks.push({ ...at, player: (v - 1) as Player, received: input.received.has(c) });
  }
  const tags: SceneTag[] = [];
  const ridges = mode === 'net' ? netRidges(topology.n) : [];
  const tesseract = topology instanceof TesseractSurface ? topology : null;
  const facetOf = (c: CellId) => (tesseract === null ? 0 : tesseract.facet(c).index);

  let win: SceneModel['win'] = null;
  if (input.win !== null) {
    const points = input.win.cells.map((c) => (cells[c] as Placement).pos);
    let paths: Vec3[][];
    if (mode === 'cover') {
      // Straight in the cover: out of the fundamental cube and on into a ghost copy.
      const cover = lineCoverPath(topology as CubicQuotient, input.win.cells);
      const p0 = cover[0] as Vec3;
      const pl = cover[cover.length - 1] as Vec3;
      const d =
        cover.length > 1 ? (cover[1] as Vec3).map((v, k) => v - (p0[k] as number)) : [0, 0, 0];
      paths = [[add(p0, d, -0.5), ...cover, add(pl, d, 0.5)].map((p) => toWorld(p))];
    } else {
      const breaks: PathBreak[] = [];
      paths = linePaths(topology, placer, input.win.cells, { ends: true, breaks });
      if (mode === 'net') {
        breaks.forEach((b, i) => {
          const tag = ridgeOf(ridges, facetOf(b.from), facetOf(b.to))?.tag ?? String(i + 1);
          tags.push(
            { text: tag, pos: b.out, kind: 'line' },
            { text: tag, pos: b.into, kind: 'line' },
          );
        });
      }
    }
    win = { player: input.win.player, points, paths };
  }

  const { wires, outline, selected } = frame(topology, placer, mode, opts);
  const bounds = boundsOf(outline.length > 0 ? outline : wires);

  let ghosts: SceneModel['ghosts'] = null;
  let landmark: SceneModel['landmark'] = [];
  const shownBlocks = new Set(['0,0,0']);
  let fitPoints: Vec3[] = boxCorners(bounds);
  if (mode === 'cover') {
    const t = topology as CubicQuotient;
    const range = opts.ghosts as GhostRange;
    const offsets = ghostOffsets(range);
    for (const o of offsets) shownBlocks.add(o.join());
    const gcells = ghostInstances(t, range).map((g) => ({
      cell: g.cell,
      pos: toWorld(g.pos),
      size: 1,
    }));
    const gmarks: MarkInstance[] = [];
    for (const g of gcells) {
      const v = board[g.cell] ?? 0;
      if (v !== 0)
        gmarks.push({ ...g, player: (v - 1) as Player, received: input.received.has(g.cell) });
    }
    ghosts = {
      offsets,
      cells: gcells,
      marks: gmarks,
      outlines: flatten(offsets.flatMap((o) => blockEdges(t.n, o))),
    };
    landmark = landmarkCopies(t, range).map((c) => ({
      offset: c.offset,
      boxes: c.boxes.map(worldBox),
    }));
    // Frame the fundamental cube with half a copy above and below (the tracer's window) and
    // the F of the copies above and below; the side copies may run out of the view.
    const h = topology.n / 2;
    fitPoints = [
      ...boxCorners({ min: [-h, -2 * h, -h], max: [h, 2 * h, h] }),
      ...landmark
        .filter((c) => c.offset[0] === 0 && c.offset[1] === 0 && c.offset[2] !== 0)
        .flatMap((c) => c.boxes.flatMap(boxCorners)),
    ];
  } else if (mode === 'schlegel') {
    // A ball that holds the diagram in every 4D orientation, sampled on 26 directions.
    const r = schlegelRadius(topology.n);
    fitPoints = [];
    for (let i = 0; i < 27; i++) {
      const v = [(i % 3) - 1, (Math.floor(i / 3) % 3) - 1, Math.floor(i / 9) - 1];
      const l = Math.hypot(...v);
      if (l > 0) fitPoints.push(v.map((x) => (x / l) * r) as unknown as Vec3);
    }
  }

  if (mode === 'net') {
    fitPoints = [];
    for (let f = 0; f < 8; f++) {
      fitPoints.push(
        ...facetEdges(topology.n, f).flatMap(([a, b]) => [
          placer.place(a, f * topology.n ** 3).pos,
          placer.place(b, f * topology.n ** 3).pos,
        ]),
      );
    }
    for (const r of ridges) {
      if (r.tag === null) continue;
      r.centres.forEach((c, i) => {
        const inward = r.inward[i] as Vec3;
        tags.push({ text: r.tag as string, pos: netToWorld(add(c, inward, 0.35)), kind: 'ridge' });
      });
    }
  }

  let trace: SceneModel['trace'] = null;
  if (opts.trace && opts.trace.cells.length > 0) {
    const tc = opts.trace.cells;
    if (topology instanceof CubicQuotient) {
      const { steps, stops } = cubicTraceSteps(topology, tc, opts.trace.dirs, shownBlocks);
      trace = {
        cells: tc,
        steps,
        stops: stops.map((pos, i) => ({ cell: tc[i] as CellId, pos, size: 1 })),
      };
    } else {
      const steps: Segment[][] = [];
      for (let i = 1; i < tc.length; i++) {
        const a = tc[i - 1] as CellId;
        const b = tc[i] as CellId;
        const d = opts.trace.dirs[i - 1] as Dir;
        steps.push(stepSegments(placer, a, b, d, opts.trace.dirs[i] as Dir).segments);
      }
      trace = { cells: tc, steps, stops: tc.map((c) => cells[c] as Placement) };
    }
  }

  return {
    key: `${topology.id}/${topology.n}/${mode}${mode === 'cover' ? `/${opts.ghosts}` : ''}`,
    mode,
    n: topology.n,
    cameraW: schlegel?.cameraW ?? null,
    cells,
    wires,
    outline,
    marks,
    lastMove: input.lastMove === null ? null : (cells[input.lastMove] ?? null),
    win,
    threats: input.threats.map((t) => ({ ...(cells[t.cell] as Placement), player: t.player })),
    bounds,
    fitPoints,
    ghosts,
    landmark,
    selectedOutline: selected,
    tags,
    trace,
  };
}
