import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { hotSeat, type GameState, type HeadStatus, type NodeId, type Player } from '@/engine';
import { Button } from '../components/Button';
import { GameBanner } from '../components/GameBanner';
import { Hud } from '../components/Hud';
import { Segmented } from '../components/Segmented';
import { STATUS_LABELS, StatusGlyph } from '../components/StatusGlyph';
import { Toast } from '../components/Toast';
import { Toggle } from '../components/Toggle';
import {
  concedeNow,
  endTurnBlocker,
  endTurnNow,
  flow,
  flowEvent,
  lastViewed,
  nextNeedingAction,
  openTimeline,
  rematch,
} from '../controller';
import { isPickingNode, targetsFor, type Flow } from '../flow';
import { MultiverseGraph, RULER } from '../multiverse/MultiverseGraph';
import { MultiverseList } from '../multiverse/MultiverseList';
import { NodeCard } from '../multiverse/NodeCard';
import { buildGraph, type GraphModel } from '../multiverse/graphModel';
import { graphCommand, moveFocus, type GraphCommand } from '../multiverse/graphNav';
import { multiverseView, showLinks, type MultiverseView } from '../multiverse/prefs';
import {
  K_MIN,
  ZOOM_STEP,
  boxAround,
  clampToBounds,
  ensureVisible,
  fit,
  initialView,
  showBox,
  zoomAt,
  type Size,
  type View,
} from '../multiverse/viewport';
import { navigate } from '../router';
import { game } from '../store';
import { pickPrompt } from '../timelineModel';
import { COLORS, playerColor, playerName } from '../tokens';
import { useSize } from '../useSize';
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

const VIEW_OPTIONS = [
  { value: 'graph', label: 'Graph' },
  { value: 'list', label: 'List' },
] as const;

/** Space kept around the graph when fitting or showing nodes (px). */
const PAD = 40;

/** The node under the pointer and the node with keyboard focus, shared with the node card. */
const graphHover = signal<NodeId | null>(null);
const graphFocus = signal<NodeId | null>(null);

/**
 * What the graph remembers while the player visits timelines: the view (once they panned or
 * zoomed; until then it follows the tree) and which draft nodes were already shown, so only
 * new ones pulse. Reset when a new game starts (the root node object identifies a game).
 */
const memory = {
  root: null as object | null,
  view: null as View | null,
  seen: new Set<string>(),
};

function rememberGame(state: GameState): void {
  const root = state.nodes[0] ?? null;
  if (root === memory.root) return;
  memory.root = root;
  memory.view = null;
  memory.seen = new Set();
  graphHover.value = null;
  graphFocus.value = null;
}

/** Identifies a draft node by what created it, so undo-then-redo pulses again. */
function draftKey(state: GameState, id: NodeId): string {
  const node = state.preview.nodes[id];
  return `${id}/${node?.parent}/${JSON.stringify(node?.origin)}`;
}

/** Keys the multiverse ignores while the focus is in a control that uses them itself. */
const OWN_KEYS = 'input, textarea, select, [role="radio"], [role="dialog"]';

/** Nodes needing action, else the newest round's nodes: where "Now" and the first view go. */
function nowNodes(state: GameState, model: GraphModel) {
  const needs = model.nodes.filter((n) => n.status === 'needsAction');
  if (needs.length > 0) return needs;
  const nodes = state.preview.nodes;
  const round = nodes.at(-1)?.round ?? 0;
  const ids = new Set(nodes.filter((n) => n.round === round).map((n) => n.id));
  return model.nodes.filter((n) => ids.has(n.id));
}

/** Every legend glyph sits in the same 32 × 32 box, centred on its label's line. */
function Legend({ seat, graph }: { seat: Player | null; graph: boolean }) {
  const linkSample = (color: string) => (
    <svg class="status-glyph" width={32} height={32} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M2 24C8 10 18 8 24 16" fill="none" stroke={color} stroke-dasharray="4 3" />
      <polygon points="28,22 21,18 26,13" fill={color} />
    </svg>
  );
  return (
    <section class="legend" aria-labelledby="legend-title">
      <h2 id="legend-title" class="t-label section-label">
        Legend
      </h2>
      <ul class={`legend-list t-caption${graph ? ' legend-list--two' : ''}`}>
        {LEGEND.map((s) => (
          <li key={s}>
            <StatusGlyph status={s} seat={seat} mover={seat ?? 0} winner={0} compact />
            {STATUS_LABELS[s]}
          </li>
        ))}
        <li>
          <StatusGlyph status="needsAction" seat={seat} mover={seat ?? 0} target compact />
          Valid target
        </li>
        {graph && (
          <>
            <li>
              <StatusGlyph status="waiting" seat={seat} mover={0} incoming={0} compact />
              Received a mark
            </li>
            <li>
              <StatusGlyph status="history" seat={seat} mover={0} current compact />
              Last viewed
            </li>
            <li>
              {linkSample(COLORS.black)}
              Time travel, transfer
            </li>
            <li>
              {linkSample(playerColor(seat === 1 ? 1 : 0))}
              Send-back
            </li>
          </>
        )}
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
            onClick={() => next !== null && openTimeline(next)}
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

/** The header row above the graph or list: the view switcher, then the graph's tools. */
function Header(props: { children?: ComponentChildren }) {
  return (
    <div class="multiverse-header">
      <Segmented<MultiverseView>
        label="Multiverse view"
        options={VIEW_OPTIONS}
        value={multiverseView.value}
        onChange={(v) => (multiverseView.value = v)}
      />
      {props.children}
    </div>
  );
}

function PickPrompt(props: { text: string | null; graph: boolean }) {
  if (props.text === null) return null;
  return (
    <div class="pick-prompt">
      <div class="bar" />
      <p class="t-subhead">{props.text}</p>
      <p class="t-caption t-grey">
        {props.graph
          ? 'Only the ringed nodes can be picked. Esc cancels.'
          : 'Only the marked rows can be picked. Esc cancels.'}
      </p>
    </div>
  );
}

/**
 * The graph with its tools and keyboard: owns the view (pan/zoom), the focus and the draft
 * pulse. Pure maths lives in `viewport.ts` and `graphNav.ts`; this wires it to input.
 */
function GraphPane(props: {
  state: GameState;
  model: GraphModel;
  flow: Flow;
  prompt: string | null;
}) {
  const { state, model, flow: f } = props;
  const zoneRef = useRef<HTMLDivElement>(null);
  const size = useSize(zoneRef);
  const [manual, setManual] = useState<View | null>(memory.view);
  const [focusRequest, setFocusRequest] = useState(0);
  const [pulse, setPulse] = useState<ReadonlySet<NodeId>>(new Set());

  // New draft nodes (since the graph last showed this game) pulse once.
  useEffect(() => {
    const fresh: NodeId[] = [];
    for (const n of model.nodes) {
      if (!n.draft) continue;
      const key = draftKey(state, n.id);
      if (!memory.seen.has(key)) fresh.push(n.id);
      memory.seen.add(key);
    }
    if (fresh.length === 0) return;
    setPulse(new Set(fresh));
    const timer = setTimeout(() => setPulse(new Set()), 400);
    return () => clearTimeout(timer);
  }, [model]);

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      // The pointer is gone with the graph; do not show a stale hovered node on return.
      graphHover.value = null;
    };
  }, []);

  const field: Size | null =
    size === null ? null : { width: size.width, height: Math.max(0, size.height - RULER) };
  const bounds = { x: 0, y: 0, width: model.width, height: model.height };
  const nowBox = useMemo(() => boxAround(nowNodes(state, model), 0), [state, model]);
  const view: View | null =
    manual ?? (field === null ? null : initialView(bounds, nowBox, field, PAD));

  const picking = isPickingNode(f);
  const targets = useMemo(
    () => (isPickingNode(f) ? new Set(targetsFor(f, state).map((t) => t.node)) : null),
    [f, state],
  );
  const next = nextNeedingAction(state);
  const focused = graphFocus.value;
  const tabStop =
    focused !== null && model.byId.has(focused)
      ? focused
      : (next ?? [...(targets ?? [])][0] ?? model.nodes.at(-1)?.id ?? null);

  const setView = (v: View) => {
    if (field === null) return;
    const clamped = clampToBounds(v, bounds, field);
    memory.view = clamped;
    setManual(clamped);
  };

  const focusNode = (id: NodeId) => {
    const n = model.byId.get(id);
    if (n === undefined) return;
    graphFocus.value = id;
    if (view !== null && field !== null) {
      const box = { x: n.x - 24, y: n.y - 32, width: 48, height: 56 };
      const shown = ensureVisible(view, box, field, 16);
      if (shown !== view) setView(shown);
    }
    // Focus at once when the node is drawn; a culled one is focused after the next render.
    const el = zoneRef.current?.querySelector<SVGGElement>(`[data-node="${id}"]`);
    if (el) el.focus({ preventScroll: true });
    else setFocusRequest((r) => r + 1);
  };

  const activate = (id: NodeId) => {
    if (picking) flowEvent({ type: 'pickNode', node: id });
    else openTimeline(id);
  };

  const run = (command: GraphCommand) => {
    if (view === null || field === null) return;
    switch (command.kind) {
      case 'fit': {
        const v = fit(bounds, field, PAD);
        setView(v.k >= K_MIN ? v : { x: PAD, y: PAD, k: K_MIN });
        break;
      }
      case 'zoomIn':
      case 'zoomOut': {
        const centre = { x: field.width / 2, y: field.height / 2 };
        setView(zoomAt(view, centre, command.kind === 'zoomIn' ? ZOOM_STEP : 1 / ZOOM_STEP));
        break;
      }
      case 'links':
        showLinks.value = !showLinks.value;
        break;
      case 'next': {
        const id = nextNeedingAction(state, focused);
        if (id !== null) focusNode(id);
        break;
      }
      case 'move': {
        const from = tabStop;
        const to = from === null ? null : moveFocus(model, from, command.key);
        if (to !== null) focusNode(to);
        else if (from !== null) focusNode(from);
        break;
      }
      case 'activate':
        if (tabStop !== null) activate(tabStop);
        break;
      case 'switchView':
        break;
    }
  };

  const showNow = () => {
    if (view === null || field === null || nowBox === null) return;
    setView(showBox(view, nowBox, field, PAD));
  };

  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(OWN_KEYS)) return;
    const command = graphCommand(event.key, {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
    });
    if (command === null || command.kind === 'switchView') return;
    const onNode = target?.closest('.graph-node') != null;
    // Arrows, Enter and Space belong to the graph only when it has the focus.
    if (command.kind === 'activate' && !onNode) return;
    if (command.kind === 'move' && !onNode && target?.closest('button, a') != null) return;
    if (command.kind === 'next' && state.phase !== 'draft') return;
    event.preventDefault();
    run(command);
  };

  return (
    <>
      <Header>
        <div class="multiverse-tools">
          <Toggle checked={showLinks.value} onChange={(v) => (showLinks.value = v)}>
            Links
          </Toggle>
          <div class="button-row multiverse-zoom">
            <Button class="btn--small" onClick={() => run({ kind: 'fit' })}>
              Fit
            </Button>
            <Button class="btn--small" onClick={() => run({ kind: 'zoomOut' })}>
              <span aria-label="Zoom out">−</span>
            </Button>
            <Button class="btn--small" onClick={() => run({ kind: 'zoomIn' })}>
              <span aria-label="Zoom in">+</span>
            </Button>
            <Button class="btn--small" onClick={showNow}>
              Now
            </Button>
          </div>
        </div>
      </Header>
      <PickPrompt text={props.prompt} graph />
      <div class="graph-zone" ref={zoneRef}>
        {size !== null && view !== null && (
          <MultiverseGraph
            state={state}
            model={model}
            size={size}
            view={view}
            onView={setView}
            links={showLinks.value}
            targets={targets}
            seat={hotSeat(state)}
            tabStop={tabStop}
            hover={graphHover.value}
            current={lastViewed.value}
            pulse={pulse}
            onHover={(id) => (graphHover.value = id)}
            onFocusNode={(id) => (graphFocus.value = id)}
            onActivate={activate}
            focusRequest={focusRequest}
          />
        )}
      </div>
    </>
  );
}

/** The node the card shows: hovered, else focused, else the next to act, else the last viewed. */
function cardNode(state: GameState, model: GraphModel): { node: NodeId; label: string } | null {
  const hovered = graphHover.value;
  if (hovered !== null && model.byId.has(hovered)) return { node: hovered, label: 'Node' };
  const focused = graphFocus.value;
  if (focused !== null && model.byId.has(focused)) return { node: focused, label: 'Node' };
  const next = nextNeedingAction(state);
  if (next !== null) return { node: next, label: 'Next to act' };
  const viewed = lastViewed.value;
  if (viewed !== null && model.byId.has(viewed)) return { node: viewed, label: 'Last viewed' };
  const newest = model.nodes.at(-1);
  return newest === undefined ? null : { node: newest.id, label: 'Newest node' };
}

/**
 * The multiverse: the graph of the timeline tree (Stage 5) or the Stage 4 list, with End turn,
 * Concede, the node card and the legend on the right. Picking flows, banners and toasts are the
 * Stage 4 ones from `controller.ts`, so both views pick targets the same way.
 */
export function MultiverseScreen() {
  const state = game.value;
  const f = flow.value;
  const mode = multiverseView.value;
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    // Capture, so G switches the view before the dev grid overlay sees it.
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);
  if (state === null) return null;
  rememberGame(state);

  const seat = hotSeat(state);
  const picking = isPickingNode(f);
  const prompt = picking && f.kind !== 'sendBack' ? pickPrompt(state, f) : null;
  const graph = mode === 'graph';
  const model = buildGraph(state);

  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(OWN_KEYS)) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' && (f.kind === 'timeTravel' || f.kind === 'transfer')) {
      event.preventDefault();
      flowEvent({ type: 'cancel' });
    } else if (key === 'g') {
      event.preventDefault();
      multiverseView.value = graph ? 'list' : 'graph';
    } else if (key === 'n' && !graph && !picking && state.phase === 'draft') {
      const next = nextNeedingAction(state);
      if (next !== null) openTimeline(next);
    }
  };

  const card = graph ? cardNode(state, model) : null;

  return (
    <div class={`screen${graph ? ' screen--fixed' : ''}`}>
      <Hud />
      <GameBanner />
      <Toast />
      <div class={`page multiverse${graph ? ' multiverse--graph' : ''}`}>
        <div class="grid multiverse-grid">
          <main class="col-1-9 multiverse-main" aria-label="Multiverse">
            {graph ? (
              <GraphPane state={state} model={model} flow={f} prompt={prompt} />
            ) : (
              <>
                <Header />
                <PickPrompt text={prompt} graph={false} />
                <MultiverseList state={state} flow={f} seat={seat} />
              </>
            )}
          </main>
          <aside class="col-10-12 multiverse-side">
            <Side state={state} flow={f} />
            {card !== null && <NodeCard state={state} node={card.node} label={card.label} />}
            <Legend seat={seat} graph={graph} />
          </aside>
        </div>
      </div>
    </div>
  );
}
