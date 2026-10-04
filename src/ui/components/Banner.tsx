import type { ComponentChildren } from 'preact';
import type { Player } from '@/engine';

export type BannerTone = 'p1' | 'p2' | 'done' | 'black';

/** The banner tone for a player's colour. */
export function playerTone(player: Player): BannerTone {
  return player === 0 ? 'p1' : 'p2';
}

/**
 * A full-width colour field with white text, flush left (design-system §5): the forced
 * send-back prompt and the game result. It is the only place where large colour fields appear.
 * The title is 48 px; the detail line underneath is the same white at body size.
 */
export function Banner(props: {
  readonly tone: BannerTone;
  readonly title: string;
  readonly detail?: string | null;
  readonly children?: ComponentChildren;
}) {
  return (
    <section class={`banner banner--${props.tone}`} role="status" aria-live="assertive">
      <div class="page banner-inner">
        <div class="banner-text">
          <p class="t-heading banner-title">{props.title}</p>
          {props.detail && <p class="t-body banner-detail">{props.detail}</p>}
        </div>
        {props.children}
      </div>
    </section>
  );
}
