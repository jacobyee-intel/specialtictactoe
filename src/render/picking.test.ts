import { describe, expect, it } from 'vitest';
import { PickTable, pickCell } from './picking';

describe('PickTable', () => {
  it('round-trips instance id ↔ cell', () => {
    const cells = [4, 9, 0, 13];
    const table = new PickTable(cells);
    expect(table.count).toBe(4);
    cells.forEach((cell, id) => {
      expect(table.cellOf(id)).toBe(cell);
      expect(table.instancesOf(cell)).toEqual([id]);
    });
    const identity = PickTable.identity(27);
    for (let c = 0; c < 27; c++)
      expect(identity.cellOf(identity.instancesOf(c)[0] as number)).toBe(c);
  });

  it('maps several instances (ghost copies) to one cell', () => {
    const table = new PickTable([3, 7, 3, 3]);
    expect(table.instancesOf(3)).toEqual([0, 2, 3]);
    expect(table.instancesOf(5)).toEqual([]);
  });

  it('rejects ids outside the table', () => {
    const table = new PickTable([1, 2]);
    expect(table.cellOf(-1)).toBeNull();
    expect(table.cellOf(2)).toBeNull();
    expect(table.cellOf(0.5)).toBeNull();
  });
});

describe('pickCell', () => {
  const marks = new PickTable([10, 20]);
  const cells = PickTable.identity(27);

  it('prefers a mark over a nearer empty cell box', () => {
    const cell = pickCell([
      { table: marks, hits: [{ instanceId: 1, distance: 9 }] },
      { table: cells, hits: [{ instanceId: 5, distance: 2 }] },
    ]);
    expect(cell).toBe(20);
  });

  it('takes the nearest hit within a layer and falls through empty layers', () => {
    const cell = pickCell([
      { table: marks, hits: [] },
      {
        table: cells,
        hits: [
          { instanceId: 8, distance: 5 },
          { instanceId: 3, distance: 1 },
          { instanceId: undefined, distance: 0 },
        ],
      },
    ]);
    expect(cell).toBe(3);
  });

  it('is null when the ray misses', () => {
    expect(pickCell([{ table: cells, hits: [] }])).toBeNull();
  });
});
