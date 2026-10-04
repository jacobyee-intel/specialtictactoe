import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CubicQuotient } from '@/geometry';
import { hotSeat, nodeAt, type CellId, type GameState, type NodeId, type Player } from '@/engine';
import { ActionBar } from '../components/ActionBar';
import { Button } from '../components/Button';
import { GameBanner } from '../components/GameBanner';
import { Hud } from '../components/Hud';
import { NodeFacts } from '../components/NodeFacts';
import { Segmented } from '../components/Segmented';
import { Toast } from '../components/Toast';
import { Toggle } from '../components/Toggle';
import { Board2D, type BoardInteraction } from '../board2d/Board2D';
import { boardView } from '../board2d/boardView';
import {
  defaultGroup,
  filterGroup,
  fitPanels,
  layoutPanels,
  panelGroups,
  type Panel,
  type Zone,
} from '../board2d/layout';
import { cubeFilter, openLinesFor, showHalos, showOpenLines, showThreats } from '../board2d/prefs';
import { act, clearDraft, flow, flowEvent, lastViewed, undoAction } from '../controller';
import { coordLabel } from '../describe';
import type { Flow } from '../flow';
import { boardOf } from '../overlays';
import { navigate } from '../router';
import { game, hover } from '../store';
import {
  NO_SELECTION,
  actButtons,
  clickCell,
  confirmSentence,
  hoverCaption,
  moveCursor,
  splitPreviewText,
  timelineMode,
  validSelection,
  type ActId,
  type CursorKey,
  type Selection,
  type TimelineMode,
} from '../timelineModel';
import { playerName } from '../tokens';
import { useSize } from '../useSize';

/** Until the zone is measured, assume the right half of a 1440 × 900 window. */
const FALLBACK_ZONE: Zone = { width: 660, height: 520 };

const CURSOR_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
]);

function BoardHeader(props: {
  wrapped: boolean;
  groups: { index: number; title: string }[];
  group: number | null;
  onGroup: (group: number | null) => void;
  seat: Player | null;
}) {
  const openPlayer = openLinesFor.value ?? props.seat ?? 0;
  return (
    <div class="board-header">
      <div class="board-toggles">
        {props.wrapped && (
          <Toggle checked={showHalos.value} onChange={(v) => (showHalos.value = v)}>
            Show glued neighbours
          </Toggle>
        )}
        <Toggle checked={showThreats.value} onChange={(v) => (showThreats.value = v)}>
          Threats
        </Toggle>
        <Toggle checked={showOpenLines.value} onChange={(v) => (showOpenLines.value = v)}>
          Open lines
        </Toggle>
        {showOpenLines.value && (
          <Segmented
            label="Open lines for"
            options={[
              { value: '0', label: 'P1' },
              { value: '1', label: 'P2' },
            ]}
            value={String(openPlayer)}
            onChange={(v) => (openLinesFor.value = Number(v) as Player)}
          />
        )}
      </div>
      {props.groups.length > 1 && (
        <div class="board-filter">
          <Segmented
            label="Cubes shown"
            options={[
              { value: 'all', label: 'All' },
              ...props.groups.map((g) => ({
                value: String(g.index),
                label: g.title.replace('Cube ', ''),
              })),
            ]}
            value={props.group === null ? 'all' : String(props.group)}
            onChange={(v) => props.onGroup(v === 'all' ? null : Number(v))}
          />
        </div>
      )}
      {showOpenLines.value && (
        <p class="t-caption measure board-note">
          <span class="t-bold">Open lines.</span> Each empty cell counts the lines{' '}
          {playerName(openPlayer)} can still complete through it. On the 3-torus every cell of an
          empty board scores the same; on the flat cube the centre dominates.
        </p>
      )}
    </div>
  );
}

/** The buttons and caption of the action bar for the current mode. */
function Actions(props: {
  state: GameState;
  node: NodeId;
  mode: TimelineMode;
  flow: Flow;
  selection: Selection;
  run: (id: ActId) => void;
  onSplitPreview: (on: boolean) => void;
}) {
  const { state, node, mode, flow: f, selection } = props;
  const back = <Button onClick={() => navigate({ screen: 'multiverse' })}>Back</Button>;

  if (mode.kind === 'pickCell' && f.kind !== 'idle') {
    return (
      <ActionBar caption={confirmSentence(state, f)} emphasis>
        <Button
          variant="primary"
          disabledReason={f.cell === null ? 'Pick a highlighted cell first' : null}
          onClick={() => flowEvent({ type: 'confirm' })}
        >
          Confirm
        </Button>
        <Button onClick={() => flowEvent({ type: 'back' })}>Back</Button>
        {f.kind !== 'sendBack' && (
          <Button onClick={() => flowEvent({ type: 'cancel' })}>Cancel</Button>
        )}
      </ActionBar>
    );
  }

  if (mode.kind === 'read') {
    const canUndo = state.phase === 'draft' && state.draft.length > 0;
    return (
      <ActionBar caption={mode.reason}>
        {back}
        {canUndo && <Button onClick={undoAction}>Undo</Button>}
        {canUndo && <Button onClick={clearDraft}>Clear</Button>}
      </ActionBar>
    );
  }

  const buttons = actButtons(state, node, selection);
  const hint =
    selection.kind === 'send'
      ? `${coordLabel(state.topology, selection.cell)} selected: time travel or transfer it.`
      : selection.kind === 'place'
        ? `Place at ${coordLabel(state.topology, selection.cell)}?`
        : 'Select an empty cell to place, or one of your marks to send it.';
  return (
    <ActionBar caption={hint}>
      {buttons.map((b) => {
        const preview =
          b.id === 'split'
            ? {
                onMouseEnter: () => props.onSplitPreview(true),
                onMouseLeave: () => props.onSplitPreview(false),
                onFocusIn: () => props.onSplitPreview(true),
                onFocusOut: () => props.onSplitPreview(false),
              }
            : {};
        return (
          <span key={b.id} class="action-slot" {...preview}>
            <Button
              variant={b.primary ? 'primary' : 'secondary'}
              disabledReason={b.disabledReason}
              onClick={() => props.run(b.id)}
            >
              {b.label}
            </Button>
          </span>
        );
      })}
      {back}
    </ActionBar>
  );
}

/**
 * One node of the multiverse: the facts on the left (the 3D board from Stage 7), the 2D slice
 * board on the right and the action bar below. What the player may do here is decided by
 * `timelineModel.ts` from the engine; this component only renders and routes events.
 */
export function TimelineScreen({ node, readOnly }: { node: number; readOnly: boolean }) {
  const state = game.value;
  const f = flow.value;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [cursor, setCursor] = useState<CellId | null>(null);
  const [splitPreview, setSplitPreview] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const measured = useSize(zoneRef);
  const zone = measured ?? FALLBACK_ZONE;
  const exists = state !== null && state.preview.nodes[node] !== undefined;

  useEffect(() => {
    setSelection(NO_SELECTION);
    setCursor(null);
    setSplitPreview(false);
    lastViewed.value = node;
  }, [node]);

  // The node can vanish (undo removed a draft node): go back to the multiverse.
  useEffect(() => {
    if (state !== null && !exists) navigate({ screen: 'multiverse' }, { replace: true });
  }, [state, exists]);

  const topology = state?.topology ?? null;
  const halos = showHalos.value;
  const panels = useMemo(
    () => (topology === null ? [] : layoutPanels(topology, { halos })),
    [topology, halos],
  );
  const groups = useMemo(() => panelGroups(panels), [panels]);
  const filterKey = topology === null ? '' : `${topology.id}/${topology.n}`;
  // Choose the cube filter once per board size, when the zone has been measured.
  useEffect(() => {
    if (measured === null || groups.length <= 1) return;
    if (cubeFilter.value?.key === filterKey) return;
    cubeFilter.value = { key: filterKey, group: defaultGroup(panels, measured) };
  }, [measured, groups, panels, filterKey]);
  const chosen = cubeFilter.value?.key === filterKey ? cubeFilter.value.group : undefined;
  const group =
    groups.length > 1 ? (chosen === undefined ? (groups[0]?.index ?? null) : chosen) : null;
  const visible: Panel[] = useMemo(() => filterGroup(panels, group), [panels, group]);
  const packing = useMemo(() => fitPanels(visible, zone), [visible, zone]);

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (state === null || !exists) return null;

  const mode = timelineMode(state, node, f, readOnly);
  const sel = mode.kind === 'act' ? validSelection(state, node, selection) : NO_SELECTION;
  const seat = hotSeat(state);
  const view = boardView(state, node, {
    threats: showThreats.value,
    openFor: showOpenLines.value ? (openLinesFor.value ?? seat ?? 0) : null,
  });
  const hovered = hover.value?.node === node ? hover.value.cell : null;
  const board = boardOf(state, node);
  const pickedCell = mode.kind === 'pickCell' && f.kind !== 'idle' ? f.cell : null;

  const run = (id: ActId) => {
    const button = actButtons(state, node, sel).find((b) => b.id === id);
    if (mode.kind !== 'act' || button === undefined || button.disabledReason !== null) return;
    switch (id) {
      case 'place':
        if (sel.kind === 'place') act({ kind: 'place', head: node, cell: sel.cell });
        break;
      case 'split':
        act({ kind: 'split', head: node });
        break;
      case 'timeTravel':
      case 'transfer':
        if (sel.kind === 'send') {
          flowEvent({ type: 'begin', kind: id, head: node, fromCell: sel.cell });
        }
        break;
      case 'undo':
        undoAction();
        break;
      case 'clear':
        clearDraft();
        break;
    }
  };

  const onCellClick = (cell: CellId) => {
    setCursor(cell);
    if (mode.kind === 'act') setSelection(clickCell(state, node, sel, cell));
    else if (mode.kind === 'pickCell') flowEvent({ type: 'pickCell', cell });
  };

  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    // Text fields and radio groups use these keys themselves; a checkbox only uses Space.
    const typing =
      'input:not([type="checkbox"]), textarea, select, [role="radio"], [role="dialog"]';
    if (target?.closest(typing)) return;
    if (event.altKey || event.metaKey) return;
    const onButton = target?.closest('button, a') != null;
    const onCheckbox = target?.closest('input') != null;
    const key = event.key;
    if (CURSOR_KEYS.has(key)) {
      event.preventDefault();
      const next = moveCursor(visible, cursor, key as CursorKey);
      setCursor(next);
      hover.value = next === null ? null : { node, cell: next };
      return;
    }
    if (event.ctrlKey) {
      if (key.toLowerCase() === 'z' && state.phase === 'draft') {
        event.preventDefault();
        undoAction();
      }
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      if (sel.kind !== 'none') setSelection(NO_SELECTION);
      else if (f.kind === 'sendBack') flowEvent({ type: 'back' });
      else if (f.kind !== 'idle') flowEvent({ type: 'cancel' });
      else navigate({ screen: 'multiverse' });
      return;
    }
    if ((onButton && key === 'Enter') || ((onButton || onCheckbox) && key === ' ')) return;
    if (key === 'Enter') {
      event.preventDefault();
      if (mode.kind === 'act') {
        if (sel.kind === 'place') run('place');
        else if (cursor !== null && board[cursor] === 0) {
          act({ kind: 'place', head: node, cell: cursor });
        }
      } else if (mode.kind === 'pickCell') {
        if (pickedCell !== null && (cursor === null || pickedCell === cursor)) {
          flowEvent({ type: 'confirm' });
        } else if (cursor !== null) flowEvent({ type: 'pickCell', cell: cursor });
      }
      return;
    }
    if (key === ' ' && cursor !== null) {
      event.preventDefault();
      onCellClick(cursor);
      return;
    }
    const shortcut: Record<string, ActId | undefined> = {
      s: 'split',
      t: 'timeTravel',
      r: 'transfer',
    };
    const id = shortcut[key.toLowerCase()];
    if (id !== undefined && mode.kind === 'act') {
      event.preventDefault();
      run(id);
    }
  };

  const interaction: BoardInteraction = {
    hovered,
    selected: sel.kind !== 'none' ? sel.cell : pickedCell,
    cursor,
    pickable: mode.kind === 'pickCell' ? new Set(mode.cells) : null,
    interactive: mode.kind === 'act',
    onCellClick,
    onHover: (cell) => {
      hover.value = cell === null ? null : { node, cell };
    },
    label: (cell) => {
      const v = board[cell];
      const content = v === 0 ? 'empty' : playerName((v === 1 ? 0 : 1) as Player);
      return `${coordLabel(state.topology, cell)}, ${content}`;
    },
  };
  const seam = visible.find((p) => p.caption !== undefined);
  const wrapped = state.topology instanceof CubicQuotient && state.topology.wrapped;
  const splitText = splitPreview && mode.kind === 'act' ? splitPreviewText(state, node) : null;
  const pickDetail =
    mode.kind === 'pickCell' && f.kind === 'sendBack'
      ? `Pick an empty cell on #${node}, then Confirm.`
      : null;
  const tnode = nodeAt(state.preview, node);

  return (
    <div class="screen screen--fixed">
      <Hud />
      <GameBanner detail={pickDetail} />
      <Toast />
      <main class="timeline-main" aria-label={`Timeline #${tnode.id}`}>
        <div class="page timeline-page">
          <div class="grid timeline-grid">
            <div class="col-1-6 timeline-left">
              <NodeFacts state={state} node={node} splitPreview={splitText} />
            </div>
            <section class="col-7-12 board-zone" aria-label="Board">
              <BoardHeader
                wrapped={wrapped}
                groups={groups}
                group={group}
                onGroup={(g) => (cubeFilter.value = { key: filterKey, group: g })}
                seat={seat}
              />
              <div class="board-scroll" ref={zoneRef}>
                <Board2D packing={packing} view={view} interaction={interaction} />
              </div>
              <div class="board-captions">
                <p class={`t-caption t-num board-hover ${hovered === null ? 't-grey' : ''}`}>
                  {hovered === null
                    ? 'Hover a cell to see its coordinates and lines.'
                    : hoverCaption(state, node, hovered)}
                </p>
                {seam?.caption !== undefined && (
                  <p class="t-caption measure">
                    <span class="t-bold">Holonomy.</span> {seam.caption}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
      <Actions
        state={state}
        node={node}
        mode={mode}
        flow={f}
        selection={sel}
        run={run}
        onSplitPreview={setSplitPreview}
      />
    </div>
  );
}
