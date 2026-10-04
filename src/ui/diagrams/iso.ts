/**
 * Tiny orthographic (axonometric) projection helpers for the hand-drawn SVG diagrams.
 *
 * World axes are right-handed with z up. A {@link View} turns the world about z by `yaw` and
 * tilts it towards the viewer by `pitch`; the image is a proper view (never mirrored), so a
 * chiral glyph painted on a face reads correctly from the side that faces the viewer. That
 * matters here: the diagrams exist to show rotations and mirrors.
 *
 * The true isometric view ({@link ISOMETRIC}) projects all three axes at the same length and
 * 120° apart. Its drawback for a cube with hidden edges is that the hidden back corner lands
 * exactly on the front corner, so the diagrams use a nearby view that separates them.
 *
 * Screen coordinates follow SVG: x to the right, y down.
 */

export type Vec3 = readonly [number, number, number];

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** Angles in radians. */
export interface View {
  /** Rotation about z: 45° shows the x and y axes symmetrically. */
  readonly yaw: number;
  /** Elevation of the eye above the xy-plane: 0 is side-on, 90° is straight down. */
  readonly pitch: number;
}

const DEG = Math.PI / 180;

/** The classic isometric view: the eye looks down the (1, 1, 1) diagonal. */
export const ISOMETRIC: View = { yaw: 45 * DEG, pitch: Math.atan(Math.SQRT1_2) };

/** A view from angles in degrees. */
export function viewDeg(yaw: number, pitch: number): View {
  return { yaw: yaw * DEG, pitch: pitch * DEG };
}

/**
 * Project a world point. The x axis points down-left on screen, y down-right and z straight up;
 * the eye sits on the positive side of all three.
 */
export function project(p: Vec3, view: View = ISOMETRIC): Point2 {
  const [x, y, z] = p;
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const depth = x * cy + y * sy;
  return {
    x: y * cy - x * sy,
    y: depth * Math.sin(view.pitch) - z * Math.cos(view.pitch),
  };
}

/** Unit vector from the scene towards the eye; faces whose normal has a positive dot with it are visible. */
export function towardEye(view: View): Vec3 {
  const cp = Math.cos(view.pitch);
  return [Math.cos(view.yaw) * cp, Math.sin(view.yaw) * cp, Math.sin(view.pitch)];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The 8 corners of the unit cube; corner `i` has coordinates given by the bits of i (x = bit 0). */
export const CUBE_VERTICES: readonly Vec3[] = Array.from({ length: 8 }, (_, i): Vec3 => [
  i & 1,
  (i >> 1) & 1,
  (i >> 2) & 1,
]);

/** The 12 edges as pairs of corner indices (corners that differ in exactly one bit). */
export const CUBE_EDGES: readonly (readonly [number, number])[] = CUBE_VERTICES.flatMap((_, i) =>
  [1, 2, 4].filter((bit) => (i & bit) === 0).map((bit) => [i, i | bit] as const),
);

/**
 * The corner farthest from the eye. For a convex cube seen from a generic direction exactly the
 * three edges meeting there are hidden.
 */
export function backCorner(view: View): number {
  const eye = towardEye(view);
  let best = 0;
  for (let i = 1; i < 8; i++) {
    if (dot(CUBE_VERTICES[i] as Vec3, eye) < dot(CUBE_VERTICES[best] as Vec3, eye)) best = i;
  }
  return best;
}

/** True when cube edge `[a, b]` is hidden behind the cube's faces in this view. */
export function isHiddenEdge(edge: readonly [number, number], view: View): boolean {
  const back = backCorner(view);
  return edge[0] === back || edge[1] === back;
}

/** A 2D affine map in SVG `matrix(a b c d e f)` order: (u, v) ↦ (a·u + c·v + e, b·u + d·v + f). */
export type Matrix2D = readonly [number, number, number, number, number, number];

/**
 * The SVG transform that paints a flat 2D figure, drawn in a unit square with local axes u
 * (right) and v (up), onto the 3D parallelogram `origin + u·U + v·V`, as seen in `view`.
 *
 * Orthographic projection is linear, so the whole face maps by one affine matrix: the figure is
 * sheared exactly as paint on that face would be.
 */
export function faceMatrix(origin: Vec3, U: Vec3, V: Vec3, view: View): Matrix2D {
  const o = project(origin, view);
  const u = project(U, view);
  const v = project(V, view);
  return [u.x, u.y, v.x, v.y, o.x, o.y];
}

export function applyMatrix(m: Matrix2D, u: number, v: number): Point2 {
  return { x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] };
}

/** Round to a fixed number of decimals, so SVG output (and snapshots) stays short and stable. */
export function round(value: number, decimals = 2): number {
  const k = 10 ** decimals;
  const r = Math.round(value * k) / k;
  return Object.is(r, -0) ? 0 : r;
}

/** An SVG path through `points`, optionally closed. */
export function pathD(points: readonly Point2[], closed = false): string {
  const body = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
  return closed ? `${body} Z` : body;
}
