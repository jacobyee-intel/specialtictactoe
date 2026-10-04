import { describe, expect, it } from 'vitest';
import { multiply4, type Mat4 } from './four';
import { NET_ROOT, facetCorners4, netBounds, netPlacements, netPoint, netRidges } from './net';

const transpose = (m: Mat4): Mat4 => m.map((_, i) => m[4 * (i % 4) + Math.floor(i / 4)] as number);

function det4(m: Mat4): number {
  // Laplace expansion along the first row.
  const minor = (r: number, c: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) if (i !== r && j !== c) out.push(m[4 * i + j] as number);
    return out;
  };
  const det3 = (a: number[]) =>
    (a[0] as number) * ((a[4] as number) * (a[8] as number) - (a[5] as number) * (a[7] as number)) -
    (a[1] as number) * ((a[3] as number) * (a[8] as number) - (a[5] as number) * (a[6] as number)) +
    (a[2] as number) * ((a[3] as number) * (a[7] as number) - (a[4] as number) * (a[6] as number));
  return [0, 1, 2, 3].reduce(
    (s, c) => s + (c % 2 ? -1 : 1) * (m[c] as number) * det3(minor(0, c)),
    0,
  );
}

describe('netPlacements', () => {
  it.each([2, 3, 4])('N=%i: 8 rigid placements into the root hyperplane, without overlaps', (n) => {
    const h = n / 2;
    const placements = netPlacements(n);
    expect(placements).toHaveLength(8);
    for (const pl of placements) {
      const I = multiply4(pl.R, transpose(pl.R));
      I.forEach((v, i) => expect(v).toBeCloseTo(i % 5 === 0 ? 1 : 0, 12));
      expect(det4(pl.R)).toBeCloseTo(1, 12);
      // Every point of the facet lands in the root's hyperplane w = −h.
      for (const c of facetCorners4(pl.facet, h)) {
        const q = pl.R.slice(12).reduce((s, v, k) => s + v * (c[k] as number), 0) + pl.t[3];
        expect(q).toBeCloseTo(-h, 12);
      }
    }
    expect(placements[NET_ROOT]?.R).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const boxes = netBounds(n);
    for (const b of boxes)
      for (let k = 0; k < 3; k++)
        expect((b.max[k] as number) - (b.min[k] as number)).toBeCloseTo(n, 12);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const [a, b] = [boxes[i], boxes[j]] as const;
        const overlap = [0, 1, 2].every(
          (k) =>
            (a?.min[k] as number) < (b?.max[k] as number) - 1e-9 &&
            (b?.min[k] as number) < (a?.max[k] as number) - 1e-9,
        );
        expect(overlap).toBe(false);
      }
    }
  });

  it('is the Dalí cross: a column of four cubes with four arms around the second', () => {
    const centres = netBounds(2).map((b) => b.min.map((v, k) => (v + (b.max[k] as number)) / 2));
    expect(centres[6]).toEqual([0, 0, 0]);
    expect(centres[4]).toEqual([0, 0, -2]);
    expect(centres[5]).toEqual([0, 0, 2]);
    expect(centres[7]).toEqual([0, 0, 4]);
    expect(centres.slice(0, 4)).toEqual([
      [-2, 0, 0],
      [2, 0, 0],
      [0, -2, 0],
      [0, 2, 0],
    ]);
  });
});

describe('netRidges', () => {
  it('has one glued face pair per ridge (24): 7 kept together, 17 lettered A–Q', () => {
    const ridges = netRidges(3);
    expect(ridges).toHaveLength(24);
    expect(ridges.filter((r) => r.glued)).toHaveLength(7);
    const tags = ridges.flatMap((r) => (r.tag === null ? [] : [r.tag]));
    expect(tags).toEqual([...'ABCDEFGHIJKLMNOPQ']);
    for (const r of ridges) {
      // Each tagged face pair: two different faces of the net, each a face of its own cube.
      const [a, b] = r.centres;
      const apart = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      expect(apart > 1e-9).toBe(!r.glued);
    }
  });

  it('a ridge point maps to the same net point from both cubes when they are kept together', () => {
    const n = 2;
    const pls = netPlacements(n);
    for (const r of netRidges(n).filter((x) => x.glued)) {
      const [f, g] = r.facets;
      const p = [0.3, -0.2, 0.7, 0.1];
      p[f >> 1] = f & 1 ? 1 : -1;
      p[g >> 1] = g & 1 ? 1 : -1;
      const a = netPoint(pls[f]!, p);
      const b = netPoint(pls[g]!, p);
      a.forEach((v, k) => expect(v).toBeCloseTo(b[k] as number, 12));
    }
  });
});
