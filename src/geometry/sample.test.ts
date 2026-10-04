import { describe, expect, it } from 'vitest';
import { mod } from '@/geometry';

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
