/** Euclidean modulo: the result is always in [0, n), even for negative `a`. */
export function mod(a: number, n: number): number {
  if (n <= 0) {
    throw new RangeError('Modulo divisor must be positive.');
  }

  return ((a % n) + n) % n;
}
