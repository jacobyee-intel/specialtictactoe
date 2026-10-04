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
 * ## Extension points (Phase B)
 *
 * - Ghost copies: add instances that reuse `cells[c]`-style placements with a source `cell`, and
 *   register them in a `PickTable` so hovering a ghost resolves to its source.
 * - 4D rotation: pass `planes4`; only the tesseract placer reads it.
 * - Straight cover lines / tracer: build more `paths` from model-frame points with the placer.
 */
import { TesseractSurface, type CellId, type Player, type Topology } from '@/geometry';
import {
  CAMERA_W_FACTOR,
  DEFAULT_PLANES4,
  cellCentre4,
  hypercubeEdges4,
  project4to3,
  rotation4,
  type Planes4,
  type Vec3,
  type Vec4,
} from './four';

export type { Vec3 };

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

export interface SceneOptions {
  /** The tesseract's 4D orientation (ignored by the cubic spaces). */
  readonly planes4?: Planes4;
}

/** A cell's place in the scene: its centre and the edge length of its (unit) box there. */
export interface Placement {
  readonly cell: CellId;
  readonly pos: Vec3;
  /** 1 in the cubic spaces; the perspective scale of the cell's depth in the tesseract. */
  readonly size: number;
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
  /** Changes only with the space or its size: the camera is refitted when it does. */
  readonly key: string;
  readonly n: number;
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
  /** Axis-aligned box around everything, for the camera fit. */
  readonly bounds: Bounds;
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
  /** A model-frame point in the scene, with the local scale there. */
  place(p: readonly number[]): { readonly pos: Vec3; readonly scale: number };
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
    centre: (cell) => cellCentre4(t, cell),
    place: (p) => {
      const { p: q, scale } = project4to3(p as unknown as Vec4, R, cameraW);
      return { pos: toWorld(q), scale };
    },
  };
}

export function placerFor(topology: Topology, opts: SceneOptions = {}): Placer {
  return topology instanceof TesseractSurface
    ? tesseractPlacer(topology, opts.planes4 ?? DEFAULT_PLANES4)
    : cubicPlacer(topology);
}

const add = (a: readonly number[], b: readonly number[], k: number) =>
  a.map((v, i) => v + k * (b[i] as number));

const same = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);

/**
 * The scene paths of a line through `cells` (consecutive cells one step apart). Each step from
 * a to b is drawn as two half-steps, a → a + d/2 and b − d′/2 → b, where d′ is the direction on
 * arrival. When the two half-steps meet, the path continues; when they do not (a seam of a
 * wrapped space), a new piece starts on the far wall.
 *
 * With `ends`, the path also runs half a step past the first and last cells, to their far faces,
 * so the line reads as a line and not just as the gaps between its marks.
 */
export function linePaths(
  topology: Topology,
  placer: Placer,
  cells: readonly CellId[],
  { ends = false }: { ends?: boolean } = {},
): Vec3[][] {
  const paths: Vec3[][] = [];
  if (cells.length === 0) return paths;
  const at = (p: readonly number[]) => placer.place(p).pos;
  const first = cells[0] as CellId;
  let current: Vec3[] = [at(placer.centre(first))];
  if (ends && cells.length > 1) {
    const second = cells[1] as CellId;
    const exit = stepTo(topology, first, second, placer.centre(first), placer.centre(second));
    if (exit !== null) current.unshift(at(add(placer.centre(first), exit.d, -0.5)));
  }
  let arrive: readonly number[] | null = null;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1] as CellId;
    const b = cells[i] as CellId;
    const ca = placer.centre(a);
    const cb = placer.centre(b);
    const exit = stepTo(topology, a, b, ca, cb);
    if (exit === null) {
      // Not one step apart: should not happen for a real line, but never draw nonsense.
      paths.push(current);
      current = [at(cb)];
      continue;
    }
    arrive = exit.arrive;
    const out = add(ca, exit.d, 0.5);
    const into = add(cb, exit.arrive, -0.5);
    if (same(out, into)) {
      // Straight on, or (tesseract) bending on the ridge: keep the meeting point if it bends.
      if (!same(add(ca, exit.d, 1), cb)) current.push(at(out));
      current.push(at(cb));
    } else {
      current.push(at(out));
      paths.push(current);
      current = [at(into), at(cb)];
    }
  }
  if (ends && arrive !== null) {
    current.push(at(add(placer.centre(cells[cells.length - 1] as CellId), arrive, 0.5)));
  }
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

/** The wire grid and heavy outline of a space, as scene segments. */
function frame(topology: Topology, placer: Placer): { wires: Float32Array; outline: Float32Array } {
  const n = topology.n;
  const h = n / 2;
  const place = ([a, b]: [readonly number[], readonly number[]]): [Vec3, Vec3] => [
    placer.place(a).pos,
    placer.place(b).pos,
  ];
  if (topology instanceof TesseractSurface) {
    const wires: [number[], number[]][] = [];
    for (let axis = 0; axis < 4; axis++) {
      const free = [0, 1, 2, 3].filter((k) => k !== axis) as [number, number, number];
      for (const side of [-h, h]) {
        const base = [0, 0, 0, 0];
        base[axis] = side;
        wires.push(...gridSegments(n, free, base));
      }
    }
    return {
      wires: flatten(wires.map(place)),
      outline: flatten(hypercubeEdges4(n).map(place)),
    };
  }
  const wires = gridSegments(n, [0, 1, 2], [0, 0, 0]);
  // The 12 edges of the cube are the grid lines that start at a corner.
  const outline = wires.filter(([p]) => p.every((v) => Math.abs(Math.abs(v) - h) < 1e-9));
  return { wires: flatten(wires.map(place)), outline: flatten(outline.map(place)) };
}

/** Build the 3D board of a node. */
export function buildSceneModel(input: SceneInput, opts: SceneOptions = {}): SceneModel {
  const { topology, board } = input;
  const placer = placerFor(topology, opts);
  const cells: Placement[] = [];
  for (let c = 0; c < topology.cellCount; c++) {
    const { pos, scale } = placer.place(placer.centre(c));
    cells.push({ cell: c, pos, size: scale });
  }
  const marks: MarkInstance[] = [];
  for (let c = 0; c < topology.cellCount; c++) {
    const v = board[c] ?? 0;
    if (v === 0) continue;
    const at = cells[c] as Placement;
    marks.push({ ...at, player: (v - 1) as Player, received: input.received.has(c) });
  }
  const win =
    input.win === null
      ? null
      : {
          player: input.win.player,
          points: input.win.cells.map((c) => (cells[c] as Placement).pos),
          paths: linePaths(topology, placer, input.win.cells, { ends: true }),
        };
  const { wires, outline } = frame(topology, placer);
  return {
    key: `${topology.id}/${topology.n}`,
    n: topology.n,
    cells,
    wires,
    outline,
    marks,
    lastMove: input.lastMove === null ? null : (cells[input.lastMove] ?? null),
    win,
    threats: input.threats.map((t) => ({ ...(cells[t.cell] as Placement), player: t.player })),
    bounds: boundsOf(outline.length > 0 ? outline : wires),
  };
}
