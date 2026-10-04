import { describe, expect, it } from 'vitest';
import { buildLineIndex, createTopology, lineCells, type TopologyId } from '@/geometry';
import { addAction, newGame } from '@/engine';
import { crafted } from '@/engine/__tests__/helpers';
import { boardOf, lineCountAt, openLineCounts, threatMarks } from './overlays';

function geometry(id: TopologyId, n: number, m = n) {
  const topology = createTopology(id, n);
  return { topology, lines: buildLineIndex(topology, m) };
}

describe('threatMarks', () => {
  it('finds the missing cell of each M−1 line for both players', () => {
    const { topology, lines } = geometry('flat', 3);
    const board = new Uint8Array(topology.cellCount);
    const c = (x: number, y: number, z: number) => topology.cellAt([x, y, z]);
    // P1: (0,0,0) (1,0,0) → threat at (2,0,0). P2: (0,2,2) (2,2,2) → threat at (1,2,2).
    board[c(0, 0, 0)] = 1;
    board[c(1, 0, 0)] = 1;
    board[c(0, 2, 2)] = 2;
    board[c(2, 2, 2)] = 2;
    const marks = threatMarks(board, lines);
    expect(marks.map((t) => [t.cell, t.player])).toEqual([
      [c(2, 0, 0), 0],
      [c(1, 2, 2), 1],
    ]);
    expect(marks[0]?.others).toEqual([c(0, 0, 0), c(1, 0, 0)]);
    for (const t of marks) {
      for (const id of t.lineIds) expect([...lineCells(lines, id)]).toContain(t.cell);
    }
  });

  it('merges lines that share the missing cell and drops blocked lines', () => {
    const { topology, lines } = geometry('flat', 3);
    const board = new Uint8Array(topology.cellCount);
    const c = (x: number, y: number, z: number) => topology.cellAt([x, y, z]);
    // P1 row (0,0,0)-(1,0,0) and column (2,1,0)-(2,2,0) both miss (2,0,0).
    for (const cell of [c(0, 0, 0), c(1, 0, 0), c(2, 1, 0), c(2, 2, 0)]) board[cell] = 1;
    const merged = threatMarks(board, lines).filter((t) => t.cell === c(2, 0, 0));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.lineIds).toHaveLength(2);
    expect(merged[0]?.others).toEqual([c(0, 0, 0), c(1, 0, 0), c(2, 1, 0), c(2, 2, 0)]);
    // A P2 mark on (2,0,0) kills both threats.
    board[c(2, 0, 0)] = 2;
    expect(threatMarks(board, lines).some((t) => t.player === 0 && t.cell === c(2, 0, 0))).toBe(
      false,
    );
  });

  it('is empty on an empty board', () => {
    const { topology, lines } = geometry('torus3', 3);
    expect(threatMarks(new Uint8Array(topology.cellCount), lines)).toEqual([]);
  });
});

describe('openLineCounts', () => {
  it('is uniform on an empty 3-torus (every cell is equivalent)', () => {
    for (const n of [3, 4]) {
      const { topology, lines } = geometry('torus3', n);
      const { counts, max } = openLineCounts(new Uint8Array(topology.cellCount), 0, lines);
      expect(new Set(counts).size).toBe(1);
      expect(max).toBe(counts[0]);
      expect(counts[0]).toBe(lineCountAt(lines, 0));
    }
  });

  it('peaks at the centre of an empty flat cube', () => {
    const { topology, lines } = geometry('flat', 3);
    const { counts, max } = openLineCounts(new Uint8Array(topology.cellCount), 1, lines);
    const centre = topology.cellAt([1, 1, 1]);
    expect(counts[centre]).toBe(max);
    expect(max).toBe(13);
    expect([...counts].filter((k) => k === max)).toHaveLength(1);
    expect(counts[topology.cellAt([0, 0, 0])]).toBe(7);
  });

  it('drops lines blocked by the opponent', () => {
    const { topology, lines } = geometry('flat', 3);
    const board = new Uint8Array(topology.cellCount);
    board[topology.cellAt([1, 1, 1])] = 2;
    const { counts } = openLineCounts(board, 0, lines);
    expect(counts[topology.cellAt([0, 0, 0])]).toBe(6);
    expect(openLineCounts(board, 1, lines).counts[topology.cellAt([0, 0, 0])]).toBe(7);
  });
});

describe('boardOf', () => {
  it('includes a mark received by transfer this turn', () => {
    const g = crafted({}, [
      { parent: null, board: '1' + '0'.repeat(26) },
      { parent: 0, board: '12' + '0'.repeat(25) },
      { parent: 0, board: '10' + '0'.repeat(25) },
    ]);
    // Both heads are at step 1 (P2 to move); make P2 the current player.
    const s = { ...g.state, current: 1 as const };
    const r = addAction(s, { kind: 'transfer', head: 1, fromCell: 1, targetHead: 2, toCell: 5 });
    if (!r.ok) throw new Error(r.message);
    expect(boardOf(r.state, 2)[5]).toBe(2);
    expect(r.state.preview.nodes[2]?.board[5]).toBe(0);
    expect(
      boardOf(newGame({ topology: 'flat', n: 3, m: 3, w: 1, l: 1 }), 0).every((v) => v === 0),
    ).toBe(true);
  });
});
