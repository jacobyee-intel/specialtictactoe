/**
 * Core geometry types shared by every playable space.
 *
 * A space is a finite set of cells plus a rule for walking along *discrete geodesics*: from a
 * cell, take a unit step in some local direction and find out which cell you land in, and which
 * way you are now facing. Spaces with seams (quotients, folded surfaces) may change the
 * direction when a step crosses a seam; that change is the space's holonomy made visible.
 */

/** A cell is an integer in `[0, cellCount)`. Boards are `Uint8Array`s indexed by cell. */
export type CellId = number;

/**
 * A direction vector in a cell's local frame, with components in {-1, 0, 1}.
 *
 * Cubic spaces use 3D vectors. The tesseract surface uses 4D vectors whose component along the
 * cell's facet normal is 0 (the vector lies in the facet's hyperplane).
 *
 * Directions returned by the geometry module are frozen and interned: equal vectors are the
 * same array, so they are cheap to pass around and can be compared by reference.
 */
export type Dir = readonly number[];

/** Result of a single step: the cell you land in and your (possibly re-oriented) direction. */
export interface StepResult {
  readonly cell: CellId;
  readonly dir: Dir;
}

/** Stable identifiers of the playable spaces. */
export type TopologyId = 'flat' | 'torus3' | 'tetracosm' | 'amphicosm1' | 'tesseract';

/** Position of a cell in the 2D "slice grid" view: a list of square panels of rows × cols. */
export interface Layout2D {
  readonly panel: number;
  readonly row: number;
  readonly col: number;
}

/** A finite discrete space in which tic-tac-toe lines are discrete geodesics. */
export interface Topology {
  readonly id: TopologyId;
  /** Edge length of each cubic block of cells. */
  readonly n: number;
  readonly cellCount: number;
  /** Dimension of direction and coordinate vectors: 3 for cubic spaces, 4 for the tesseract. */
  readonly dim: 3 | 4;
  /** Number of panels in the 2D slice view (`n` z-slices, or `8n` for the tesseract). */
  readonly panelCount: number;
  /** The 26 unit directions (all nonzero {-1,0,1} vectors) in the cell's local frame. */
  localDirections(c: CellId): readonly Dir[];
  /** Move one cell along `d`. Returns `null` when blocked (a boundary or a curvature edge). */
  step(c: CellId, d: Dir): StepResult | null;
  /** Integer lattice coordinates of the cell (length `dim`). */
  coords(c: CellId): readonly number[];
  /** Inverse of {@link Topology.coords}. Throws `RangeError` if no cell has these coordinates. */
  cellAt(coords: readonly number[]): CellId;
  layout2D(c: CellId): Layout2D;
}

/** A player index. Player `p` writes the mark `p + 1` on a board; `0` means empty. */
export type Player = 0 | 1;
