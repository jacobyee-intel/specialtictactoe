import { describe, expect, it } from 'vitest';
import {
  CubicQuotient,
  DIRECTIONS_3D,
  applyAffine,
  applyLinear,
  composeAffine,
  createTopology,
  dir3,
  type CubicTopologyId,
  type Dir,
} from '@/geometry';

const WRAPPED: readonly CubicTopologyId[] = ['torus3', 'tetracosm', 'amphicosm1'];

/** Number of steps until the state (cell, direction) first returns to its start. */
function orbitLength(t: CubicQuotient, start: number, d0: Dir): number {
  let cell = start;
  let dir = d0;
  for (let k = 1; k <= 10 * t.cellCount; k++) {
    const r = t.step(cell, dir);
    if (r === null) throw new Error('blocked');
    ({ cell, dir } = r);
    if (cell === start && dir === d0) return k;
  }
  throw new Error('no return');
}

describe('CubicQuotient basics', () => {
  it('indexes cells as x + N(y + Nz) and lays out panel = z, row = y, col = x', () => {
    const t = new CubicQuotient('torus3', 4);
    expect(t.cellCount).toBe(64);
    expect(t.dim).toBe(3);
    expect(t.panelCount).toBe(4);
    expect(t.cellAt([1, 2, 3])).toBe(1 + 4 * (2 + 4 * 3));
    expect(t.coords(57)).toEqual([1, 2, 3]);
    expect(t.layout2D(57)).toEqual({ panel: 3, row: 2, col: 1 });
    expect(t.localDirections(0)).toBe(DIRECTIONS_3D);
  });

  it('rejects malformed coordinates and directions', () => {
    const t = new CubicQuotient('tetracosm', 3);
    expect(() => t.cellAt([3, 0, 0])).toThrow(RangeError);
    expect(() => t.cellAt([0, -1, 0])).toThrow(RangeError);
    expect(() => t.cellAt([0.5, 0, 0])).toThrow(RangeError);
    expect(() => t.cellAt([0, 0])).toThrow(RangeError);
    expect(() => t.step(0, [1, 0])).toThrow(RangeError);
    expect(() => t.reduce([0, 0, 0, 0], dir3(1, 0, 0))).toThrow(RangeError);
    expect(() => new CubicQuotient('flat', 0)).toThrow(RangeError);
  });

  it('reports which spaces are wrapped', () => {
    expect(new CubicQuotient('flat', 3).wrapped).toBe(false);
    for (const id of WRAPPED) expect(new CubicQuotient(id, 3).wrapped).toBe(true);
  });
});

describe('z-gluing', () => {
  it('tetracosm: going up turns (x, y) into (N-1-y, x) and rotates the direction', () => {
    const t = new CubicQuotient('tetracosm', 3);
    expect(t.step(t.cellAt([0, 1, 2]), dir3(1, 0, 1))).toEqual({
      cell: t.cellAt([1, 1, 0]),
      dir: dir3(0, 1, 1),
    });
    // Going down applies the inverse (x, y) -> (y, N-1-x).
    expect(t.step(t.cellAt([1, 0, 0]), dir3(0, 0, -1))).toEqual({
      cell: t.cellAt([0, 1, 2]),
      dir: dir3(0, 0, -1),
    });
  });

  it('amphicosm1: crossing z mirrors x and dx', () => {
    const t = new CubicQuotient('amphicosm1', 4);
    expect(t.step(t.cellAt([0, 2, 3]), dir3(1, 1, 1))).toEqual({
      cell: t.cellAt([2, 3, 0]),
      dir: dir3(-1, 1, 1),
    });
  });

  it('x and y wrap without any twist', () => {
    for (const id of WRAPPED) {
      const t = new CubicQuotient(id, 3);
      expect(t.step(t.cellAt([2, 2, 1]), dir3(1, 1, 0))).toEqual({
        cell: t.cellAt([0, 0, 1]),
        dir: dir3(1, 1, 0),
      });
    }
  });
});

describe('z-orbit lengths', () => {
  const up = dir3(0, 0, 1);
  for (const n of [3, 4, 5]) {
    const mid = (n - 1) / 2;
    it(`torus N=${n}: every vertical geodesic has length N`, () => {
      const t = new CubicQuotient('torus3', n);
      for (let c = 0; c < t.cellCount; c++) expect(orbitLength(t, c, up)).toBe(n);
    });

    it(`tetracosm N=${n}: 4N, except N on the rotation axis when N is odd`, () => {
      const t = new CubicQuotient('tetracosm', n);
      for (let c = 0; c < t.cellCount; c++) {
        const [x, y] = t.coords(c);
        expect(orbitLength(t, c, up)).toBe(x === mid && y === mid ? n : 4 * n);
      }
    });

    it(`amphicosm1 N=${n}: 2N, except N on the mirror plane when N is odd`, () => {
      const t = new CubicQuotient('amphicosm1', n);
      for (let c = 0; c < t.cellCount; c++) {
        const [x] = t.coords(c);
        expect(orbitLength(t, c, up)).toBe(x === mid ? n : 2 * n);
      }
    });
  }
});

describe('universal cover', () => {
  for (const id of [...WRAPPED, 'flat'] as const) {
    for (const n of [3, 4]) {
      it(`${id} N=${n}: k steps along d equal reduce(start + k·d)`, () => {
        const t = new CubicQuotient(id, n);
        for (let c = 0; c < t.cellCount; c++) {
          const p = t.coords(c);
          for (const d of DIRECTIONS_3D) {
            let cur: { cell: number; dir: Dir } | null = { cell: c, dir: d };
            for (let k = 1; k <= 2 * n + 1; k++) {
              cur = cur && t.step(cur.cell, cur.dir);
              const q = p.map((v, i) => v + k * (d[i] as number));
              expect(t.reduce(q, d)).toEqual(cur);
            }
          }
        }
      });
    }
  }

  it('reduce handles points many layers away', () => {
    const t = new CubicQuotient('tetracosm', 3);
    // Four quarter turns are the identity, so 4 layers up is the same cell and direction.
    expect(t.reduce([0, 1, 12], dir3(1, 0, 0))).toEqual({
      cell: t.cellAt([0, 1, 0]),
      dir: dir3(1, 0, 0),
    });
    expect(t.reduce([0, 1, -3], dir3(1, 0, 0))).toEqual({
      cell: t.cellAt([1, 2, 0]),
      dir: dir3(0, -1, 0),
    });
  });
});

describe('deck transformations', () => {
  for (const id of WRAPPED) {
    for (const n of [3, 4]) {
      it(`${id} N=${n}: reduce(deck(i,j,k) · cell) is the same cell and direction`, () => {
        const t = new CubicQuotient(id, n);
        const mismatches: string[] = [];
        for (let i = -2; i <= 2; i++) {
          for (let j = -1; j <= 1; j++) {
            for (let k = -4; k <= 4; k++) {
              const deck = t.deckTransform(i, j, k);
              for (let c = 0; c < t.cellCount; c++) {
                const q = applyAffine(deck, t.coords(c));
                expect(Math.floor((q[2] as number) / n)).toBe(k);
                for (const d of DIRECTIONS_3D) {
                  const r = t.reduce(q, applyLinear(deck, d));
                  if (r?.cell !== c || r.dir !== d) mismatches.push([i, j, k, c, ...d].join());
                }
              }
            }
          }
        }
        expect(mismatches).toEqual([]);
      });
    }
  }

  it('has the expected holonomy in its linear parts', () => {
    const det = (m: readonly number[]): number => {
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = m;
      return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    };
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const tetra = new CubicQuotient('tetracosm', 3);
    expect(tetra.deckTransform(0, 0, 1).m).not.toEqual(identity);
    expect(tetra.deckTransform(0, 0, 2).m).not.toEqual(identity);
    expect(tetra.deckTransform(0, 0, 4).m).toEqual(identity);
    expect(det(tetra.deckTransform(0, 0, 1).m)).toBe(1);
    const amphi = new CubicQuotient('amphicosm1', 3);
    expect(det(amphi.deckTransform(0, 0, 1).m)).toBe(-1);
    expect(amphi.deckTransform(0, 0, 2).m).toEqual(identity);
    expect(new CubicQuotient('torus3', 3).deckTransform(1, -1, 1)).toEqual({
      m: identity,
      t: [3, -3, 3],
    });
  });

  it('composes into a group action: deck(0,0,1) ∘ deck(0,0,1) = deck(0,0,2)', () => {
    const t = new CubicQuotient('tetracosm', 4);
    expect(composeAffine(t.deckTransform(0, 0, 1), t.deckTransform(0, 0, 1))).toEqual(
      t.deckTransform(0, 0, 2),
    );
  });

  it('the flat cube only has the identity', () => {
    const t = createTopology('flat', 3);
    expect(applyAffine(t.deckTransform(0, 0, 0), [1, 2, 0])).toEqual([1, 2, 0]);
    expect(() => t.deckTransform(1, 0, 0)).toThrow(RangeError);
    expect(() => t.deckTransform(0, 0, -1)).toThrow(RangeError);
  });
});

describe('flat cube', () => {
  it('blocks every step that leaves the block, and only those', () => {
    const t = new CubicQuotient('flat', 3);
    for (let c = 0; c < t.cellCount; c++) {
      const p = t.coords(c);
      for (const d of DIRECTIONS_3D) {
        const q = p.map((v, i) => v + (d[i] as number));
        const inside = q.every((v) => v >= 0 && v < 3);
        expect(t.step(c, d)).toEqual(inside ? { cell: t.cellAt(q), dir: d } : null);
      }
    }
    expect(t.step(0, dir3(-1, 0, 0))).toBeNull();
    expect(t.step(26, dir3(0, 0, 1))).toBeNull();
  });
});
