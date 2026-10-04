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
  /** Screen size in CSS pixels, for the screen-space line widths. */
  setResolution(width: number, height: number): void;
  dispose(): void;
}

const color = (hex: string) => new Color(hex);

export function playerHex(player: Player): string {
  return player === 0 ? COLORS.p1 : COLORS.p2;
}

export function createMaterials(registry = new ResourceRegistry()): Materials {
  const t = <M extends Material>(m: M) => registry.track(m);
  const outline = t(new LineMaterial({ color: color(COLORS.black), linewidth: 2 }));
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
    setResolution: (width, height) => outline.resolution.set(width, height),
    dispose: () => registry.disposeAll(),
  };
}
