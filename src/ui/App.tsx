import { screen } from './router';
import { MultiverseScreen, StartScreen, TimelineScreen } from './screens';

function assertNever(value: never): never {
  throw new Error(`Unknown screen: ${value}`);
}

export function App() {
  const activeScreen = screen.value;

  return (
    <main class="app-shell">
      {(() => {
        switch (activeScreen) {
          case 'start':
            return <StartScreen />;
          case 'multiverse':
            return <MultiverseScreen />;
          case 'timeline':
            return <TimelineScreen />;
          default:
            return assertNever(activeScreen);
        }
      })()}
    </main>
  );
}
