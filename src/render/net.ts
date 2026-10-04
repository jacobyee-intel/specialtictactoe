/**
 * The net of the tesseract: its 8 cubes unfolded into 3D (the Dalí cross), each by a rigid
 * motion of R⁴, so every cube keeps its true shape and size. Pure, tested in node.
 *
 * ## Unfolding
 *
 * Two facets P (fixed axis a, side σa = ±1) and C (axis b, side σb) share the ridge
 * x_a = σa·h, x_b = σb·h. Rotating C by 90° in the (a, b) plane about that ridge lays it into
 * P's hyperplane, on the far side of the shared square:
 *
 *   x′_a = σa·σb·x_b,   x′_b = −σa·σb·x_a + 2h·σb,   other coordinates unchanged.
 *
 * This is a rotation (det +1) plus a translation, and it fixes the ridge pointwise, which is
 * what makes a straight line of the surface stay straight across the ridge in the net.
 *
 * The root is the cube w = 0 (facet 6, the hyperplane w = −h), whose 3D coordinates are
 * (x, y, z). The six cubes around it unfold across its six faces, and the opposite cube
 * (w = N) across the top face of the cube z = N: a column of four with four arms.
 */
import type { Mat4, Vec3, Vec4 } from './four';
import { apply4, multiply4 } from './four';

/** A facet's placement in the net: p ↦ R·p + t, landing in the root hyperplane w = −h. */
export interface NetPlacement {
  readonly facet: number;
  readonly R: Mat4;
  readonly t: Vec4;
}

/** The root facet (w = 0) and the unfolding tree: the facet each one is unfolded from. */
export const NET_ROOT = 6;
const PARENT: Readonly<Record<number, number>> = { 0: 6, 1: 6, 2: 6, 3: 6, 4: 6, 5: 6, 7: 5 };

const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sign = (facet: number) => (facet & 1 ? 1 : -1);

/** The unfolding of facet `child` into the hyperplane of facet `parent` (they share a ridge). */
function unfold(parent: number, child: number, h: number): { M: Mat4; t: Vec4 } {
  const a = parent >> 1;
  const b = child >> 1;
  const sa = sign(parent);
  const sb = sign(child);
  const M = [...IDENTITY4];
  M[4 * a + a] = 0;
  M[4 * b + b] = 0;
  M[4 * a + b] = sa * sb;
  M[4 * b + a] = -sa * sb;
  const t = [0, 0, 0, 0];
  t[b] = 2 * h * sb;
  return { M, t: t as unknown as Vec4 };
}

/** The 8 placements, indexed by facet. */
export function netPlacements(n: number): NetPlacement[] {
  const h = n / 2;
  const out: NetPlacement[] = [];
  const place = (f: number): NetPlacement => {
    const done = out[f];
    if (done !== undefined) return done;
    if (f === NET_ROOT) {
      out[f] = { facet: f, R: IDENTITY4, t: [0, 0, 0, 0] };
      return out[f];
    }
    const parent = place(PARENT[f] as number);
    const u = unfold(parent.facet, f, h);
    const tp = apply4(parent.R, u.t);
    out[f] = {
      facet: f,
      R: multiply4(parent.R, u.M),
      t: [0, 1, 2, 3].map((k) => (tp[k] as number) + (parent.t[k] as number)) as unknown as Vec4,
    };
    return out[f];
  };
  for (let f = 0; f < 8; f++) place(f);
  return out;
}

/** A point of a facet in the net's 3D space. */
export function netPoint(pl: NetPlacement, p: readonly number[]): Vec3 {
  const q = apply4(pl.R, p as unknown as Vec4);
  return [q[0] + pl.t[0], q[1] + pl.t[1], q[2] + pl.t[2]];
}

/** The 8 corners of facet f of the centred hypercube (half-width h). */
export function facetCorners4(f: number, h: number): Vec4[] {
  const axis = f >> 1;
  const free = [0, 1, 2, 3].filter((k) => k !== axis);
  const out: Vec4[] = [];
  for (let i = 0; i < 8; i++) {
    const p = [0, 0, 0, 0];
    p[axis] = sign(f) * h;
    free.forEach((k, bit) => (p[k] = (i >> bit) & 1 ? h : -h));
    out.push(p as unknown as Vec4);
  }
  return out;
}

export interface NetRidge {
  /** The two facets that share the ridge. */
  readonly facets: readonly [number, number];
  /** True when the two cubes touch along this face in the net (no tag needed). */
  readonly glued: boolean;
  /** A letter shared by the two separated faces; null when glued in the net. */
  readonly tag: string | null;
  /** The face's centre in each cube of the net (same order as `facets`). */
  readonly centres: readonly [Vec3, Vec3];
  /** From each face centre towards its cube's centre, unit length. */
  readonly inward: readonly [Vec3, Vec3];
}

const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);

/**
 * The 24 ridges of the tesseract (one per pair of facets on different axes). 7 are faces where
 * the net keeps two cubes together; the other 17 are cut, and get letters A–Q.
 */
export function netRidges(n: number): NetRidge[] {
  const h = n / 2;
  const placements = netPlacements(n);
  const ridges: NetRidge[] = [];
  let letter = 0;
  for (let f = 0; f < 8; f++) {
    for (let g = f + 1; g < 8; g++) {
      if (f >> 1 === g >> 1) continue; // opposite cubes share nothing
      const a = f >> 1;
      const b = g >> 1;
      const free = [0, 1, 2, 3].filter((k) => k !== a && k !== b);
      const corners: Vec4[] = [];
      for (let i = 0; i < 4; i++) {
        const p = [0, 0, 0, 0];
        p[a] = sign(f) * h;
        p[b] = sign(g) * h;
        free.forEach((k, bit) => (p[k] = (i >> bit) & 1 ? h : -h));
        corners.push(p as unknown as Vec4);
      }
      const pf = placements[f] as NetPlacement;
      const pg = placements[g] as NetPlacement;
      const inF = corners.map((c) => netPoint(pf, c));
      const inG = corners.map((c) => netPoint(pg, c));
      const glued = inF.every((p) => inG.some((q) => near(p, q)));
      const centre = (ps: Vec3[]): Vec3 =>
        [0, 1, 2].map(
          (k) => ps.reduce((s, p) => s + (p[k] as number), 0) / ps.length,
        ) as unknown as Vec3;
      const cubeCentre = (pl: NetPlacement, facet: number) => {
        const c = [0, 0, 0, 0];
        c[facet >> 1] = sign(facet) * h;
        return netPoint(pl, c);
      };
      const unit = (from: Vec3, to: Vec3): Vec3 => {
        const v = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const l = Math.hypot(...v);
        return v.map((x) => x / l) as unknown as Vec3;
      };
      const cf = centre(inF);
      const cg = centre(inG);
      ridges.push({
        facets: [f, g],
        glued,
        tag: glued ? null : String.fromCharCode(65 + letter++),
        centres: [cf, cg],
        inward: [unit(cf, cubeCentre(pf, f)), unit(cg, cubeCentre(pg, g))],
      });
    }
  }
  return ridges;
}

/** The ridge shared by two facets, or undefined for the same or opposite facets. */
export function ridgeOf(ridges: readonly NetRidge[], f: number, g: number): NetRidge | undefined {
  return ridges.find(
    (r) => (r.facets[0] === f && r.facets[1] === g) || (r.facets[0] === g && r.facets[1] === f),
  );
}

/** Axis-aligned bounds of each cube in the net, for tests and the camera fit. */
export function netBounds(n: number): { min: Vec3; max: Vec3 }[] {
  const h = n / 2;
  return netPlacements(n).map((pl) => {
    const ps = facetCorners4(pl.facet, h).map((c) => netPoint(pl, c));
    const min = [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k] as number)));
    const max = [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k] as number)));
    return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
  });
}
