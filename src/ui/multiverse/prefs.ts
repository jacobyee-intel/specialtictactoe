/**
 * The multiverse screen's remembered choices: Graph or List, and whether the cross-links are
 * drawn. They persist in `localStorage` so a reload (or the next game) keeps the player's setup.
 * Storage is optional: in node, or when the browser refuses it, the defaults simply apply.
 */
import { effect, signal } from '@preact/signals';

export type MultiverseView = 'graph' | 'list';

export interface MultiversePrefs {
  readonly view: MultiverseView;
  readonly links: boolean;
}

export const DEFAULT_PREFS: MultiversePrefs = { view: 'graph', links: true };

export const PREFS_KEY = 'specialtictactoe.multiverse';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** Saved prefs, with anything missing or malformed replaced by the default. */
export function parsePrefs(raw: string | null): MultiversePrefs {
  if (raw === null) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof MultiversePrefs, unknown>> | null;
    return {
      view: value?.view === 'list' || value?.view === 'graph' ? value.view : DEFAULT_PREFS.view,
      links: typeof value?.links === 'boolean' ? value.links : DEFAULT_PREFS.links,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function loadPrefs(storage: Storage | null): MultiversePrefs {
  try {
    return parsePrefs(storage?.getItem(PREFS_KEY) ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(storage: Storage | null, prefs: MultiversePrefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full quota: the choice just is not remembered.
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const initial = loadPrefs(browserStorage());

/** Graph (default) or List. */
export const multiverseView = signal<MultiverseView>(initial.view);
/** Draw the time-travel, transfer and send-back arrows. On by default. */
export const showLinks = signal(initial.links);

effect(() => {
  savePrefs(browserStorage(), { view: multiverseView.value, links: showLinks.value });
});
