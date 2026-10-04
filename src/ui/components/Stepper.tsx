import type { TargetedKeyboardEvent } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

/** Delay before a held − / + button starts repeating, and the repeat interval (ms). */
const HOLD_DELAY = 400;
const HOLD_EVERY = 90;

interface StepperProps {
  /** One-letter name, e.g. "N". */
  readonly name: string;
  /** What it means, e.g. "Cells per side". */
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Step used when a button is held or with PageUp/PageDown and Shift+arrows. */
  readonly bigStep?: number;
  readonly error?: string | null | undefined;
  /** Change by a relative amount (the parent clamps and applies it to its latest state). */
  readonly onStep: (delta: number) => void;
  /** Set a typed value (NaN while the field is empty or not a number). */
  readonly onInput: (value: number) => void;
}

/** Parse what the user typed: digits only (with an optional sign), else NaN. */
function parseTyped(text: string): number {
  const t = text.trim();
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * A labelled numeric stepper (design-system §5): a 12 px uppercase label, a large numeral that
 * can be typed into, and square − / + buttons. Out-of-range steps are disabled; errors appear
 * underneath with a red rule.
 */
export function Stepper(props: StepperProps) {
  const { value, min, max, bigStep = 1, onStep } = props;
  const id = useId();
  const errorId = `${id}-error`;
  // What the user is typing, kept only while editing so "1" on the way to "12" is not clamped
  // away; otherwise the numeral is always the current value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (Number.isFinite(value) ? String(value) : '');
  const hold = useRef<{ timer: number; interval: number } | null>(null);

  const step = (delta: number) => {
    setDraft(null);
    onStep(delta);
  };

  const stopHold = () => {
    if (hold.current === null) return;
    window.clearTimeout(hold.current.timer);
    window.clearInterval(hold.current.interval);
    hold.current = null;
  };
  useEffect(() => stopHold, []);

  const startHold = (sign: 1 | -1) => {
    stopHold();
    step(sign);
    const state = { timer: 0, interval: 0 };
    state.timer = window.setTimeout(() => {
      state.interval = window.setInterval(() => step(sign * bigStep), HOLD_EVERY);
    }, HOLD_DELAY);
    hold.current = state;
  };

  const finite = Number.isFinite(value);
  const canDown = !finite || value > min;
  const canUp = !finite || value < max;

  const button = (sign: 1 | -1, enabled: boolean, label: string) => (
    <button
      type="button"
      class="btn btn--square stepper-button"
      aria-label={`${label} ${props.name}`}
      aria-controls={id}
      disabled={!enabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        startHold(sign);
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onClick={(event) => {
        // Pointer presses were handled on pointerdown; this is Enter/Space on a focused button.
        if (event.detail === 0) step(sign);
      }}
    >
      {sign < 0 ? '−' : '+'}
    </button>
  );

  // Holding a button until it disables itself must still stop the repeat.
  useEffect(() => {
    if (!canDown || !canUp) stopHold();
  }, [canDown, canUp]);

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    const big = event.shiftKey ? bigStep : 1;
    const deltas: Record<string, number | undefined> = {
      ArrowUp: big,
      ArrowDown: -big,
      PageUp: bigStep,
      PageDown: -bigStep,
    };
    const delta = deltas[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      step(delta);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setDraft(null);
      props.onInput(event.key === 'Home' ? min : max);
    }
  };

  return (
    <div class={props.error ? 'stepper stepper--invalid' : 'stepper'}>
      <label class="t-label stepper-label" for={id}>
        <span class="t-bold">{props.name}</span> {props.label}
      </label>
      <input
        id={id}
        class="stepper-value t-num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellcheck={false}
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={finite ? value : undefined}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? errorId : undefined}
        value={text}
        onInput={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          props.onInput(parseTyped(next));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
      <div class="stepper-buttons">
        {button(-1, canDown, 'Decrease')}
        {button(1, canUp, 'Increase')}
      </div>
      {props.error && (
        <p id={errorId} class="field-error t-caption">
          {props.error}
        </p>
      )}
    </div>
  );
}
