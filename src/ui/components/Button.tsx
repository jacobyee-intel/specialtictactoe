import type { ComponentChildren, TargetedMouseEvent } from 'preact';
import { useId } from 'preact/hooks';

type Variant = 'primary' | 'secondary';

interface ButtonProps {
  readonly children: ComponentChildren;
  readonly onClick?: (event: TargetedMouseEvent<HTMLButtonElement>) => void;
  readonly variant?: Variant;
  /**
   * When set, the button is disabled and this text explains why. It is shown as a tooltip on
   * hover and focus, so the button stays focusable (`aria-disabled` rather than `disabled`).
   */
  readonly disabledReason?: string | null;
  readonly type?: 'button' | 'submit';
  readonly class?: string;
  readonly ariaExpanded?: boolean;
  readonly ariaHasPopup?: boolean;
}

/** A rectangular Swiss button (design-system §5): primary is solid black, secondary outlined. */
export function Button(props: ButtonProps) {
  const { variant = 'secondary', disabledReason = null, type = 'button' } = props;
  const tipId = useId();
  const disabled = disabledReason !== null;
  const classes = ['btn', variant === 'primary' ? 'btn--primary' : '', props.class ?? '']
    .filter(Boolean)
    .join(' ');
  const button = (
    <button
      type={type}
      class={classes}
      aria-disabled={disabled ? 'true' : undefined}
      aria-describedby={disabled ? tipId : undefined}
      aria-expanded={props.ariaExpanded}
      aria-haspopup={props.ariaHasPopup ? 'true' : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        props.onClick?.(event);
      }}
    >
      {props.children}
    </button>
  );
  if (!disabled) return button;
  return (
    <span class="btn-wrap">
      {button}
      <span id={tipId} role="tooltip" class="tooltip t-caption">
        {disabledReason}
      </span>
    </span>
  );
}

/** A link styled as a button, for navigation away from the app. */
export function ButtonLink(props: {
  readonly href: string;
  readonly children: ComponentChildren;
  readonly variant?: Variant;
}) {
  return (
    <a
      class={props.variant === 'primary' ? 'btn btn--primary' : 'btn'}
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.children}
    </a>
  );
}
