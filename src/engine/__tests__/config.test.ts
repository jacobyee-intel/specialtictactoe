import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  geometryFor,
  headStatus,
  liveTimelines,
  newGame,
  printTree,
  requiredHeads,
  validateConfig,
  type GameConfigInput,
} from '@/engine';
import type { TopologyId } from '@/geometry';

const base: GameConfigInput = { topology: 'flat', n: 3, m: 3, w: 1, l: 1 };

describe('validateConfig (test 1)', () => {
  it('accepts valid configs and defaults the timeline cap to 32', () => {
    expect(validateConfig(base)).toEqual({ ok: true, config: { ...base, maxTimelines: 32 } });
    expect(validateConfig({ ...base, maxTimelines: 1 })).toMatchObject({ ok: true });
    expect(validateConfig(DEFAULT_CONFIG)).toMatchObject({ ok: true });
    expect(validateConfig({ topology: 'tesseract', n: 2, m: 2, w: 1, l: 1 }).ok).toBe(true);
    expect(validateConfig({ topology: 'torus3', n: 6, m: 2, w: 9, l: 99 }).ok).toBe(true);
  });

  const fieldsOf = (input: GameConfigInput) => {
    const check = validateConfig(input);
    return check.ok ? [] : check.errors.map((e) => e.field);
  };

  it.each<[string, Partial<GameConfigInput>, string[]]>([
    ['M > N', { n: 3, m: 4 }, ['m']],
    ['M < 2', { m: 1 }, ['m']],
    ['non-integer M', { m: 2.5 }, ['m']],
    ['N below the cubic range', { n: 2, m: 2 }, ['n']],
    ['N above the cubic range', { n: 7 }, ['n']],
    ['non-integer N', { n: 3.5 }, ['n']],
    ['W < 1', { w: 0 }, ['w']],
    ['L < 1', { l: 0 }, ['l']],
    ['non-integer L', { l: 1.5 }, ['l']],
    ['several fields at once', { w: -1, l: 0, m: 9 }, ['m', 'w', 'l']],
  ])('rejects %s', (_, patch, fields) => {
    expect(fieldsOf({ ...base, ...patch })).toEqual(fields);
  });

  it('rejects a timeline cap below 1', () => {
    expect(fieldsOf({ ...base, maxTimelines: 0 })).toEqual(['maxTimelines']);
    expect(fieldsOf({ ...base, maxTimelines: 1.5 })).toEqual(['maxTimelines']);
  });

  it('uses the per-topology N range (tesseract is 2..4)', () => {
    expect(fieldsOf({ topology: 'tesseract', n: 5, m: 3, w: 1, l: 1 })).toEqual(['n']);
    expect(fieldsOf({ topology: 'tesseract', n: 1, m: 1, w: 1, l: 1 })).toEqual(['n', 'm']);
  });

  it('rejects an unknown topology', () => {
    expect(fieldsOf({ ...base, topology: 'klein' as TopologyId })).toEqual(['topology']);
  });

  it('newGame throws a RangeError with the messages', () => {
    expect(() => newGame({ ...base, m: 4 })).toThrow(RangeError);
    expect(() => newGame({ ...base, m: 4 })).toThrow(/2 ≤ M ≤ N/);
  });
});

describe('newGame (test 2)', () => {
  it('starts with a single empty root at step 0, P1 to move, round 1', () => {
    const s = newGame({ ...base, l: 5 });
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]).toMatchObject({ id: 0, parent: null, step: 0, terminal: null, round: 0 });
    expect(s.nodes[0]?.origin).toEqual({ kind: 'root' });
    expect([...(s.nodes[0]?.board ?? [])].every((v) => v === 0)).toBe(true);
    expect(s.nodes[0]?.board).toHaveLength(27);
    expect(s.current).toBe(0);
    expect(s.round).toBe(1);
    expect(s.score).toEqual([0, 0]);
    expect(s.phase).toBe('draft');
    expect(requiredHeads(s)).toEqual([0]);
    expect(requiredHeads(s, 1)).toEqual([]);
    expect(liveTimelines(s)).toBe(1);
    expect(headStatus(s, 0)).toBe('needsAction');
    expect(printTree(s)).toBe(
      'round 1 · P1 to move · draft · score 0–0 · live 1/32\n#0 s0 P1 root [needs action]',
    );
  });

  it('shares the topology and line index between games with the same space', () => {
    const a = newGame({ ...base, topology: 'torus3' });
    const b = newGame({ ...base, topology: 'torus3', w: 5 });
    expect(a.lines).toBe(b.lines);
    expect(a.lines.lineCount).toBe(117);
    expect(geometryFor(a.config).topology).toBe(a.topology);
    expect(newGame(base).lines).not.toBe(a.lines);
  });
});
