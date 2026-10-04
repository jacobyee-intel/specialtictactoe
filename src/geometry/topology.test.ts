/** Structural properties that every space must satisfy. */
import { describe, expect, it } from 'vitest';
import { TOPOLOGY_IDS, createTopology, internDir, isUnitDir, negateDir } from '@/geometry';

const CASES = TOPOLOGY_IDS.flatMap((id) => [3, 4].map((n) => ({ id, n })));

describe.each(CASES)('$id N=$n', ({ id, n }) => {
  const t = createTopology(id, n);

  it('has 26 distinct unit local directions per cell', () => {
    for (let c = 0; c < t.cellCount; c++) {
      const dirs = t.localDirections(c);
      expect(dirs).toHaveLength(26);
      expect(new Set(dirs).size).toBe(26);
      expect(dirs.every((d) => d.length === t.dim && isUnitDir(d))).toBe(true);
    }
  });

  it('is reversible: stepping back along the negated new direction returns home', () => {
    for (let c = 0; c < t.cellCount; c++) {
      for (const d of t.localDirections(c)) {
        const r = t.step(c, d);
        if (r === null) continue;
        expect(t.step(r.cell, negateDir(r.dir))).toEqual({ cell: c, dir: negateDir(d) });
      }
    }
  });

  it('returns interned directions from step', () => {
    for (let c = 0; c < t.cellCount; c++) {
      for (const d of t.localDirections(c)) {
        const r = t.step(c, d);
        if (r !== null) expect(r.dir).toBe(internDir(r.dir));
      }
    }
  });

  it('round-trips coords and cellAt, and lays out cells injectively', () => {
    const seen = new Set<string>();
    for (let c = 0; c < t.cellCount; c++) {
      const p = t.coords(c);
      expect(p).toHaveLength(t.dim);
      expect(t.cellAt(p)).toBe(c);
      const { panel, row, col } = t.layout2D(c);
      expect(panel).toBeGreaterThanOrEqual(0);
      expect(panel).toBeLessThan(t.panelCount);
      for (const v of [row, col]) expect(v >= 0 && v < n).toBe(true);
      seen.add(`${panel},${row},${col}`);
    }
    expect(seen.size).toBe(t.cellCount);
    expect(t.panelCount * n * n).toBe(t.cellCount);
  });

  it('rejects invalid cell ids', () => {
    for (const bad of [-1, t.cellCount, 0.5]) {
      expect(() => t.step(bad, t.localDirections(0)[0] ?? [])).toThrow(RangeError);
      expect(() => t.coords(bad)).toThrow(RangeError);
      expect(() => t.layout2D(bad)).toThrow(RangeError);
      expect(() => t.localDirections(bad)).toThrow(RangeError);
    }
  });
});
