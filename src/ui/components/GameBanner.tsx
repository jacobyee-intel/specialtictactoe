import { hotSeat } from '@/engine';
import { resultSentence } from '../describe';
import { game } from '../store';
import { sendBackBanner } from '../timelineModel';
import { Banner, playerTone } from './Banner';

/**
 * The banner every game screen shows under the HUD when the engine needs attention: the forced
 * send-back prompt in the sender's colour, or the result once the game is over.
 */
export function GameBanner(props: { readonly detail?: string | null }) {
  const state = game.value;
  if (state === null) return null;
  if (state.phase === 'over' && state.result !== null) {
    const r = state.result;
    return (
      <Banner
        tone={r.kind === 'win' ? 'done' : 'black'}
        title={resultSentence(r, state.score)}
        detail={props.detail ?? 'The final multiverse stays open to browse, read-only.'}
      />
    );
  }
  const pending = state.pendingSendBack;
  if (state.phase === 'awaitSendBack' && pending !== null) {
    const seat = hotSeat(state) ?? pending.player;
    const text = sendBackBanner(state, pending.player, pending.terminal);
    return (
      <Banner tone={playerTone(seat)} title={text.title} detail={props.detail ?? text.detail} />
    );
  }
  return null;
}
