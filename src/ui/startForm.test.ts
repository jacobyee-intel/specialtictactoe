import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from '@/engine';
import { TOPOLOGY_IDS } from '@/geometry';
import {
  cellCount,
  clampForTopology,
  fieldRange,
  formErrors,
  initialInput,
  setField,
  startBlocker,
  stepField,
  winningLineCount,
  type StartInput,
} from './startForm';

const base: StartInput = { topology: 'torus3', n: 6, m: 5, w: 3, l: 40 };

describe('initialInput', () => {
  it('starts from the engine defaults, or the previous game', () => {
    expect(initialInput()).toEqual({ topology: 'torus3', n: 4, m: 4, w: 3, l: 40 });
    expect(initialInput({ ...DEFAULT_CONFIG, topology: 'flat', n: 5 })).toMatchObject({
      topology: 'flat',
      n: 5,
    });
  });
});

describe('clampForTopology', () => {
  it('clamps N into the tesseract range and keeps M ≤ N', () => {
    expect(clampForTopology(base, 'tesseract')).toEqual({
      ...base,
      topology: 'tesseract',
      n: 4,
      m: 4,
    });
    expect(clampForTopology({ ...base, m: 3 }, 'tesseract')).toMatchObject({ n: 4, m: 3 });
  });

  it('raises N into the cubic range when leaving a small tesseract', () => {
    const small: StartInput = { ...base, topology: 'tesseract', n: 2, m: 2 };
    // M was a full row (M = N), so it follows N up.
    expect(clampForTopology(small, 'flat')).toMatchObject({ topology: 'flat', n: 3, m: 3 });
  });

  it('keeps N when it already fits', () => {
    expect(clampForTopology(base, 'tetracosm')).toEqual({ ...base, topology: 'tetracosm' });
  });

  it('recovers a half-typed N', () => {
    expect(clampForTopology({ ...base, n: NaN }, 'tesseract').n).toBe(4);
  });

  it('always yields a valid config from a valid one', () => {
    for (const from of TOPOLOGY_IDS) {
      for (const to of TOPOLOGY_IDS) {
        const input = clampForTopology(clampForTopology(base, from), to);
        expect(validateConfig(input).ok, `${from} → ${to}`).toBe(true);
      }
    }
  });
});

describe('M follows N', () => {
  it('keeps a full row when N moves', () => {
    const full: StartInput = { ...base, n: 4, m: 4 };
    expect(setField(full, 'n', 5)).toMatchObject({ n: 5, m: 5 });
    expect(setField(full, 'n', 3)).toMatchObject({ n: 3, m: 3 });
  });

  it('only shrinks a shorter M when it would exceed N', () => {
    expect(setField(base, 'n', 5)).toMatchObject({ n: 5, m: 5 });
    expect(setField({ ...base, m: 3 }, 'n', 5)).toMatchObject({ n: 5, m: 3 });
    expect(setField({ ...base, m: 3 }, 'n', 4)).toMatchObject({ n: 4, m: 3 });
  });

  it('leaves M alone while N is half-typed', () => {
    expect(setField(base, 'n', NaN)).toMatchObject({ m: 5 });
  });

  it('caps the M stepper at N', () => {
    expect(fieldRange(base, 'm')).toEqual([2, 6]);
    expect(stepField({ ...base, m: 6 }, 'm', 1).m).toBe(6);
  });
});

describe('stepField', () => {
  it('steps within range and from the minimum when empty', () => {
    expect(stepField(base, 'w', 1).w).toBe(4);
    expect(stepField({ ...base, w: 9 }, 'w', 1).w).toBe(9);
    expect(stepField({ ...base, l: 198 }, 'l', 5).l).toBe(200);
    expect(stepField({ ...base, l: 3 }, 'l', -5).l).toBe(1);
    expect(stepField({ ...base, l: NaN }, 'l', 1).l).toBe(1);
    expect(stepField(base, 'n', 1)).toMatchObject({ n: 6, m: 5 });
  });
});

describe('formErrors', () => {
  const bad: StartInput[] = [
    { ...base, n: 7 },
    { ...base, topology: 'tesseract', n: 5, m: 1 },
    { ...base, m: 7 },
    { ...base, w: 0, l: 0 },
    { ...base, n: NaN, m: NaN, w: NaN, l: 2.5 },
  ];

  it('has no errors for a valid config', () => {
    expect(formErrors(base)).toEqual({});
    expect(startBlocker({})).toBeNull();
  });

  it.each(bad)('maps every validateConfig error to its field: %o', (input) => {
    const check = validateConfig(input);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    const errors = formErrors(input);
    expect(Object.keys(errors).sort()).toEqual(check.errors.map((e) => e.field).sort());
    for (const e of check.errors) expect(errors[e.field]).toBe(e.message);
    expect(startBlocker(errors)).toBe(check.errors[0]?.message);
  });

  it('adds the stepper limits for W and L', () => {
    expect(formErrors({ ...base, w: 10, l: 201 })).toEqual({
      w: 'W must be an integer from 1 to 9.',
      l: 'L must be an integer from 1 to 200.',
    });
  });
});

describe('cells and winning lines', () => {
  it('counts cells', () => {
    expect(cellCount('torus3', 4)).toBe(64);
    expect(cellCount('tesseract', 3)).toBe(216);
  });

  it('matches the PLAN.md line-count oracles', () => {
    const at = (topology: StartInput['topology'], n: number, m: number) =>
      winningLineCount({ ...base, topology, n, m });
    expect(at('flat', 3, 3)).toBe(49);
    expect(at('torus3', 3, 3)).toBe(117);
    expect(at('tetracosm', 4, 4)).toBe(640);
    expect(at('amphicosm1', 3, 3)).toBe(207);
    expect(at('tesseract', 3, 3)).toBe(2072);
    expect(at('torus3', 4, 3)).toBe(13 * 64);
  });

  it('is null for an unplayable N or M', () => {
    expect(winningLineCount({ ...base, n: 7 })).toBeNull();
    expect(winningLineCount({ ...base, m: 1 })).toBeNull();
    expect(winningLineCount({ ...base, m: NaN })).toBeNull();
  });
});
