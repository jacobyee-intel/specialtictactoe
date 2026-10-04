import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { FIT_MARGIN, FOV, applyFit, configureControls, corners, fitCube } from './controls';

function cube(n: number) {
  const h = n / 2;
  return { min: [-h, -h, -h] as const, max: [h, h, h] as const };
}

describe('fitCube', () => {
  it.each([3, 4, 5, 6])('frames all 8 corners of the N = %i cube with the margin', (n) => {
    for (const aspect of [0.75, 1, 4 / 3, 1.8, 2.4]) {
      const bounds = cube(n);
      const fit = fitCube(bounds, { aspect });
      const camera = new PerspectiveCamera(FOV, aspect, 0.1, 1000);
      applyFit(camera, fit);
      camera.updateMatrixWorld();
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      let widest = 0;
      for (const c of corners(bounds)) {
        const p = new Vector3(...c);
        expect(frustum.containsPoint(p)).toBe(true);
        const ndc = p.clone().project(camera);
        widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
      }
      // Inside the margin, and tight: some corner touches it.
      expect(widest).toBeLessThanOrEqual(1 / (1 + FIT_MARGIN) + 1e-9);
      expect(widest).toBeGreaterThan(1 / (1 + FIT_MARGIN) - 1e-6);
      expect(fit.near).toBeLessThan(fit.distance - Math.sqrt(3) * (n / 2));
      expect(fit.far).toBeGreaterThan(4 * fit.distance + Math.sqrt(3) * (n / 2));
    }
  });

  it('looks at the centre of off-centre bounds', () => {
    const fit = fitCube({ min: [0, 0, 0], max: [2, 4, 6] }, { aspect: 1 });
    expect(fit.target).toEqual([1, 2, 3]);
  });
});

describe('configureControls', () => {
  it('leaves the left button unbound and saves the fit for Reset view', () => {
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
    const fit = fitCube(cube(4), { aspect: 1 });
    applyFit(camera, fit);
    const controls = new OrbitControls(camera);
    configureControls(controls, fit);
    expect(controls.mouseButtons.LEFT).toBeNull();
    expect(controls.enableDamping).toBe(true);
    expect(controls.target.toArray()).toEqual([...fit.target]);
    camera.position.set(1, 2, 3);
    controls.reset();
    expect(camera.position.toArray().map((v) => +v.toFixed(9))).toEqual(
      fit.position.map((v) => +v.toFixed(9)),
    );
  });
});
