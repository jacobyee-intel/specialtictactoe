import { useEffect } from 'preact/hooks';
import { route } from './router';
import { MultiverseScreen, StartScreen, TimelineScreen } from './screens';

const COLUMNS = Array.from({ length: 12 }, (_, i) => i);

/**
 * The debug grid overlay (design-system §4): `?grid` in the URL turns it on, and in dev the G
 * key toggles it (except while typing in a field).
 */
function useGridOverlay(): void {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('grid')) {
      document.body.classList.add('show-grid');
    }
    if (!import.meta.env.DEV) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, [contenteditable]') != null;
      if (
        event.key.toLowerCase() !== 'g' ||
        typing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      document.body.classList.toggle('show-grid');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useGridOverlay();
  const current = route.value;

  let screen;
  switch (current.screen) {
    case 'start':
      screen = <StartScreen />;
      break;
    case 'multiverse':
      screen = <MultiverseScreen />;
      break;
    case 'timeline':
      screen = <TimelineScreen node={current.node} readOnly={current.readOnly} />;
      break;
  }

  return (
    <>
      {screen}
      <div class="grid-overlay" aria-hidden="true">
        <div class="page grid">
          {COLUMNS.map((i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
