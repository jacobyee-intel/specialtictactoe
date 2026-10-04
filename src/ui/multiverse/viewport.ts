/**
 * Pure pan/zoom maths for the multiverse graph, and culling to what is on screen.
 *
 * A {@link View} maps graph coordinates to screen pixels: `screen = graph × k + (x, y)`. The
 * component only stores a view and calls these functions, so every interaction (drag, wheel,
 * the Fit/−/+/Now buttons, keyboard focus) is tested here in node.
 */
import { COLUMN, LANE } from './laneLayout';

export interface View {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** An axis-aligned box in graph coordinates. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisibleRange {
  readonly stepMin: number;
  readonly stepMax: number;
  readonly laneMin: number;
  readonly laneMax: number;
}

/** The zoom range of the wheel and the − / + buttons. */
export const K_MIN = 0.25;
export const K_MAX = 2;
/** One − / + press or Ctrl+wheel notch. */
export const ZOOM_STEP = 1.25;

export const IDENTITY: View = { x: 0, y: 0, k: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The largest zoom (at most `kMax`) at which `bounds` plus `padding` on every side fits `size`,
 * aligned flush left and top (design-system §1: flush left, ragged right).
 */
export function fit(bounds: Box, size: Size, padding: number, kMax = 1): View {
  const kx = bounds.width > 0 ? (size.width - 2 * padding) / bounds.width : Infinity;
  const ky = bounds.height > 0 ? (size.height - 2 * padding) / bounds.height : Infinity;
  const k = Math.max(1e-6, Math.min(kMax, kx, ky));
  return { x: padding - bounds.x * k, y: padding - bounds.y * k, k };
}

/** The zoom at which {@link fit} would show everything (uncapped). */
export function fitScale(bounds: Box, size: Size, padding: number): number {
  return fit(bounds, size, padding, Infinity).k;
}

/** Zoom by `factor` keeping the screen `point` over the same graph point. */
export function zoomAt(
  view: View,
  point: { readonly x: number; readonly y: number },
  factor: number,
  range: readonly [number, number] = [K_MIN, K_MAX],
): View {
  const k = clamp(view.k * factor, range[0], range[1]);
  const gx = (point.x - view.x) / view.k;
  const gy = (point.y - view.y) / view.k;
  return { x: point.x - gx * k, y: point.y - gy * k, k };
}

export function pan(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, k: view.k };
}

/**
 * Keep at least `keep` px of the content on screen in each direction (less when the content is
 * smaller), so the graph can never be panned away and lost.
 */
export function clampToBounds(view: View, bounds: Box, size: Size, keep = 64): View {
  const axis = (t: number, lo: number, extent: number, screen: number) => {
    const k0 = lo * view.k;
    const span = extent * view.k;
    const m = Math.min(keep, span, screen);
    // Content occupies [t + k0, t + k0 + span]; require its right end ≥ m and left end ≤ screen − m.
    return clamp(t, m - k0 - span, screen - m - k0);
  };
  return {
    x: axis(view.x, bounds.x, bounds.width, size.width),
    y: axis(view.y, bounds.y, bounds.height, size.height),
    k: view.k,
  };
}

/** The graph box visible on screen. */
export function visibleBox(view: View, size: Size): Box {
  return {
    x: -view.x / view.k,
    y: -view.y / view.k,
    width: size.width / view.k,
    height: size.height / view.k,
  };
}

/** The step columns and lanes (lanes layout) that intersect the screen, for culling. */
export function visibleRange(view: View, size: Size): VisibleRange {
  const box = visibleBox(view, size);
  return {
    stepMin: Math.floor(box.x / COLUMN),
    stepMax: Math.ceil((box.x + box.width) / COLUMN),
    laneMin: Math.floor(box.y / LANE),
    laneMax: Math.ceil((box.y + box.height) / LANE),
  };
}

/**
 * The smallest pan that brings `box` (graph coordinates) at least `margin` px inside the screen;
 * the same view when it already is. A box too large to fit is aligned by its top-left corner.
 */
export function ensureVisible(view: View, box: Box, size: Size, margin: number): View {
  const axis = (t: number, lo: number, extent: number, screen: number) => {
    const a = t + lo * view.k;
    const b = a + extent * view.k;
    if (a < margin) return t + (margin - a);
    if (b > screen - margin) return t - Math.min(b - (screen - margin), a - margin);
    return t;
  };
  const x = axis(view.x, box.x, box.width, size.width);
  const y = axis(view.y, box.y, box.height, size.height);
  return x === view.x && y === view.y ? view : { x, y, k: view.k };
}

/** Pan (keeping the zoom) so that `box` is centred on screen. */
export function centerOn(view: View, box: Box, size: Size): View {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x: size.width / 2 - cx * view.k, y: size.height / 2 - cy * view.k, k: view.k };
}

/** The bounding box of some points, grown by `pad` on every side. */
export function boxAround(
  points: readonly { readonly x: number; readonly y: number }[],
  pad = 0,
): Box | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
}

/**
 * Pan (keeping the zoom) to show `box`: centred when it fits, otherwise its top-left corner
 * `margin` px inside the screen (the first needs-action node, in id order).
 */
export function showBox(view: View, box: Box, size: Size, margin: number): View {
  const fits = box.width * view.k <= size.width - 2 * margin;
  const fitsY = box.height * view.k <= size.height - 2 * margin;
  const centred = centerOn(view, box, size);
  return {
    x: fits ? centred.x : margin - box.x * view.k,
    y: fitsY ? centred.y : margin - box.y * view.k,
    k: view.k,
  };
}

/** The smallest zoom at which the graph is still worth fitting whole (labels stay readable). */
export const FIT_MIN = 0.6;

/**
 * The view a graph opens with: everything, if it fits at a zoom of at least {@link FIT_MIN};
 * otherwise the nodes that need action (or `fallback`) at zoom 1.
 */
export function initialView(bounds: Box, focus: Box | null, size: Size, padding: number): View {
  if (fitScale(bounds, size, padding) >= FIT_MIN) return fit(bounds, size, padding);
  return showBox(IDENTITY, focus ?? bounds, size, padding);
}
