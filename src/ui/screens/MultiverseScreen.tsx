import { headStatus, parityPlayer, type GameState, type NodeId } from '@/engine';
import { Button } from '../components/Button';
import { Hud } from '../components/Hud';
import { PlayerGlyph } from '../components/PlayerGlyph';
import { Toast } from '../components/Toast';
import { navigate } from '../router';
import { game } from '../store';
import { playerName } from '../tokens';

/** Statuses where the hot-seat player can still act on the node; anything else opens read-only. */
const ACTIONABLE = new Set(['needsAction', 'acted', 'draftCreated']);

function rows(state: GameState) {
  return state.preview.nodes.map((node) => ({
    id: node.id as NodeId,
    step: node.step,
    mover: parityPlayer(node.step),
    status: headStatus(state, node.id),
  }));
}

/**
 * TEMPORARY (Stage 3): a plain list of the preview's nodes, so a started game can be inspected
 * end to end. Stage 4 replaces it with the real list multiverse, and Stage 5 with the graph.
 */
export function MultiverseScreen() {
  const state = game.value;
  if (state === null) return null;
  return (
    <>
      <Hud />
      <Toast />
      <div class="page">
        <div class="grid">
          <main class="col-1-9 temp-screen" aria-labelledby="multiverse-title">
            <p class="t-label temp-flag">Temporary · replaced in Stage 4</p>
            <div class="bar" />
            <h1 id="multiverse-title" class="t-heading t-bold temp-title">
              Multiverse
            </h1>
            <table class="node-table t-num">
              <thead>
                <tr class="t-label">
                  <th scope="col">Node</th>
                  <th scope="col">Step</th>
                  <th scope="col">To move</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span class="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows(state).map((row) => (
                  <tr key={row.id}>
                    <td class="t-bold">#{row.id}</td>
                    <td>T = {row.step}</td>
                    <td>
                      <span class="inline-glyph">
                        <PlayerGlyph player={row.mover} size={12} />
                        {playerName(row.mover)}
                      </span>
                    </td>
                    <td>{row.status}</td>
                    <td>
                      <Button
                        onClick={() =>
                          navigate({
                            screen: 'timeline',
                            node: row.id,
                            readOnly: !ACTIONABLE.has(row.status),
                          })
                        }
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </main>
          <aside class="col-10-12 temp-side t-caption">
            <p>
              <span class="t-bold">Draft.</span> {state.draft.length}{' '}
              {state.draft.length === 1 ? 'action' : 'actions'} this turn.
            </p>
            <p>
              <span class="t-bold">Phase.</span> {state.phase}.
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
