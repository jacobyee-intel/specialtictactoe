import { navigate, type Screen } from '../router';

const screens: Array<{ id: Screen; label: string }> = [
  { id: 'start', label: 'Start' },
  { id: 'multiverse', label: 'Multiverse' },
  { id: 'timeline', label: 'Timeline' },
];

type ScreenNavProps = {
  current: Screen;
};

export function ScreenNav({ current }: ScreenNavProps) {
  return (
    <nav class="button-row" aria-label="Screen navigation">
      {screens
        .filter(({ id }) => id !== current)
        .map(({ id, label }) => (
          <button type="button" onClick={() => navigate(id)} key={id}>
            {label}
          </button>
        ))}
    </nav>
  );
}
