/**
 * The tesseract surface: the 3D boundary of the 4D hypercube [0,N]⁴, cut into 8·N³ unit cubes.
 *
 * ## Structure
 *
 * The boundary of a tesseract consists of 8 cubic *facets*, one for each choice of a fixed axis
 * a ∈ {0,1,2,3} and a side s ∈ {0: the face x_a = 0, 1: the face x_a = N}. Facet index f = 2a + s.
 * Topologically the surface is a 3-sphere S³. Its lower-dimensional pieces are:
 *
 * - **ridges**: 2D squares, each shared by exactly **2** facets;
 * - **edges**: 1D segments, each shared by **3** facets;
 * - **vertices**: points shared by 4 facets.
 *
 * ## Curvature lives on the edges
 *
 * Inside a facet the surface is a flat Euclidean cube. Across a ridge it is still flat: two
 * cubes glued along a square form a perfectly ordinary piece of 3-space once you *unfold* the
 * second cube about the shared square into the hyperplane of the first. That unfolding is an
 * isometry, so a straight line just keeps going; folded back into R⁴ it turns by 90°, because
 * the two facet hyperplanes meet at a right angle.
 *
 * Around an edge, however, only 3 cubes meet, each contributing a 90° dihedral angle: the total
 * cone angle is 270° instead of 360°. That 90° *angle deficit* is positive curvature concentrated
 * on the edge (the 3D analogue of a cube's corner, where 3 squares leave a 90° gap). There is no
 * consistent way to continue a straight line through a cone singularity, so any step that would
 * pass through an edge, or through a vertex, is **blocked** (`null`). Straight lines that avoid
 * the edges close up after 4N cells, and initially parallel lines converge, as on a sphere.
 *
 * ## Coordinates and stepping
 *
 * A cell of facet (a, s) has three *free* coordinates in [0, N). Its 4D lattice coordinates put
 * the fixed coordinate at −1 (s = 0) or N (s = 1): think of the unit cubes stacked just outside
 * each face of [0, N)⁴. Directions are 4D vectors with d[a] = 0.
 *
 * To step, add d to the free coordinates.
 * - None leaves [0, N): stay on the facet.
 * - Exactly one free axis b leaves (crossing a ridge): move to facet (b, overflow side). The old
 *   fixed axis becomes free with value (s ? N−1 : 0), and the direction rotates by 90° in the
 *   (a, b) plane: the component along b (now the normal) becomes the component along a, pointing
 *   into the new facet: d[a] = (s ? −1 : +1), d[b] = 0.
 * - Two or more leave: the step would cross an edge or a vertex, so it is blocked.
 */
import { DIRECTIONS_3D, dir4, isUnitDir } from './directions';
import { assertCell, assertSize } from './math';
import type { CellId, Dir, Layout2D, StepResult, Topology } from './types';

/** The free axes of a facet with fixed axis `a`, in increasing order. */
const FREE_AXES: readonly (readonly [number, number, number])[] = [
  [1, 2, 3],
  [0, 2, 3],
  [0, 1, 3],
  [0, 1, 2],
];

/** The 26 local directions of a cell whose facet has fixed axis `a`. */
const DIRECTIONS_BY_AXIS: readonly (readonly Dir[])[] = FREE_AXES.map((free) =>
  Object.freeze(
    DIRECTIONS_3D.map((d3) => {
      const v = [0, 0, 0, 0];
      free.forEach((axis, i) => (v[axis] = d3[i] as number));
      return dir4(v[0] as number, v[1] as number, v[2] as number, v[3] as number);
    }),
  ),
);

/** Facet identity of a cell. */
export interface Facet {
  /** Facet index f = 2·axis + side, in [0, 8). */
  readonly index: number;
  /** The fixed axis a ∈ {0, 1, 2, 3}. */
  readonly axis: number;
  /** 0 for the face x_a = 0, 1 for the face x_a = N. */
  readonly side: 0 | 1;
}

/**
 * The boundary of the tesseract, with N×N×N cells per facet.
 *
 * Cells are facet-major: cell = f·N³ + local, where local = q[f0] + N·(q[f1] + N·q[f2]) for the
 * facet's free axes f0 < f1 < f2.
 */
export class TesseractSurface implements Topology {
  readonly id = 'tesseract' as const;
  readonly n: number;
  readonly cellCount: number;
  readonly dim = 4 as const;
  readonly panelCount: number;
  private readonly n3: number;
  /** Scratch buffer for `step`, so stepping allocates only its result. */
  private readonly q = new Int32Array(4);

  constructor(n: number) {
    assertSize(n, 1);
    this.n = n;
    this.n3 = n * n * n;
    this.cellCount = 8 * this.n3;
    this.panelCount = 8 * n;
  }

  facet(c: CellId): Facet {
    assertCell(c, this.cellCount);
    const index = Math.floor(c / this.n3);
    return { index, axis: index >> 1, side: (index & 1) as 0 | 1 };
  }

  localDirections(c: CellId): readonly Dir[] {
    return DIRECTIONS_BY_AXIS[this.facet(c).axis] as readonly Dir[];
  }

  step(c: CellId, d: Dir): StepResult | null {
    assertCell(c, this.cellCount);
    const f = Math.floor(c / this.n3);
    const a = f >> 1;
    const s = f & 1;
    if (d.length !== 4 || d[a] !== 0 || !isUnitDir(d)) {
      throw new RangeError(`Direction (${d.join(', ')}) is not tangent to facet ${f}.`);
    }
    const n = this.n;
    const q = this.q;
    this.writeCoords(c, f, a, q);
    let overflowAxis = -1;
    let overflowCount = 0;
    for (const k of FREE_AXES[a] as readonly number[]) {
      q[k] = (q[k] as number) + (d[k] as number);
      if ((q[k] as number) < 0 || (q[k] as number) >= n) {
        overflowAxis = k;
        overflowCount++;
      }
    }
    const [d0, d1, d2, d3] = d as unknown as readonly [number, number, number, number];
    if (overflowCount === 0) {
      return { cell: f * this.n3 + this.localIndex(a, q), dir: dir4(d0, d1, d2, d3) };
    }
    if (overflowCount > 1) return null; // through an edge (3 facets) or a vertex: blocked
    // Ridge crossing: unfold onto the neighboring facet (b, side of the overflow).
    const b = overflowAxis;
    const nb = (q[b] as number) >= n ? 1 : 0;
    q[a] = s ? n - 1 : 0;
    const nd = [d0, d1, d2, d3];
    nd[a] = s ? -1 : 1;
    nd[b] = 0;
    return {
      cell: (2 * b + nb) * this.n3 + this.localIndex(b, q),
      dir: dir4(nd[0] as number, nd[1] as number, nd[2] as number, nd[3] as number),
    };
  }

  /** 4D lattice coordinates: free coordinates in [0, N), the fixed one at −1 or N. */
  coords(c: CellId): readonly number[] {
    const { index: f, axis: a } = this.facet(c);
    const q = [0, 0, 0, 0];
    this.writeCoords(c, f, a, q);
    return q;
  }

  cellAt(coords: readonly number[]): CellId {
    const n = this.n;
    const fixed = coords.flatMap((v, k) => (v === -1 || v === n ? [k] : []));
    const a = fixed[0];
    const valid =
      coords.length === 4 &&
      a !== undefined &&
      fixed.length === 1 &&
      coords.every((v, k) => k === a || (Number.isInteger(v) && v >= 0 && v < n));
    if (!valid) throw new RangeError(`No cell at (${coords.join(', ')}).`);
    const f = 2 * a + (coords[a] === n ? 1 : 0);
    return f * this.n3 + this.localIndex(a, coords);
  }

  /** Slice view: panel = f·N + q[f2], row = q[f1], col = q[f0]. */
  layout2D(c: CellId): Layout2D {
    const { index: f } = this.facet(c);
    const n = this.n;
    const local = c - f * this.n3;
    return {
      panel: f * n + Math.floor(local / (n * n)),
      row: Math.floor(local / n) % n,
      col: local % n,
    };
  }

  private localIndex(a: number, q: ArrayLike<number>): number {
    const [f0, f1, f2] = FREE_AXES[a] as readonly [number, number, number];
    const n = this.n;
    return (q[f0] as number) + n * ((q[f1] as number) + n * (q[f2] as number));
  }

  private writeCoords(c: CellId, f: number, a: number, out: { [k: number]: number }): void {
    const [f0, f1, f2] = FREE_AXES[a] as readonly [number, number, number];
    const n = this.n;
    const local = c - f * this.n3;
    out[a] = f & 1 ? n : -1;
    out[f0] = local % n;
    out[f1] = Math.floor(local / n) % n;
    out[f2] = Math.floor(local / (n * n));
  }
}
