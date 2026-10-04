import { describe, expect, it } from 'vitest';
import { newGame } from '@/engine';
import { miniCell, miniPanels } from './MiniBoard';

const game = (topology: 'flat' | 'torus3' | 'tesseract', n: number) =>
  newGame({ topology, n, m: 3, w: 1, l: 10 });

describe('miniPanels', () => {
  it('shows one panel per slice of a cubic board, without halos or the seam panel', () => {
    const { panels, hiddenGroups } = miniPanels(game('torus3', 4));
    expect(panels.map((p) => [p.cols, p.rows])).toEqual([
      [4, 4],
      [4, 4],
      [4, 4],
      [4, 4],
    ]);
    expect(panels.every((p) => p.cells.every((c) => c.kind === 'cell'))).toBe(true);
    expect(hiddenGroups).toBe(0);
  });

  it('shows the first cube of the tesseract and counts the rest', () => {
    const { panels, hiddenGroups } = miniPanels(game('tesseract', 4));
    expect(panels).toHaveLength(4);
    expect(new Set(panels.map((p) => p.groupIndex)).size).toBe(1);
    expect(hiddenGroups).toBe(7);
  });
});

describe('miniCell', () => {
  it('uses the largest pitch that fits, never below 6 px', () => {
    expect(miniCell(3, 3)).toBe(10);
    expect(miniCell(4, 4)).toBe(10);
    expect(miniCell(5, 5)).toBe(10);
    expect(miniCell(6, 6)).toBe(6);
    expect(miniCell(20, 20)).toBe(6);
  });
});
