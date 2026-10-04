/**
 * The marks of the Schlegel diagram, built honestly in 4D.
 *
 * A tesseract cell is a unit cube lying in its facet's hyperplane. Its mark is built there, in
 * 4D, and then goes through exactly the same 4D rotation and Schlegel projection as the cell:
 *
 * - **P1 box:** the cell's 4D cube shrunk towards its 4D centre by {@link MARK_SIZE}. A central
 *   projection maps lines to lines and planes to planes, so its image is a skewed hexahedron
 *   with planar faces, inside the cell's own hexahedron.
 * - **P2 ball:** the 3-ball of radius MARK_SIZE / 2 about the cell's centre, inside the facet
 *   hyperplane. A unit sphere is tessellated once ({@link BALL}) and placed in the facet's 3D
 *   frame; its image is an ellipsoid (a projective map takes quadrics to quadrics).
 * - the last-move outline and the threat boxes: the cell's 4D cube shrunk by
 *   {@link LAST_MOVE_SIZE} or {@link THREAT_SIZE}, drawn as edges.
 *
 * Shrinking *after* projecting would be wrong: the projection is projective, not affine, so the
 * centroid of the projected corners is not the image of the cell's centre.
 *
 * ## Why the rotated corners are enough
 *
 * Every mark point is an affine combination of the cell's corners in 4D: p = c + Σ s_k e_k,
 * where c is the centre (the mean of the 8 corners) and e_k the cell's k-th free axis (corner
 * 2^k minus corner 0, a unit vector). The 4D rotation R is linear, so R·p = R·c + Σ s_k R·e_k:
 * rotating the 8 corners (done once per lattice point by the scene model) gives everything,
 * and only the perspective divide is done per mark vertex. The writers below take those
 * *rotated* corners. Pure and allocation-free: they run for every mark on every frame of a 4D
 * turn.
 */
import type { Vec4 } from './four';
import { hexOrientation } from './hexahedron';

/** Mark size as a fraction of the cell, as in 2D (inset 20% on each side). */
export const MARK_SIZE = 0.6;
/** The last-move outline sits just outside the mark. */
export const LAST_MOVE_SIZE = 0.76;
/** Threat boxes sit outside the last-move outline. */
export const THREAT_SIZE = 0.86;

/** A unit sphere as a triangle mesh, with a lat/long wire on the same vertices. */
export interface UnitSphere {
  /** The unit vectors, xyz each. */
  readonly vertices: Float64Array;
  readonly count: number;
  /** Triangles, wound outwards when the frame (x, y, z) is right-handed. */
  readonly triangles: readonly number[];
  /** Line pairs: three parallels (±45° and the equator) and two great circles of meridians. */
  readonly wire: readonly number[];
}

/**
 * A UV sphere with `segments` around the pole axis (z) and `rings` bands from pole to pole.
 * Vertex 0 is the +z pole, then the rings from the top, then the −z pole.
 */
export function unitSphere(segments: number, rings: number): UnitSphere {
  const count = 2 + (rings - 1) * segments;
  const vertices = new Float64Array(count * 3);
  vertices.set([0, 0, 1], 0);
  for (let j = 1; j < rings; j++) {
    const theta = (Math.PI * j) / rings;
    for (let k = 0; k < segments; k++) {
      const phi = (2 * Math.PI * k) / segments;
      const at = 3 * (1 + (j - 1) * segments + k);
      vertices[at] = Math.sin(theta) * Math.cos(phi);
      vertices[at + 1] = Math.sin(theta) * Math.sin(phi);
      vertices[at + 2] = Math.cos(theta);
    }
  }
  vertices.set([0, 0, -1], 3 * (count - 1));
  const south = count - 1;
  /** Vertex k of ring j (0 and `rings` are the poles). */
  const v = (j: number, k: number) =>
    j === 0 ? 0 : j === rings ? south : 1 + (j - 1) * segments + (k % segments);
  const triangles: number[] = [];
  for (let k = 0; k < segments; k++) {
    triangles.push(0, v(1, k), v(1, k + 1));
    for (let j = 1; j < rings - 1; j++) {
      triangles.push(v(j, k), v(j + 1, k), v(j + 1, k + 1), v(j, k), v(j + 1, k + 1), v(j, k + 1));
    }
    triangles.push(south, v(rings - 1, k + 1), v(rings - 1, k));
  }
  const wire: number[] = [];
  for (const j of [rings / 4, rings / 2, (3 * rings) / 4].map(Math.round)) {
    for (let k = 0; k < segments; k++) wire.push(v(j, k), v(j, k + 1));
  }
  for (const k of [0, 1, 2, 3].map((q) => Math.round((q * segments) / 4))) {
    for (let j = 0; j < rings; j++) wire.push(v(j, k), v(j + 1, k));
  }
  return { vertices, count, triangles, wire };
}

/**
 * The ball's tessellation: 16 × 8 (114 vertices, 224 triangles). Unlit, a ball is only its
 * outline, and a 16-gon silhouette reads as round at mark size.
 */
export const BALL: UnitSphere = unitSphere(16, 8);

/**
 * Write a triangle list into `out` at `offset`, wound outwards for a mark of the given
 * orientation (see `hexOrientation`): a mirrored image swaps two corners of every triangle.
 */
export function writeTriangles(
  triangles: readonly number[],
  orientation: number,
  base: number,
  out: Uint32Array,
  offset: number,
): void {
  const flip = orientation < 0;
  for (let i = 0; i < triangles.length; i += 3) {
    out[offset + i] = (triangles[i] as number) + base;
    out[offset + i + 1] = (triangles[i + (flip ? 2 : 1)] as number) + base;
    out[offset + i + 2] = (triangles[i + (flip ? 1 : 2)] as number) + base;
  }
}

const centre = new Float64Array(4);
const axes = new Float64Array(12);
const point = new Float64Array(4);
const scratch = new Float64Array(24);
const at = (a: Float64Array, i: number) => a[i] as number;

/** The centre of a cell (mean of its rotated corners) into `centre`. */
function findCentre(rot: readonly Vec4[]): void {
  centre.fill(0);
  for (let i = 0; i < 8; i++) {
    const p = rot[i] as Vec4;
    for (let k = 0; k < 4; k++) centre[k] = at(centre, k) + (p[k] as number) / 8;
  }
}

/**
 * Project a rotated 4D point from the eye at (0, 0, 0, cameraW) and write it in the scene frame
 * at `out[o]`: the same arithmetic as `toWorld(project4to3(p, R, cameraW).p)`.
 */
function put(
  out: Float32Array | Float64Array,
  o: number,
  x: number,
  y: number,
  z: number,
  w: number,
  cameraW: number,
): void {
  const s = cameraW / (cameraW - w);
  out[o] = x * s;
  out[o + 1] = z * s;
  out[o + 2] = 0 - y * s;
}

/**
 * The cell's 4D cube shrunk by `factor` towards its 4D centre, projected: 8 corners in
 * `cellCorners4` order, written at vertex `vertex` of `out`. `rot` are the cell's corners after
 * the 4D rotation.
 */
export function writeBox4(
  rot: readonly Vec4[],
  factor: number,
  cameraW: number,
  out: Float32Array,
  vertex: number,
): void {
  findCentre(rot);
  const cx = at(centre, 0);
  const cy = at(centre, 1);
  const cz = at(centre, 2);
  const cw = at(centre, 3);
  for (let i = 0; i < 8; i++) {
    const p = rot[i] as Vec4;
    put(
      out,
      (vertex + i) * 3,
      cx + factor * (p[0] - cx),
      cy + factor * (p[1] - cy),
      cz + factor * (p[2] - cz),
      cw + factor * (p[3] - cw),
      cameraW,
    );
  }
}

/**
 * The ball of `radius` about the cell's 4D centre, in its facet's hyperplane, projected: one
 * vertex per vertex of `sphere`, written from vertex `vertex` of `out`. Sphere axis k runs along
 * the cell's k-th free axis (corner 2^k minus corner 0), the frame of `cellCorners4`.
 */
export function writeBall4(
  rot: readonly Vec4[],
  radius: number,
  cameraW: number,
  sphere: UnitSphere,
  out: Float32Array,
  vertex: number,
): void {
  findCentre(rot);
  const o = rot[0] as Vec4;
  for (let k = 0; k < 3; k++) {
    const p = rot[1 << k] as Vec4;
    for (let a = 0; a < 4; a++) axes[4 * k + a] = radius * ((p[a] as number) - (o[a] as number));
  }
  const s = sphere.vertices;
  for (let v = 0; v < sphere.count; v++) {
    const u0 = at(s, 3 * v);
    const u1 = at(s, 3 * v + 1);
    const u2 = at(s, 3 * v + 2);
    // The centre plus u0·e0 + u1·e1 + u2·e2, per 4D coordinate.
    for (let k = 0; k < 4; k++) {
      point[k] = at(centre, k) + u0 * at(axes, k) + u1 * at(axes, 4 + k) + u2 * at(axes, 8 + k);
    }
    put(out, (vertex + v) * 3, at(point, 0), at(point, 1), at(point, 2), at(point, 3), cameraW);
  }
}

/**
 * +1 if the projected cell keeps the handedness of its frame (corner 0 → corners 1, 2, 4), −1
 * if the projection mirrors it. The same for the cell and every mark built in it.
 */
export function orientation4(rot: readonly Vec4[], cameraW: number): number {
  for (let b = 0; b < 4; b++) {
    const i = b === 3 ? 4 : b;
    const p = rot[i] as Vec4;
    put(scratch, 3 * i, p[0], p[1], p[2], p[3], cameraW);
  }
  return hexOrientation(scratch);
}
