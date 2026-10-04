/** Game construction: validated config → topology, line index, and the initial state. */
import { buildLineIndex, createTopology, type LineIndex, type Topology } from '@/geometry';
import { validateConfig } from './config';
import { staticPreview } from './draft';
import { buildChildren } from './tree';
import type { GameConfig, GameConfigInput, GameState, TNode } from './types';

const geometryCache = new Map<string, { topology: Topology; lines: LineIndex }>();

/**
 * The topology and line index for a config. They depend only on (space, N, M) and are pure, so
 * they are built once and shared (line enumeration is the expensive part of starting a game).
 */
export function geometryFor(config: GameConfig): { topology: Topology; lines: LineIndex } {
  const key = `${config.topology}/${config.n}/${config.m}`;
  let geometry = geometryCache.get(key);
  if (geometry === undefined) {
    const topology = createTopology(config.topology, config.n);
    geometry = { topology, lines: buildLineIndex(topology, config.m) };
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/** A new game: one empty root timeline at step 0, P1 to move, round 1. Throws on a bad config. */
export function newGame(input: GameConfigInput): GameState {
  const check = validateConfig(input);
  if (!check.ok) throw new RangeError(check.errors.map((e) => e.message).join(' '));
  const config = check.config;
  const { topology, lines } = geometryFor(config);
  const root: TNode = {
    id: 0,
    parent: null,
    step: 0,
    board: new Uint8Array(topology.cellCount),
    terminal: null,
    origin: { kind: 'root' },
    received: null,
    round: 0,
  };
  const nodes = [root];
  const children = buildChildren(nodes);
  return {
    config,
    topology,
    lines,
    nodes,
    children,
    current: 0,
    round: 1,
    score: [0, 0],
    phase: 'draft',
    draft: [],
    queue: [],
    pendingSendBack: null,
    resolveLedger: null,
    result: null,
    events: [],
    preview: staticPreview({ nodes, children }),
  };
}
