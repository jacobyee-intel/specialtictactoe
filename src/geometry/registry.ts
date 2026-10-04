/**
 * The catalogue of playable spaces: factory plus the descriptive metadata shown in the UI.
 */
import { CubicQuotient, type CubicTopologyId } from './cubic';
import { TesseractSurface } from './tesseract';
import type { Topology, TopologyId } from './types';

export interface TopologyInfo {
  readonly id: TopologyId;
  /** Short name, e.g. "Quarter-turn space". */
  readonly displayName: string;
  /** Display name with its common alias, e.g. "Quarter-turn space (tetracosm)". */
  readonly fullName: string;
  /** Conway–Rossetti name of the flat 3-manifold, or null if it is not one. */
  readonly conwayName: string | null;
  readonly orientable: boolean;
  /** Holonomy group: what parallel transport around loops can do to a direction. */
  readonly holonomy: string;
  readonly curvature: string;
  /** Inclusive range of board sizes N offered in a game. */
  readonly nRange: readonly [number, number];
  readonly blurb: string;
}

/** All spaces, in menu order. */
export const TOPOLOGY_IDS: readonly TopologyId[] = [
  'torus3',
  'tetracosm',
  'amphicosm1',
  'tesseract',
  'flat',
];

export const TOPOLOGY_INFO: Readonly<Record<TopologyId, TopologyInfo>> = {
  torus3: {
    id: 'torus3',
    displayName: '3-torus',
    fullName: '3-torus (torocosm)',
    conwayName: 'torocosm',
    orientable: true,
    holonomy: 'trivial',
    curvature: 'flat',
    nRange: [3, 6],
    blurb:
      'Leave through any face and you re-enter through the opposite one, unchanged. Every cell is equivalent: there are no edges, corners or center.',
  },
  tetracosm: {
    id: 'tetracosm',
    displayName: 'Quarter-turn space',
    fullName: 'Quarter-turn space (tetracosm)',
    conwayName: 'tetracosm',
    orientable: true,
    holonomy: 'Z/4 (quarter turn about z)',
    curvature: 'flat',
    nRange: [3, 6],
    blurb:
      'Like the 3-torus, but going out through the top rotates you a quarter turn before you come back in at the bottom. Vertical lines visit four columns before closing.',
  },
  amphicosm1: {
    id: 'amphicosm1',
    displayName: 'First amphicosm',
    fullName: 'First amphicosm (Klein bottle × circle)',
    conwayName: 'first amphicosm',
    orientable: false,
    holonomy: 'Z/2 (reflection in x)',
    curvature: 'flat',
    nRange: [3, 6],
    blurb:
      'Going out through the top mirrors you left-to-right, so a right hand comes back as a left hand. The space is non-orientable: a Klein bottle times a circle.',
  },
  tesseract: {
    id: 'tesseract',
    displayName: 'Tesseract surface',
    fullName: 'Tesseract surface',
    conwayName: null,
    orientable: true,
    holonomy: 'n/a',
    curvature: 'positive on edges (cone angle 270°)',
    nRange: [2, 4],
    blurb:
      'The 3D boundary of a 4D hypercube: eight cubes glued face to face. Lines bend 90° through the fourth dimension where cubes meet, and are blocked at the edges where three cubes meet.',
  },
  flat: {
    id: 'flat',
    displayName: 'Flat cube',
    fullName: 'Flat cube (Euclidean baseline)',
    conwayName: null,
    orientable: true,
    holonomy: 'trivial',
    curvature: 'flat, with boundary',
    nRange: [3, 6],
    blurb:
      'Classic 3D tic-tac-toe in an ordinary bounded cube, for comparison. Lines stop at the walls, so the center is worth far more than a corner.',
  },
};

export function isTopologyId(value: unknown): value is TopologyId {
  return typeof value === 'string' && (TOPOLOGY_IDS as readonly string[]).includes(value);
}

/**
 * Build a space with N cells per edge. The `nRange` in {@link TOPOLOGY_INFO} is the playable
 * range and is enforced by game config validation, not here.
 */
export function createTopology(id: 'tesseract', n: number): TesseractSurface;
export function createTopology(id: CubicTopologyId, n: number): CubicQuotient;
export function createTopology(id: TopologyId, n: number): Topology;
export function createTopology(id: TopologyId, n: number): Topology {
  return id === 'tesseract' ? new TesseractSurface(n) : new CubicQuotient(id, n);
}
