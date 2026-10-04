import { Component } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { GameState, NodeId, Player } from '@/engine';
import { GLYPH_BOX, StatusGlyphBody } from '../components/StatusGlyph';
import { coordLabel, nodeAriaLabel } from '../describe';
import { COLORS, playerColor } from '../tokens';
import {
  BLOCK_LANES,
  BLOCK_STEPS,
  blocksIn,
  graphBlocks,
  nodeAbove,
  type Block,
  type GraphLink,
  type GraphModel,
  type GraphNode,
} from './graphModel';
import { COLUMN, edgePath, linkLabelAt, routeLink } from './laneLayout';
import { pan, visibleRange, zoomAt, type Size, type View } from './viewport';

/** Height of the step ruler above the field (px). */
export const RULER = 48;
/** Node labels and link labels are hidden below this zoom. */
export const LABEL_MIN_K = 0.6;
/** Columns and lanes drawn beyond the visible range, so panning never shows a gap. */
const CULL_MARGIN = 2;
/**
 * Where a label moved aside starts: right of the 18 px target ring at label height, and right of
 * the 12 px half-width of the view bar above.
 */
const LABEL_RIGHT_X = 13;
/** Pointer travel (px) before a press becomes a pan instead of a click. */
const DRAG_THRESHOLD = 4;

/** Show every `stride`-th step on the ruler so numerals keep at least 28 px apart. */
export function rulerStride(k: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (COLUMN * k * s >= 28) return s;
  return 1000;
}

export interface MultiverseGraphProps {
  readonly state: GameState;
  readonly model: GraphModel;
  /** Size of the whole SVG; the field is everything below the ruler. */
  readonly size: Size;
  readonly view: View;
  readonly onView: (view: View) => void;
  readonly links: boolean;
  /** Picking mode: the nodes that may be picked (everything else drops to 30%); null otherwise. */
  readonly targets: ReadonlySet<NodeId> | null;
  readonly seat: Player | null;
  /** The node with the keyboard tab stop (roving tabindex). */
  readonly tabStop: NodeId | null;
  readonly hover: NodeId | null;
  /** The last-viewed timeline: a 4 px bar under it. */
  readonly current: NodeId | null;
  /** Draft nodes that just appeared and pulse once. */
  readonly pulse: ReadonlySet<NodeId>;
  readonly onHover: (node: NodeId | null) => void;
  readonly onFocusNode: (node: NodeId) => void;
  readonly onActivate: (node: NodeId) => void;
  /** Bumped to move DOM focus to `tabStop` (keyboard navigation). */
  readonly focusRequest: number;
}

interface Drag {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  readonly view: View;
  moved: boolean;
}

/** The arrowhead of a link: an 8 px (on screen) filled triangle at the tip. */
function arrowHead(tip: { x: number; y: number }, dir: { x: number; y: number }, k: number) {
  const len = 8 / k;
  const half = 3.5 / k;
  const bx = tip.x - dir.x * len;
  const by = tip.y - dir.y * len;
  return `${tip.x},${tip.y} ${bx - dir.y * half},${by + dir.x * half} ${bx + dir.y * half},${by - dir.x * half}`;
}

function Link(props: {
  link: GraphLink;
  model: GraphModel;
  occupied: ReadonlySet<string>;
  k: number;
  label: string | null;
}) {
  const { link, model, k } = props;
  const a = model.byId.get(link.from);
  const b = model.byId.get(link.to);
  if (a === undefined || b === undefined) return null;
  const curve = routeLink(a, b, (step, lane) => props.occupied.has(`${step}/${lane}`));
  const at = linkLabelAt(curve);
  const color = link.kind === 'sendBack' ? playerColor(link.player) : COLORS.black;
  return (
    <g
      class={`graph-link graph-link--${link.kind}${link.draft ? ' graph-link--draft' : ''}`}
      data-link={link.kind}
      data-from={link.from}
      data-to={link.to}
    >
      <path d={curve.d} stroke={color} />
      <polygon points={arrowHead(curve.tip, curve.dir, k)} fill={color} />
      {props.label !== null && (
        <text
          class="graph-link-label"
          x={at.x}
          y={at.y}
          text-anchor={at.anchor}
          font-size={12 / k}
          stroke-width={3 / k}
          fill={color}
        >
          {props.label}
        </text>
      )}
    </g>
  );
}

/** Do two flat props objects differ in any value? */
function shallowDiffers(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key in y) if (x[key] !== y[key]) return true;
  for (const key in x) if (!(key in y)) return true;
  return false;
}

interface NodeHandlers {
  readonly hover: (id: NodeId) => void;
  readonly focus: (id: NodeId) => void;
  readonly activate: (id: NodeId) => void;
}

interface NodeViewProps {
  readonly state: GameState;
  readonly node: GraphNode;
  readonly seat: Player | null;
  readonly target: boolean;
  readonly dim: boolean;
  readonly pulse: boolean;
  readonly hover: boolean;
  readonly current: boolean;
  readonly tabStop: boolean;
  /** The zoom, when the "#id" label is shown (it is set at 12 px on screen); null hides it. */
  readonly labelK: number | null;
  /** Set the label above-right, clear of a target ring here or a bar/ring on the node above. */
  readonly labelRight: boolean;
  readonly handlers: NodeHandlers;
}

/**
 * One node of the graph. A class only for `shouldComponentUpdate`: graph nodes are immutable
 * and the props are flat, so when panning brings new columns into view only those nodes render,
 * not the thousand already on screen.
 */
class NodeView extends Component<NodeViewProps> {
  override shouldComponentUpdate(next: NodeViewProps): boolean {
    return shallowDiffers(this.props, next);
  }

  override render() {
    const { state, node: n, seat, target, labelK, handlers } = this.props;
    const half = GLYPH_BOX / 2;
    const classes = ['graph-node'];
    if (this.props.dim) classes.push('graph-node--dim');
    if (target) classes.push('graph-node--target');
    return (
      <g
        class={classes.join(' ')}
        data-node={n.id}
        data-status={n.status}
        style={`transform: translate(${n.x}px, ${n.y}px)`}
        tabindex={this.props.tabStop ? 0 : -1}
        role="button"
        aria-label={nodeAriaLabel(state, n.id, target)}
        onPointerEnter={() => handlers.hover(n.id)}
        onFocus={() => handlers.focus(n.id)}
        onClick={() => handlers.activate(n.id)}
      >
        <rect
          class={`graph-hit${this.props.hover ? ' graph-hit--hover' : ''}`}
          x={-half}
          y={-half}
          width={GLYPH_BOX}
          height={GLYPH_BOX}
        />
        <rect class="graph-focus" x={-half} y={-half} width={GLYPH_BOX} height={GLYPH_BOX} />
        <g transform={`translate(${-half} ${-half})`}>
          <StatusGlyphBody
            status={n.status}
            seat={seat}
            mover={n.mover}
            winner={n.winner}
            target={target}
            incoming={n.incoming ? n.mover : null}
            current={this.props.current}
          />
        </g>
        {this.props.pulse && <circle class="graph-pulse" r={16} />}
        {labelK !== null && (
          <text
            class="graph-label"
            x={this.props.labelRight ? LABEL_RIGHT_X : -12}
            y={-12 - 2 / labelK}
            font-size={12 / labelK}
          >
            #{n.id}
          </text>
        )}
      </g>
    );
  }
}

/** The tree edges through one block; drawn once per model and then skipped. */
class EdgeBlock extends Component<{ readonly block: Block }> {
  override shouldComponentUpdate(next: { readonly block: Block }): boolean {
    return next.block !== this.props.block;
  }

  override render() {
    return (
      <g>
        {this.props.block.edges.map(({ from, to }) => {
          const d = edgePath(from, to);
          return (
            <path
              key={to.id}
              class={to.draft ? 'graph-edge graph-edge--draft' : 'graph-edge'}
              d={d}
              style={`d: path('${d}')`}
            />
          );
        })}
      </g>
    );
  }
}

interface NodeBlockProps {
  readonly block: Block;
  readonly model: GraphModel;
  readonly state: GameState;
  readonly seat: Player | null;
  readonly targets: ReadonlySet<NodeId> | null;
  readonly pulse: ReadonlySet<NodeId>;
  /** Null unless the node is in this block, so other blocks stay untouched. */
  readonly hover: NodeId | null;
  readonly tabStop: NodeId | null;
  /** The last-viewed node (anywhere: the label of the node below it moves aside). */
  readonly current: NodeId | null;
  readonly labelK: number | null;
  readonly handlers: NodeHandlers;
}

/** The nodes of one block; skipped while none of its props change (shallow compare). */
class NodeBlock extends Component<NodeBlockProps> {
  override shouldComponentUpdate(next: NodeBlockProps): boolean {
    return shallowDiffers(this.props, next);
  }

  override render() {
    const { block, model, targets, pulse, current } = this.props;
    // A node's label moves right of its own target ring, and right of the view bar or target
    // ring hanging down from the node directly above it (same step, previous lane).
    const marked = (id: NodeId | undefined) =>
      id !== undefined && (id === current || (targets?.has(id) ?? false));
    return (
      <g>
        {block.nodes.map((n) => {
          const target = targets?.has(n.id) ?? false;
          return (
            <NodeView
              key={n.id}
              state={this.props.state}
              node={n}
              seat={this.props.seat}
              target={target}
              dim={targets !== null && !target}
              pulse={pulse.has(n.id)}
              hover={this.props.hover === n.id}
              current={current === n.id}
              tabStop={this.props.tabStop === n.id}
              labelK={this.props.labelK}
              labelRight={target || marked(nodeAbove(model, n))}
              handlers={this.props.handlers}
            />
          );
        })}
      </g>
    );
  }
}

/** The key of the block holding node `id`. */
function blockKeyOf(model: GraphModel, id: NodeId): string | null {
  const n = model.byId.get(id);
  if (n === undefined) return null;
  return `${Math.floor(n.step / BLOCK_STEPS)}/${Math.floor(n.lane / BLOCK_LANES)}`;
}

/**
 * The multiverse as an SVG graph (design-system §7): a sticky step ruler, orthogonal tree edges,
 * dashed cross-links and the status glyphs, panned and zoomed by a {@link View}. Only nodes and
 * edges in the visible columns and lanes (plus a margin) are drawn, so large trees stay fast.
 *
 * The component is controlled: the view, focus and hover live in the screen, which also owns the
 * keyboard. Pointer input is handled here: drag (left or middle button) pans, the wheel pans
 * (Shift: sideways) and Ctrl/⌘ + wheel zooms at the cursor.
 */
export function MultiverseGraph(props: MultiverseGraphProps) {
  const { state, model, size, view, targets, seat } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const field: Size = { width: size.width, height: Math.max(0, size.height - RULER) };
  // One stable handler object for every node, reading the latest props when called.
  const handlers = useMemo<NodeHandlers>(
    () => ({
      hover: (id) => latest.current.onHover(id),
      focus: (id) => latest.current.onFocusNode(id),
      activate: (id) => {
        if (!suppressClick.current) latest.current.onActivate(id);
      },
    }),
    [],
  );
  const occupied = useMemo(() => new Set(model.nodes.map((n) => `${n.step}/${n.lane}`)), [model]);

  // The wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { view: v, onView, size: s } = latest.current;
      const rect = svg.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? s.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top - RULER };
        onView(zoomAt(v, point, Math.exp(-dy * 0.002)));
      } else if (event.shiftKey) {
        onView(pan(v, -(dx || dy), 0));
      } else {
        onView(pan(v, -dx, -dy));
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (props.focusRequest === 0 || props.tabStop === null) return;
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-node="${props.tabStop}"]`);
    el?.focus({ preventScroll: true });
  }, [props.focusRequest]);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view: latest.current.view,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (d === null || d.pointer !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      svgRef.current?.setPointerCapture(event.pointerId);
    }
    latest.current.onView(pan(d.view, dx, dy));
  };
  const onPointerUp = (event: PointerEvent) => {
    const d = drag.current;
    if (d === null || d.pointer !== event.pointerId) return;
    drag.current = null;
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
  };

  // --- Culling ---------------------------------------------------------------------------------
  const range = visibleRange(view, field);
  const blocks = blocksIn(model, {
    stepMin: range.stepMin - CULL_MARGIN,
    stepMax: range.stepMax + CULL_MARGIN,
    laneMin: range.laneMin - CULL_MARGIN,
    laneMax: range.laneMax + CULL_MARGIN,
  });
  // The keyboard tab stop is always in the DOM, even when it is scrolled away.
  const stopBlock = props.tabStop === null ? null : blockKeyOf(model, props.tabStop);
  const extra = graphBlocks(model).get(stopBlock ?? '');
  if (extra !== undefined && !blocks.includes(extra)) blocks.push(extra);
  const blockKeys = blocks.map((b) => b.key).join(',');
  const k = view.k;
  const labels = k >= LABEL_MIN_K;
  const picking = targets !== null;
  const stride = rulerStride(k);
  // The mover glyphs alternate on every column while there is room (12 px apart), so the
  // parity lesson survives zooming out even when only every few numerals fit.
  const glyphStride = COLUMN * k >= 12 ? 1 : stride;
  const ruler: number[] = [];
  const first = Math.max(0, Math.ceil(range.stepMin / glyphStride) * glyphStride);
  // Up to the step the current heads will create next; beyond it there is nothing to label.
  const last = Math.min(range.stepMax, model.steps);
  for (let step = first; step <= last; step += glyphStride) ruler.push(step);

  const layers = useMemo(() => {
    const p = latest.current;
    const only = (id: NodeId | null, block: Block) =>
      id !== null && blockKeyOf(model, id) === block.key ? id : null;
    const s0 = range.stepMin - CULL_MARGIN;
    const s1 = range.stepMax + CULL_MARGIN;
    const l0 = range.laneMin - CULL_MARGIN;
    const l1 = range.laneMax + CULL_MARGIN;
    const links = p.links
      ? model.links.filter((link) => {
          const a = model.byId.get(link.from);
          const b = model.byId.get(link.to);
          if (a === undefined || b === undefined) return false;
          const inSteps = Math.max(a.step, b.step) >= s0 && Math.min(a.step, b.step) <= s1;
          const inLanes = Math.max(a.lane, b.lane) + 2 >= l0 && Math.min(a.lane, b.lane) <= l1;
          return inSteps && inLanes;
        })
      : [];
    return (
      <>
        <g class="graph-edges">
          {blocks.map((block) => (
            <EdgeBlock key={block.key} block={block} />
          ))}
        </g>
        {links.length > 0 && (
          <g class="graph-links">
            {links.map((link) => (
              <Link
                key={`${link.kind}-${link.from}-${link.to}`}
                link={link}
                model={model}
                occupied={occupied}
                k={k}
                label={labels ? coordLabel(state.topology, link.cell) : null}
              />
            ))}
          </g>
        )}
        <g class="graph-nodes">
          {blocks.map((block) => (
            <NodeBlock
              key={block.key}
              block={block}
              state={state}
              seat={seat}
              targets={targets}
              pulse={p.pulse}
              model={model}
              hover={only(p.hover, block)}
              current={p.current}
              tabStop={only(p.tabStop, block)}
              labelK={labels ? k : null}
              handlers={handlers}
            />
          ))}
        </g>
      </>
    );
    // `blockKeys` stands for `blocks` and `range`: the layers only change when the set of drawn
    // blocks does, not on every pan.
  }, [
    state,
    model,
    occupied,
    blockKeys,
    k,
    labels,
    targets,
    seat,
    props.links,
    props.tabStop,
    props.hover,
    props.current,
    props.pulse,
  ]);

  return (
    <svg
      ref={svgRef}
      class={`graph${picking ? ' graph--picking' : ''}`}
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      role="group"
      aria-label={`Multiverse graph, ${model.nodes.length} nodes`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => props.onHover(null)}
    >
      <defs>
        <clipPath id="graph-field-clip">
          <rect width={field.width} height={field.height} />
        </clipPath>
      </defs>
      <g transform={`translate(0 ${RULER})`}>
        <g clip-path="url(#graph-field-clip)">
          <rect class="graph-bg" width={field.width} height={field.height} />
          <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>{layers}</g>
        </g>
      </g>
      <g class="graph-ruler" aria-hidden="true">
        <rect class="graph-ruler-bg" width={size.width} height={RULER} />
        {ruler.map((step) => {
          const x = view.x + step * COLUMN * k;
          if (x < 24 || x > size.width - 12) return null;
          const mover: Player = step % 2 === 0 ? 0 : 1;
          return (
            <g key={step} transform={`translate(${x} 0)`}>
              {step % stride === 0 && (
                <text class="graph-ruler-numeral" y={20}>
                  {step}
                </text>
              )}
              {mover === 0 ? (
                <rect x={-4} y={28} width={8} height={8} fill={playerColor(0)} />
              ) : (
                <circle cy={32} r={4} fill={playerColor(1)} />
              )}
            </g>
          );
        })}
        <text class="graph-ruler-t" y={20}>
          T
        </text>
        <path class="graph-ruler-rule" d={`M0 ${RULER - 0.5}H${size.width}`} />
      </g>
    </svg>
  );
}
