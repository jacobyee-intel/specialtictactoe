import { describe, expect, it } from 'vitest';
import {
  boxAround,
  centerOn,
  clampToBounds,
  ensureVisible,
  fit,
  initialView,
  pan,
  showBox,
  visibleBox,
  visibleRange,
  zoomAt,
  type Box,
  type View,
} from './viewport';

const SIZE = { width: 800, height: 600 };
const toScreen = (v: View, p: { x: number; y: number }) => ({
  x: p.x * v.k + v.x,
  y: p.y * v.k + v.y,
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const view: View = { x: 37, y: -12, k: 0.8 };
    const point = { x: 300, y: 200 };
    const graph = { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k };
    const zoomed = zoomAt(view, point, 1.25);
    expect(zoomed.k).toBeCloseTo(1);
    const back = toScreen(zoomed, graph);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('clamps the zoom to the range and still keeps the point fixed', () => {
    const view: View = { x: 0, y: 0, k: 1.8 };
    const zoomed = zoomAt(view, { x: 100, y: 100 }, 4);
    expect(zoomed.k).toBe(2);
    expect(toScreen(zoomed, { x: 100 / 1.8, y: 100 / 1.8 }).x).toBeCloseTo(100);
    expect(zoomAt(view, { x: 0, y: 0 }, 0.01).k).toBe(0.25);
  });
});

describe('fit', () => {
  it('contains the bounds with padding, flush left and top', () => {
    const bounds: Box = { x: 0, y: 0, width: 2000, height: 400 };
    const view = fit(bounds, SIZE, 24);
    expect(view.k).toBeCloseTo((800 - 48) / 2000);
    const a = toScreen(view, { x: 0, y: 0 });
    const b = toScreen(view, { x: 2000, y: 400 });
    expect(a).toEqual({ x: 24, y: 24 });
    expect(b.x).toBeLessThanOrEqual(800 - 24 + 1e-9);
    expect(b.y).toBeLessThanOrEqual(600 - 24 + 1e-9);
  });

  it('does not magnify small trees beyond kMax', () => {
    expect(fit({ x: 0, y: 0, width: 64, height: 0 }, SIZE, 24).k).toBe(1);
    expect(fit({ x: 0, y: 0, width: 0, height: 0 }, SIZE, 24, 2).k).toBe(2);
  });

  it('fits an offset box', () => {
    const view = fit({ x: 100, y: 50, width: 100, height: 100 }, SIZE, 0, 10);
    expect(view.k).toBe(6);
    expect(toScreen(view, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });
});

describe('pan and clampToBounds', () => {
  it('pans by screen pixels', () => {
    expect(pan({ x: 1, y: 2, k: 0.5 }, 10, -4)).toEqual({ x: 11, y: -2, k: 0.5 });
  });

  it('keeps some of the content on screen', () => {
    const bounds: Box = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(clampToBounds({ x: -5000, y: 3000, k: 1 }, bounds, SIZE)).toEqual({
      x: 64 - 1000,
      y: 600 - 64,
      k: 1,
    });
    const inside: View = { x: -100, y: -100, k: 1 };
    expect(clampToBounds(inside, bounds, SIZE)).toEqual(inside);
  });
});

describe('visibleRange', () => {
  it('matches a hand computation', () => {
    // Graph x from 128 to 128 + 800 / 0.5 = 1728; y from -48 to -48 + 1200 = 1152.
    const view: View = { x: -64, y: 24, k: 0.5 };
    expect(visibleBox(view, SIZE)).toEqual({ x: 128, y: -48, width: 1600, height: 1200 });
    expect(visibleRange(view, SIZE)).toEqual({
      stepMin: 2,
      stepMax: 27, // ceil(1728 / 64)
      laneMin: -1,
      laneMax: 24, // 1152 / 48
    });
  });
});

describe('ensureVisible', () => {
  const node: Box = { x: 300, y: 200, width: 24, height: 24 };

  it('is a no-op when the node is already visible', () => {
    const view: View = { x: 0, y: 0, k: 1 };
    expect(ensureVisible(view, node, SIZE, 32)).toBe(view);
  });

  it('pans just enough to bring the node inside the margin', () => {
    const view: View = { x: -600, y: 0, k: 1 };
    const next = ensureVisible(view, node, SIZE, 32);
    expect(next).toEqual({ x: -268, y: 0, k: 1 });
    const right = ensureVisible({ x: 600, y: -400, k: 1 }, node, SIZE, 32);
    expect(toScreen(right, { x: 324, y: 200 })).toEqual({ x: 768, y: 32 });
  });
});

describe('centerOn and boxAround', () => {
  it('centres a box keeping the zoom', () => {
    const view = centerOn({ x: 0, y: 0, k: 2 }, { x: 100, y: 100, width: 0, height: 0 }, SIZE);
    expect(toScreen(view, { x: 100, y: 100 })).toEqual({ x: 400, y: 300 });
  });

  it('bounds points with padding', () => {
    expect(boxAround([])).toBeNull();
    expect(
      boxAround(
        [
          { x: 64, y: 0 },
          { x: 0, y: 48 },
        ],
        8,
      ),
    ).toEqual({ x: -8, y: -8, width: 80, height: 64 });
  });
});

describe('initialView and showBox', () => {
  it('fits the whole graph when it fits at k ≥ 0.6', () => {
    const bounds: Box = { x: 0, y: 0, width: 640, height: 240 };
    expect(initialView(bounds, null, SIZE, 32)).toEqual(fit(bounds, SIZE, 32));
    expect(initialView(bounds, null, SIZE, 32).k).toBe(1);
  });

  it('shows the needs-action nodes at k = 1 when the graph is too big', () => {
    const bounds: Box = { x: 0, y: 0, width: 6400, height: 4800 };
    const needs: Box = { x: 3200, y: 960, width: 0, height: 96 };
    const view = initialView(bounds, needs, SIZE, 32);
    expect(view.k).toBe(1);
    expect(toScreen(view, { x: 3200, y: 1008 })).toEqual({ x: 400, y: 300 });
  });

  it('aligns a box too big to centre by its top-left corner', () => {
    const view = showBox(
      { x: 0, y: 0, k: 1 },
      { x: 100, y: 100, width: 2000, height: 10 },
      SIZE,
      32,
    );
    expect(toScreen(view, { x: 100, y: 105 })).toEqual({ x: 32, y: 300 });
  });
});
