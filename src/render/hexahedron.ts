/**
 * A cell of the tesseract seen in the Schlegel diagram is no cube: the 4D rotation and the
 * perspective projection turn it into a general hexahedron (a skewed frustum). It is given by
 * its 8 corners in the order of `cellCorners4`: corner i is on the + side of the k-th free axis
 * when bit k of i is set. Its faces are still planar (a central projection maps planes to
 * planes) and it stays convex, so it is drawn and picked as 6 quads.
 *
 * Pure (no three.js), so the face table and the shrunken pick shape are tested in node.
 */
import type { Vec3 } from './four';

/** Triangles per hexahedron (6 quads, 2 each): the face → hexahedron map is `face / 12`. */
export const HEX_TRIANGLES = 12;

/**
 * The 6 faces as cyclic corner quadruples (consecutive corners share an edge). Face 2k holds
 * the corners with bit k clear, face 2k + 1 those with bit k set. Each is counter-clockwise seen
 * from outside when bits 0, 1, 2 point along a right-handed frame.
 */
export const HEX_FACES: readonly (readonly [number, number, number, number])[] = [
  [0, 4, 6, 2],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 2, 3, 1],
  [4, 5, 7, 6],
];

/** The 12 edges: pairs of corners that differ in one bit. */
export const HEX_EDGES: readonly (readonly [number, number])[] = [0, 1, 2].flatMap((k) =>
  [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !((i >> k) & 1)).map((i) => [i, i | (1 << k)] as const),
);

/**
 * The 36 triangle indices of the faces, wound outwards for a hexahedron of the given
 * orientation (see {@link hexOrientation}); `base` is added to every index.
 */
export function hexTriangles(orientation: number, base = 0): number[] {
  const out: number[] = [];
  for (const [a, b, c, d] of HEX_FACES) {
    if (orientation >= 0) out.push(a + base, b + base, c + base, a + base, c + base, d + base);
    else out.push(a + base, c + base, b + base, a + base, d + base, c + base);
  }
  return out;
}

/** The 24 line indices of the edges, `base` added to each. */
export function hexEdgeIndices(base = 0): number[] {
  return HEX_EDGES.flatMap(([a, b]) => [a + base, b + base]);
}

/**
 * +1 if the corners' frame (corner 0 → corners 1, 2, 4) is right-handed, −1 if mirrored. The
 * Schlegel projection mirrors a cell as it turns past edge-on in 4D, so this changes as the
 * tesseract turns; a convex hexahedron has the same sign at every corner.
 */
export function hexOrientation(c: ArrayLike<number>, offset = 0): number {
  const at = (i: number, k: number) =>
    (c[offset + 3 * i + k] as number) - (c[offset + k] as number);
  const u = [at(1, 0), at(1, 1), at(1, 2)];
  const v = [at(2, 0), at(2, 1), at(2, 2)];
  const w = [at(4, 0), at(4, 1), at(4, 2)];
  const det =
    (u[0] as number) * ((v[1] as number) * (w[2] as number) - (v[2] as number) * (w[1] as number)) -
    (u[1] as number) * ((v[0] as number) * (w[2] as number) - (v[2] as number) * (w[0] as number)) +
    (u[2] as number) * ((v[0] as number) * (w[1] as number) - (v[1] as number) * (w[0] as number));
  return det < 0 ? -1 : 1;
}

/**
 * Write 8 corners into `out` at vertex `vertex` (xyz each), shrunk by `factor` towards their
 * centroid. Allocation-free: it runs for every cell on every frame of a 4D turn.
 */
export function writeHex(
  corners: readonly Vec3[],
  factor: number,
  out: Float32Array,
  vertex: number,
): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < 8; i++) {
    const p = corners[i] as Vec3;
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= 8;
  cy /= 8;
  cz /= 8;
  let o = vertex * 3;
  for (let i = 0; i < 8; i++) {
    const p = corners[i] as Vec3;
    out[o++] = cx + (p[0] - cx) * factor;
    out[o++] = cy + (p[1] - cy) * factor;
    out[o++] = cz + (p[2] - cz) * factor;
  }
}
