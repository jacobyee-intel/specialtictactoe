/**
 * The geodesic tracer: walk straight from a cell in one direction and report what happens.
 * Pure (no three.js); the 3D view animates the result and the 2D board highlights it.
 *
 * A walk repeats `topology.step` and ends when
 *
 * - it is back on the start cell *with the start direction*: the geodesic is **closed**;
 * - a step is impossible: **blocked** on a tesseract edge or vertex (curvature), or at the
 *   **boundary** of the flat cube;
 * - it reaches `maxSteps` (the **limit**).
 *
 * It can pass the start cell facing another way first. That first return is the holonomy made
 * visible (the amphicosm's mirror, the tetracosm's quarter turn), and is reported.
 *
 * Every number in the captions comes from the walk itself.
 */
import { CubicQuotient, TesseractSurface, type CellId, type Dir, type Topology } from '@/geometry';
import { cellCentre } from './cover';
import type { Vec3 } from './four';

export type TraceEnd = 'closed' | 'blocked' | 'boundary' | 'limit';

export interface TraceResult {
  /** The start, then every cell reached (`steps + 1` cells; a closed walk ends on the start). */
  readonly cells: readonly CellId[];
  /** The local direction on arrival at each cell (`dirs[0]` is the start direction). */
  readonly dirs: readonly Dir[];
  readonly steps: number;
  readonly end: TraceEnd;
  /**
   * Cubic spaces: the walk in the universal cover, p₀ + k·d (centred model frame), one point per
   * cell. It is a straight line, whatever the seams did to the local direction.
   */
  readonly cover?: readonly Vec3[];
  /** The direction on the first return to the start cell, when it differs from the start one. */
  readonly holonomy?: Dir;
  /** Steps taken at that first return. */
  readonly firstReturn?: number;
  /** Blocked walks on the tesseract: where the step failed. */
  readonly blockedAt?: 'edge' | 'vertex';
}

const sameDir = (a: Dir, b: Dir) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Walk from `start` along `d` (a local direction of `start`). */
export function trace(
  topology: Topology,
  start: CellId,
  d: Dir,
  maxSteps = 8 * topology.n,
): TraceResult {
  const cells: CellId[] = [start];
  const dirs: Dir[] = [d];
  let cur = start;
  let dir = d;
  let end: TraceEnd = 'limit';
  let holonomy: Dir | undefined;
  let firstReturn: number | undefined;
  let blockedAt: 'edge' | 'vertex' | undefined;
  for (let s = 1; s <= maxSteps; s++) {
    const r = topology.step(cur, dir);
    if (r === null) {
      if (topology instanceof TesseractSurface) {
        end = 'blocked';
        blockedAt = overflowCount(topology, cur, dir) >= 3 ? 'vertex' : 'edge';
      } else {
        end = 'boundary';
      }
      break;
    }
    cur = r.cell;
    dir = r.dir;
    cells.push(cur);
    dirs.push(dir);
    if (cur === start) {
      if (sameDir(dir, d)) {
        end = 'closed';
        break;
      }
      if (holonomy === undefined) {
        holonomy = dir;
        firstReturn = s;
      }
    }
  }
  const steps = cells.length - 1;
  let cover: Vec3[] | undefined;
  if (topology instanceof CubicQuotient) {
    const p0 = cellCentre(topology, start);
    cover = cells.map(
      (_, k) =>
        [
          p0[0] + k * (d[0] as number),
          p0[1] + k * (d[1] as number),
          p0[2] + k * (d[2] as number),
        ] as Vec3,
    );
  }
  return {
    cells,
    dirs,
    steps,
    end,
    ...(cover === undefined ? {} : { cover }),
    ...(holonomy === undefined ? {} : { holonomy, firstReturn: firstReturn as number }),
    ...(blockedAt === undefined ? {} : { blockedAt }),
  };
}

/** How many free coordinates a tesseract step would push out of its facet. */
function overflowCount(t: TesseractSurface, cell: CellId, d: Dir): number {
  const q = t.coords(cell);
  const { axis } = t.facet(cell);
  let count = 0;
  q.forEach((v, k) => {
    if (k === axis) return;
    const next = v + (d[k] as number);
    if (next < 0 || next >= t.n) count++;
  });
  return count;
}

/** "(−1, 0, 1)" with true minus signs. */
export function formatDir(d: Dir): string {
  return `(${d.map((v) => (v < 0 ? `\u2212${-v}` : String(v))).join(', ')})`;
}

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** How the returned direction relates to the start direction, in words. */
function turnWords(topology: Topology, d: Dir, back: Dir): string {
  if (topology.id === 'amphicosm1') return 'mirrored';
  if (topology.id === 'tetracosm') {
    const half = back[0] === 0 - (d[0] as number) && back[1] === 0 - (d[1] as number);
    return half ? 'turned a half turn' : 'turned a quarter turn';
  }
  return 'facing another way';
}

/**
 * What one pass through the top (or bottom) does to a layer, for vertical lines. A vertical
 * direction itself comes back unchanged in every space; what changes is *where* it re-enters:
 * the gluing turns or mirrors the (x, y) square, so the line moves to another column.
 */
const PASS_WORDS: Partial<Record<string, { each: string; fixed: string }>> = {
  tetracosm: {
    each: 'turns the layer a quarter turn about the centre',
    fixed: 'it is the centre column, which the quarter turn leaves in place',
  },
  amphicosm1: {
    each: 'mirrors the layer',
    fixed: 'it lies in the mirror plane, which the mirror leaves in place',
  },
};

/**
 * The result caption, as a bold lead and a sentence. Every number is read off the walk: the
 * step count, the columns or cubes visited, the returned direction.
 */
export function traceCaption(topology: Topology, r: TraceResult): { lead: string; text: string } {
  const d = r.dirs[0] as Dir;
  const lead = `Along ${formatDir(d)}.`;
  const s = r.steps;
  const back =
    r.holonomy !== undefined && r.firstReturn !== undefined
      ? `Back where it started after ${plural(r.firstReturn, 'step')}, but ${turnWords(topology, d, r.holonomy)}: the direction returned as ${formatDir(r.holonomy)}. `
      : '';
  switch (r.end) {
    case 'blocked':
      return r.blockedAt === 'vertex'
        ? {
            lead,
            text: `Blocked at a corner after ${plural(s, 'step')}: four cubes meet there, so the line has no straight way on.`,
          }
        : {
            lead,
            text: `Blocked at an edge after ${plural(s, 'step')}: three cubes meet there at 270°, not 360°, so the line has no straight way on.`,
          };
    case 'boundary':
      return {
        lead,
        text: `Stopped by the wall after ${plural(s, 'step')}: the flat cube has a boundary, so lines end there.`,
      };
    case 'limit':
      return {
        lead,
        text: `${back}Not closed after ${plural(s, 'step')}, the most the tracer walks.`,
      };
    case 'closed':
      break;
  }
  if (topology instanceof TesseractSurface) {
    const facets = r.cells.map((c) => topology.facet(c).index);
    const cubes = new Set(facets).size;
    const ridges = facets.filter((f, i) => i > 0 && f !== facets[i - 1]).length;
    const turn =
      ridges === 0
        ? '.'
        : `. It crossed ${plural(ridges, 'ridge')}, turning 90° in 4D at each, yet on the surface it never turns.`;
    return {
      lead,
      text: `${back}Closed after ${plural(s, 'step')} through ${plural(cubes, 'cube')}${turn}`,
    };
  }
  const cubic = topology as CubicQuotient;
  const distinct = new Set(r.cells).size;
  if (d[0] === 0 && d[1] === 0) {
    const columns = new Set(
      r.cells.map((c) => {
        const q = cubic.coords(c);
        return `${q[0]},${q[1]}`;
      }),
    ).size;
    // Passes through the glued top or bottom face: steps where z wraps around.
    const zs = r.cells.map((c) => cubic.coords(c)[2] as number);
    const passes = zs.filter((z, i) => i > 0 && Math.abs(z - (zs[i - 1] as number)) > 1).length;
    const face = (d[2] as number) > 0 ? 'top' : 'bottom';
    const words = PASS_WORDS[topology.id];
    const head = `${back}Closed after ${plural(s, 'step')}: this vertical line`;
    if (columns === 1) {
      const why =
        words === undefined
          ? `Nothing turns at the ${face}, so it closes after ${plural(passes, 'pass', 'passes')}.`
          : `Its column is fixed: ${words.fixed}, so the line closes after ${plural(passes, 'pass', 'passes')}.`;
      return { lead, text: `${head} stays in one column. ${why}` };
    }
    const why =
      words === undefined
        ? ''
        : ` Each pass through the ${face} ${words.each}, so the line needs ${passes} passes to come home.`;
    return { lead, text: `${head} visits ${columns} columns.${why}` };
  }
  return {
    lead,
    text: `${back}Closed after ${plural(s, 'step')} through ${plural(distinct, 'cell')}.`,
  };
}
