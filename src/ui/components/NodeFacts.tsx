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

/** The split preview: a small fork diagram, one node at T and two at T + 1. */
function ForkDiagram({ step, text }: { step: number; text: string }) {
  return (
    <figure class="fork">
      <svg width="240" height="96" viewBox="0 0 240 96" aria-hidden="true">
        <path d="M32 48L176 16M32 48L176 80" fill="none" stroke="black" stroke-width="1" />
        <circle cx="32" cy="48" r="12" fill="black" />
        <circle cx="176" cy="16" r="11.5" fill="white" stroke="black" stroke-dasharray="3 2" />
        <circle cx="176" cy="80" r="11.5" fill="white" stroke="black" stroke-dasharray="3 2" />
        <text x="200" y="20" class="fork-label">
          T = {step + 1}
        </text>
        <text x="200" y="84" class="fork-label">
          T = {step + 1}
        </text>
      </svg>
      <figcaption class="t-body measure">
        <span class="t-bold">Split.</span> {text}
      </figcaption>
    </figure>
  );
}

/**
 * The left zone of the timeline screen until the 3D board arrives (Stage 7): the node's step as
 * a large numeral, who moves, its status and origin, and links along its ancestry. It fills the
 * box the 3D view will use, so the layout does not move when that lands.
 */
export function NodeFacts(props: {
  readonly state: GameState;
  readonly node: NodeId;
  /** Shown while Split is hovered or focused: the fork preview replaces the origin text. */
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

  return (
    <section class="node-facts view3d-slot" aria-label={`Timeline node #${id}`}>
      <div class="bar" />
      <p class="t-label node-facts-id">Node #{id}</p>
      <p class="node-numeral t-num" aria-label={`Step ${node.step}`}>
        T = {node.step}
      </p>
      {t === null ? (
        <p class={`t-subhead node-mover ${playerClass(mover)}`}>
          <PlayerGlyph player={mover} size={16} />
          {playerName(mover)} to move
        </p>
      ) : (
        <p class="t-subhead node-mover c-done">
          {t.kind === 'win' ? `Won by ${playerName(t.winner)}` : 'Drawn'}
        </p>
      )}
      <p class="node-status">
        <StatusGlyph
          status={status}
          seat={hotSeat(state)}
          mover={mover}
          winner={t?.kind === 'win' ? t.winner : null}
          incoming={incoming && mover}
          current
        />
        <span>{statusCaption(state, id)}</span>
      </p>
      {props.splitPreview !== null ? (
        <ForkDiagram step={node.step} text={props.splitPreview} />
      ) : (
        <p class="t-body measure node-origin">{keepCoordsTogether(originSentence(state, id))}</p>
      )}
      <nav class="t-caption node-links" aria-label="Ancestry">
        <p>
          <span class="t-label node-links-label">Ancestry</span>
          {[...ancestry, id].map((a, i) => (
            <span key={a}>
              {i > 0 && ' → '}
              <NodeLink id={a} current={a === id} />
            </span>
          ))}
        </p>
        <p>
          <span class="t-label node-links-label">Children</span>
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
    </section>
  );
}
