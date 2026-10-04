import { useEffect, useRef, useState } from 'preact/hooks';
import { hotSeat, type GameState, type HeadStatus, type Player } from '@/engine';
import { Button } from '../components/Button';
import { GameBanner } from '../components/GameBanner';
import { Hud } from '../components/Hud';
import { PlayerGlyph } from '../components/PlayerGlyph';
import { STATUS_LABELS, StatusGlyph } from '../components/StatusGlyph';
import { Toast } from '../components/Toast';
import {
  concedeNow,
  endTurnBlocker,
  endTurnNow,
  flow,
  flowEvent,
  nextNeedingAction,
  rematch,
} from '../controller';
import { keepCoordsTogether } from '../describe';
import type { Flow } from '../flow';
import { multiverseGroups, type NodeRow, type RowGroup } from '../multiverseModel';
import { navigate } from '../router';
import { game } from '../store';
import { pickPrompt } from '../timelineModel';
import { playerName } from '../tokens';
import { prefillStartForm } from './StartScreen';

const LEGEND: readonly HeadStatus[] = [
  'needsAction',
  'acted',
  'draftCreated',
  'waiting',
  'frozen',
  'won',
  'drawn',
  'history',
];

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

function Legend({ seat }: { seat: Player | null }) {
  return (
    <section class="legend" aria-labelledby="legend-title">
      <h2 id="legend-title" class="t-label section-label">
        Legend
      </h2>
      <ul class="legend-list t-caption">
        {LEGEND.map((s) => (
          <li key={s}>
            <StatusGlyph status={s} seat={seat} mover={seat ?? 0} winner={0} />
            {STATUS_LABELS[s]}
          </li>
        ))}
        <li>
          <StatusGlyph status="needsAction" seat={seat} mover={seat ?? 0} target />
          Valid target
        </li>
      </ul>
    </section>
  );
}

function Side(props: { state: GameState; flow: Flow }) {
  const { state, flow: f } = props;
  const [confirming, setConfirming] = useState(false);
  const seat = hotSeat(state);

  if (state.phase === 'over') {
    return (
      <div class="side-actions">
        <Button variant="primary" onClick={rematch}>
          Rematch
        </Button>
        <Button
          onClick={() => {
            prefillStartForm(state.config);
            navigate({ screen: 'start' });
          }}
        >
          New game
        </Button>
      </div>
    );
  }

  const next = nextNeedingAction(state);
  return (
    <div class="side-actions">
      {f.kind === 'timeTravel' || f.kind === 'transfer' ? (
        <Button onClick={() => flowEvent({ type: 'cancel' })}>Cancel</Button>
      ) : (
        <>
          <Button
            disabledReason={next === null ? 'No timeline needs an action' : null}
            onClick={() =>
              next !== null && navigate({ screen: 'timeline', node: next, readOnly: false })
            }
          >
            Next
          </Button>
          <Button variant="primary" disabledReason={endTurnBlocker(state)} onClick={endTurnNow}>
            End turn
          </Button>
        </>
      )}
      {confirming && seat !== null ? (
        <div class="concede-confirm" role="dialog" aria-label="Concede">
          <p class="t-body">Concede the game to {playerName(seat === 0 ? 1 : 0)}?</p>
          <div class="button-row">
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false);
                concedeNow();
              }}
            >
              Concede
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>Concede</Button>
      )}
    </div>
  );
}

/**
 * The basic multiverse (Stage 4): every node of the preview in a Swiss table, grouped by what it
 * means for the player in the hot seat, with End turn and Concede on the right. In picking mode
 * only the targets of the current flow are enabled. Stage 5 replaces the table with a graph and
 * keeps `multiverseModel.ts` and `controller.ts`.
 */
export function MultiverseScreen() {
  const state = game.value;
  const f = flow.value;
  const [showHistory, setShowHistory] = useState(historyOpen);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  if (state === null) return null;

  const seat = hotSeat(state);
  const picking = f.kind !== 'idle' && f.target === null;
  const groups = multiverseGroups(state, f, showHistory);
  const prompt = picking && f.kind !== 'sendBack' ? pickPrompt(state, f) : null;

  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [role="dialog"]')) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Escape' && (f.kind === 'timeTravel' || f.kind === 'transfer')) {
      event.preventDefault();
      flowEvent({ type: 'cancel' });
    } else if (event.key.toLowerCase() === 'n' && !picking && state.phase === 'draft') {
      const next = nextNeedingAction(state);
      if (next !== null) navigate({ screen: 'timeline', node: next, readOnly: false });
    }
  };

  return (
    <div class="screen">
      <Hud />
      <GameBanner />
      <Toast />
      <div class="page multiverse">
        <div class="grid">
          <main class="col-1-9 multiverse-main" aria-label="Multiverse">
            {prompt !== null && (
              <div class="pick-prompt">
                <div class="bar" />
                <p class="t-subhead">{prompt}</p>
                <p class="t-caption t-grey">Only the marked rows can be picked. Esc cancels.</p>
              </div>
            )}
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
          </main>
          <aside class="col-10-12 multiverse-side">
            <Side state={state} flow={f} />
            <Legend seat={seat} />
          </aside>
        </div>
      </div>
    </div>
  );
}
