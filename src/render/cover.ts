/**
 * The universal cover of the wrapped cubic spaces, as seen from inside: the fundamental cube
 * surrounded by **ghost copies**, each placed by a deck transformation (`CubicQuotient`). Pure
 * (no three.js), so every claim the 3D view makes is tested in node.
 *
 * ## Frames
 *
 * Positions here are in the *centred model frame* of `sceneModel.ts`: engine axes, the
 * fundamental cube is [−N/2, N/2]³, and cell q has its centre at q + ½ − N/2.
 *
 * A deck transformation D(q) = m·q + t acts on integer cell coordinates (it sends cell q to the
 * cover cell D(q)). On continuous points it is x ↦ m·(x − ½) + t + ½ in cell units (so the unit
 * box of cell q goes to the unit box of cell D(q)); in the centred frame that is X ↦ m·X + t′
 * with t′ = m·(h − ½) + t + ½ − h, h = N/2. Its linear part m is a rotation about the vertical
 * axis through the centre of the cube (tetracosm), a mirror in the plane x = 0 (amphicosm) or
 * the identity (3-torus); t′ is then the translation by N·(i, j, k).
 */
import { applyAffine, type CellId, type CubicQuotient, type Dir, type Affine3 } from '@/geometry';
import type { Vec3 } from './four';

/** Which neighbouring copies to show. */
export type GhostRange = 'faces' | 'all';

/** A cover offset: the copy i blocks along x, j along y and k along z. */
export type Offset = readonly [number, number, number];

export interface GhostInstance {
  readonly offset: Offset;
  /** The cell this ghost is a copy of. */
  readonly cell: CellId;
  /** Its centre in the centred model frame. */
  readonly pos: Vec3;
}

/** An affine map of the centred model frame with real translation: X ↦ m·X + t. */
export interface CentredDeck {
  readonly m: readonly number[];
  readonly t: Vec3;
}

/** An axis-aligned box in the centred model frame. */
export interface Box3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The 6 face-adjacent copies, or all 26 neighbours, in a fixed order. */
export function ghostOffsets(range: GhostRange): Offset[] {
  const out: Offset[] = [];
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const nonzero = (i !== 0 ? 1 : 0) + (j !== 0 ? 1 : 0) + (k !== 0 ? 1 : 0);
        if (nonzero === 0 || (range === 'faces' && nonzero > 1)) continue;
        out.push([i, j, k]);
      }
    }
  }
  return out;
}

/** The centre of a cell in the centred model frame. */
export function cellCentre(topology: CubicQuotient, cell: CellId): Vec3 {
  const h = topology.n / 2;
  const q = topology.coords(cell);
  return [(q[0] as number) + 0.5 - h, (q[1] as number) + 0.5 - h, (q[2] as number) + 0.5 - h];
}

const row = (m: readonly number[], r: number, v: readonly number[]) =>
  (m[3 * r] as number) * (v[0] as number) +
  (m[3 * r + 1] as number) * (v[1] as number) +
  (m[3 * r + 2] as number) * (v[2] as number);

/** The linear part of a 3 × 3 row-major matrix applied to a vector. */
export function linear3(m: readonly number[], v: readonly number[]): Vec3 {
  return [row(m, 0, v), row(m, 1, v), row(m, 2, v)];
}

export function det3(m: readonly number[]): number {
  const e = (i: number) => m[i] as number;
  return (
    e(0) * (e(4) * e(8) - e(5) * e(7)) -
    e(1) * (e(3) * e(8) - e(5) * e(6)) +
    e(2) * (e(3) * e(7) - e(4) * e(6))
  );
}

/** The deck transformation of a cover offset, conjugated to the centred frame. */
export function centredDeck(topology: CubicQuotient, offset: Offset): CentredDeck {
  const D: Affine3 = topology.deckTransform(...(offset as [number, number, number]));
  const h = topology.n / 2;
  const s = h - 0.5;
  const ms = linear3(D.m, [s, s, s]);
  return {
    m: D.m,
    t: [0, 1, 2].map((k) => (ms[k] as number) + (D.t[k] as number) - s) as unknown as Vec3,
  };
}

export function applyCentred(D: CentredDeck, p: readonly number[]): Vec3 {
  const v = linear3(D.m, p);
  return [v[0] + D.t[0], v[1] + D.t[1], v[2] + D.t[2]];
}

/**
 * Every ghost cell of the chosen copies: for each offset, the cover cell D(q) of every cell q,
 * at its centre. `reduce` sends each one back to `cell` (tested).
 */
export function ghostInstances(topology: CubicQuotient, range: GhostRange): GhostInstance[] {
  const out: GhostInstance[] = [];
  const h = topology.n / 2;
  for (const offset of ghostOffsets(range)) {
    const D = topology.deckTransform(...(offset as [number, number, number]));
    for (let cell = 0; cell < topology.cellCount; cell++) {
      const q = applyAffine(D, topology.coords(cell));
      out.push({
        offset,
        cell,
        pos: [(q[0] as number) + 0.5 - h, (q[1] as number) + 0.5 - h, (q[2] as number) + 0.5 - h],
      });
    }
  }
  return out;
}

/** The integer cover coordinates of a cell centre given in the centred frame. */
export function coverCoords(n: number, p: readonly number[]): number[] {
  return p.map((v) => Math.round(v + n / 2 - 0.5));
}

/** The cover block a centred point lies in: (0, 0, 0) is the fundamental cube. */
export function blockOf(n: number, p: readonly number[]): Offset {
  const h = n / 2;
  const b = p.map((v) => Math.floor((v + h) / n));
  return [b[0] as number, b[1] as number, b[2] as number];
}

/**
 * The local direction of each cell of a walk `cells` (consecutive cells one step apart): the
 * direction that leaves cell i towards cell i + 1, and for the last cell the direction it was
 * entered with. Null if the cells are not one geodesic.
 */
export function walkDirs(topology: CubicQuotient, cells: readonly CellId[]): Dir[] | null {
  const first = cells[0];
  if (first === undefined) return null;
  if (cells.length === 1) return [topology.localDirections(first)[0] as Dir];
  for (const d0 of topology.localDirections(first)) {
    const dirs: Dir[] = [d0];
    let cur = first;
    let d = d0;
    let ok = true;
    for (let i = 1; i < cells.length; i++) {
      const r = topology.step(cur, d);
      if (r === null || r.cell !== cells[i]) {
        ok = false;
        break;
      }
      cur = r.cell;
      d = r.dir;
      dirs.push(d);
    }
    if (ok) return dirs;
  }
  return null;
}

const outside = (h: number, p: Vec3) => p.reduce((sum, v) => sum + Math.max(0, Math.abs(v) - h), 0);

/**
 * A line of the quotient drawn in the cover: M points p₀ + k·d, equally spaced and collinear,
 * that reduce back to the line's cells. Of the M lifts (one anchored at each cell, inside the
 * fundamental cube), the one that stays closest to the fundamental cube is chosen, so the line
 * runs out of the cube into one neighbouring copy rather than far away.
 */
export function lineCoverPath(topology: CubicQuotient, cells: readonly CellId[]): Vec3[] {
  const dirs = walkDirs(topology, cells);
  if (dirs === null) throw new RangeError('Not a line: consecutive cells are not one step apart.');
  const h = topology.n / 2;
  let best: Vec3[] = [];
  let bestScore = Infinity;
  cells.forEach((cell, anchor) => {
    const c = cellCentre(topology, cell);
    const d = dirs[anchor] as Dir;
    const path = cells.map(
      (_, j) =>
        [
          c[0] + (j - anchor) * (d[0] as number),
          c[1] + (j - anchor) * (d[1] as number),
          c[2] + (j - anchor) * (d[2] as number),
        ] as Vec3,
    );
    const score = path.reduce((s, p) => s + outside(h, p), 0);
    if (score < bestScore - 1e-9) {
      best = path;
      bestScore = score;
    }
  });
  return best;
}

// --- The chiral landmark ----------------------------------------------------------------------

/**
 * A black "F" lying on the floor (z = −N/2) of the fundamental cube near the origin corner,
 * 0.6 N tall (along +y) and 0.4 N wide (along +x), built from three boxes that do not overlap:
 * the stem, the top bar and the middle bar, in that order. An F has no mirror symmetry and no
 * rotational symmetry, so each ghost copy shows exactly what its deck transform does.
 */
export function landmarkBoxes(n: number): Box3[] {
  const h = n / 2;
  const t = 0.12 * n; // stroke
  const H = 0.6 * n;
  const W = 0.4 * n;
  const x0 = -h + 0.1 * n;
  const y0 = -h + 0.1 * n;
  const z0 = -h + 0.01;
  const z1 = -h + 0.01 + Math.max(0.06, 0.012 * n);
  const mid = y0 + 0.55 * H;
  return [
    { min: [x0, y0, z0], max: [x0 + t, y0 + H, z1] },
    { min: [x0 + t, y0 + H - t, z0], max: [x0 + W, y0 + H, z1] },
    { min: [x0 + t, mid - t, z0], max: [x0 + 0.75 * W, mid, z1] },
  ];
}

/** The image of a box under a deck transform (exact: the linear parts are signed permutations). */
export function transformBox(D: CentredDeck, box: Box3): Box3 {
  const a = applyCentred(D, box.min);
  const b = applyCentred(D, box.max);
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

export interface LandmarkCopy {
  /** (0, 0, 0) for the fundamental cube. */
  readonly offset: Offset;
  readonly boxes: readonly Box3[];
}

/** The F of the fundamental cube, then its image in every shown copy. */
export function landmarkCopies(topology: CubicQuotient, range: GhostRange): LandmarkCopy[] {
  const base = landmarkBoxes(topology.n);
  return [[0, 0, 0] as Offset, ...ghostOffsets(range)].map((offset) => {
    const D = centredDeck(topology, offset);
    return { offset, boxes: base.map((b) => transformBox(D, b)) };
  });
}

const centreOf = (b: Box3): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];

/**
 * Read an F back from its three boxes: `up` runs along the stem towards the top bar, `right`
 * from the stem towards the bars. For the original F these are +y and +x; the sign of
 * (right × up)·n, with n the normal of the floor, says whether the F is mirrored.
 */
export function landmarkFrame(boxes: readonly Box3[]): { right: Vec3; up: Vec3; normal: Vec3 } {
  const [stem, top] = boxes as [Box3, Box3];
  const extent = [0, 1, 2].map((k) => (stem.max[k] as number) - (stem.min[k] as number));
  const thin = extent.indexOf(Math.min(...extent));
  const long = extent.indexOf(Math.max(...extent));
  const across = 3 - thin - long;
  const s = centreOf(stem);
  const c = centreOf(top);
  const axis = (k: number, sign: number): Vec3 =>
    [0, 1, 2].map((i) => (i === k ? Math.sign(sign) : 0)) as unknown as Vec3;
  return {
    up: axis(long, (c[long] as number) - (s[long] as number)),
    right: axis(across, (c[across] as number) - (s[across] as number)),
    normal: axis(thin, 1),
  };
}

/**
 * How a copy's linear part acts: 'identity', a 'rotation' about z by `angle` degrees
 * (counter-clockwise seen from above), or a 'mirror'.
 */
export function classifyLinear(m: readonly number[]): {
  kind: 'identity' | 'rotation' | 'mirror';
  angle: number;
  det: number;
} {
  const det = det3(m);
  const x = linear3(m, [1, 0, 0]);
  const angle = Math.round((Math.atan2(x[1], x[0]) * 180) / Math.PI);
  if (det < 0) return { kind: 'mirror', angle, det };
  return { kind: angle === 0 ? 'identity' : 'rotation', angle, det };
}

/**
 * The inside-view caption, derived from the deck transforms rather than written per space, so
 * it cannot claim something the picture does not show: what the copy above does (from the
 * linear part of the deck transform for offset (0, 0, 1)), and that the side copies are plain
 * translations (checked, not assumed).
 */
export function coverCaption(topology: CubicQuotient): string {
  const above = classifyLinear(centredDeck(topology, [0, 0, 1]).m);
  const sidesPlain = ghostOffsets('faces')
    .filter((o) => o[2] === 0)
    .every((o) => classifyLinear(centredDeck(topology, o).m).kind === 'identity');
  const sides = sidesPlain ? ' The copies beside it are plain translations.' : '';
  const intro = 'You are looking at one cube and its neighbouring copies.';
  switch (above.kind) {
    case 'identity':
      return `${intro} Every copy is identical, above and beside: the 3-torus has no holonomy.`;
    case 'rotation': {
      const turn = Math.abs(above.angle) === 90 ? 'a quarter turn' : `${Math.abs(above.angle)}°`;
      return `${intro} The copy above is turned ${turn}: that is the holonomy of this space. Follow the F.${sides}`;
    }
    case 'mirror':
      return `${intro} The copy above is mirrored: that is the holonomy of this space, and why it is non-orientable. Follow the F.${sides}`;
  }
}
