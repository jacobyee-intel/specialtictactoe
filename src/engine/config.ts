/**
 * Game configuration: defaults and validation.
 *
 * The geometry builds any size it is asked for; the playable ranges live here so the start screen
 * and saved games are checked in one place.
 */
import { TOPOLOGY_INFO, isTopologyId } from '@/geometry';
import type { GameConfig, GameConfigInput } from './types';

export const DEFAULT_MAX_TIMELINES = 32;

/** A sensible starting point: on small tori the first player is too strong, so N = M = 4. */
export const DEFAULT_CONFIG: GameConfig = {
  topology: 'torus3',
  n: 4,
  m: 4,
  w: 3,
  l: 40,
  maxTimelines: DEFAULT_MAX_TIMELINES,
};

export interface ConfigError {
  readonly field: keyof GameConfig;
  readonly message: string;
}

export type ConfigCheck =
  | { readonly ok: true; readonly config: GameConfig }
  | { readonly ok: false; readonly errors: readonly ConfigError[] };

/**
 * Check every field and return either the normalized config (with `maxTimelines` filled in) or
 * one error per bad field, so a form can show them next to the inputs.
 *
 * Rules: N within the topology's `nRange`, 2 ≤ M ≤ N, W ≥ 1, L ≥ 1, maxTimelines ≥ 1, all
 * integers.
 */
export function validateConfig(input: GameConfigInput): ConfigCheck {
  const config: GameConfig = {
    topology: input.topology,
    n: input.n,
    m: input.m,
    w: input.w,
    l: input.l,
    maxTimelines: input.maxTimelines ?? DEFAULT_MAX_TIMELINES,
  };
  const errors: ConfigError[] = [];
  const isInt = (v: unknown): v is number => Number.isInteger(v);

  if (!isTopologyId(config.topology)) {
    errors.push({ field: 'topology', message: `Unknown space "${String(config.topology)}".` });
  } else {
    const [lo, hi] = TOPOLOGY_INFO[config.topology].nRange;
    if (!isInt(config.n) || config.n < lo || config.n > hi) {
      errors.push({ field: 'n', message: `N must be an integer from ${lo} to ${hi}.` });
    }
  }
  if (!isInt(config.m) || config.m < 2 || !(config.m <= config.n)) {
    errors.push({ field: 'm', message: 'M must be an integer with 2 ≤ M ≤ N.' });
  }
  if (!isInt(config.w) || config.w < 1) {
    errors.push({ field: 'w', message: 'W must be a positive integer.' });
  }
  if (!isInt(config.l) || config.l < 1) {
    errors.push({ field: 'l', message: 'L must be a positive integer.' });
  }
  if (!isInt(config.maxTimelines) || config.maxTimelines < 1) {
    errors.push({ field: 'maxTimelines', message: 'The timeline cap must be a positive integer.' });
  }
  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}
