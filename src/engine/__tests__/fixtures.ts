import { scenario } from './helpers';

/**
 * Three P1 heads at step 4 (flat 3³):
 * - `s` and `x`: P1 (0,0,0), P2 (0,0,2)
 * - `y`: P1 (0,0,0) and (2,2,2), P2 (0,0,2), so P1 threatens the diagonal at (1,1,1).
 */
export function threeHeads() {
  const g = scenario();
  const [n1] = g.line(g.c(0, 0, 0));
  const [n2, n3] = g.split(n1 as number);
  g.endTurn();
  const [n4, n5] = g.split(n2);
  const n6 = g.place(n3, g.c(2, 2, 2));
  g.endTurn();
  const s = g.place(n4, g.c(0, 0, 2));
  const x = g.place(n5, g.c(0, 0, 2));
  const y = g.place(n6, g.c(0, 0, 2));
  g.endTurn();
  return { g, s, x, y };
}

/**
 * A single timeline after a1 (0,0,0), b1 (0,0,2), a2 (1,0,0), b2 (1,0,2), a3 (1,1,1),
 * b3 (2,2,2). P1 is to move at n6; n4 (step 4) holds P1's open threat at (2,0,0).
 */
export function longLine() {
  const g = scenario();
  const nodes = g.line(
    g.c(0, 0, 0),
    g.c(0, 0, 2),
    g.c(1, 0, 0),
    g.c(1, 0, 2),
    g.c(1, 1, 1),
    g.c(2, 2, 2),
  );
  return { g, n: [g.root, ...nodes] };
}
