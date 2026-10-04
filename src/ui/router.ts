import { signal } from '@preact/signals';

export type Screen = 'start' | 'multiverse' | 'timeline';

export const screen = signal<Screen>('start');

export function navigate(nextScreen: Screen): void {
  screen.value = nextScreen;
}
