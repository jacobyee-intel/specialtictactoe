import { describe, expect, it } from 'vitest';
import {
  TOPOLOGY_IDS,
  buildLineIndex,
  createTopology,
  lineCells,
  linesThroughCell,
  type LineIndex,
  type Topology,
  type TopologyId,
} from '@/geometry';

/** Verified by the throwaway prototype (see plans/01-geometry.md). Columns: [N, M, lines]. */
const ORACLE: Record<TopologyId, readonly (readonly [number, number, number])[]> = {
  flat: [
    [3, 3, 49],
    [4, 4, 76],
    [4, 3, 224],
    [3, 2, 158],
  ],
  torus3: [
    [3, 3, 117],
    [4, 4, 208],
    [4, 3, 832],
    [3, 2, 351],
  ],
  tetracosm: [
    [3, 3, 253],
    [4, 4, 640],
    [4, 3, 832],
    [3, 2, 351],
  ],
  amphicosm1: [
    [3, 3, 207],
    [4, 4, 640],
    [4, 3, 832],
    [3, 2, 351],
  ],
  tesseract: [
    [3, 3, 2072],
    [4, 4, 5120],
    [4, 3, 5632],
    [3, 2, 2440],
    [2, 2, 608],
  ],
};

/** Histogram {lines through a cell: number of such cells}. */
function histogram(index: LineIndex): Record<number, number> {
  const out: Record<number, number> = {};
  for (let c = 0; c < index.cellCount; c++) {
    const k = linesThroughCell(index, c).length;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe('line-count oracles', () => {
  for (const id of TOPOLOGY_IDS) {
    for (const [n, m, count] of ORACLE[id]) {
      it(`${id} N=${n} M=${m} has ${count} lines`, () => {
        expect(buildLineIndex(createTopology(id, n), m).lineCount).toBe(count);
      });
    }
  }

  it('wrapped cubic spaces have 13N³ lines whenever M < N', () => {
    for (const id of ['torus3', 'tetracosm', 'amphicosm1'] as const) {
      for (let n = 3; n <= 6; n++) {
        for (let m = 2; m < n; m++) {
          expect(buildLineIndex(createTopology(id, n), m).lineCount).toBe(13 * n ** 3);
        }
      }
    }
  });
});

describe('per-cell line histograms', () => {
  it.each([
    ['torus3', 3, 3, { 13: 27 }],
    ['tetracosm', 3, 3, { 21: 3, 29: 24 }],
    ['amphicosm1', 3, 3, { 19: 9, 25: 18 }],
    ['tetracosm', 4, 4, { 40: 64 }],
    ['amphicosm1', 4, 4, { 40: 64 }],
    ['flat', 3, 3, { 4: 12, 5: 6, 7: 8, 13: 1 }],
    ['tesseract', 3, 3, { 19: 8, 25: 64, 27: 48, 33: 96 }],
    ['tesseract', 4, 4, { 31: 128, 43: 384 }],
  ] as const)('%s N=%i M=%i', (id, n, m, expected) => {
    expect(histogram(buildLineIndex(createTopology(id, n), m))).toEqual(expected);
  });

  it('the special tetracosm cells are exactly the rotation axis', () => {
    const t = createTopology('tetracosm', 3);
    const index = buildLineIndex(t, 3);
    for (let c = 0; c < t.cellCount; c++) {
      const [x, y] = t.coords(c);
      expect(linesThroughCell(index, c).length).toBe(x === 1 && y === 1 ? 21 : 29);
    }
  });
});

/** Re-trace a line from its first cell to confirm it is a geodesic of the topology. */
function isGeodesic(t: Topology, cells: Int32Array): boolean {
  return t.localDirections(cells[0] as number).some((d0) => {
    let cur: { cell: number; dir: readonly number[] } | null = {
      cell: cells[0] as number,
      dir: d0,
    };
    for (let k = 1; k < cells.length; k++) {
      cur = t.step(cur.cell, cur.dir);
      if (cur === null || cur.cell !== cells[k]) return false;
    }
    return true;
  });
}

describe('line index structure', () => {
  const configs = [
    ...TOPOLOGY_IDS.flatMap((id) => [
      { id, n: 3, m: 3 },
      { id, n: 4, m: 4 },
    ]),
    { id: 'torus3' as const, n: 2, m: 2 },
    { id: 'tetracosm' as const, n: 2, m: 2 },
    { id: 'tesseract' as const, n: 2, m: 2 },
    { id: 'tetracosm' as const, n: 2, m: 3 },
  ];

  it.each(configs)(
    '$id N=$n M=$m: lines are distinct geodesics of M distinct cells',
    ({ id, n, m }) => {
      const t = createTopology(id, n);
      const index = buildLineIndex(t, m);
      expect(index.m).toBe(m);
      expect(index.cellCount).toBe(t.cellCount);
      expect(index.lines).toHaveLength(index.lineCount * m);
      const keys = new Set<string>();
      for (let i = 0; i < index.lineCount; i++) {
        const cells = lineCells(index, i);
        expect(new Set(cells).size).toBe(m);
        expect(isGeodesic(t, cells)).toBe(true);
        keys.add([...cells].sort((a, b) => a - b).join());
      }
      expect(keys.size).toBe(index.lineCount);
    },
  );

  it.each(configs)('$id N=$n M=$m: linesThrough agrees with lines', ({ id, n, m }) => {
    const index = buildLineIndex(createTopology(id, n), m);
    const { offsets, ids } = index.linesThrough;
    expect(offsets).toHaveLength(index.cellCount + 1);
    expect(offsets[0]).toBe(0);
    expect(offsets[index.cellCount]).toBe(ids.length);
    expect(ids.length).toBe(index.lineCount * m);
    for (let c = 0; c < index.cellCount; c++) {
      const through = [...linesThroughCell(index, c)];
      expect(through).toEqual([...through].sort((a, b) => a - b));
      const expected = [];
      for (let i = 0; i < index.lineCount; i++)
        if (lineCells(index, i).includes(c)) expected.push(i);
      expect(through).toEqual(expected);
    }
  });

  it('rejects traces that wrap around onto a cell they already visited', () => {
    // On the N=2 torus every geodesic closes after 2 cells, so no 3 cells are ever collinear.
    expect(buildLineIndex(createTopology('torus3', 2), 3).lineCount).toBe(0);
    // In the N=2 tetracosm, vertical geodesics are 8 cells long, so those lines survive.
    expect(buildLineIndex(createTopology('tetracosm', 2), 3).lineCount).toBeGreaterThan(0);
  });

  it('rejects M < 2', () => {
    expect(() => buildLineIndex(createTopology('torus3', 3), 1)).toThrow(RangeError);
  });

  it('builds the largest tesseract index quickly', () => {
    const start = performance.now();
    buildLineIndex(createTopology('tesseract', 4), 4);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
