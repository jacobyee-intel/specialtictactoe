/**
 * The camera: where it starts (the fit maths, pure and tested in node) and how the player moves
 * it (OrbitControls with the 3D view's button map).
 *
 * Left-click does nothing in 3D: every game action stays on the 2D board, so a stray click in
 * the 3D view can never place a mark. Right-drag orbits, middle-drag moves the centre, the wheel
 * zooms (wheel events only reach the canvas while the pointer is over it).
 */
import { MOUSE, TOUCH, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Bounds, Vec3 } from './sceneModel';

/** Vertical field of view in degrees: narrow, so the cube is not distorted much. */
export const FOV = 30;

/** Fraction of the half-viewport kept clear around the board. */
export const FIT_MARGIN = 0.15;

/** From the front, right and above: all three axes and the top slice are visible. */
export const DEFAULT_VIEW_DIR: Vec3 = [1.1, 0.95, 1.6];

export interface CameraFit {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Distance from the camera to the target. */
  readonly distance: number;
  readonly near: number;
  readonly far: number;
}

export interface FitOptions {
  readonly fovDeg?: number;
  readonly aspect: number;
  readonly margin?: number;
  /** From the target towards the camera; need not be normalised. */
  readonly direction?: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The 8 corners of a box. */
export function corners(b: Bounds): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push([(i & 1 ? b.max : b.min)[0], (i & 2 ? b.max : b.min)[1], (i & 4 ? b.max : b.min)[2]]);
  }
  return out;
}

/**
 * Frame a box: the camera looks at its centre from `direction`, at the smallest distance where
 * every corner projects inside the viewport shrunk by the margin. For each corner at lateral
 * offset x and depth offset z (towards the camera), it must hold that
 * |x| ≤ (d − z) · tan(fov/2) / (1 + margin), so d ≥ z + |x| (1 + margin) / tan(fov/2), per axis.
 */
export function fitCube(bounds: Bounds, opts: FitOptions): CameraFit {
  const { aspect, fovDeg = FOV, margin = FIT_MARGIN } = opts;
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const back = normalise(opts.direction ?? DEFAULT_VIEW_DIR);
  const right = normalise(cross([-back[0], -back[1], -back[2]], [0, 1, 0]));
  const up = cross(right, [-back[0], -back[1], -back[2]]);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let distance = 0;
  let radius = 0;
  for (const c of corners(bounds)) {
    const rel = sub(c, target);
    const z = dot(rel, back);
    distance = Math.max(
      distance,
      z + (Math.abs(dot(rel, right)) * (1 + margin)) / tanH,
      z + (Math.abs(dot(rel, up)) * (1 + margin)) / tanV,
    );
    radius = Math.max(radius, Math.hypot(...rel));
  }
  return {
    target,
    distance,
    position: [
      target[0] + back[0] * distance,
      target[1] + back[1] * distance,
      target[2] + back[2] * distance,
    ],
    near: Math.max(0.01, (distance - radius) / 20),
    far: (distance + radius) * 8,
  };
}

/** Place the camera at a fit, looking at its target (the projection matrix is updated too). */
export function applyFit(camera: PerspectiveCamera, fit: CameraFit): void {
  camera.position.set(...fit.position);
  camera.near = fit.near;
  camera.far = fit.far;
  camera.lookAt(...fit.target);
  camera.updateProjectionMatrix();
}

/** The 3D view's button map and limits; `saveState` makes the fit what Reset view returns to. */
export function configureControls(controls: OrbitControls, fit: CameraFit): void {
  controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.screenSpacePanning = true;
  controls.minDistance = fit.distance * 0.25;
  controls.maxDistance = fit.distance * 4;
  controls.target.set(...fit.target);
  controls.update();
  controls.saveState();
}
