/**
 * The win-line index: every set of M distinct cells that lie on a common discrete geodesic.
 *
 * A line starts at some cell and takes M−1 steps in one of the cell's 26 local directions,
 * letting each step re-orient the direction as it crosses seams. A trace is rejected if a step is
 * blocked (flat boundary, tesseract edge) or if it revisits a cell (a geodesic that wraps around
 * onto itself is not a valid line). Every line is found once from each end and possibly from
 * several directions, so lines are deduplicated by their sorted cell set.
 */
import { assertSize } from './math';
import type { CellId, Topology } from './types';

/**
 * All lines of length `m` in a topology, in compact typed-array form.
 *
 * - `lines` holds `lineCount · m` cell ids; line `i` is `lines[i·m .. (i+1)·m)`, in traversal
 *   order (consecutive cells are neighbors along the geodesic), which is what renderers draw.
 * - `linesThrough` is a CSR adjacency: the ids of the lines through cell `c` are
 *   `ids[offsets[c] .. offsets[c+1])`, in increasing order.
 */
export interface LineIndex {
  readonly m: number;
  readonly cellCount: number;
  readonly lineCount: number;
  readonly lines: Int32Array;
  readonly linesThrough: { readonly offsets: Int32Array; readonly ids: Int32Array };
}

/** Enumerate all lines of `m` cells (m ≥ 2). Build once per game configuration. */
export function buildLineIndex(topology: Topology, m: number): LineIndex {
  assertSize(m, 2);
  const seen = new Set<string>();
  const cells: number[] = [];
  const trace = new Int32Array(m);
  const sorted = new Int32Array(m);

  for (let start = 0; start < topology.cellCount; start++) {
    for (const d0 of topology.localDirections(start)) {
      if (!traceLine(topology, start, d0, trace)) continue;
      sorted.set(trace);
      sorted.sort();
      const key = sorted.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      for (const c of trace) cells.push(c);
    }
  }

  const lines = Int32Array.from(cells);
  const lineCount = lines.length / m;
  const offsets = new Int32Array(topology.cellCount + 1);
  for (const c of lines) offsets[c + 1] = (offsets[c + 1] as number) + 1;
  for (let c = 0; c < topology.cellCount; c++) {
    offsets[c + 1] = (offsets[c + 1] as number) + (offsets[c] as number);
  }
  const ids = new Int32Array(lines.length);
  const fill = offsets.slice(0, topology.cellCount);
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i] as number;
    const slot = fill[c] as number;
    ids[slot] = Math.floor(i / m);
    fill[c] = slot + 1;
  }

  return { m, cellCount: topology.cellCount, lineCount, lines, linesThrough: { offsets, ids } };
}

/** Walk `out.length − 1` steps from `start`; false if blocked or if a cell repeats. */
function traceLine(
  topology: Topology,
  start: CellId,
  d0: readonly number[],
  out: Int32Array,
): boolean {
  out[0] = start;
  let cell = start;
  let dir = d0;
  for (let k = 1; k < out.length; k++) {
    const next = topology.step(cell, dir);
    if (next === null) return false;
    for (let j = 0; j < k; j++) if (out[j] === next.cell) return false;
    out[k] = next.cell;
    cell = next.cell;
    dir = next.dir;
  }
  return true;
}

/** The cells of line `lineId`, in traversal order (a view into `index.lines`). */
export function lineCells(index: LineIndex, lineId: number): Int32Array {
  return index.lines.subarray(lineId * index.m, (lineId + 1) * index.m);
}

/** The ids of all lines through `cell` (a view into the CSR arrays). */
export function linesThroughCell(index: LineIndex, cell: CellId): Int32Array {
  const { offsets, ids } = index.linesThrough;
  return ids.subarray(offsets[cell], offsets[cell + 1]);
}
