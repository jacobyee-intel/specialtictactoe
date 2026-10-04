import { describe, expect, it } from 'vitest';
import { createTopology } from '@/geometry';
import {
  CAMERA_W_FACTOR,
  DEFAULT_PLANES4,
  apply4,
  cellCentre4,
  cellCorners4,
  schlegelRadius,
  hypercubeEdges4,
  multiply4,
  project4to3,
  rotation4,
  type Mat4,
} from './four';

const transpose = (m: Mat4): Mat4 => m.map((_, i) => m[4 * (i % 4) + Math.floor(i / 4)] as number);

describe('rotation4', () => {
  it('is orthonormal for any angles', () => {
    const R = rotation4({ xw: 0.3, yw: 1.1, zw: -2, xy: 0.5, xz: 0.2, yz: 2.9 });
    const I = multiply4(R, transpose(R));
    I.forEach((v, i) => expect(v).toBeCloseTo(i % 5 === 0 ? 1 : 0, 12));
  });

  it('turns x into w with a quarter turn in the XW plane', () => {
    const p = apply4(rotation4({ xw: Math.PI / 2, yw: 0, zw: 0 }), [1, 0, 0, 0]);
    expect(p.map((v) => +v.toFixed(12))).toEqual([0, 0, 0, 1]);
  });
});

describe('cellCentre4 and project4to3', () => {
  it('puts every cell centre on its facet hyperplane, inside the face', () => {
    const t = createTopology('tesseract', 3);
    for (let c = 0; c < t.cellCount; c++) {
      const p = cellCentre4(t, c);
      const { axis, side } = t.facet(c);
      expect(p[axis]).toBe(side ? 1.5 : -1.5);
      p.forEach((v, k) => k !== axis && expect(Math.abs(v)).toBeLessThan(1.5));
    }
  });

  it('projects w = 0 with scale 1 and the near side larger', () => {
    const I = rotation4({ xw: 0, yw: 0, zw: 0 });
    expect(project4to3([1, 2, 3, 0], I, 6)).toEqual({ p: [1, 2, 3], scale: 1 });
    expect(project4to3([1, 0, 0, 2], I, 6).scale).toBeGreaterThan(1);
    expect(project4to3([1, 0, 0, -2], I, 6).scale).toBeLessThan(1);
  });

  it('lists the 32 edges of the hypercube, each of length N', () => {
    const edges = hypercubeEdges4(4);
    expect(edges).toHaveLength(32);
    for (const [a, b] of edges)
      expect(Math.hypot(...a.map((v, i) => v - (b[i] as number)))).toBe(4);
  });
});

describe('cellCorners4', () => {
  const key = (p: readonly number[]) => p.join(',');
  const shared = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) => {
    const s = new Set(a.map(key));
    return b.filter((p) => s.has(key(p))).length;
  };

  it.each([2, 3])(
    'N=%i: corners lie in the facet hyperplane; neighbours share faces or edges',
    (n) => {
      const t = createTopology('tesseract', n);
      const h = n / 2;
      for (let c = 0; c < t.cellCount; c++) {
        const corners = cellCorners4(t, c);
        const { axis, side } = t.facet(c);
        expect(corners).toHaveLength(8);
        expect(new Set(corners.map(key)).size).toBe(8);
        for (const p of corners) expect(p[axis]).toBe(side ? h : -h);
        for (const d of t.localDirections(c)) {
          const r = t.step(c, d);
          if (r === null || t.facet(r.cell).index === t.facet(c).index) continue;
          const nonzero = d.filter((v) => v !== 0).length;
          const s = shared(corners, cellCorners4(t, r.cell));
          // Across a ridge: a face (4 corners) straight on, an edge (2) diagonally, a corner (1).
          expect(s).toBe([0, 4, 2, 1][nonzero]);
        }
      }
    },
  );

  it('three cells meet around each segment of a hypercube edge (270°, not 360°)', () => {
    const n = 3;
    const t = createTopology('tesseract', n);
    const all = Array.from({ length: t.cellCount }, (_, c) => cellCorners4(t, c).map(key));
    for (const [a, b] of hypercubeEdges4(n)) {
      const k = a.findIndex((v, i) => v !== b[i]);
      for (let s = 0; s < n; s++) {
        const p = [...a];
        const q = [...a];
        p[k] = -n / 2 + s;
        q[k] = -n / 2 + s + 1;
        const around = all.filter((cs) => cs.includes(key(p)) && cs.includes(key(q)));
        expect(around).toHaveLength(3);
      }
    }
  });
});

describe('Schlegel projection', () => {
  it('the near facet encloses the far facet at the default rotation', () => {
    const n = 4;
    const t = createTopology('tesseract', n);
    const R = rotation4(DEFAULT_PLANES4);
    const cw = CAMERA_W_FACTOR * n;
    const near = cells(t, 7)
      .flatMap((c) => cellCorners4(t, c))
      .map((p) => project4to3(p, R, cw).p);
    const far = cells(t, 6)
      .flatMap((c) => cellCorners4(t, c))
      .map((p) => project4to3(p, R, cw).p);
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(...near.map((p) => p[k] as number));
      const hi = Math.max(...near.map((p) => p[k] as number));
      for (const p of far) {
        expect(p[k]).toBeGreaterThan(lo);
        expect(p[k]).toBeLessThan(hi);
      }
    }
  });

  it('schlegelRadius bounds the projection in every orientation', () => {
    const n = 4;
    const R0 = schlegelRadius(n);
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const R = rotation4({ xw: i * 0.37, yw: i * 0.71, zw: i * 1.13, xy: i * 0.5, xz: i * 0.3 });
      for (const [a] of hypercubeEdges4(n)) {
        max = Math.max(max, Math.hypot(...project4to3(a, R, CAMERA_W_FACTOR * n).p));
      }
    }
    expect(max).toBeLessThanOrEqual(R0 + 1e-9);
    expect(max).toBeGreaterThan(0.97 * R0);
  });

  it('composes plane rotations: YW then ZW by 90° take y to w and z to w', () => {
    const y = apply4(rotation4({ xw: 0, yw: Math.PI / 2, zw: 0 }), [0, 1, 0, 0]);
    expect(y.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 0, 1]);
    const z = apply4(rotation4({ xw: 0, yw: 0, zw: Math.PI / 2 }), [0, 0, 1, 0]);
    expect(z.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 0, 1]);
    const R = rotation4({ xw: 0.4, yw: 0.9, zw: -1.3 });
    const parts = multiply4(
      multiply4(rotation4({ xw: 0.4, yw: 0, zw: 0 }), rotation4({ xw: 0, yw: 0.9, zw: 0 })),
      rotation4({ xw: 0, yw: 0, zw: -1.3 }),
    );
    R.forEach((v, i) => expect(v).toBeCloseTo(parts[i] as number, 12));
  });
});

function cells(t: ReturnType<typeof createTopology>, facet: number): number[] {
  const n3 = t.n ** 3;
  return Array.from({ length: n3 }, (_, i) => facet * n3 + i);
}
