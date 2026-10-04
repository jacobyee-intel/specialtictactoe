import type { ComponentChildren } from 'preact';

/** A square checkbox with a 16 px label (design-system §5). */
export function Toggle(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ComponentChildren;
  readonly disabled?: boolean;
}) {
  return (
    <label class={props.disabled ? 'toggle toggle--disabled' : 'toggle'}>
      <input
        type="checkbox"
        class="toggle-box"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.children}</span>
    </label>
  );
}
