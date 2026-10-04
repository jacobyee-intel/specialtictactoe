/**
 * Pure 4D maths for the tesseract surface: where its cells sit in R⁴, how R⁴ is rotated, and
 * the Schlegel projection down to 3D.
 *
 * The hypercube is centred at the origin with half-width N/2, so facet (a, s) is the hyperplane
 * x_a = ±N/2. A cell's lattice coordinates (`TesseractSurface.coords`) put its fixed coordinate
 * at −1 or N, just outside the face; here it is moved onto the face itself, and the free
 * coordinates are shifted by −N/2 + ½ to the centre of the unit cube.
 *
 * The projection is a perspective from a 4D eye on the +w axis: points nearer the eye (larger
 * w) come out larger. With the eye outside the near facet this is the Schlegel diagram: the near
 * cube is the big outer shell, the far cube a small cube inside, and six frusta in between.
 *
 * Stage 7 Phase A only uses the default orientation; Phase B adds the rotation controls.
 */
import type { CellId, TesseractSurface } from '@/geometry';

export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

/** A 4 × 4 matrix, row-major: `m[4 * row + col]`. */
export type Mat4 = readonly number[];

/** Rotation angles in radians, one per coordinate plane. Missing planes are 0. */
export interface Planes4 {
  readonly xw: number;
  readonly yw: number;
  readonly zw: number;
  readonly xy?: number;
  readonly xz?: number;
  readonly yz?: number;
}

/**
 * The orientation the 3D view opens with. The identity shows the textbook Schlegel diagram
 * (nested cubes joined by six frusta); Phase B lets the player turn it.
 */
export const DEFAULT_PLANES4: Planes4 = { xw: 0, yw: 0, zw: 0 };

/** The 4D eye sits on +w at this multiple of N (far enough to see the whole near facet). */
export const CAMERA_W_FACTOR = 1.6;

const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The rotation by `angle` in the plane of axes (i, j): it turns axis i towards axis j. */
function planeRotation(i: number, j: number, angle: number): Mat4 {
  const m = [...IDENTITY4];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[4 * i + i] = c;
  m[4 * j + j] = c;
  m[4 * j + i] = s;
  m[4 * i + j] = -s;
  return m;
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[4 * r + k] as number) * (b[4 * k + c] as number);
      out[4 * r + c] = sum;
    }
  }
  return out;
}

/**
 * The composed rotation R = R_xy · R_xz · R_yz · R_xw · R_yw · R_zw: the w-planes act first, so
 * the three 4D sliders of Phase B stay independent of any later 3D-plane tweak.
 */
export function rotation4(planes: Planes4): Mat4 {
  const order: [number, number, number][] = [
    [0, 1, planes.xy ?? 0],
    [0, 2, planes.xz ?? 0],
    [1, 2, planes.yz ?? 0],
    [0, 3, planes.xw],
    [1, 3, planes.yw],
    [2, 3, planes.zw],
  ];
  return order.reduce<Mat4>(
    (m, [i, j, angle]) => (angle === 0 ? m : multiply4(m, planeRotation(i, j, angle))),
    IDENTITY4,
  );
}

export function apply4(m: Mat4, p: Vec4): Vec4 {
  const row = (r: number) =>
    (m[4 * r] as number) * p[0] +
    (m[4 * r + 1] as number) * p[1] +
    (m[4 * r + 2] as number) * p[2] +
    (m[4 * r + 3] as number) * p[3];
  return [row(0), row(1), row(2), row(3)];
}

/** The centre of a tesseract cell in R⁴, on the centred hypercube of half-width N/2. */
export function cellCentre4(t: TesseractSurface, cell: CellId): Vec4 {
  const q = t.coords(cell);
  const { axis, side } = t.facet(cell);
  const h = t.n / 2;
  const p = q.map((v, k) => (k === axis ? (side === 1 ? h : -h) : v - h + 0.5));
  return p as unknown as Vec4;
}

/**
 * The 8 corners of a cell in R⁴: its 3 free coordinates at centre ± ½, the fixed one on the
 * facet hyperplane. Corner i takes the + side on the k-th free axis when bit k of i is set.
 */
export function cellCorners4(t: TesseractSurface, cell: CellId): Vec4[] {
  const c = cellCentre4(t, cell);
  const { axis } = t.facet(cell);
  const free = [0, 1, 2, 3].filter((k) => k !== axis);
  const out: Vec4[] = [];
  for (let i = 0; i < 8; i++) {
    const p = [...c];
    free.forEach((k, bit) => (p[k] = (p[k] as number) + ((i >> bit) & 1 ? 0.5 : -0.5)));
    out.push(p as unknown as Vec4);
  }
  return out;
}

/**
 * The 32 edges of the hypercube (where three cubes meet and lines are blocked), as pairs of
 * vertices in R⁴: each vertex is (±h, ±h, ±h, ±h), and an edge flips one coordinate.
 */
export function hypercubeEdges4(n: number): [Vec4, Vec4][] {
  const h = n / 2;
  const vertex = (bits: number): Vec4 =>
    [0, 1, 2, 3].map((k) => ((bits >> k) & 1 ? h : -h)) as unknown as Vec4;
  const edges: [Vec4, Vec4][] = [];
  for (let v = 0; v < 16; v++) {
    for (let k = 0; k < 4; k++) if (!((v >> k) & 1)) edges.push([vertex(v), vertex(v | (1 << k))]);
  }
  return edges;
}

/**
 * The radius of a ball that holds the projection of the whole hypercube in every orientation.
 * A vertex is at distance r = N from the centre; at angle θ from the w axis it projects at
 * c·r·sin θ / (c − r·cos θ) with c = cameraW, which is largest when cos θ = r / c, giving
 * r·c / √(c² − r²). The camera is fitted to this ball, so turning in 4D never leaves the view.
 */
export function schlegelRadius(n: number): number {
  const c = CAMERA_W_FACTOR * n;
  return (n * c) / Math.sqrt(c * c - n * n);
}

/**
 * Rotate `p` by `R`, then project it from the 4D eye at (0, 0, 0, cameraW). `scale` is the
 * perspective factor at that depth (1 for w = 0), which sizes the tracer's walker and trail.
 * Marks need more than a scale: they are built in 4D and projected vertex by vertex
 * (`marks4.ts`).
 */
export function project4to3(p: Vec4, R: Mat4, cameraW: number): { p: Vec3; scale: number } {
  const [x, y, z, w] = apply4(R, p);
  const scale = cameraW / (cameraW - w);
  return { p: [x * scale, y * scale, z * scale], scale };
}
