import type { ComponentChildren } from 'preact';
import { keepCoordsTogether } from '../describe';

/**
 * The full-width bottom bar of the timeline screen (design-system §4): 96 px tall, ruled off
 * above, holding the buttons for the current mode flush left and a caption after them.
 */
export function ActionBar(props: {
  readonly children: ComponentChildren;
  /** A sentence about the mode ("History", "Send (1, 2, 0) to #4 at (0, 0, 2)"). */
  readonly caption?: ComponentChildren;
  /** Set the caption at body size and bold (the confirm step), instead of a 12 px caption. */
  readonly emphasis?: boolean;
}) {
  return (
    <footer class="action-bar" aria-label="Actions">
      <div class="page action-bar-inner">
        {props.caption !== undefined && props.caption !== null && (
          <p
            class={
              props.emphasis ? 't-body t-bold action-bar-caption' : 't-caption action-bar-caption'
            }
            aria-live="polite"
          >
            {typeof props.caption === 'string' ? keepCoordsTogether(props.caption) : props.caption}
          </p>
        )}
        <div class="button-row action-bar-buttons">{props.children}</div>
      </div>
    </footer>
  );
}
