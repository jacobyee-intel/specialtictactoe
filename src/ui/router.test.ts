import { describe, expect, it } from 'vitest';
import { parseHash, routeToHash, sameRoute, type Route } from './router';

describe('hash routes', () => {
  const routes: Route[] = [
    { screen: 'start' },
    { screen: 'multiverse' },
    { screen: 'timeline', node: 12, readOnly: false },
    { screen: 'timeline', node: 0, readOnly: true },
  ];

  it('writes the documented hashes', () => {
    expect(routes.map(routeToHash)).toEqual([
      '#/',
      '#/multiverse',
      '#/timeline/12',
      '#/timeline/0/read',
    ]);
  });

  it.each(routes)('round-trips %o', (r) => {
    expect(parseHash(routeToHash(r))).toEqual(r);
  });

  it('accepts empty and sloppy hashes', () => {
    expect(parseHash('')).toEqual({ screen: 'start' });
    expect(parseHash('#')).toEqual({ screen: 'start' });
    expect(parseHash('#/multiverse/')).toEqual({ screen: 'multiverse' });
  });

  it('rejects unknown hashes', () => {
    for (const hash of [
      '#/nope',
      '#/timeline',
      '#/timeline/x',
      '#/timeline/-1',
      '#/timeline/3/edit',
    ]) {
      expect(parseHash(hash)).toBeNull();
    }
  });

  it('compares routes by value', () => {
    expect(sameRoute({ screen: 'multiverse' }, { screen: 'multiverse' })).toBe(true);
    expect(
      sameRoute(
        { screen: 'timeline', node: 1, readOnly: false },
        { screen: 'timeline', node: 1, readOnly: true },
      ),
    ).toBe(false);
  });
});
