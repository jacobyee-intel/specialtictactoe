import { describe, expect, it } from 'vitest';
import { DIRECTIONS_3D, dir3, dir4, internDir, isUnitDir, negateDir } from '@/geometry';

describe('directions', () => {
  it('lists the 26 distinct nonzero unit vectors in 3D', () => {
    expect(DIRECTIONS_3D).toHaveLength(26);
    expect(new Set(DIRECTIONS_3D.map((d) => d.join())).size).toBe(26);
    expect(DIRECTIONS_3D.every((d) => d.length === 3 && isUnitDir(d))).toBe(true);
    expect(DIRECTIONS_3D.some((d) => d.every((v) => v === 0))).toBe(false);
  });

  it('interns unit vectors so equal directions are the same array', () => {
    expect(dir3(1, 0, -1)).toBe(dir3(1, 0, -1));
    expect(dir4(0, 1, -1, 1)).toBe(internDir([0, 1, -1, 1]));
    expect(internDir([1, 1, 0])).toBe(dir3(1, 1, 0));
    expect(Object.isFrozen(dir3(1, 0, 0))).toBe(true);
  });

  it('falls back to fresh frozen arrays outside {-1,0,1} and for other lengths', () => {
    expect(dir3(2, 0, 0)).toEqual([2, 0, 0]);
    expect(dir3(2, 0, 0)).not.toBe(dir3(2, 0, 0));
    expect(dir4(0, 0, 0, -3)).toEqual([0, 0, 0, -3]);
    expect(internDir([1, 0])).toEqual([1, 0]);
    expect(Object.isFrozen(internDir([1, 0]))).toBe(true);
    expect(isUnitDir([0, 2, 0])).toBe(false);
  });

  it('negates without producing -0', () => {
    const n = negateDir(dir3(1, 0, -1));
    expect(n).toBe(dir3(-1, 0, 1));
    expect(Object.is(n[1], 0)).toBe(true);
  });
});
