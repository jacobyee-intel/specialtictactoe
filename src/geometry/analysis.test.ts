import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  buildLineIndex,
  completesLine,
  createTopology,
  isFull,
  lineCells,
  markOf,
  openLines,
  threats,
  type Player,
  type Topology,
} from '@/geometry';

function setup(id: 'flat' | 'torus3', marks: readonly [Player, number[]][] = []) {
  const t: Topology = createTopology(id, 3);
  const index = buildLineIndex(t, 3);
  const board = new Uint8Array(t.cellCount);
  for (const [p, cells] of marks) for (const xyz of chunk(cells)) board[t.cellAt(xyz)] = markOf(p);
  return { t, index, board };
}

function chunk(v: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < v.length; i += 3) out.push(v.slice(i, i + 3));
  return out;
}

const sortedCells = (index: ReturnType<typeof setup>['index'], id: number): number[] =>
  [...lineCells(index, id)].sort((a, b) => a - b);

describe('marks', () => {
  it('maps players to board values', () => {
    expect(EMPTY).toBe(0);
    expect(markOf(0)).toBe(1);
    expect(markOf(1)).toBe(2);
  });
});

describe('completesLine', () => {
  it('finds the row completed by the third mark, before or after it is written', () => {
    const { t, index, board } = setup('flat', [[0, [0, 0, 0, 1, 0, 0]]]);
    const cell = t.cellAt([2, 0, 0]);
    const line = completesLine(board, cell, 0, index);
    expect(sortedCells(index, line)).toEqual([0, 1, 2]);
    board[cell] = markOf(0);
    expect(completesLine(board, cell, 0, index)).toBe(line);
    expect(completesLine(board, cell, 1, index)).toBe(-1);
  });

  it('is blocked by an opponent mark and ignores unrelated cells', () => {
    const { t, index, board } = setup('flat', [
      [0, [0, 0, 0]],
      [1, [1, 0, 0]],
    ]);
    expect(completesLine(board, t.cellAt([2, 0, 0]), 0, index)).toBe(-1);
    expect(completesLine(board, t.cellAt([2, 2, 2]), 0, index)).toBe(-1);
  });

  it('sees a broken diagonal on the 3-torus that the flat cube does not', () => {
    const marks: [Player, number[]][] = [[1, [0, 1, 0, 1, 2, 0]]];
    const torus = setup('torus3', marks);
    const flat = setup('flat', marks);
    const target = torus.t.cellAt([2, 0, 0]);
    expect(completesLine(torus.board, target, 1, torus.index)).not.toBe(-1);
    expect(completesLine(flat.board, target, 1, flat.index)).toBe(-1);
  });
});

describe('threats', () => {
  it('lists lines with M-1 own marks and one empty cell', () => {
    const { t, index, board } = setup('flat', [[0, [0, 0, 0, 1, 0, 0]]]);
    expect(threats(board, 0, index)).toEqual([
      { lineId: expect.any(Number), missingCell: t.cellAt([2, 0, 0]) },
    ]);
    expect(threats(board, 1, index)).toEqual([]);

    board[t.cellAt([2, 0, 0])] = markOf(1);
    expect(threats(board, 0, index)).toEqual([]);

    board[t.cellAt([1, 1, 0])] = markOf(0);
    const missing = threats(board, 0, index).map((th) => th.missingCell);
    expect(missing.sort((a, b) => a - b)).toEqual([t.cellAt([1, 2, 0]), t.cellAt([2, 2, 0])]);
    for (const th of threats(board, 0, index)) {
      expect(lineCells(index, th.lineId)).toContain(th.missingCell);
    }
  });

  it('does not count completed lines', () => {
    const { index, board } = setup('flat', [[0, [0, 0, 0, 1, 0, 0, 2, 0, 0]]]);
    expect(threats(board, 0, index)).toEqual([]);
  });
});

describe('openLines', () => {
  it('excludes exactly the lines touched by the opponent', () => {
    const { t, index, board } = setup('flat');
    expect(openLines(board, 0, index)).toHaveLength(49);
    board[t.cellAt([1, 1, 1])] = markOf(1);
    expect(openLines(board, 0, index)).toHaveLength(49 - 13);
    expect(openLines(board, 1, index)).toHaveLength(49);
    board[t.cellAt([0, 0, 0])] = markOf(0);
    expect(openLines(board, 1, index)).toHaveLength(49 - 7);
  });
});

describe('isFull', () => {
  it('is true only when no cell is empty', () => {
    const board = new Uint8Array(4).fill(1);
    expect(isFull(board)).toBe(true);
    board[2] = EMPTY;
    expect(isFull(board)).toBe(false);
  });
});
