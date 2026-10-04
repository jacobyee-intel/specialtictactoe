import { describe, expect, it } from 'vitest';
import { TesseractSurface, dir4, type Dir } from '@/geometry';

/** Number of steps until the state (cell, direction) first returns to its start, or -1 if blocked. */
function orbitLength(t: TesseractSurface, start: number, d0: Dir): number {
  let cell = start;
  let dir = d0;
  for (let k = 1; k <= 10 * t.cellCount; k++) {
    const r = t.step(cell, dir);
    if (r === null) return -1;
    ({ cell, dir } = r);
    if (cell === start && dir === d0) return k;
  }
  throw new Error('no return');
}

describe('TesseractSurface', () => {
  it.each([2, 3, 4])('N=%i has 8N³ cells and 8N panels', (n) => {
    const t = new TesseractSurface(n);
    expect(t.cellCount).toBe(8 * n ** 3);
    expect(t.panelCount).toBe(8 * n);
    expect(t.dim).toBe(4);
  });

  it('is facet-major with the fixed coordinate at -1 or N', () => {
    const t = new TesseractSurface(3);
    expect(t.facet(0)).toEqual({ index: 0, axis: 0, side: 0 });
    expect(t.facet(27 * 7 + 5)).toEqual({ index: 7, axis: 3, side: 1 });
    // Facet 0 (x0 = 0 side): free axes 1, 2, 3 with axis 1 fastest.
    expect(t.coords(8)).toEqual([-1, 2, 2, 0]);
    // Facet 3 (x1 = N side): free axes 0, 2, 3.
    expect(t.coords(3 * 27 + 1 + 3 * 2 + 9 * 1)).toEqual([1, 3, 2, 1]);
    expect(t.layout2D(3 * 27 + 1 + 3 * 2 + 9 * 1)).toEqual({ panel: 3 * 3 + 1, row: 2, col: 1 });
  });

  it('local directions are tangent to the facet (zero along the fixed axis)', () => {
    const t = new TesseractSurface(2);
    for (let c = 0; c < t.cellCount; c++) {
      const a = t.facet(c).axis;
      expect(t.localDirections(c).every((d) => d[a] === 0)).toBe(true);
    }
  });

  it.each([2, 3, 4])('N=%i: every straight axis loop closes after exactly 4N steps', (n) => {
    const t = new TesseractSurface(n);
    for (let c = 0; c < t.cellCount; c++) {
      for (const d of t.localDirections(c)) {
        if (d.filter((v) => v !== 0).length === 1) expect(orbitLength(t, c, d)).toBe(4 * n);
      }
    }
  });

  it('blocks a diagonal step into a cube edge (where 3 facets meet)', () => {
    const t = new TesseractSurface(3);
    expect(t.coords(8)).toEqual([-1, 2, 2, 0]);
    expect(t.step(8, dir4(0, 1, 1, 0))).toBeNull();
    // ...and into a vertex (where 4 facets meet).
    expect(t.step(26, dir4(0, 1, 1, 1))).toBeNull();
    // The same diagonal one cell away from the edge crosses a ridge instead.
    expect(t.step(5, dir4(0, 1, 1, 0))).not.toBeNull();
  });

  it('crossing a ridge turns the direction by 90° through the fourth dimension', () => {
    const t = new TesseractSurface(3);
    expect(t.coords(2)).toEqual([-1, 2, 0, 0]);
    const straight = t.step(2, dir4(0, 1, 0, 0));
    expect(straight).toEqual({ cell: 3 * 27, dir: dir4(1, 0, 0, 0) });
    expect(t.coords(3 * 27)).toEqual([0, 3, 0, 0]);
    // The old and new directions are orthogonal 4D vectors.
    const dot = [0, 1, 0, 0].reduce((s, v, i) => s + v * (straight?.dir[i] ?? 0), 0);
    expect(dot).toBe(0);

    // A diagonal keeps its in-ridge component and rotates the rest.
    expect(t.step(2, dir4(0, 1, 1, 0))).toEqual({ cell: 3 * 27 + 3, dir: dir4(1, 0, 1, 0) });
    // Leaving a plus-side facet points the new direction back toward the minus side.
    const plus = t.cellAt([3, 0, 1, 2]);
    expect(t.step(plus, dir4(0, -1, 0, 0))).toEqual({
      cell: t.cellAt([2, -1, 1, 2]),
      dir: dir4(-1, 0, 0, 0),
    });
  });

  it('rejects directions that are not tangent unit vectors', () => {
    const t = new TesseractSurface(3);
    expect(() => t.step(0, dir4(1, 0, 0, 0))).toThrow(RangeError);
    expect(() => t.step(0, [0, 1, 0])).toThrow(RangeError);
    expect(() => t.step(0, [0, 2, 0, 0])).toThrow(RangeError);
    expect(() => new TesseractSurface(0)).toThrow(RangeError);
  });

  it('rejects coordinates that are not a cell', () => {
    const t = new TesseractSurface(3);
    for (const bad of [
      [0, 0, 0, 0],
      [-1, 3, 0, 0],
      [-1, 0, 0],
      [-1, 0.5, 0, 0],
      [-1, 0, 4, 0],
    ]) {
      expect(() => t.cellAt(bad)).toThrow(RangeError);
    }
  });
});
