import { describe, expect, it } from 'vitest';
import { createTopology, dir3, type CubicTopologyId } from '@/geometry';
import { gluedPairs, type FaceFrame } from './gluing';
import { add, cross, dot, scale, type Vec3 } from './iso';

const WRAPPED: CubicTopologyId[] = ['torus3', 'tetracosm', 'amphicosm1'];
const AXIS: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const at = (f: FaceFrame, u: number, v: number): Vec3 =>
  add(add(f.origin, scale(f.U, u)), scale(f.V, v));

describe('gluedPairs', () => {
  it('has no gluing for the bounded cube', () => {
    expect(gluedPairs('flat')).toEqual([]);
  });

  it.each(WRAPPED)('%s: x and y are straight, z carries the twist', (id) => {
    const pairs = gluedPairs(id);
    expect(pairs.map((p) => `${p.letter}${p.axis}:${p.kind}`)).toEqual([
      'ax:straight',
      'by:straight',
      `cz:${({ torus3: 'straight', tetracosm: 'quarterTurn', amphicosm1: 'mirror' } as Record<string, string>)[id]}`,
    ]);
  });

  it.each(WRAPPED)('%s: visible faces read unmirrored from outside', (id) => {
    for (const pair of gluedPairs(id)) {
      const n = AXIS[pair.axis];
      // Each frame lies on its face: the coordinate along the axis is constant.
      for (const [f, c] of [
        [pair.near, 0],
        [pair.far, 1],
      ] as const) {
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          expect(dot(at(f, u as number, v as number), n)).toBeCloseTo(c, 10);
        }
      }
      if (pair.kind !== 'mirror') expect(dot(cross(pair.far.U, pair.far.V), n)).toBe(1);
      expect(dot(cross(pair.near.U, pair.near.V), n)).toBe(1);
    }
  });

  it('turns the tetracosm arrow a quarter turn and mirrors the amphicosm arrow', () => {
    const z = (id: CubicTopologyId) => gluedPairs(id)[2]!;
    const torus = z('torus3');
    expect(torus.far.U).toEqual(torus.near.U);
    expect(torus.far.V).toEqual(torus.near.V);
    const tetra = z('tetracosm');
    expect(dot(tetra.far.V, tetra.near.V)).toBe(0);
    expect(dot(cross(tetra.far.U, tetra.far.V), AXIS.z)).toBe(1);
    const amphi = z('amphicosm1');
    expect(amphi.far.V).toEqual(amphi.near.V); // same direction along the mirror line…
    expect(dot(cross(amphi.far.U, amphi.far.V), AXIS.z)).toBe(-1); // …but reflected
  });

  // The decisive check: the drawing agrees with the game's geometry. Leaving the far face of a
  // cell at local (u, v) must land in the cell at the same local (u, v) of the near face.
  it.each(WRAPPED)('%s: matches CubicQuotient.step across every face', (id) => {
    const n = 3;
    const topology = createTopology(id, n);
    const cellOf = (p: Vec3) => p.map((c) => Math.min(n - 1, Math.floor(c * n)));
    for (const pair of gluedPairs(id)) {
      const out = dir3(...(AXIS[pair.axis] as [number, number, number]));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const u = (i + 0.5) / n;
          const v = (j + 0.5) / n;
          const from = topology.cellAt(cellOf(at(pair.far, u, v)));
          const landed = topology.step(from, out);
          expect(landed).not.toBeNull();
          expect(topology.coords(landed!.cell)).toEqual(cellOf(at(pair.near, u, v)));
        }
      }
    }
  });
});
