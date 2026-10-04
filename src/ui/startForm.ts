/**
 * Start-screen form logic, kept out of the component so it can be tested in node.
 *
 * The form holds a plain config input. Numbers may be NaN while the user is typing; validation
 * is always the engine's {@link validateConfig}, plus the steppers' own upper limits for W and L
 * (the engine accepts any positive W and L, but the form offers a sensible range).
 */
import {
  DEFAULT_CONFIG,
  geometryFor,
  validateConfig,
  type GameConfig,
  type GameConfigInput,
} from '@/engine';
import { TOPOLOGY_INFO, isTopologyId, type TopologyId } from '@/geometry';

/** What the form edits: a config without the timeline cap (which keeps its default). */
export type StartInput = Pick<GameConfigInput, 'topology' | 'n' | 'm' | 'w' | 'l'>;

export type NumberField = 'n' | 'm' | 'w' | 'l';

/** Form field errors keyed like the engine's `ConfigError.field`. */
export type FormErrors = Partial<Record<keyof GameConfig, string>>;

export const W_RANGE = [1, 9] as const;
export const L_RANGE = [1, 200] as const;

/** The form's starting values: the previous game's config, else the engine defaults. */
export function initialInput(previous: GameConfig | null = null): StartInput {
  const { topology, n, m, w, l } = previous ?? DEFAULT_CONFIG;
  return { topology, n, m, w, l };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Inclusive range the stepper for `field` offers, given the rest of the input. */
export function fieldRange(input: StartInput, field: NumberField): readonly [number, number] {
  switch (field) {
    case 'n':
      return TOPOLOGY_INFO[input.topology].nRange;
    case 'm':
      return [2, Number.isInteger(input.n) ? Math.max(2, input.n) : 2];
    case 'w':
      return W_RANGE;
    case 'l':
      return L_RANGE;
  }
}

/**
 * M after N changes from `oldN` to `newN`. "M = N" (a full row, the default) is kept as N
 * moves; otherwise M only shrinks when it would exceed N.
 */
function followN(m: number, oldN: number, newN: number): number {
  if (!Number.isInteger(newN)) return m;
  if (m === oldN) return Math.max(2, newN);
  return Number.isInteger(m) ? clamp(m, 2, Math.max(2, newN)) : m;
}

/**
 * Switch the space, clamping N into its `nRange` (e.g. 6 → 4 for the tesseract) and keeping
 * M ≤ N. W and L are unaffected.
 */
export function clampForTopology(input: StartInput, id: TopologyId): StartInput {
  const [lo, hi] = TOPOLOGY_INFO[id].nRange;
  const n = Number.isInteger(input.n) ? clamp(input.n, lo, hi) : clamp(DEFAULT_CONFIG.n, lo, hi);
  return { ...input, topology: id, n, m: followN(input.m, input.n, n) };
}

/** Set one number field; changing N drags M along (see {@link followN}). */
export function setField(input: StartInput, field: NumberField, value: number): StartInput {
  if (field === 'n') return { ...input, n: value, m: followN(input.m, input.n, value) };
  return { ...input, [field]: value };
}

/** Step a field by `delta` within its stepper range (from the range's start if it is NaN). */
export function stepField(input: StartInput, field: NumberField, delta: number): StartInput {
  const [lo, hi] = fieldRange(input, field);
  const value = input[field];
  const next = Number.isFinite(value) ? clamp(Math.round(value) + delta, lo, hi) : lo;
  return setField(input, field, next);
}

/**
 * Errors to show next to each field: every error from {@link validateConfig}, plus the form's
 * own upper limits for W and L when the engine has nothing to say about them.
 */
export function formErrors(input: StartInput): FormErrors {
  const out: FormErrors = {};
  const check = validateConfig(input);
  if (!check.ok) for (const e of check.errors) out[e.field] ??= e.message;
  if (out.w === undefined && input.w > W_RANGE[1]) {
    out.w = `W must be an integer from ${W_RANGE[0]} to ${W_RANGE[1]}.`;
  }
  if (out.l === undefined && input.l > L_RANGE[1]) {
    out.l = `L must be an integer from ${L_RANGE[0]} to ${L_RANGE[1]}.`;
  }
  return out;
}

/** The first error, phrased as the reason the Start button is disabled; null if none. */
export function startBlocker(errors: FormErrors): string | null {
  const first = Object.values(errors)[0];
  return first ?? null;
}

/** Cells in a game of this size: N³, or 8N³ for the eight cubes of the tesseract surface. */
export function cellCount(id: TopologyId, n: number): number {
  return (id === 'tesseract' ? 8 : 1) * n ** 3;
}

const lineCounts = new Map<string, number>();

/**
 * The number of winning lines for this space, N and M, or null when N or M is not playable.
 *
 * It comes from the engine's line index, so it is exactly what the game will use. Building an
 * index costs up to ~30 ms (tesseract, N = 4), so counts are memoised per (space, N, M) here on
 * top of the engine's own geometry cache.
 */
export function winningLineCount(input: StartInput): number | null {
  const { topology, n, m } = input;
  if (!isTopologyId(topology)) return null;
  const [lo, hi] = TOPOLOGY_INFO[topology].nRange;
  if (!Number.isInteger(n) || n < lo || n > hi || !Number.isInteger(m) || m < 2 || m > n) {
    return null;
  }
  const key = `${topology}/${n}/${m}`;
  let count = lineCounts.get(key);
  if (count === undefined) {
    count = geometryFor({ ...DEFAULT_CONFIG, topology, n, m }).lines.lineCount;
    lineCounts.set(key, count);
  }
  return count;
}
