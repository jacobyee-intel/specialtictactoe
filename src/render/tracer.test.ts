import { describe, expect, it } from 'vitest';
import { createTopology, dir3, dir4, type CubicQuotient } from '@/geometry';
import { coverCoords } from './cover';
import { formatDir, trace, traceCaption } from './tracer';

const up = dir3(0, 0, 1);

describe('trace: cubic spaces', () => {
  it.each([3, 4, 5, 6])('tetracosm N=%i: vertical orbits are 4N, or N on the axis', (n) => {
    const t = createTopology('tetracosm', n);
    for (let c = 0; c < n * n; c++) {
      const r = trace(t, c, up);
      const [x, y] = t.coords(c) as [number, number, number];
      const onAxis = n % 2 === 1 && x === (n - 1) / 2 && y === (n - 1) / 2;
      expect(r.end).toBe('closed');
      expect(r.steps).toBe(onAxis ? n : 4 * n);
      expect(r.cells.at(-1)).toBe(c);
      const caption = traceCaption(t, r).text;
      expect(caption).toBe(
        onAxis
          ? `Closed after ${n} steps: this vertical line stays in one column. Its column is fixed: it is the centre column, which the quarter turn leaves in place, so the line closes after 1 pass.`
          : `Closed after ${4 * n} steps: this vertical line visits 4 columns. Each pass through the top turns the layer a quarter turn about the centre, so the line needs 4 passes to come home.`,
      );
    }
  });

  it.each([3, 4, 5, 6])('amphicosm N=%i: vertical orbits are 2N, or N on the mirror plane', (n) => {
    const t = createTopology('amphicosm1', n);
    for (let c = 0; c < n * n; c++) {
      const r = trace(t, c, up);
      const x = t.coords(c)[0] as number;
      const mirror = n % 2 === 1 && x === (n - 1) / 2;
      expect(r.end).toBe('closed');
      expect(r.steps).toBe(mirror ? n : 2 * n);
      expect(traceCaption(t, r).text).toBe(
        mirror
          ? `Closed after ${n} steps: this vertical line stays in one column. Its column is fixed: it lies in the mirror plane, which the mirror leaves in place, so the line closes after 1 pass.`
          : `Closed after ${2 * n} steps: this vertical line visits 2 columns. Each pass through the top mirrors the layer, so the line needs 2 passes to come home.`,
      );
      // The vertical direction itself is never changed: no "came back mirrored" wording.
      expect(r.holonomy).toBeUndefined();
    }
  });

  it('amphicosm: a slanted line on the mirror plane comes back mirrored first', () => {
    const n = 5;
    const t = createTopology('amphicosm1', n);
    const start = t.cellAt([2, 1, 0]);
    const r = trace(t, start, dir3(1, 0, 1));
    expect(r.firstReturn).toBe(n);
    expect(r.holonomy).toEqual([-1, 0, 1]);
    expect(r.end).toBe('closed');
    expect(r.steps).toBe(2 * n);
    expect(traceCaption(t, r).text).toBe(
      'Back where it started after 5 steps, but mirrored: the direction returned as (\u22121, 0, 1). Closed after 10 steps through 9 cells.',
    );
  });

  it('downward vertical lines count passes through the bottom', () => {
    const t = createTopology('tetracosm', 4);
    const r = trace(t, 5, dir3(0, 0, -1));
    expect(r.holonomy).toBeUndefined();
    expect(traceCaption(t, r).text).toBe(
      'Closed after 16 steps: this vertical line visits 4 columns. Each pass through the bottom turns the layer a quarter turn about the centre, so the line needs 4 passes to come home.',
    );
    const torus = createTopology('torus3', 4);
    expect(traceCaption(torus, trace(torus, 5, up)).text).toBe(
      'Closed after 4 steps: this vertical line stays in one column. Nothing turns at the top, so it closes after 1 pass.',
    );
  });

  it('torus: every line closes after N steps with no holonomy', () => {
    const t = createTopology('torus3', 4);
    for (const d of t.localDirections(0)) {
      const r = trace(t, 21, d);
      expect(r).toMatchObject({ end: 'closed', steps: 4 });
      expect(r.holonomy).toBeUndefined();
    }
  });

  it('the cover walk is straight and reduces to the cells', () => {
    for (const id of ['torus3', 'tetracosm', 'amphicosm1'] as const) {
      const t = createTopology(id, 4) as CubicQuotient;
      for (const d of t.localDirections(0)) {
        const r = trace(t, 5, d);
        r.cover?.forEach((p, k) => {
          expect(t.reduce(coverCoords(4, p), d)).toEqual({ cell: r.cells[k], dir: r.dirs[k] });
        });
      }
    }
  });

  it('flat: a walk ends at the boundary', () => {
    const t = createTopology('flat', 4);
    const r = trace(t, t.cellAt([1, 1, 1]), dir3(1, 0, 0));
    expect(r).toMatchObject({ end: 'boundary', steps: 2 });
    expect(traceCaption(t, r).text).toBe(
      'Stopped by the wall after 2 steps: the flat cube has a boundary, so lines end there.',
    );
  });

  it('stops at the limit', () => {
    const t = createTopology('tetracosm', 4);
    expect(trace(t, 0, up, 5)).toMatchObject({ end: 'limit', steps: 5 });
  });
});

describe('trace: tesseract', () => {
  it.each([2, 3, 4])('N=%i: an axis loop closes after 4N through 4 cubes', (n) => {
    const t = createTopology('tesseract', n);
    const start = t.cellAt([-1, 0, 0, 0]);
    const r = trace(t, start, dir4(0, 1, 0, 0));
    expect(r).toMatchObject({ end: 'closed', steps: 4 * n });
    expect(new Set(r.cells.map((c) => t.facet(c).index)).size).toBe(4);
    expect(traceCaption(t, r).text).toBe(
      `Closed after ${4 * n} steps through 4 cubes. It crossed 4 ridges, turning 90° in 4D at each, yet on the surface it never turns.`,
    );
  });

  it('a diagonal into an edge is blocked', () => {
    const t = createTopology('tesseract', 3);
    // Facet x = −1, at free (y, z, w) = (1, 1, 0), heading (y −1, z −1): it reaches the
    // corner column (0, 0) of the facet, then the next step would pass through an edge.
    const start = t.cellAt([-1, 1, 1, 0]);
    const r = trace(t, start, dir4(0, -1, -1, 0));
    expect(r).toMatchObject({ end: 'blocked', steps: 1, blockedAt: 'edge' });
    expect(traceCaption(t, r).text).toBe(
      'Blocked at an edge after 1 step: three cubes meet there at 270°, not 360°, so the line has no straight way on.',
    );
    const corner = trace(t, t.cellAt([-1, 0, 0, 0]), dir4(0, -1, -1, -1));
    expect(corner).toMatchObject({ end: 'blocked', steps: 0, blockedAt: 'vertex' });
  });
});

describe('formatDir', () => {
  it('uses true minus signs', () => {
    expect(formatDir([-1, 0, 1])).toBe('(\u22121, 0, 1)');
  });
});
