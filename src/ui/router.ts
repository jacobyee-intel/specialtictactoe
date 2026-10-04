/**
 * Screen routing, mirrored to `location.hash` so the browser Back button works.
 *
 * The route is a signal; components read `route.value` and re-render when it changes. The hash
 * format is `#/`, `#/multiverse`, `#/timeline/12` and `#/timeline/12/read` (read-only view).
 *
 * The router does not know about games. The store installs a guard ({@link setRouteGuard}) that
 * redirects to the start screen when there is no game, which keeps the import graph acyclic:
 * the store depends on the router, never the other way round.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { NodeId } from '@/engine';

export type Route =
  | { readonly screen: 'start' }
  | { readonly screen: 'multiverse' }
  | { readonly screen: 'timeline'; readonly node: NodeId; readonly readOnly: boolean };

export type Screen = Route['screen'];

export const START: Route = { screen: 'start' };

/** The hash for a route. Inverse of {@link parseHash}. */
export function routeToHash(route: Route): string {
  switch (route.screen) {
    case 'start':
      return '#/';
    case 'multiverse':
      return '#/multiverse';
    case 'timeline':
      return `#/timeline/${route.node}${route.readOnly ? '/read' : ''}`;
  }
}

/** The route a hash names, or null when it names none (an unknown or malformed hash). */
export function parseHash(hash: string): Route | null {
  const path = hash.replace(/^#/, '').replace(/^\/+|\/+$/g, '');
  if (path === '') return START;
  if (path === 'multiverse') return { screen: 'multiverse' };
  const match = /^timeline\/(\d{1,9})(\/read)?$/.exec(path);
  if (match) {
    return { screen: 'timeline', node: Number(match[1]), readOnly: match[2] !== undefined };
  }
  return null;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}

const current = signal<Route>(START);

/** The route being shown (always one the guard accepted). */
export const route: ReadonlySignal<Route> = current;

let guard: (route: Route) => Route = (r) => r;

/**
 * Install the function that every requested route passes through before it is shown, e.g. "no
 * game → start". It is re-applied to the current route at once.
 */
export function setRouteGuard(next: (route: Route) => Route): void {
  guard = next;
  current.value = guard(current.value);
}

const hasWindow = typeof window !== 'undefined';

function writeHash(hash: string, replace: boolean): void {
  if (!hasWindow || window.location.hash === hash) return;
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = hash;
}

/**
 * Show a route. By default this adds a browser history entry; `replace` overwrites the current
 * one instead. Redirects made by the guard always replace, so Back does not bounce into them.
 */
export function navigate(next: Route, options: { readonly replace?: boolean } = {}): void {
  const target = guard(next);
  const redirected = !sameRoute(target, next);
  if (!sameRoute(target, current.value)) current.value = target;
  writeHash(routeToHash(target), options.replace === true || redirected);
}

function syncFromHash(): void {
  const requested = parseHash(window.location.hash);
  const target = guard(requested ?? START);
  if (!sameRoute(target, current.value)) current.value = target;
  // Normalize unknown, redirected or non-canonical hashes (e.g. "#/multiverse/") in place.
  writeHash(routeToHash(target), true);
}

/**
 * Follow the browser's hash (initial load, Back/Forward, edited URLs). Returns a function that
 * stops listening. Does nothing outside a browser.
 */
export function startRouter(): () => void {
  if (!hasWindow) return () => {};
  syncFromHash();
  window.addEventListener('hashchange', syncFromHash);
  return () => window.removeEventListener('hashchange', syncFromHash);
}
