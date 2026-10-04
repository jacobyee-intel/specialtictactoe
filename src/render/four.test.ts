import { describe, expect, it } from 'vitest';
import { createTopology } from '@/geometry';
import {
  apply4,
  cellCentre4,
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
