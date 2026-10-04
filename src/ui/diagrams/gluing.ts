/**
 * How the faces of the fundamental cube are glued, as drawing data for {@link SpaceDiagram}.
 *
 * The diagram paints the same chiral arrow on both faces of each glued pair. A face is given by
 * a frame: the unit square (u, v) ↦ origin + u·U + v·V. Two faces are glued exactly when the
 * gluing map carries one frame onto the other, so matching arrows *are* the gluing.
 *
 * - x and y pairs: a plain translation in every wrapped space, so both frames are the same
 *   frame shifted by one unit.
 * - z pair: the point (x, y, 1) on the top is the point (G(x, y), 0) on the bottom (see
 *   `src/geometry/cubic.ts`, scaled to the unit cube). The bottom arrow is drawn upright and the
 *   top arrow is G⁻¹ of it: identical for the 3-torus, a quarter turn for the tetracosm, and a
 *   mirror image for the amphicosm.
 *
 * The visible face of each pair gets a right-handed frame (U × V = outward normal), so its arrow
 * reads unmirrored from outside; `gluing.test.ts` checks all of this against the geometry.
 */
import type { CubicTopologyId } from '@/geometry';
import type { Vec3 } from './iso';

export interface FaceFrame {
  readonly origin: Vec3;
  readonly U: Vec3;
  readonly V: Vec3;
}

export type GluingKind = 'straight' | 'quarterTurn' | 'mirror';

export interface GluedPair {
  /** Letter that matches the two faces by eye. */
  readonly letter: 'a' | 'b' | 'c';
  readonly axis: 'x' | 'y' | 'z';
  readonly kind: GluingKind;
  /** The face at coordinate 0 (hidden behind the cube; drawn pulled out). */
  readonly near: FaceFrame;
  /** The face at coordinate 1 (visible from the diagram's viewpoint). */
  readonly far: FaceFrame;
}

export const GLUING_CAPTION: Readonly<Record<GluingKind, string>> = {
  straight: 'straight across',
  quarterTurn: 'quarter turn',
  mirror: 'mirror',
};

/** A planar affine map on the unit square, (x, y) ↦ (a·x + b·y + e, c·x + d·y + f). */
type Plane = readonly [number, number, number, number, number, number];

/**
 * G⁻¹ for each wrapped space, on the unit square. G is the z-gluing of `cubic.ts`:
 * tetracosm (x, y) ↦ (1 − y, x), amphicosm (x, y) ↦ (1 − x, y).
 */
const Z_INVERSE: Readonly<Record<Exclude<CubicTopologyId, 'flat'>, Plane>> = {
  torus3: [1, 0, 0, 1, 0, 0],
  tetracosm: [0, 1, -1, 0, 0, 1],
  amphicosm1: [-1, 0, 0, 1, 1, 0],
};

// `+ 0` turns -0 into 0, so frames compare cleanly.
function mapPoint(g: Plane, p: Vec3, z: number): Vec3 {
  return [g[0] * p[0] + g[1] * p[1] + g[4] + 0, g[2] * p[0] + g[3] * p[1] + g[5] + 0, z];
}

function mapVector(g: Plane, v: Vec3): Vec3 {
  return [g[0] * v[0] + g[1] * v[1] + 0, g[2] * v[0] + g[3] * v[1] + 0, 0];
}

function shifted(frame: FaceFrame, by: Vec3): FaceFrame {
  const [x, y, z] = frame.origin;
  return { ...frame, origin: [x + by[0], y + by[1], z + by[2]] };
}

/** Front-left face x = 1, arrow pointing up (U = ŷ, V = ẑ). */
const X_FAR: FaceFrame = { origin: [1, 0, 0], U: [0, 1, 0], V: [0, 0, 1] };
/** Front-right face y = 1, arrow pointing up (U = −x̂, V = ẑ). */
const Y_FAR: FaceFrame = { origin: [1, 1, 0], U: [-1, 0, 0], V: [0, 0, 1] };
/**
 * Bottom face z = 0, seen from above, arrow along −y. Pointing the arrow along the mirror line
 * of the amphicosm means its mirror image keeps the direction and only flips the hook, which
 * is the clearest way to show a reflection.
 */
const Z_NEAR: FaceFrame = { origin: [1, 1, 0], U: [-1, 0, 0], V: [0, -1, 0] };

/** The glued face pairs of a cubic space, a/b/c for x/y/z; none for the bounded flat cube. */
export function gluedPairs(id: CubicTopologyId): GluedPair[] {
  if (id === 'flat') return [];
  const g = Z_INVERSE[id];
  const zFar: FaceFrame = {
    origin: mapPoint(g, Z_NEAR.origin, 1),
    U: mapVector(g, Z_NEAR.U),
    V: mapVector(g, Z_NEAR.V),
  };
  const zKind: GluingKind =
    id === 'tetracosm' ? 'quarterTurn' : id === 'amphicosm1' ? 'mirror' : 'straight';
  return [
    { letter: 'a', axis: 'x', kind: 'straight', near: shifted(X_FAR, [-1, 0, 0]), far: X_FAR },
    { letter: 'b', axis: 'y', kind: 'straight', near: shifted(Y_FAR, [0, -1, 0]), far: Y_FAR },
    { letter: 'c', axis: 'z', kind: zKind, near: Z_NEAR, far: zFar },
  ];
}

/**
 * The chiral arrow painted on glued faces, in face-local coordinates (unit square, v up): a
 * shaft with a solid head and a foot to the right at the tail. A rotation turns it; a mirror
 * moves the foot to the other side.
 */
export const ARROW_GLYPH: readonly (readonly [number, number])[] = [
  [0.44, 0.24],
  [0.68, 0.24],
  [0.68, 0.33],
  [0.53, 0.33],
  [0.53, 0.58],
  [0.64, 0.58],
  [0.485, 0.78],
  [0.33, 0.58],
  [0.44, 0.58],
];
