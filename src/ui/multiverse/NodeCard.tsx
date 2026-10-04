import {
  headStatus,
  hotSeat,
  incomingOf,
  nodeAt,
  parityPlayer,
  type GameState,
  type NodeId,
} from '@/engine';
import { StatusGlyph } from '../components/StatusGlyph';
import { STATUS_LABELS, keepCoordsTogether, originSentence } from '../describe';
import { playerName } from '../tokens';
import { MiniBoard } from './MiniBoard';

/**
 * The facts of one node, in the right column next to the graph (never floating over it, so the
 * graph's grid stays clean): `#id · T = step · Player 2 to move · status`, how the node came to
 * be, and a mini board.
 */
export function NodeCard(props: {
  readonly state: GameState;
  readonly node: NodeId;
  /** What the card is showing: "Hovered", "Next to act", … (a 12 px label). */
  readonly label: string;
}) {
  const { state, node: id, label } = props;
  const node = nodeAt(state.preview, id);
  const status = headStatus(state, id);
  const mover = parityPlayer(node.step);
  const t = node.terminal;
  const who =
    t === null
      ? `${playerName(mover)} to move`
      : t.kind === 'win'
        ? `Won by ${playerName(t.winner)}`
        : 'Drawn';
  const incoming = t === null ? incomingOf(state, id) : null;
  return (
    <section class="node-card" aria-label={`Node #${id}`} aria-live="polite">
      <h2 class="t-label section-label">{label}</h2>
      <div class="node-card-head">
        <StatusGlyph
          status={status}
          seat={hotSeat(state)}
          mover={mover}
          winner={t?.kind === 'win' ? t.winner : null}
          incoming={incoming && mover}
        />
        <p class="t-num">
          <span class="t-bold">#{id}</span> · T = {node.step} · {who}
          {t === null && ` · ${STATUS_LABELS[status].toLowerCase()}`}
          {status === 'frozen' && ' this turn'}
        </p>
      </div>
      <p class="t-caption node-card-origin">{keepCoordsTogether(originSentence(state, id))}</p>
      <MiniBoard state={state} node={id} />
    </section>
  );
}
