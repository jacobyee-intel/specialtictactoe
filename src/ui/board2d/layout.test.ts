import { describe, expect, it } from 'vitest';
import { CubicQuotient, TesseractSurface, createTopology, type TopologyId } from '@/geometry';
import {
  CELL_SIZES,
  GUTTER,
  PANEL_TITLE,
  SEAM_CAPTIONS,
  defaultGroup,
  filterGroup,
  fitPanels,
  layoutPanels,
  packPanels,
  panelGroups,
  type Panel,
} from './layout';

const SPACES: readonly [TopologyId, number][] = [
  ['flat', 3],
  ['torus3', 3],
  ['torus3', 4],
  ['tetracosm', 3],
  ['tetracosm', 4],
  ['amphicosm1', 3],
  ['amphicosm1', 5],
  ['tesseract', 2],
  ['tesseract', 3],
];

const at = (panel: Panel, col: number, row: number) =>
  panel.cells.find((c) => c.col === col && c.row === row);

describe('layoutPanels', () => {
  it.each(SPACES)('shows every real cell of %s N=%i exactly once', (id, n) => {
    const topology = createTopology(id, n);
    for (const halos of [false, true]) {
      const seen = new Map<number, number>();
      for (const p of layoutPanels(topology, { halos })) {
        for (const c of p.cells) {
          if (c.kind === 'cell') {
            expect(c.cell).not.toBeNull();
            seen.set(c.cell as number, (seen.get(c.cell as number) ?? 0) + 1);
          } else {
            expect(c.cell).toBeNull();
            expect(c.ghostOf).toBeGreaterThanOrEqual(0);
          }
        }
      }
      expect(seen.size).toBe(topology.cellCount);
      expect([...seen.values()].every((k) => k === 1)).toBe(true);
    }
  });

  it('places real cells where layout2D says, inside the halo ring', () => {
    const topology = createTopology('tetracosm', 4);
    const panels = layoutPanels(topology, { halos: true });
    for (const p of panels.slice(0, 4)) {
      for (const c of p.cells.filter((c) => c.kind === 'cell')) {
        const l = topology.layout2D(c.cell as number);
        expect(p.key).toBe(`z${l.panel}`);
        expect([c.col - 1, c.row - 1]).toEqual([l.col, l.row]);
      }
    }
  });

  it('gives the flat cube a solid boundary and no halos or seam panel', () => {
    const panels = layoutPanels(createTopology('flat', 3), { halos: true });
    expect(panels.map((p) => p.title)).toEqual(['z = 0', 'z = 1', 'z = 2']);
    expect(panels.every((p) => p.frame === 'boundary' && p.cols === 3)).toBe(true);
    expect(panels.flatMap((p) => p.cells).every((c) => c.kind === 'cell')).toBe(true);
  });

  it('drops the halo ring when the toggle is off but keeps the seam panel', () => {
    const panels = layoutPanels(createTopology('torus3', 3), { halos: false });
    expect(panels).toHaveLength(4);
    expect(panels.slice(0, 3).every((p) => p.cells.every((c) => c.kind === 'cell'))).toBe(true);
    expect(panels[3]?.frame).toBe('ghost');
  });

  describe('halos', () => {
    it.each(['torus3', 'tetracosm', 'amphicosm1'] as const)(
      'hold reduce() of the out-of-range coordinates in %s',
      (id) => {
        const n = 4;
        const topology = new CubicQuotient(id, n);
        const panels = layoutPanels(topology, { halos: true });
        for (let z = 0; z < n; z++) {
          const p = panels[z] as Panel;
          expect(p.cols).toBe(n + 2);
          for (const c of p.cells.filter((c) => c.kind === 'halo')) {
            const hit = topology.reduce([c.col - 1, c.row - 1, z], [0, 0, 1]);
            expect(c.ghostOf).toBe(hit?.cell);
          }
          // A ring of 4N + 4 ghosts.
          expect(p.cells.filter((c) => c.kind === 'halo')).toHaveLength(4 * n + 4);
        }
      },
    );

    it('wrap plainly in x and y: torus3 (−1, y) is (N−1, y)', () => {
      const n = 3;
      const topology = new CubicQuotient('torus3', n);
      const panels = layoutPanels(topology, { halos: true });
      for (let z = 0; z < n; z++) {
        for (let y = 0; y < n; y++) {
          expect(at(panels[z] as Panel, 0, y + 1)?.ghostOf).toBe(topology.cellAt([n - 1, y, z]));
          expect(at(panels[z] as Panel, n + 1, y + 1)?.ghostOf).toBe(topology.cellAt([0, y, z]));
          expect(at(panels[z] as Panel, y + 1, 0)?.ghostOf).toBe(topology.cellAt([y, n - 1, z]));
        }
        expect(at(panels[z] as Panel, 0, 0)?.ghostOf).toBe(topology.cellAt([n - 1, n - 1, z]));
      }
    });

    it('are plain wraps in the twisted spaces too (the twist is only in z)', () => {
      for (const id of ['tetracosm', 'amphicosm1'] as const) {
        const topology = new CubicQuotient(id, 3);
        const twisted = layoutPanels(topology, { halos: true });
        const plain = layoutPanels(new CubicQuotient('torus3', 3), { halos: true });
        for (let z = 0; z < 3; z++) {
          expect(twisted[z]?.cells.map((c) => c.ghostOf ?? c.cell)).toEqual(
            plain[z]?.cells.map((c) => c.ghostOf ?? c.cell),
          );
        }
      }
    });
  });

  describe('the seam panel (slice 0 seen from above the top)', () => {
    /** The seam panel as a row-major grid of (x, y) coordinates of the slice-0 cells it shows. */
    function seamGrid(id: 'torus3' | 'tetracosm' | 'amphicosm1', n: number, halos: boolean) {
      const topology = new CubicQuotient(id, n);
      const panels = layoutPanels(topology, { halos });
      const seam = panels.at(-1) as Panel;
      expect(seam.key).toBe('seam');
      expect(seam.title).toBe(`z = ${n} ≡ 0 (glued)`);
      expect(seam.caption).toBe(SEAM_CAPTIONS[id]);
      const off = halos ? 1 : 0;
      const grid: number[][][] = [];
      for (let y = 0; y < n; y++) {
        const row: number[][] = [];
        for (let x = 0; x < n; x++) {
          const c = at(seam, x + off, y + off);
          expect(c?.kind).toBe('seam');
          const q = topology.coords(c?.ghostOf as number);
          expect(q[2]).toBe(0);
          row.push([q[0] as number, q[1] as number]);
        }
        grid.push(row);
      }
      return grid;
    }

    it.each([3, 4])('is an exact copy of slice 0 in the 3-torus (N=%i)', (n) => {
      const grid = seamGrid('torus3', n, true);
      grid.forEach((row, y) => row.forEach((q, x) => expect(q).toEqual([x, y])));
    });

    it.each([3, 4, 5])('is slice 0 turned a quarter turn in the tetracosm (N=%i)', (n) => {
      // G(x, y) = (N−1−y, x) from plans/01-geometry.md.
      for (const halos of [true, false]) {
        const grid = seamGrid('tetracosm', n, halos);
        grid.forEach((row, y) => row.forEach((q, x) => expect(q).toEqual([n - 1 - y, x])));
      }
      // Seen as a picture: the seam panel's rows are slice 0's columns, reversed. That is a
      // rotation (not a reflection): applying it four times gives back the identity.
      const grid = seamGrid('tetracosm', n, false);
      const rot = (x: number, y: number) => grid[y]?.[x] as number[];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let [a, b] = [x, y];
          for (let k = 0; k < 4; k++) [a, b] = rot(a, b) as [number, number];
          expect([a, b]).toEqual([x, y]);
          const [a2, b2] = rot(...(rot(x, y) as [number, number])) as [number, number];
          expect([a2, b2]).toEqual([n - 1 - x, n - 1 - y]);
        }
      }
    });

    it.each([3, 4])('is slice 0 mirrored left–right in the amphicosm (N=%i)', (n) => {
      // G(x, y) = (N−1−x, y) from plans/01-geometry.md.
      const grid = seamGrid('amphicosm1', n, true);
      grid.forEach((row, y) => row.forEach((q, x) => expect(q).toEqual([n - 1 - x, y])));
    });

    it('agrees with stepping up from the top slice', () => {
      for (const id of ['torus3', 'tetracosm', 'amphicosm1'] as const) {
        const topology = new CubicQuotient(id, 4);
        const seam = layoutPanels(topology, { halos: false }).at(-1) as Panel;
        for (const c of seam.cells) {
          const top = topology.cellAt([c.col, c.row, 3]);
          expect(topology.step(top, [0, 0, 1])?.cell).toBe(c.ghostOf);
        }
      }
    });
  });

  describe('tesseract', () => {
    it.each([2, 3, 4])('has 8N panels in 8 cube groups (N=%i)', (n) => {
      const topology = new TesseractSurface(n);
      const panels = layoutPanels(topology, { halos: true });
      expect(panels).toHaveLength(8 * n);
      const groups = panelGroups(panels);
      expect(groups.map((g) => g.title)).toEqual([
        'Cube x = 0',
        `Cube x = ${n}`,
        'Cube y = 0',
        `Cube y = ${n}`,
        'Cube z = 0',
        `Cube z = ${n}`,
        'Cube w = 0',
        `Cube w = ${n}`,
      ]);
      for (const g of groups) expect(filterGroup(panels, g.index)).toHaveLength(n);
      expect(panels.flatMap((p) => p.cells).some((c) => c.kind !== 'cell')).toBe(false);
    });

    it('slices each cube along its third free axis', () => {
      const topology = new TesseractSurface(3);
      const panels = layoutPanels(topology, { halos: false });
      // Cube w = 0 has free axes x, y, z: panels are z-slices with x across and y down.
      const w0 = filterGroup(panels, 6);
      expect(w0.map((p) => p.title)).toEqual(['z = 0', 'z = 1', 'z = 2']);
      expect(w0[0]?.axes).toEqual({ col: 'x', row: 'y' });
      // Cube x = 0 has free axes y, z, w: panels are w-slices.
      expect(filterGroup(panels, 0)[1]?.title).toBe('w = 1');
      expect(filterGroup(panels, 0)[0]?.axes).toEqual({ col: 'y', row: 'z' });
      for (const p of panels) {
        for (const c of p.cells) {
          const q = topology.coords(c.cell as number);
          const facet = topology.facet(c.cell as number);
          expect(p.groupIndex).toBe(facet.index);
          const free = [0, 1, 2, 3].filter((k) => k !== facet.axis);
          expect([c.col, c.row]).toEqual([q[free[0] as number], q[free[1] as number]]);
          expect(p.title).toBe(`${'xyzw'[free[2] as number]} = ${q[free[2] as number]}`);
        }
      }
    });
  });
});

describe('packing', () => {
  const flat = layoutPanels(createTopology('flat', 3), { halos: false });

  it('flows panels left to right with 24 px gutters and wraps', () => {
    const p = packPanels(flat, 48, 1000);
    expect(p.panels.map((x) => [x.x, x.y])).toEqual([
      [0, 0],
      [144 + GUTTER, 0],
      [2 * (144 + GUTTER), 0],
    ]);
    expect(p.height).toBe(PANEL_TITLE + 144);
    const narrow = packPanels(flat, 48, 300);
    expect(narrow.panels.map((x) => [x.x, x.y])).toEqual([
      [0, 0],
      [0, PANEL_TITLE + 144 + GUTTER],
      [0, 2 * (PANEL_TITLE + 144 + GUTTER)],
    ]);
  });

  it('picks the largest cell size that fits', () => {
    expect(fitPanels(flat, { width: 660, height: 560 })).toMatchObject({
      cellSize: 48,
      fits: true,
    });
    const tight = fitPanels(flat, { width: 660, height: 100 });
    expect(tight.cellSize).toBe(24);
    const never = fitPanels(flat, { width: 40, height: 40 });
    expect(never).toMatchObject({ cellSize: CELL_SIZES.at(-1), fits: false });
  });

  it('puts a heading above each tesseract cube', () => {
    const panels = layoutPanels(createTopology('tesseract', 2), { halos: false });
    const p = packPanels(panels, 16, 2000);
    expect(p.headings.map((h) => h.text)).toHaveLength(8);
    expect(p.panels[0]?.y).toBeGreaterThan(p.headings[0]?.y as number);
  });

  it('shows all cubes by default only when they fit at 16 px or more', () => {
    const zone = { width: 660, height: 560 };
    const t3 = layoutPanels(createTopology('tesseract', 3), { halos: false });
    expect(defaultGroup(t3, zone)).toBeNull();
    const t4 = layoutPanels(createTopology('tesseract', 4), { halos: false });
    expect(defaultGroup(t4, zone)).toBe(0);
    expect(fitPanels(filterGroup(t4, 0), zone).cellSize).toBe(CELL_SIZES[0]);
    // The cubic spaces have no filter.
    expect(defaultGroup(flat, { width: 10, height: 10 })).toBeNull();
  });
});
