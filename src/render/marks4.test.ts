import { describe, expect, it } from 'vitest';
import { createTopology, type TesseractSurface } from '@/geometry';
import {
  CAMERA_W_FACTOR,
  cellCentre4,
  cellCorners4,
  project4to3,
  rotation4,
  type Mat4,
  type Planes4,
  type Vec3,
  type Vec4,
} from './four';
import { HEX_FACES, hexOrientation } from './hexahedron';
import {
  BALL,
  MARK_SIZE,
  orientation4,
  unitSphere,
  writeBall4,
  writeBox4,
  writeTriangles,
} from './marks4';
import { buildSceneModel, toWorld, type SceneModel } from './sceneModel';

const deg = (d: number) => (d * Math.PI) / 180;
const ANGLES: [string, Planes4][] = [
  ['identity', { xw: 0, yw: 0, zw: 0 }],
  ['XW 40°', { xw: deg(40), yw: 0, zw: 0 }],
  ['XW 80°', { xw: deg(80), yw: 0, zw: 0 }],
  ['XW 80°, YW, ZW', { xw: deg(80), yw: 0.3, zw: -1.2 }],
];

const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - (b[i] as number));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, v, i) => s + v * (b[i] as number), 0);
const norm = (a: readonly number[]) => Math.sqrt(dot(a, a));
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const mean = (ps: readonly (readonly number[])[]) =>
  (ps[0] as readonly number[]).map((_, k) => ps.reduce((s, p) => s + p[k]!, 0) / ps.length);
const points = (out: Float32Array, count: number, from = 0): Vec3[] =>
  Array.from({ length: count }, (_, i) => [
    out[3 * (from + i)]!,
    out[3 * (from + i) + 1]!,
    out[3 * (from + i) + 2]!,
  ]);

function setup(n: number, planes4: Planes4) {
  const t = createTopology('tesseract', n) as TesseractSurface;
  const model: SceneModel = buildSceneModel(
    {
      topology: t,
      board: new Uint8Array(t.cellCount),
      received: new Set(),
      lastMove: null,
      win: null,
      threats: [],
    },
    { planes4 },
  );
  const R: Mat4 = rotation4(planes4);
  const cameraW = CAMERA_W_FACTOR * n;
  /** A 4D point (before rotation) in the scene: rotate, project, map to three's frame. */
  const scene = (p: readonly number[]) => toWorld(project4to3(p as Vec4, R, cameraW).p);
  return { t, model, R, cameraW, scene };
}

/** The cell's 4D cube shrunk by `f` towards its 4D centre (before rotation). */
const shrink4 = (corners: readonly Vec4[], f: number) => {
  const c = mean(corners);
  return corners.map((p) => p.map((v, k) => c[k]! + f * (v - c[k]!)));
};

/** Outward face planes of a convex hexahedron in `cellCorners4` order. */
function facePlanes(c: readonly Vec3[]) {
  const mid = mean(c);
  return HEX_FACES.map(([a, b, , e]) => {
    const o = c[a]!;
    let nrm = cross(sub(c[b]!, o), sub(c[e]!, o));
    if (dot(nrm, sub(mid, o)) > 0) nrm = nrm.map((v) => -v) as unknown as Vec3;
    const l = norm(nrm);
    return { n: nrm.map((v) => v / l), d: dot(nrm, o) / l };
  });
}

/** Least-squares quadric Q(x) + L·x = 1 through centred points; its residual and its form. */
function fitQuadric(ps: readonly Vec3[]) {
  const c = mean(ps);
  const rows = ps.map((p) => {
    const [x, y, z] = sub(p, c) as [number, number, number];
    return [x * x, y * y, z * z, x * y, x * z, y * z, x, y, z];
  });
  const m = 9;
  const a = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) =>
      j < m ? rows.reduce((s, r) => s + r[i]! * r[j]!, 0) : rows.reduce((s, r) => s + r[i]!, 0),
    ),
  );
  for (let i = 0; i < m; i++) {
    let best = i;
    for (let r = i + 1; r < m; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[best]![i]!)) best = r;
    [a[i], a[best]] = [a[best]!, a[i]!];
    for (let r = 0; r < m; r++) {
      if (r === i) continue;
      const f = a[r]![i]! / a[i]![i]!;
      for (let j = i; j <= m; j++) a[r]![j]! -= f * a[i]![j]!;
    }
  }
  const q = a.map((row, i) => row[m]! / row[i]!);
  const residual = Math.max(...rows.map((r) => Math.abs(dot(r, q) - 1)));
  const [A, B, C, D, E, F] = q as [number, number, number, number, number, number];
  // Sylvester: the quadratic form is positive definite iff its leading minors are positive.
  const minors = [
    A,
    A * B - (D / 2) ** 2,
    A * (B * C - (F / 2) ** 2) -
      (D / 2) * ((D / 2) * C - (F / 2) * (E / 2)) +
      (E / 2) * ((D / 2) * (F / 2) - B * (E / 2)),
  ];
  return { residual, minors };
}

describe('unitSphere', () => {
  it('is a closed, outward-wound unit sphere with a lat/long wire on its edges', () => {
    const s = unitSphere(16, 8);
    expect(s.count).toBe(2 + 7 * 16);
    expect(s.triangles.length / 3).toBe(2 * 16 + 6 * 16 * 2);
    expect(BALL.count).toBe(s.count);
    const v = (i: number): Vec3 => [
      s.vertices[3 * i]!,
      s.vertices[3 * i + 1]!,
      s.vertices[3 * i + 2]!,
    ];
    for (let i = 0; i < s.count; i++) expect(norm(v(i))).toBeCloseTo(1, 12);
    // Every directed edge once, its reverse once: closed and consistently wound.
    const directed = new Set<string>();
    for (let k = 0; k < s.triangles.length; k += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => s.triangles[k + j]!) as [number, number, number];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        expect(directed.has(`${p},${q}`)).toBe(false);
        directed.add(`${p},${q}`);
      }
      const normal = cross(sub(v(b), v(a)), sub(v(c), v(a)));
      expect(dot(normal, mean([v(a), v(b), v(c)]))).toBeGreaterThan(0);
    }
    for (const e of directed) expect(directed.has(e.split(',').reverse().join())).toBe(true);
    // The wire: 3 parallels of 16 segments and 4 half-meridians of 8, all mesh edges.
    expect(s.wire.length / 2).toBe(3 * 16 + 4 * 8);
    for (let k = 0; k < s.wire.length; k += 2) {
      expect(directed.has(`${s.wire[k]},${s.wire[k + 1]}`)).toBe(true);
    }
    // The parallels lie at ±45° and on the equator.
    const parallels = s.wire.slice(0, 2 * 3 * 16);
    const heights = new Set(parallels.map((i) => v(i)[2].toFixed(6)));
    expect([...heights].map(Number).sort((a, b) => a - b)).toEqual(
      [-Math.SQRT1_2, 0, Math.SQRT1_2].map((h) => Number(h.toFixed(6))),
    );
  });

  it('writeTriangles re-winds for a mirrored image and offsets the vertices', () => {
    const out = new Uint32Array(8);
    writeTriangles([0, 1, 2, 2, 1, 3], 1, 10, out, 1);
    expect(Array.from(out)).toEqual([0, 10, 11, 12, 12, 11, 13, 0]);
    writeTriangles([0, 1, 2, 2, 1, 3], -1, 10, out, 1);
    expect(Array.from(out)).toEqual([0, 10, 12, 11, 12, 13, 11, 0]);
  });
});

describe.each([3, 4])('Schlegel marks, N=%i', (n) => {
  it.each(ANGLES)(
    '%s: P1 box = the projected 4D-shrunk cube, planar, inside its cell',
    (_, planes4) => {
      const { t, model, cameraW, scene } = setup(n, planes4);
      const out = new Float32Array(24);
      let skewed = 0;
      for (let c = 0; c < t.cellCount; c++) {
        const cell = model.cells[c]!;
        writeBox4(cell.corners4!, MARK_SIZE, cameraW, out, 0);
        const got = points(out, 8);
        const expected = shrink4(cellCorners4(t, c), MARK_SIZE).map(scene);
        got.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(expected[i]![k]!, 5)));
        // A central projection keeps the faces planar (Float32 positions).
        for (const [a, b, d, e] of HEX_FACES) {
          const [u, v, w] = [b, d, e].map((i) => sub(got[i]!, got[a]!));
          const volume = Math.abs(dot(cross(u!, v!), w!)) / (norm(u!) * norm(v!) * norm(w!));
          expect(volume).toBeLessThan(1e-4);
        }
        // Strictly inside the cell's projected hexahedron (a projection keeps convexity).
        const faces = facePlanes(cell.corners!);
        for (const p of got) for (const f of faces) expect(dot(f.n, p) - f.d).toBeLessThan(-1e-4);
        // One orientation for the cell and its mark.
        expect(orientation4(cell.corners4!, cameraW)).toBe(hexOrientation(cell.corners!.flat()));
        expect(hexOrientation(out)).toBe(hexOrientation(cell.corners!.flat()));
        // Shrinking the projected corners instead would be a different (dishonest) box.
        const centroid = mean(cell.corners!);
        const wrong = cell.corners!.map((p) =>
          p.map((v, k) => centroid[k]! + MARK_SIZE * (v - centroid[k]!)),
        );
        if (Math.max(...wrong.map((p, i) => norm(sub(p, got[i]!)))) > 1e-3) skewed++;
      }
      // Off the identity, nearly every cell's honest mark differs from the 3D-shrunk one.
      if (planes4.xw !== 0) expect(skewed).toBeGreaterThan(t.cellCount / 2);
    },
  );

  it.each(ANGLES)('%s: P2 = the projected 3-ball in the facet hyperplane', (_, planes4) => {
    const { t, model, cameraW, scene } = setup(n, planes4);
    const r = MARK_SIZE / 2;
    const out = new Float32Array(BALL.count * 3);
    const step = n === 3 ? 3 : 7;
    let worst = 0;
    for (let c = 0; c < t.cellCount; c += step) {
      writeBall4(model.cells[c]!.corners4!, r, cameraW, BALL, out, 0);
      const got = points(out, BALL.count);
      const centre = cellCentre4(t, c);
      const corners = cellCorners4(t, c);
      const { axis, side } = t.facet(c);
      const axes = [1, 2, 4].map((b) => sub(corners[b]!, corners[0]!));
      for (let v = 0; v < BALL.count; v++) {
        const s = [0, 1, 2].map((k) => BALL.vertices[3 * v + k]!);
        // The 4D point: in the facet hyperplane, at distance r from the cell's centre.
        const p = centre.map((x, k) => x + r * s.reduce((acc, u, j) => acc + u * axes[j]![k]!, 0));
        expect(norm(sub(p, centre))).toBeCloseTo(r, 12);
        expect(p[axis]).toBe(side === 1 ? n / 2 : -n / 2);
        const q = scene(p);
        q.forEach((x, k) => expect(got[v]![k]!).toBeCloseTo(x, 5));
      }
      // The image is an ellipsoid: a positive-definite quadric through every vertex.
      const { residual, minors } = fitQuadric(got);
      worst = Math.max(worst, residual);
      for (const m of minors) expect(m).toBeGreaterThan(0);
    }
    expect(worst).toBeLessThan(1e-4);
  });
});

describe('Schlegel marks: shape at a glance', () => {
  it('at the identity a cell of the near or far cube shows its ball as a sphere', () => {
    const { t, model, cameraW } = setup(3, ANGLES[0]![1]);
    const out = new Float32Array(BALL.count * 3);
    for (const facet of [6, 7]) {
      const c = facet * 27 + 13;
      writeBall4(model.cells[c]!.corners4!, MARK_SIZE / 2, cameraW, BALL, out, 0);
      const got = points(out, BALL.count);
      const centre = model.cells[c]!.pos;
      const d = got.map((p) => norm(sub(p, centre)));
      expect((Math.max(...d) - Math.min(...d)) / Math.max(...d)).toBeLessThan(1e-5);
      // The ball is sized like its cell: radius MARK_SIZE / 2 at the cell's depth.
      expect(d[0]).toBeCloseTo((MARK_SIZE / 2) * model.cells[c]!.size, 5);
      expect(t.facet(c).index).toBe(facet);
    }
  });

  it('at XW 40° a wedge cell squashes its ball into a clear ellipsoid', () => {
    const { t, model, cameraW } = setup(3, ANGLES[1]![1]);
    const out = new Float32Array(BALL.count * 3);
    const c = 2 * 27 + 13; // the y = −1 cube: a wedge
    expect(t.facet(c).axis).toBe(1);
    writeBall4(model.cells[c]!.corners4!, MARK_SIZE / 2, cameraW, BALL, out, 0);
    const got = points(out, BALL.count);
    const centre = mean(got);
    const d = got.map((p) => norm(sub(p, centre)));
    expect(Math.max(...d) / Math.min(...d)).toBeGreaterThan(1.3);
  });
});
