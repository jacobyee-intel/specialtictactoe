/**
 * Hover picking, kept free of three.js so it is tested in node.
 *
 * Every pickable `InstancedMesh` has a {@link PickTable} mapping its instance ids to cells. Several
 * instances may show the same cell: Phase B's ghost copies register one instance per copy, and
 * hovering any of them resolves to the source cell.
 *
 * In the Schlegel diagram the cells are picked by their true (skewed) shapes, merged into one
 * mesh: a hit there reports a triangle, which {@link pickHit} turns into the cell's id.
 *
 * The raycast is done in *layers* in priority order (see {@link pickCell}): the visible marks
 * first, then the invisible cell boxes. Without that, the box of an empty cell in front would
 * steal the hover from a mark the player is visibly pointing at inside the cube.
 */
import type { CellId } from '@/geometry';

export class PickTable {
  private readonly cells: Int32Array;
  private readonly byCell = new Map<CellId, number[]>();

  constructor(cells: readonly CellId[]) {
    this.cells = Int32Array.from(cells);
    cells.forEach((cell, id) => {
      const list = this.byCell.get(cell);
      if (list === undefined) this.byCell.set(cell, [id]);
      else list.push(id);
    });
  }

  /** The identity table of a mesh with one instance per cell, in cell order. */
  static identity(cellCount: number): PickTable {
    return new PickTable(Array.from({ length: cellCount }, (_, c) => c));
  }

  get count(): number {
    return this.cells.length;
  }

  /** The cell an instance shows, or null for an out-of-range id. */
  cellOf(instanceId: number): CellId | null {
    if (!Number.isInteger(instanceId) || instanceId < 0 || instanceId >= this.cells.length) {
      return null;
    }
    return this.cells[instanceId] as CellId;
  }

  /** Every instance showing `cell` (one, or several with ghost copies). */
  instancesOf(cell: CellId): readonly number[] {
    return this.byCell.get(cell) ?? [];
  }
}

/** One ray intersection, as three.js reports it for an InstancedMesh. */
export interface PickHit {
  readonly instanceId?: number | undefined;
  readonly distance: number;
}

/** A raw three.js intersection: an instance of an InstancedMesh, or a triangle of a mesh. */
export interface RawHit {
  readonly instanceId?: number | undefined;
  readonly faceIndex?: number | null | undefined;
  readonly distance: number;
}

/**
 * The pick id of a raw hit. An instanced layer reports its instance; a merged layer of
 * `trianglesPerItem` triangles per item (> 0) reports a triangle, which belongs to item
 * `⌊face / trianglesPerItem⌋`.
 */
export function pickHit(hit: RawHit, trianglesPerItem = 0): PickHit {
  if (trianglesPerItem <= 0) return { instanceId: hit.instanceId, distance: hit.distance };
  const face = hit.faceIndex;
  return {
    instanceId: face == null ? undefined : Math.floor(face / trianglesPerItem),
    distance: hit.distance,
  };
}

export interface PickLayer {
  readonly table: PickTable;
  readonly hits: readonly PickHit[];
}

/**
 * The hovered cell: the nearest hit of the first layer that has one, so a mark wins over the
 * box of the empty cell in front of it. Null when the ray misses everything.
 */
export function pickCell(layers: readonly PickLayer[]): CellId | null {
  for (const { table, hits } of layers) {
    let best: CellId | null = null;
    let bestDistance = Infinity;
    for (const hit of hits) {
      if (hit.instanceId === undefined || hit.distance >= bestDistance) continue;
      const cell = table.cellOf(hit.instanceId);
      if (cell === null) continue;
      best = cell;
      bestDistance = hit.distance;
    }
    if (best !== null) return best;
  }
  return null;
}
