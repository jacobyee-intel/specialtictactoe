import { describe, expect, it } from 'vitest';
import { createTopology } from '@/geometry';
import { cellCorners4, type Vec3 } from './four';
import {
  HEX_EDGES,
  HEX_FACES,
  HEX_TRIANGLES,
  hexEdgeIndices,
  hexOrientation,
  hexTriangles,
  writeHex,
} from './hexahedron';

const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - (b[i] as number));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, v, i) => s + v * (b[i] as number), 0);
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];
const bitsDiffer = (a: number, b: number) => [1, 2, 4].includes(a ^ b);

/** The Gram determinant of three vectors: 0 iff they are linearly dependent (any dimension). */
function gram(u: readonly number[], v: readonly number[], w: readonly number[]): number {
  const g = [
    [dot(u, u), dot(u, v), dot(u, w)],
    [dot(v, u), dot(v, v), dot(v, w)],
    [dot(w, u), dot(w, v), dot(w, w)],
  ] as number[][];
  const m = (r: number, c: number) => (g[r] as number[])[c] as number;
  return (
    m(0, 0) * (m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1)) -
    m(0, 1) * (m(1, 0) * m(2, 2) - m(1, 2) * m(2, 0)) +
    m(0, 2) * (m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0))
  );
}

/** A unit cube in `cellCorners4` order (bit k → axis k), optionally mirrored in x. */
const cube = (mirror = false): Vec3[] =>
  Array.from({ length: 8 }, (_, i) => [(mirror ? -1 : 1) * (i & 1), (i >> 1) & 1, (i >> 2) & 1]);

describe('HEX_FACES and HEX_EDGES', () => {
  it('are 6 cyclic quads (each corner in exactly 3) and 12 edges (each corner in 3)', () => {
    expect(HEX_FACES).toHaveLength(6);
    for (let i = 0; i < 8; i++) {
      expect(HEX_FACES.filter((f) => f.includes(i))).toHaveLength(3);
      expect(HEX_EDGES.filter((e) => e.includes(i))).toHaveLength(3);
    }
    for (const face of HEX_FACES) {
      expect(new Set(face).size).toBe(4);
      // Consecutive corners share an edge (no diagonal), so the quad is not twisted.
      face.forEach((a, k) => expect(bitsDiffer(a, face[(k + 1) % 4] as number)).toBe(true));
      // All four share one bit: they lie on one side of one free axis.
      const fixed = [1, 2, 4].filter((b) => face.every((c) => (c & b) === (face[0] & b)));
      expect(fixed).toHaveLength(1);
    }
    expect(new Set(HEX_EDGES.map((e) => e.join())).size).toBe(12);
    for (const [a, b] of HEX_EDGES) expect(bitsDiffer(a, b)).toBe(true);
    expect(hexEdgeIndices(8)).toHaveLength(24);
    expect(Math.min(...hexEdgeIndices(8))).toBe(8);
  });

  it.each([2, 3])('N=%i: each face of every cell is coplanar in 4D', (n) => {
    const t = createTopology('tesseract', n);
    for (let c = 0; c < t.cellCount; c++) {
      const p = cellCorners4(t, c);
      for (const [a, b, d, e] of HEX_FACES) {
        const o = p[a] as unknown as number[];
        const u = sub(p[b] as unknown as number[], o);
        const v = sub(p[d] as unknown as number[], o);
        const w = sub(p[e] as unknown as number[], o);
        expect(Math.abs(gram(u, v, w))).toBeLessThan(1e-12);
        // …and a real quad: its two sides from corner a span a plane.
        expect(dot(u, u) * dot(w, w) - dot(u, w) ** 2).toBeGreaterThan(0.1);
      }
    }
  });

  it.each([false, true])('triangles are wound outwards (mirrored: %s)', (mirror) => {
    const corners = cube(mirror);
    const flat = corners.flat();
    const sign = hexOrientation(flat);
    expect(sign).toBe(mirror ? -1 : 1);
    const tris = hexTriangles(sign);
    expect(tris).toHaveLength(HEX_TRIANGLES * 3);
    const centre: Vec3 = [mirror ? -0.5 : 0.5, 0.5, 0.5];
    for (let k = 0; k < tris.length; k += 3) {
      const at = (j: number) => corners[tris[k + j] as number] as Vec3;
      const [a, b, c] = [at(0), at(1), at(2)];
      const normal = cross(sub(b, a), sub(c, a));
      const mid = [0, 1, 2].map((j) => (a[j]! + b[j]! + c[j]!) / 3);
      expect(dot(normal, sub(mid, centre))).toBeGreaterThan(0);
    }
    expect(Math.min(...hexTriangles(1, 16))).toBe(16);
  });
});

describe('writeHex', () => {
  it('shrinks the corners towards their centroid, in place', () => {
    const corners: Vec3[] = cube().map(([x, y, z]) => [2 * x + 1, 4 * y, z + 3 * x]);
    const out = new Float32Array(8 * 3 * 2);
    writeHex(corners, 0.5, out, 8);
    expect(Array.from(out.slice(0, 24)).every((v) => v === 0)).toBe(true);
    const centroid = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k]!, 0) / 8);
    corners.forEach((p, i) => {
      for (let k = 0; k < 3; k++) {
        const expected = centroid[k]! + 0.5 * (p[k]! - centroid[k]!);
        expect(out[24 + 3 * i + k]).toBeCloseTo(expected, 6);
      }
    });
  });
});
