import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, loadPrefs, parsePrefs, savePrefs } from './prefs';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('multiverse prefs', () => {
  it('defaults to the graph with links on', () => {
    expect(DEFAULT_PREFS).toEqual({ view: 'graph', links: true });
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    savePrefs(storage, { view: 'list', links: false });
    expect(storage.data.get(PREFS_KEY)).toBe('{"view":"list","links":false}');
    expect(loadPrefs(storage)).toEqual({ view: 'list', links: false });
  });

  it('replaces malformed values by the defaults', () => {
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"view":"disk","links":"yes"}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"links":false}')).toEqual({ view: 'graph', links: false });
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow();
  });
});
