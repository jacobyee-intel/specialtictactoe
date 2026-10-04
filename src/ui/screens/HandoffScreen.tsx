import { useEffect, useRef } from 'preact/hooks';
import type { GameState, Player } from '@/engine';
import { Button } from '../components/Button';
import { PlayerGlyph } from '../components/PlayerGlyph';
import { startTurn } from '../controller';
import { playerClass, playerName } from '../tokens';

/**
 * "Player 2, your turn": a white field with the player's name at 192 px, shown whenever the
 * hot seat changes (a new turn, or a forced send-back owed by the other player). It hides the
 * board while the players swap seats.
 */
export function HandoffScreen(props: { readonly state: GameState; readonly player: Player }) {
  const { state, player } = props;
  const button = useRef<HTMLDivElement>(null);
  useEffect(() => {
    button.current?.querySelector('button')?.focus();
  }, [player]);
  const sendBack = state.phase === 'awaitSendBack' && state.pendingSendBack?.player === player;
  const round = Math.min(state.round, state.config.l);
  return (
    <main class="page handoff" aria-labelledby="handoff-title">
      <div class="bar" />
      <div class="handoff-glyph">
        <PlayerGlyph player={player} size={48} />
      </div>
      <h1 id="handoff-title" class={`handoff-name ${playerClass(player)}`}>
        {playerName(player)}
      </h1>
      <p class="t-subhead handoff-caption">
        {sendBack ? 'Forced send-back' : 'Your turn'} · Round {round}
      </p>
      <p class="t-body t-grey measure handoff-note">
        {sendBack
          ? 'A timeline has ended and you owe a forced send-back: a new mark in its past.'
          : 'Take the seat, then start your turn. The board stays hidden until you do.'}
      </p>
      <div class="handoff-actions" ref={button}>
        <Button variant="primary" onClick={startTurn}>
          Start turn
        </Button>
      </div>
    </main>
  );
}
