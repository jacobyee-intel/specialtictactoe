/**
 * The 3D view's materials, built once per view from the design tokens (`tokens.ts`) and shared
 * by every rebuild of the board. All are unlit (`MeshBasicMaterial`, line materials): the design
 * system is flat, so a red cube is one red, with no light or shadow.
 */
import {
  BackSide,
  Color,
  LineBasicMaterial,
  LineDashedMaterial,
  MeshBasicMaterial,
  type Material,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Player } from '@/geometry';
import { COLORS } from '@/ui/tokens';
import { ResourceRegistry } from './registry';

export interface Materials {
  /** The 1 px cell grid. */
  readonly wire: LineBasicMaterial;
  /** The 2 px outline of the fundamental cube (screen-space width, `LineSegments2`). */
  readonly outline: LineMaterial;
  /** Solid marks, by player. */
  readonly mark: readonly [MeshBasicMaterial, MeshBasicMaterial];
  /**
   * White edges on the solid cubes: with unlit shading a cube is one flat red shape, so two
   * cubes in a row would merge. The white edge is the 3D twin of the 1 px white gap in 2D.
   */
  readonly markEdge: LineBasicMaterial;
  /** Received marks: wire versions, by player. */
  readonly markWire: readonly [LineBasicMaterial, LineBasicMaterial];
  readonly lastMove: LineBasicMaterial;
  /** Threats: dashed outline boxes in the threatening player's colour. */
  readonly threat: readonly [LineDashedMaterial, LineDashedMaterial];
  readonly win: MeshBasicMaterial;
  /** The hovered cell: a grey-30 box seen from inside (back faces), so a mark in it stays pure. */
  readonly hoverFill: MeshBasicMaterial;
  readonly hoverEdge: LineBasicMaterial;
  /** Invisible pick targets (the mesh is hidden; raycasting ignores visibility). */
  readonly pick: MeshBasicMaterial;
  /**
   * Ghost copies: the same glyphs at 35% strength, as opaque tints of the player colours (35%
   * of the accent on white). They are drawn in their own pass under the board (see
   * `GHOST_LAYER`), so they never cover the fundamental cube and need no sorting.
   */
  readonly ghostMark: readonly [MeshBasicMaterial, MeshBasicMaterial];
  /** White edges on the ghost cubes, as on the real ones, so neighbouring ghosts stay apart. */
  readonly ghostMarkEdge: LineBasicMaterial;
  /** The chiral F: black in the fundamental cube, grey-60 in the copies. */
  readonly landmark: MeshBasicMaterial;
  readonly ghostLandmark: MeshBasicMaterial;
  /** Edges of the hovered cell's ghost copies. */
  readonly hoverGhostEdge: LineBasicMaterial;
  /** The tesseract cube chosen in the 2D filter: a heavier black outline (4 px). */
  readonly outlineBold: LineMaterial;
  /** The tracer's trail and walker. */
  readonly trace: MeshBasicMaterial;
  /** Screen size in CSS pixels, for the screen-space line widths. */
  setResolution(width: number, height: number): void;
  dispose(): void;
}

const color = (hex: string) => new Color(hex);

/** How strongly a ghost copy shows its glyph (the 2D halos use 30%). */
export const GHOST_STRENGTH = 0.35;

/** `hex` at `strength` on white, mixed in sRGB like CSS opacity over a white page. */
export function tintHex(hex: string, strength: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c
    .map((v) => Math.round(255 - strength * (255 - v)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function playerHex(player: Player): string {
  return player === 0 ? COLORS.p1 : COLORS.p2;
}

export function createMaterials(registry = new ResourceRegistry()): Materials {
  const t = <M extends Material>(m: M) => registry.track(m);
  const outline = t(new LineMaterial({ color: color(COLORS.black), linewidth: 2 }));
  const outlineBold = t(new LineMaterial({ color: color(COLORS.black), linewidth: 4 }));
  const ghost = (hex: string) =>
    t(new MeshBasicMaterial({ color: color(tintHex(hex, GHOST_STRENGTH)) }));
  const dashed = (p: Player) =>
    t(new LineDashedMaterial({ color: color(playerHex(p)), dashSize: 0.12, gapSize: 0.08 }));
  return {
    wire: t(new LineBasicMaterial({ color: color(COLORS.grey30) })),
    outline,
    // The polygon offset pushes the faces back a little so their edges are not z-fighting.
    mark: [
      t(
        new MeshBasicMaterial({
          color: color(COLORS.p1),
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      ),
      t(new MeshBasicMaterial({ color: color(COLORS.p2) })),
    ],
    markEdge: t(new LineBasicMaterial({ color: color(COLORS.white) })),
    markWire: [
      t(new LineBasicMaterial({ color: color(COLORS.p1) })),
      t(new LineBasicMaterial({ color: color(COLORS.p2) })),
    ],
    lastMove: t(new LineBasicMaterial({ color: color(COLORS.black) })),
    threat: [dashed(0), dashed(1)],
    win: t(new MeshBasicMaterial({ color: color(COLORS.done) })),
    hoverFill: t(
      new MeshBasicMaterial({
        color: color(COLORS.grey30),
        side: BackSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    ),
    hoverEdge: t(new LineBasicMaterial({ color: color(COLORS.black) })),
    pick: t(new MeshBasicMaterial({ visible: false })),
    ghostMark: [ghost(COLORS.p1), ghost(COLORS.p2)],
    ghostMarkEdge: t(new LineBasicMaterial({ color: color(COLORS.white) })),
    landmark: t(new MeshBasicMaterial({ color: color(COLORS.black) })),
    ghostLandmark: t(new MeshBasicMaterial({ color: color(COLORS.grey60) })),
    hoverGhostEdge: t(new LineBasicMaterial({ color: color(COLORS.grey60) })),
    outlineBold,
    trace: t(new MeshBasicMaterial({ color: color(COLORS.black) })),
    setResolution: (width, height) => {
      outline.resolution.set(width, height);
      outlineBold.resolution.set(width, height);
    },
    dispose: () => registry.disposeAll(),
  };
}
