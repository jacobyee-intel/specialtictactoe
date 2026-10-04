import { useEffect, useRef, useState } from 'preact/hooks';
import { hudModel } from '../hud';
import { game, quit } from '../store';
import { playerClass } from '../tokens';
import { Button } from './Button';
import { PlayerGlyph } from './PlayerGlyph';

/**
 * The Menu button and its panel.
 */
function Menu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        root.current?.querySelector<HTMLButtonElement>('.hud-menu-toggle')?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div class="hud-menu" ref={root}>
      <Button
        class="hud-menu-toggle"
        ariaExpanded={open}
        ariaHasPopup
        onClick={() => (open ? close() : setOpen(true))}
      >
        Menu
      </Button>
      {open && (
        <div class="hud-menu-panel" role="dialog" aria-label="Menu">
          <Button
            onClick={() => {
              close();
              quit();
            }}
          >
            Quit to start
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The top bar of every game screen (design-system §5): whose turn it is in 48 px, in the
 * player's colour and with their glyph, then round, score, timelines and space.
 */
export function Hud() {
  const state = game.value;
  if (state === null) return null;
  const hud = hudModel(state);
  const [s1, s2] = hud.score;

  return (
    <header class="hud">
      <div class="page hud-bar">
        <div class="hud-player" aria-live="polite">
          {hud.player !== null && <PlayerGlyph player={hud.player} />}
          <div>
            <p
              class={`t-heading t-bold hud-label ${hud.player === null ? '' : playerClass(hud.player)}`}
            >
              {hud.label}
            </p>
            {hud.caption !== null && <p class="t-caption hud-caption">{hud.caption}</p>}
          </div>
        </div>
        <ul class="hud-facts t-num" aria-label="Game status">
          <li>
            Round {hud.round} / {hud.roundLimit}
          </li>
          <li aria-label={`Score: Player 1 ${s1}, Player 2 ${s2}`}>
            Score <span class="c-p1">{s1}</span>–<span class="c-p2">{s2}</span>
          </li>
          <li>
            Timelines {hud.live} / {hud.maxTimelines}
          </li>
          <li>{hud.space}</li>
        </ul>
        <Menu />
      </div>
      {hud.alertBar !== null && (
        <div class={`hud-alert hud-alert--p${hud.alertBar + 1}`} aria-hidden="true" />
      )}
      <hr class="rule" />
    </header>
  );
}
