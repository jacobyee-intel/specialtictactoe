import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ComponentChildren;
}

/**
 * A single choice from a list: a row or column of rectangles, the selected one solid black
 * (design-system §5).
 *
 * It follows the ARIA radio-group pattern: one tab stop (the selected option), and the arrow
 * keys, Home and End move the choice, as with native radio buttons.
 */
export function Segmented<T extends string>(props: {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly orientation?: 'horizontal' | 'vertical';
}) {
  const { options, value, onChange, orientation = 'horizontal' } = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const choose = (index: number) => {
    const count = options.length;
    const next = ((index % count) + count) % count;
    const option = options[next];
    if (option === undefined) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number | undefined> = {
      ArrowDown: selected + 1,
      ArrowRight: selected + 1,
      ArrowUp: selected - 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: options.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    choose(target);
  };

  return (
    <div
      class={`segmented segmented--${orientation}`}
      role="radiogroup"
      aria-label={props.label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const checked = i === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            class={checked ? 'segment segment--on' : 'segment'}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
