/**
 * Direction vectors: the 26 neighbor offsets of a cubic cell, plus interning helpers.
 *
 * Every direction with components in {-1, 0, 1} is stored once in a lookup table, so the
 * geometry code can hand out shared, frozen arrays instead of allocating on every step.
 */
import type { Dir } from './types';

function buildTable(length: number): readonly Dir[] {
  const table: Dir[] = [];
  for (let code = 0; code < 3 ** length; code++) {
    const v: number[] = [];
    for (let k = 0, rest = code; k < length; k++, rest = Math.floor(rest / 3)) {
      v.push((rest % 3) - 1);
    }
    table.push(Object.freeze(v));
  }
  return table;
}

const TABLE3 = buildTable(3);
const TABLE4 = buildTable(4);

const isUnit = (v: number): boolean => v === -1 || v === 0 || v === 1;

/** The interned 3D direction (x, y, z), or a fresh frozen array if a component is not in {-1,0,1}. */
export function dir3(x: number, y: number, z: number): Dir {
  if (isUnit(x) && isUnit(y) && isUnit(z)) {
    return TABLE3[x + 1 + 3 * (y + 1) + 9 * (z + 1)] as Dir;
  }
  return Object.freeze([x, y, z]);
}

/** The interned 4D direction (x, y, z, w), or a fresh frozen array if a component is not in {-1,0,1}. */
export function dir4(x: number, y: number, z: number, w: number): Dir {
  if (isUnit(x) && isUnit(y) && isUnit(z) && isUnit(w)) {
    return TABLE4[x + 1 + 3 * (y + 1) + 9 * (z + 1) + 27 * (w + 1)] as Dir;
  }
  return Object.freeze([x, y, z, w]);
}

/** Intern any direction vector. 3D and 4D unit vectors come from the shared tables. */
export function internDir(v: readonly number[]): Dir {
  const [x, y, z, w] = v as unknown as readonly [number, number, number, number];
  if (v.length === 3) return dir3(x, y, z);
  if (v.length === 4) return dir4(x, y, z, w);
  return Object.freeze([...v]);
}

/** The opposite direction `-d` (interned, and without any `-0` components). */
export function negateDir(d: Dir): Dir {
  return internDir(d.map((v) => 0 - v));
}

/** True if every component of `d` is in {-1, 0, 1}. */
export function isUnitDir(d: Dir): boolean {
  return d.every(isUnit);
}

/**
 * The 26 nonzero vectors in {-1,0,1}³: 6 face, 12 edge and 8 corner neighbors.
 * Opposite pairs give the 13 line directions of 3D tic-tac-toe.
 */
export const DIRECTIONS_3D: readonly Dir[] = Object.freeze(
  TABLE3.filter((d) => d.some((v) => v !== 0)),
);
