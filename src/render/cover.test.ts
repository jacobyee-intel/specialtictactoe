import { describe, expect, it } from 'vitest';
import {
  buildLineIndex,
  createTopology,
  dir3,
  lineCells,
  type CubicQuotient,
  type CubicTopologyId,
} from '@/geometry';
import {
  applyCentred,
  blockOf,
  centredDeck,
  classifyLinear,
  coverCaption,
  coverCoords,
  det3,
  ghostInstances,
  ghostOffsets,
  landmarkBoxes,
  landmarkCopies,
  landmarkFrame,
  lineCoverPath,
  linear3,
  type Offset,
} from './cover';

const WRAPPED: CubicTopologyId[] = ['torus3', 'tetracosm', 'amphicosm1'];
const cubic = (id: CubicTopologyId, n: number) => createTopology(id, n) as CubicQuotient;

describe('ghostOffsets', () => {
  it('lists the 6 face neighbours or all 26', () => {
    expect(ghostOffsets('faces')).toHaveLength(6);
    expect(ghostOffsets('all')).toHaveLength(26);
    for (const o of ghostOffsets('faces')) expect(o.filter((v) => v !== 0)).toHaveLength(1);
    expect(new Set(ghostOffsets('all').map((o) => o.join())).size).toBe(26);
  });
});

describe('ghostInstances', () => {
  it.each(WRAPPED)('%s: every ghost reduces back to its cell, in its own block', (id) => {
    for (const n of [3, 4, 5, 6]) {
      const t = cubic(id, n);
      const ghosts = ghostInstances(t, 'all');
      expect(ghosts).toHaveLength(26 * n ** 3);
      for (const g of ghosts) {
        const r = t.reduce(coverCoords(n, g.pos), dir3(0, 0, 1));
        expect(r?.cell).toBe(g.cell);
        expect(blockOf(n, g.pos)).toEqual(g.offset);
      }
    }
  });

  it('the centred deck agrees with the integer deck on every cell centre', () => {
    for (const id of WRAPPED) {
      const t = cubic(id, 4);
      for (const offset of ghostOffsets('all')) {
        const D = centredDeck(t, offset);
        for (const g of ghostInstances(t, 'all').filter((x) => x.offset === offset)) {
          const q = t.coords(g.cell).map((v) => v + 0.5 - 2);
          expect(applyCentred(D, q)).toEqual(g.pos);
        }
      }
    }
  });
});

describe('deck transforms of the copies (what the captions claim)', () => {
  const zCopies: Offset[] = [
    [0, 0, 1],
    [0, 0, -1],
  ];
  const sideCopies: Offset[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];

  it.each([3, 4, 5, 6])('N=%i: x/y-face copies are pure translations by N in every space', (n) => {
    for (const id of WRAPPED) {
      for (const o of sideCopies) {
        const D = centredDeck(cubic(id, n), o);
        expect(classifyLinear(D.m).kind).toBe('identity');
        expect(D.t).toEqual(o.map((v) => v * n));
      }
    }
  });

  it.each([3, 4, 5, 6])('N=%i: the copies above and below', (n) => {
    for (const o of zCopies) {
      // 3-torus: identical copies, translated straight up or down.
      const torus = centredDeck(cubic('torus3', n), o);
      expect(classifyLinear(torus.m).kind).toBe('identity');
      // Tetracosm: a quarter turn about the vertical axis through the cube's centre.
      const tetra = centredDeck(cubic('tetracosm', n), o);
      const rot = classifyLinear(tetra.m);
      expect(rot).toMatchObject({ kind: 'rotation', det: 1 });
      expect(Math.abs(rot.angle)).toBe(90);
      // Clockwise seen from above for the copy above, counter-clockwise below.
      expect(rot.angle).toBe(o[2] === 1 ? -90 : 90);
      expect(linear3(tetra.m, [0, 0, 1])).toEqual([0, 0, 1]);
      // Amphicosm: mirrored in x (det −1), y and z kept.
      const amphi = centredDeck(cubic('amphicosm1', n), o);
      expect(det3(amphi.m)).toBe(-1);
      expect(linear3(amphi.m, [1, 0, 0])).toEqual([-1, 0, 0]);
      expect(linear3(amphi.m, [0, 1, 0])).toEqual([0, 1, 0]);
      // All of them sit exactly one block up or down (no sideways shift in the centred frame).
      for (const D of [torus, tetra, amphi]) expect(D.t).toEqual([0, 0, o[2] * n]);
    }
  });
});

describe('the chiral F', () => {
  it('is an F: three disjoint boxes on the floor, 0.6 N by 0.4 N, not symmetric', () => {
    for (const n of [3, 6]) {
      const boxes = landmarkBoxes(n);
      expect(boxes).toHaveLength(3);
      const minX = Math.min(...boxes.map((b) => b.min[0]));
      const maxX = Math.max(...boxes.map((b) => b.max[0]));
      const minY = Math.min(...boxes.map((b) => b.min[1]));
      const maxY = Math.max(...boxes.map((b) => b.max[1]));
      expect(maxX - minX).toBeCloseTo(0.4 * n, 9);
      expect(maxY - minY).toBeCloseTo(0.6 * n, 9);
      for (const b of boxes) expect(b.min[2]).toBeGreaterThan(-n / 2);
      for (const b of boxes) expect(b.max[2]).toBeLessThan(-n / 2 + 0.2);
      // Boxes do not overlap (no double blending in the translucent ghosts).
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          const [a, b] = [boxes[i], boxes[j]] as const;
          const overlap = [0, 1, 2].every(
            (k) =>
              (a?.min[k] as number) < (b?.max[k] as number) - 1e-9 &&
              (b?.min[k] as number) < (a?.max[k] as number) - 1e-9,
          );
          expect(overlap).toBe(false);
        }
      }
      expect(landmarkFrame(boxes)).toEqual({ right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] });
    }
  });

  const handedness = (f: ReturnType<typeof landmarkFrame>) => {
    const [r, u] = [f.right, f.up];
    return r[0] * u[1] - r[1] * u[0];
  };

  it.each(WRAPPED)('%s: the F of every copy, read back from its boxes', (id) => {
    for (const n of [3, 4, 5, 6]) {
      const t = cubic(id, n);
      const copies = landmarkCopies(t, 'all');
      expect(copies).toHaveLength(27);
      for (const copy of copies) {
        const frame = landmarkFrame(copy.boxes);
        const D = centredDeck(t, copy.offset);
        const z = copy.offset[2];
        // The F lies in its copy's floor, and handedness is the determinant of the deck.
        for (const b of copy.boxes)
          expect(
            blockOf(
              n,
              b.min.map((v, k) => (v + (b.max[k] as number)) / 2),
            ),
          ).toEqual(copy.offset);
        expect(handedness(frame)).toBe(det3(D.m));
        const mirrored = id === 'amphicosm1' && z !== 0;
        expect(det3(D.m)).toBe(mirrored ? -1 : 1);
        // The F's up direction tells the rotation: 90° in the tetracosm copies above and below.
        const angle = Math.round((Math.atan2(frame.up[1], frame.up[0]) * 180) / Math.PI) - 90;
        const expected = id === 'tetracosm' ? -90 * z : 0;
        expect((((angle - expected) % 360) + 360) % 360).toBe(0);
      }
    }
  });
});

describe('lineCoverPath', () => {
  it.each(WRAPPED)(
    '%s: straight, equally spaced, and reduces to the line, seams included',
    (id) => {
      for (const [n, m] of [
        [3, 3],
        [4, 4],
        [4, 3],
        [5, 4],
      ] as const) {
        const t = cubic(id, n);
        const index = buildLineIndex(t, m);
        let crossing = 0;
        for (let l = 0; l < index.lineCount; l++) {
          const cells = [...lineCells(index, l)];
          const path = lineCoverPath(t, cells);
          expect(path).toHaveLength(m);
          const d = [0, 1, 2].map((k) => (path[1]?.[k] as number) - (path[0]?.[k] as number));
          expect(d.every((v) => [-1, 0, 1].includes(v)) && d.some((v) => v !== 0)).toBe(true);
          path.forEach((p, k) => {
            p.forEach((v, axis) =>
              expect(v).toBeCloseTo((path[0]?.[axis] as number) + k * (d[axis] as number), 9),
            );
            expect(t.reduce(coverCoords(n, p), dir3(0, 0, 1))?.cell).toBe(cells[k]);
          });
          if (path.some((p) => p.some((v) => Math.abs(v) > n / 2))) crossing++;
        }
        // Some lines really do cross a seam (and are still straight).
        expect(crossing).toBeGreaterThan(0);
      }
    },
  );

  it('flat: the plain polyline inside the cube', () => {
    const t = cubic('flat', 3);
    const path = lineCoverPath(t, [0, 13, 26]);
    expect(path).toEqual([
      [-1, -1, -1],
      [0, 0, 0],
      [1, 1, 1],
    ]);
  });
});

describe('coverCaption', () => {
  it('says what the deck transforms do', () => {
    expect(coverCaption(cubic('torus3', 4))).toContain('Every copy is identical');
    const tetra = coverCaption(cubic('tetracosm', 5));
    expect(tetra).toContain('The copy above is turned a quarter turn: that is the holonomy');
    expect(tetra).toContain('The copies beside it are plain translations.');
    const amphi = coverCaption(cubic('amphicosm1', 3));
    expect(amphi).toContain('The copy above is mirrored');
    expect(amphi).toContain('non-orientable');
    expect(amphi).toContain('plain translations');
  });
});
