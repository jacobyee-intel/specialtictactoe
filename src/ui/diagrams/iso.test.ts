import { describe, expect, it } from 'vitest';
import {
  CUBE_EDGES,
  CUBE_VERTICES,
  ISOMETRIC,
  applyMatrix,
  backCorner,
  cross,
  dot,
  faceMatrix,
  isHiddenEdge,
  pathD,
  project,
  towardEye,
  viewDeg,
  type Vec3,
} from './iso';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

describe('isometric projection of the unit cube', () => {
  const points = CUBE_VERTICES.map((v) => project(v));

  it('is stable (x = bit 0, y = bit 1, z = bit 2 of the corner index)', () => {
    expect(CUBE_VERTICES).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    expect(points.map((p) => [r4(p.x), r4(p.y)])).toEqual([
      [0, 0],
      [-0.7071, 0.4082],
      [0.7071, 0.4082],
      [0, 0.8165],
      [0, -0.8165],
      [-0.7071, -0.4082],
      [0.7071, -0.4082],
      [0, 0],
    ]);
  });

  it('draws every edge at the same length, √(2/3)', () => {
    expect(CUBE_EDGES).toHaveLength(12);
    for (const [a, b] of CUBE_EDGES) {
      const p = points[a]!;
      const q = points[b]!;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(Math.sqrt(2 / 3), 10);
    }
  });

  it('looks down the (1, 1, 1) diagonal, so the back corner hides behind the front one', () => {
    const eye = towardEye(ISOMETRIC);
    for (const c of eye) expect(c).toBeCloseTo(1 / Math.sqrt(3), 10);
    expect(points[0]!.x).toBeCloseTo(points[7]!.x, 10);
    expect(points[0]!.y).toBeCloseTo(points[7]!.y, 10);
  });
});

describe('views', () => {
  const views = [ISOMETRIC, viewDeg(30, 30), viewDeg(32, 34), viewDeg(60, 20)];

  it.each(views)('is a proper (unmirrored) view: %o', (view) => {
    // Seen from outside, a right-handed face frame (U × V = outward normal) must stay
    // counter-clockwise on screen, which is a negative 2D cross product with y pointing down.
    const eye = towardEye(view);
    const frames: [Vec3, Vec3][] = [
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 0, 1],
        [1, 0, 0],
      ],
    ];
    for (const [U, V] of frames) {
      const n = cross(U, V);
      const sign = Math.sign(dot(n, eye));
      const u = project(U, view);
      const v = project(V, view);
      expect(Math.sign(u.x * v.y - u.y * v.x)).toBe(-sign);
    }
  });

  it.each(views)('hides exactly the three edges at the back corner: %o', (view) => {
    expect(backCorner(view)).toBe(0);
    expect(CUBE_EDGES.filter((e) => isHiddenEdge(e, view))).toEqual([
      [0, 1],
      [0, 2],
      [0, 4],
    ]);
  });

  it('separates the back corner from the front one away from the true isometric', () => {
    const view = viewDeg(32, 34);
    const back = project([0, 0, 0], view);
    const front = project([1, 1, 1], view);
    expect(Math.hypot(front.x - back.x, front.y - back.y)).toBeGreaterThan(0.25);
  });
});

describe('faceMatrix', () => {
  it('maps the unit square onto the projected face', () => {
    const view = viewDeg(32, 34);
    const origin: Vec3 = [1, 0, 0];
    const U: Vec3 = [0, 1, 0];
    const V: Vec3 = [0, 0, 1];
    const m = faceMatrix(origin, U, V, view);
    const cases: [number, number, Vec3][] = [
      [0, 0, [1, 0, 0]],
      [1, 0, [1, 1, 0]],
      [0, 1, [1, 0, 1]],
      [0.5, 0.25, [1, 0.5, 0.25]],
    ];
    for (const [u, v, world] of cases) {
      const got = applyMatrix(m, u, v);
      const want = project(world, view);
      expect(got.x).toBeCloseTo(want.x, 10);
      expect(got.y).toBeCloseTo(want.y, 10);
    }
  });
});

describe('pathD', () => {
  it('writes short, rounded path data', () => {
    expect(
      pathD(
        [
          { x: 0, y: -0.001 },
          { x: 1.23456, y: 2 },
        ],
        true,
      ),
    ).toBe('M0 0 L1.23 2 Z');
  });
});
