/** Euclidean modulo: the result is always in [0, n), even for negative `a`. */
export function mod(a: number, n: number): number {
  if (n <= 0) {
    throw new RangeError('Modulo divisor must be positive.');
  }

  return ((a % n) + n) % n;
}

/** Throw a `RangeError` unless `c` is an integer cell id in `[0, cellCount)`. */
export function assertCell(c: number, cellCount: number): void {
  if (!Number.isInteger(c) || c < 0 || c >= cellCount) {
    throw new RangeError(`Cell ${c} is outside [0, ${cellCount}).`);
  }
}

/** Throw a `RangeError` unless `n` is an integer of at least `min`. */
export function assertSize(n: number, min: number): void {
  if (!Number.isInteger(n) || n < min) {
    throw new RangeError(`Size ${n} must be an integer >= ${min}.`);
  }
}
