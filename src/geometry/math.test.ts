import { describe, expect, it } from 'vitest';
import { mod } from '@/geometry';
import { assertCell, assertSize } from './math';

describe('mod', () => {
  it('wraps negative inputs into a non-negative range', () => {
    expect(mod(-1, 5)).toBe(4);
    expect(mod(-6, 5)).toBe(4);
    expect(mod(-10, 5)).toBe(0);
    expect(Object.is(mod(-5, 5), 0)).toBe(true);
  });

  it('leaves in-range values unchanged and wraps large ones', () => {
    expect(mod(3, 5)).toBe(3);
    expect(mod(12, 5)).toBe(2);
  });

  it('rejects non-positive divisors', () => {
    expect(() => mod(1, 0)).toThrow(RangeError);
  });
});

describe('assertions', () => {
  it('assertCell accepts integer ids in range only', () => {
    expect(() => assertCell(0, 8)).not.toThrow();
    expect(() => assertCell(7, 8)).not.toThrow();
    expect(() => assertCell(8, 8)).toThrow(RangeError);
    expect(() => assertCell(-1, 8)).toThrow(RangeError);
    expect(() => assertCell(1.5, 8)).toThrow(RangeError);
  });

  it('assertSize accepts integers at or above the minimum only', () => {
    expect(() => assertSize(2, 2)).not.toThrow();
    expect(() => assertSize(1, 2)).toThrow(RangeError);
    expect(() => assertSize(2.5, 2)).toThrow(RangeError);
  });
});
