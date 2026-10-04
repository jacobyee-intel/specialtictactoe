/**
 * Pure layout of the 2D board: which square panels to draw, what each position shows, and how
 * the panels pack into the board zone at the largest cell size that fits.
 *
 * ## Cubic spaces
 *
 * One panel per z-slice, x to the right and y down (`layout2D`). For the wrapped spaces two
 * extras make the gluing visible without any 3D:
 *
 * - **Halos**: a one-cell ring around each slice showing the real cell each out-of-range position
 *   is glued to. They are found with {@link CubicQuotient.reduce}, the same projection the line
 *   index uses, so the halo can never disagree with the rules. Within a slice only x and y wrap,
 *   and they wrap plainly in all three spaces (the twist is only in z).
 * - **The seam panel**: slice 0 as seen from just above the top slice, i.e. position (x, y)
 *   holds `reduce((x, y, N))`. In the 3-torus it is a copy of slice 0, in the tetracosm it is
 *   slice 0 turned a quarter turn, and in the amphicosm slice 0 mirrored: the holonomy, in 2D.
 *
 * ## Tesseract
 *
 * Eight cubes (facets) of N panels each: inside a cube the panels are slices along its third
 * free axis, again from `layout2D`. Ridge adjacency (halos between cubes) comes in Stage 8.
 */
import {
  CubicQuotient,
  TesseractSurface,
  type CellId,
  type CubicTopologyId,
  type Topology,
} from '@/geometry';
import { axisName, cubeLabel, freeAxes } from '../describe';

export type PanelCellKind = 'cell' | 'halo' | 'seam';

/**
 * One position of a panel. A `cell` entry is a real, playable cell (`cell` is set). Halo and
 * seam entries are ghosts: `cell` is null and `ghostOf` is the real cell drawn there.
 */
export interface PanelCell {
  readonly cell: CellId | null;
  readonly ghostOf?: CellId;
  readonly col: number;
  readonly row: number;
  readonly kind: PanelCellKind;
}

/**
 * How a panel's border is drawn:
 * - `boundary`: the flat cube's walls, a solid 2 px rule (lines stop here);
 * - `seam`: a dashed rule between the slice and its halo of glued neighbours;
 * - `ghost`: the whole panel is a ghost (the seam panel), dashed all round;
 * - `none`: no frame (wrapped spaces with halos off, tesseract cubes).
 */
export type PanelFrame = 'boundary' | 'seam' | 'ghost' | 'none';

export interface Panel {
  readonly key: string;
  readonly title: string;
  /** Title of the panel's group ("Cube w = 0"); empty for the cubic spaces (a single group). */
  readonly group: string;
  readonly groupIndex: number;
  readonly cells: readonly PanelCell[];
  readonly cols: number;
  readonly rows: number;
  readonly frame: PanelFrame;
  /** The square of real (or seam) cells inside the panel, in panel positions. */
  readonly inner: { readonly col: number; readonly row: number; readonly size: number };
  /** Axis names along the columns (→) and rows (↓), for the axis hint. */
  readonly axes: { readonly col: string; readonly row: string };
  /** A one-sentence explanation shown with the panel (the seam panel's gluing). */
  readonly caption?: string;
}

export interface LayoutOptions {
  /** Draw the ring of glued neighbours around each slice (wrapped spaces only). */
  readonly halos: boolean;
}

/** How each wrapped space re-enters above the top, for the seam panel caption. */
export const SEAM_CAPTIONS: Readonly<Record<Exclude<CubicTopologyId, 'flat'>, string>> = {
  torus3: 'Above the top you re-enter at the bottom, unchanged.',
  tetracosm: 'Above the top you re-enter at the bottom, turned 90°.',
  amphicosm1: 'Above the top you re-enter at the bottom, mirrored left–right.',
};

/** Every panel of the 2D board for a topology, in display order. */
export function layoutPanels(topology: Topology, opts: LayoutOptions): Panel[] {
  if (topology instanceof TesseractSurface) return tesseractPanels(topology);
  if (topology instanceof CubicQuotient) return cubicPanels(topology, opts);
  throw new TypeError(`No 2D layout for topology ${topology.id}.`);
}

function cubicPanels(topology: CubicQuotient, opts: LayoutOptions): Panel[] {
  const n = topology.n;
  const wrapped = topology.wrapped;
  const halos = wrapped && opts.halos;
  const off = halos ? 1 : 0;
  const size = n + 2 * off;
  const axes = { col: 'x', row: 'y' };
  const panels: Panel[] = [];

  for (let z = 0; z < n; z++) {
    const cells: PanelCell[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const x = col - off;
        const y = row - off;
        const inside = x >= 0 && x < n && y >= 0 && y < n;
        if (inside) {
          cells.push({ cell: topology.cellAt([x, y, z]), col, row, kind: 'cell' });
        } else {
          cells.push({ cell: null, ghostOf: glued(topology, x, y, z), col, row, kind: 'halo' });
        }
      }
    }
    panels.push({
      key: `z${z}`,
      title: `z = ${z}`,
      group: '',
      groupIndex: 0,
      cells,
      cols: size,
      rows: size,
      frame: wrapped ? (halos ? 'seam' : 'none') : 'boundary',
      inner: { col: off, row: off, size: n },
      axes,
    });
  }

  if (wrapped) {
    // Same box as the slices (with an empty ring when halos are on) so the rows line up.
    const cells: PanelCell[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        cells.push({
          cell: null,
          ghostOf: glued(topology, x, y, n),
          col: x + off,
          row: y + off,
          kind: 'seam',
        });
      }
    }
    panels.push({
      key: 'seam',
      title: `z = ${n} ≡ 0 (glued)`,
      group: '',
      groupIndex: 0,
      cells,
      cols: size,
      rows: size,
      frame: 'ghost',
      inner: { col: off, row: off, size: n },
      axes,
      caption: SEAM_CAPTIONS[topology.id as keyof typeof SEAM_CAPTIONS],
    });
  }
  return panels;
}

/** The real cell at cover point (x, y, z): the projection of the universal cover. */
function glued(topology: CubicQuotient, x: number, y: number, z: number): CellId {
  const hit = topology.reduce([x, y, z], [0, 0, 1]);
  if (hit === null) throw new RangeError(`(${x}, ${y}, ${z}) is outside the flat cube.`);
  return hit.cell;
}

function tesseractPanels(topology: TesseractSurface): Panel[] {
  const n = topology.n;
  const n3 = n * n * n;
  const panels: Panel[] = [];
  for (let f = 0; f < 8; f++) {
    const [f0, f1, f2] = freeAxes(f >> 1);
    const group = cubeLabel(topology, f);
    for (let k = 0; k < n; k++) {
      const cells: PanelCell[] = [];
      for (let local = k * n * n; local < (k + 1) * n * n; local++) {
        const cell = f * n3 + local;
        const { row, col } = topology.layout2D(cell);
        cells.push({ cell, col, row, kind: 'cell' });
      }
      panels.push({
        key: `f${f}-${k}`,
        title: `${axisName(f2)} = ${k}`,
        group,
        groupIndex: f,
        cells,
        cols: n,
        rows: n,
        frame: 'none',
        inner: { col: 0, row: 0, size: n },
        axes: { col: axisName(f0), row: axisName(f1) },
      });
    }
  }
  return panels;
}

/** The distinct groups of a panel list (tesseract cubes), in order. */
export function panelGroups(panels: readonly Panel[]): { index: number; title: string }[] {
  const out: { index: number; title: string }[] = [];
  for (const p of panels) {
    if (out.at(-1)?.index !== p.groupIndex) out.push({ index: p.groupIndex, title: p.group });
  }
  return out;
}

/** Only the panels of one group, or all of them for `null`. */
export function filterGroup(panels: readonly Panel[], group: number | null): Panel[] {
  return group === null ? [...panels] : panels.filter((p) => p.groupIndex === group);
}

// --- Packing -------------------------------------------------------------------------------------

/** Cell sizes to try, largest first (px). */
export const CELL_SIZES = [48, 40, 32, 24, 20, 16] as const;
export const GUTTER = 24;
/** Height of a panel's title line (12 px caption on a 16 px line, plus 8 px). */
export const PANEL_TITLE = 24;
/** Height of a group heading (cube name) above its panels. */
export const GROUP_TITLE = 32;

export interface PlacedPanel {
  readonly panel: Panel;
  /** Top-left of the panel's title line; the cells start `PANEL_TITLE` below. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedHeading {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export interface Packing {
  readonly cellSize: number;
  readonly panels: readonly PlacedPanel[];
  readonly headings: readonly PlacedHeading[];
  readonly width: number;
  readonly height: number;
}

export interface Zone {
  readonly width: number;
  readonly height: number;
}

interface Block {
  readonly heading: string;
  readonly items: { panel: Panel; x: number; y: number; w: number; h: number }[];
  readonly width: number;
  readonly height: number;
}

/** Lay out one group: an optional heading, then its panels flowing left to right. */
function packBlock(panels: readonly Panel[], size: number, maxWidth: number): Block {
  const heading = panels[0]?.group ?? '';
  const top = heading === '' ? 0 : GROUP_TITLE;
  const items: Block['items'] = [];
  let x = 0;
  let y = top;
  let lineH = 0;
  let width = 0;
  for (const panel of panels) {
    const w = panel.cols * size;
    const h = PANEL_TITLE + panel.rows * size;
    if (x > 0 && x + w > maxWidth) {
      x = 0;
      y += lineH + GUTTER;
      lineH = 0;
    }
    items.push({ panel, x, y, w, h });
    width = Math.max(width, x + w);
    lineH = Math.max(lineH, h);
    x += w + GUTTER;
  }
  return { heading, items, width, height: y + lineH };
}

/**
 * Place panels at a given cell size inside `maxWidth`: groups are blocks that flow left to right
 * (wrapping like words), and panels flow the same way inside each block, with 24 px gutters.
 */
export function packPanels(panels: readonly Panel[], size: number, maxWidth: number): Packing {
  const groups: Panel[][] = [];
  for (const p of panels) {
    const last = groups.at(-1);
    if (last !== undefined && last[0]?.groupIndex === p.groupIndex) last.push(p);
    else groups.push([p]);
  }
  const placed: PlacedPanel[] = [];
  const headings: PlacedHeading[] = [];
  let x = 0;
  let y = 0;
  let lineH = 0;
  let width = 0;
  for (const group of groups) {
    const block = packBlock(group, size, maxWidth);
    if (x > 0 && x + block.width > maxWidth) {
      x = 0;
      y += lineH + GUTTER;
      lineH = 0;
    }
    if (block.heading !== '') headings.push({ text: block.heading, x, y });
    for (const it of block.items) {
      placed.push({ panel: it.panel, x: x + it.x, y: y + it.y, width: it.w, height: it.h });
    }
    width = Math.max(width, x + block.width);
    lineH = Math.max(lineH, block.height);
    x += block.width + GUTTER;
  }
  return { cellSize: size, panels: placed, headings, width, height: y + lineH };
}

/** True when a packing fits the zone without scrolling. */
export function fits(packing: Packing, zone: Zone): boolean {
  return packing.width <= zone.width && packing.height <= zone.height;
}

/**
 * The packing at the largest cell size in {@link CELL_SIZES} that fits the zone. If even 16 px
 * does not fit, the 16 px packing is returned with `fits: false` and the zone scrolls vertically.
 */
export function fitPanels(panels: readonly Panel[], zone: Zone): Packing & { fits: boolean } {
  let packing: Packing | null = null;
  for (const size of CELL_SIZES) {
    packing = packPanels(panels, size, zone.width);
    if (fits(packing, zone)) return { ...packing, fits: true };
  }
  return { ...(packing as Packing), fits: false };
}

/**
 * The tesseract facet filter's initial choice: all cubes (null) if they fit the zone at 16 px or
 * more, otherwise the first cube, so N = 4 (32 panels) stays readable.
 */
export function defaultGroup(panels: readonly Panel[], zone: Zone): number | null {
  if (panelGroups(panels).length <= 1) return null;
  return fitPanels(panels, zone).fits ? null : (panels[0]?.groupIndex ?? null);
}
