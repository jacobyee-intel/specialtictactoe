import { useState } from 'preact/hooks';
import type { GameState, Player } from '@/engine';
import { Button } from '../components/Button';
import { PlayerGlyph } from '../components/PlayerGlyph';
import { StatusGlyph } from '../components/StatusGlyph';
import { flowEvent } from '../controller';
import { keepCoordsTogether } from '../describe';
import type { Flow } from '../flow';
import { multiverseGroups, type NodeRow, type RowGroup } from '../multiverseModel';
import { navigate } from '../router';
import { playerName } from '../tokens';

/** History is collapsed by default; this remembers an explicit choice while the game runs. */
let historyOpen = false;

function Row(props: { row: NodeRow; seat: Player | null; picking: boolean }) {
  const { row, seat, picking } = props;
  const open = () => {
    if (picking) {
      if (row.target) flowEvent({ type: 'pickNode', node: row.id });
      return;
    }
    navigate({ screen: 'timeline', node: row.id, readOnly: false });
  };
  return (
    <tr
      class={`node-row${row.dimmed ? ' node-row--dim' : ''}${row.target ? ' node-row--target' : ''}`}
      data-node={row.id}
    >
      <td class="node-row-glyph">
        <StatusGlyph
          status={row.status}
          seat={seat}
          mover={row.mover}
          winner={row.winner}
          target={row.target}
          incoming={row.incoming?.player ?? null}
        />
      </td>
      <td class="t-bold">#{row.id}</td>
      <td>T = {row.step}</td>
      <td>
        <span class="inline-glyph">
          <PlayerGlyph player={row.mover} size={12} />
          {playerName(row.mover)} to move
        </span>
      </td>
      <td class="node-row-origin">
        {keepCoordsTogether(row.origin)}
        {row.incoming !== null && (
          <span class="node-row-badge t-caption">
            <PlayerGlyph player={row.incoming.player} size={12} outline /> received from #
            {row.incoming.from}
          </span>
        )}
      </td>
      <td class="node-row-action">
        {picking ? (
          row.target ? (
            <Button variant="primary" onClick={open}>
              Pick
            </Button>
          ) : null
        ) : (
          <Button onClick={open}>Open</Button>
        )}
      </td>
    </tr>
  );
}

function Group(props: {
  group: RowGroup;
  seat: Player | null;
  picking: boolean;
  onToggle?: () => void;
}) {
  const { group, seat, picking } = props;
  const collapsible = group.id === 'history';
  return (
    <section class="node-group" aria-labelledby={`group-${group.id}`}>
      <div class="bar" />
      <div class="node-group-head">
        <h2 id={`group-${group.id}`} class="t-subhead node-group-title">
          {group.title} <span class="t-grey t-num">{group.rows.length}</span>
        </h2>
        {collapsible && group.rows.length > 0 && (
          <button type="button" class="btn btn--text t-caption" onClick={props.onToggle}>
            {group.collapsed ? 'Show' : 'Hide'}
          </button>
        )}
      </div>
      {!group.collapsed && group.rows.length > 0 && (
        <table class="node-table t-num">
          <tbody>
            {group.rows.map((row) => (
              <Row key={row.id} row={row} seat={seat} picking={picking} />
            ))}
          </tbody>
        </table>
      )}
      {!group.collapsed && group.rows.length === 0 && (
        <p class="t-caption t-grey node-group-empty">None.</p>
      )}
    </section>
  );
}

/**
 * The Stage 4 list multiverse, now the secondary view: every node of the preview in a Swiss
 * table, grouped by what it means for the player in the hot seat. In picking mode the targets of
 * the current flow are lifted into a first group and are the only rows that can be picked.
 */
export function MultiverseList(props: {
  readonly state: GameState;
  readonly flow: Flow;
  readonly seat: Player | null;
}) {
  const { state, flow: f, seat } = props;
  const [showHistory, setShowHistory] = useState(historyOpen);
  const picking = f.kind !== 'idle' && f.target === null;
  const groups = multiverseGroups(state, f, showHistory);
  return (
    <>
      {groups.map((g) => (
        <Group
          key={g.id}
          group={g}
          seat={seat}
          picking={picking}
          onToggle={() => {
            historyOpen = !showHistory;
            setShowHistory(historyOpen);
          }}
        />
      ))}
    </>
  );
}
