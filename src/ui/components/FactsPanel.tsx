import {
  childrenOf,
  headStatus,
  hotSeat,
  incomingOf,
  nodeAt,
  parityPlayer,
  strictAncestors,
  type GameState,
  type NodeId,
} from '@/engine';
import { keepCoordsTogether, originSentence, statusCaption } from '../describe';
import { routeToHash } from '../router';
import { playerClass, playerName } from '../tokens';
import { PlayerGlyph } from './PlayerGlyph';
import { StatusGlyph } from './StatusGlyph';

function NodeLink({ id, current }: { id: NodeId; current?: boolean }) {
  if (current) return <span class="t-bold">#{id}</span>;
  return <a href={routeToHash({ screen: 'timeline', node: id, readOnly: false })}>#{id}</a>;
}

/** The split preview, compact: one node at T forking into two at T + 1, and the sentence. */
function ForkPreview({ step, text }: { step: number; text: string }) {
  return (
    <figure class="facts-fork">
      <svg width="112" height="40" viewBox="0 0 112 40" aria-hidden="true">
        <path d="M8 20L64 6M8 20L64 34" fill="none" stroke="black" stroke-width="1" />
        <circle cx="8" cy="20" r="6" fill="black" />
        <circle cx="64" cy="6" r="5.5" fill="white" stroke="black" stroke-dasharray="3 2" />
        <circle cx="64" cy="34" r="5.5" fill="white" stroke="black" stroke-dasharray="3 2" />
        <text x="76" y="7" class="fork-label">
          T = {step + 1}
        </text>
        <text x="76" y="35" class="fork-label">
          T = {step + 1}
        </text>
      </svg>
      <figcaption class="t-caption">
        <span class="t-bold">Split.</span> {text}
      </figcaption>
    </figure>
  );
}

/**
 * The node facts of the timeline screen, compact enough (96 px) to sit above the 2D board now
 * that the 3D view has the left zone: the step as a 48 px numeral, who moves, the status, the
 * origin on one line (the full sentence in a tooltip), and a Details disclosure for ancestry and
 * children. While Split is hovered the fork preview takes the place of the status and origin.
 */
export function FactsPanel(props: {
  readonly state: GameState;
  readonly node: NodeId;
  /** Shown while Split is hovered or focused. */
  readonly splitPreview: string | null;
}) {
  const { state, node: id } = props;
  const node = nodeAt(state.preview, id);
  const mover = parityPlayer(node.step);
  const status = headStatus(state, id);
  const t = node.terminal;
  const incoming = node.terminal === null ? incomingOf(state, id) : null;
  const ancestry = strictAncestors(state.preview, id).reverse();
  const kids = childrenOf(state.preview, id);
  const origin = keepCoordsTogether(originSentence(state, id));

  return (
    <section class="facts" aria-label={`Timeline node #${id}`}>
      <div class="facts-step">
        <p class="facts-numeral t-num" aria-label={`Step ${node.step}`}>
          T = {node.step}
        </p>
        <p class="t-label t-grey">Node #{id}</p>
      </div>
      <div class="facts-body">
        {t === null ? (
          <p class={`t-body facts-mover ${playerClass(mover)}`}>
            <PlayerGlyph player={mover} size={16} />
            {playerName(mover)} to move
          </p>
        ) : (
          <p class="t-body facts-mover c-done">
            {t.kind === 'win' ? `Won by ${playerName(t.winner)}` : 'Drawn'}
          </p>
        )}
        {props.splitPreview !== null ? (
          <ForkPreview step={node.step} text={props.splitPreview} />
        ) : (
          <>
            <p class="t-caption facts-status">
              <StatusGlyph
                status={status}
                seat={hotSeat(state)}
                mover={mover}
                winner={t?.kind === 'win' ? t.winner : null}
                incoming={incoming && mover}
                compact
              />
              <span>{statusCaption(state, id)}</span>
            </p>
            <div class="facts-origin-row">
              <p class="t-caption facts-origin" title={origin}>
                {origin}
              </p>
              <details class="facts-details">
                <summary class="t-caption t-bold">Details</summary>
                <nav class="t-caption facts-links" aria-label="Ancestry">
                  <p>
                    <span class="t-label facts-links-label">Ancestry</span>
                    {[...ancestry, id].map((a, i) => (
                      <span key={a}>
                        {i > 0 && ' → '}
                        <NodeLink id={a} current={a === id} />
                      </span>
                    ))}
                  </p>
                  <p>
                    <span class="t-label facts-links-label">Children</span>
                    {kids.length === 0
                      ? t === null
                        ? 'None yet'
                        : 'None (the timeline ended here)'
                      : kids.map((k, i) => (
                          <span key={k}>
                            {i > 0 && ', '}
                            <NodeLink id={k} />
                          </span>
                        ))}
                  </p>
                </nav>
              </details>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
