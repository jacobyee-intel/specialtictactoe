import { headStatus, parityPlayer, type Origin } from '@/engine';
import { Button } from '../components/Button';
import { Hud } from '../components/Hud';
import { PlayerGlyph } from '../components/PlayerGlyph';
import { Toast } from '../components/Toast';
import { navigate } from '../router';
import { game } from '../store';
import { playerName } from '../tokens';

/** A one-line origin summary; Stage 4's `describe.ts` replaces this with real sentences. */
function originText(origin: Origin): string {
  switch (origin.kind) {
    case 'root':
      return 'The first board.';
    case 'place':
      return `A mark was placed on cell ${origin.cell}.`;
    case 'split':
      return 'Split from its parent.';
    case 'ttSource':
      return `Mark on cell ${origin.cell} travelled back to #${origin.arrival}.`;
    case 'ttArrival':
      return `A mark arrived from #${origin.source} on cell ${origin.cell}.`;
    case 'transferSource':
      return `Mark on cell ${origin.cell} moved to cell ${origin.toCell} of #${origin.to}.`;
    case 'transferWin':
      return `Ended by a mark received from #${origin.from}.`;
    case 'sendBack':
      return `Forced send-back on cell ${origin.cell}, owed for #${origin.terminal}.`;
  }
}

/**
 * TEMPORARY (Stage 3): the facts of one node of the preview. Stage 4 replaces it with the 2D
 * board and the action bar.
 */
export function TimelineScreen({ node, readOnly }: { node: number; readOnly: boolean }) {
  const state = game.value;
  const tnode = state?.preview.nodes[node];
  if (state === null || tnode === undefined) return null;
  const mover = parityPlayer(tnode.step);
  return (
    <>
      <Hud />
      <Toast />
      <div class="page">
        <div class="grid">
          <main class="col-1-6 temp-screen" aria-labelledby="timeline-title">
            <p class="t-label temp-flag">Temporary · replaced in Stage 4</p>
            <div class="bar" />
            <h1 id="timeline-title" class="t-heading t-bold temp-title">
              Timeline #{tnode.id}
            </h1>
            <dl class="facts t-num">
              <div>
                <dt class="t-label">Step</dt>
                <dd>T = {tnode.step}</dd>
              </div>
              <div>
                <dt class="t-label">To move</dt>
                <dd class="inline-glyph">
                  <PlayerGlyph player={mover} size={12} />
                  {playerName(mover)}
                </dd>
              </div>
              <div>
                <dt class="t-label">Status</dt>
                <dd>
                  {headStatus(state, tnode.id)}
                  {readOnly ? ' · read-only' : ''}
                </dd>
              </div>
              <div>
                <dt class="t-label">Origin</dt>
                <dd>{originText(tnode.origin)}</dd>
              </div>
            </dl>
            <div class="button-row">
              <Button onClick={() => navigate({ screen: 'multiverse' })}>Back to multiverse</Button>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
