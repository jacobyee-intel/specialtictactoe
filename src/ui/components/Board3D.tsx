import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CubicQuotient, TesseractSurface, dir3, dir4, type Dir, type Topology } from '@/geometry';
import type { CellId, NodeId } from '@/engine';
import type { BoardView, SceneInput, TraceResult } from '@/render';
import { axisName } from '../describe';
import {
  autoRotate,
  ghostChoice,
  planes4,
  tesseractView,
  traceHighlight,
  type GhostChoice,
} from '../view3d';
import { Button } from './Button';
import { DirectionPicker, type Vec3i } from './DirectionPicker';
import { Segmented } from './Segmented';
import { Toggle } from './Toggle';

type RenderModule = typeof import('@/render');

/**
 * three.js is about half a megabyte, so the render module is fetched only when a timeline is
 * first opened. The promise is cached: later mounts reuse the loaded module.
 */
let loader: Promise<RenderModule> | null = null;
function loadRender(): Promise<RenderModule> {
  loader ??= import('@/render').catch((error: unknown) => {
    loader = null; // let a later mount retry (e.g. after a network blip)
    throw error;
  });
  return loader;
}

type Status = 'loading' | 'ready' | 'unavailable' | 'failed';

const HINT = 'Right-drag rotate · Middle-drag move centre · Wheel zoom';
const HINT_4D =
  'Right-drag rotate · Shift + right-drag turn in 4D · Shift + wheel ZW · Middle-drag move centre · Wheel zoom';
/** How long the pointer must rest on a cell before it becomes the tracer's start. */
const DWELL_MS = 250;
const DEG = Math.PI / 180;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The axes the direction picker shows for a start cell: x y z, or a tesseract cube's free axes. */
function pickerAxes(topology: Topology, cell: CellId | null): number[] {
  if (!(topology instanceof TesseractSurface) || cell === null) return [0, 1, 2];
  const a = topology.facet(cell).axis;
  return [0, 1, 2, 3].filter((k) => k !== a);
}

/** A picker vector as a local direction of the start cell. */
function toDir(topology: Topology, cell: CellId, v: Vec3i): Dir {
  if (!(topology instanceof TesseractSurface)) return dir3(v[0], v[1], v[2]);
  const d = [0, 0, 0, 0];
  pickerAxes(topology, cell).forEach((k, i) => (d[k] = v[i] as number));
  return dir4(d[0] as number, d[1] as number, d[2] as number, d[3] as number);
}

/** One 4D angle slider, in whole degrees. */
function AngleSlider(props: { label: string; value: number; onChange: (radians: number) => void }) {
  const deg = Math.round(props.value / DEG) % 360;
  return (
    <label class="angle-slider">
      <span class="t-label">{props.label}</span>
      <input
        type="range"
        min={0}
        max={359}
        step={1}
        value={deg}
        aria-label={`${props.label} rotation, degrees`}
        onInput={(event) => props.onChange(Number(event.currentTarget.value) * DEG)}
      />
      <span class="t-caption t-num angle-value">{deg}°</span>
    </label>
  );
}

function Caption(props: { lead: string; text: string; class?: string }) {
  return (
    <p class={`t-caption measure ${props.class ?? ''}`}>
      <span class="t-bold">{props.lead}</span> {props.text}
    </p>
  );
}

/**
 * The 3D view of a node's board (Stage 7). A Preact shell around the imperative `BoardView`: it
 * lazy-loads the render module, mounts the view, forwards the board, the shared hover and the
 * view settings, and hosts the Phase B controls: ghost copies, the tesseract's 4D rotation and
 * net, and the geodesic tracer. Left-click does nothing in the canvas; every game action stays
 * on the 2D board.
 */
export function Board3D(props: {
  /** The node's board; its identity must change only when the board does (it is rebuilt). */
  readonly input: SceneInput;
  readonly hovered: CellId | null;
  readonly onHover: (cell: CellId | null) => void;
  /** The hover caption, shared with the 2D board. */
  readonly caption: string | null;
  readonly node: NodeId;
  /** The 2D board's selected cell: the tracer starts there when there is one. */
  readonly selected: CellId | null;
  /** Tesseract: the cube chosen in the 2D filter (null: all). */
  readonly facet: number | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mod, setMod] = useState<RenderModule | null>(null);
  const [view, setView] = useState<BoardView | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const onHover = useRef(props.onHover);
  onHover.current = props.onHover;
  const reduced = useMemo(reducedMotion, []);

  const topology = props.input.topology;
  const tesseract = topology instanceof TesseractSurface;
  const wrapped = topology instanceof CubicQuotient && topology.wrapped;
  const ghosts: GhostChoice = wrapped ? ghostChoice.value : 'off';
  const net = tesseract && tesseractView.value === 'net';
  const schlegel = tesseract && !net;
  const planes = planes4.value ?? mod?.DEFAULT_PLANES4 ?? { xw: 0, yw: 0, zw: 0 };
  const spinning = schlegel && autoRotate.value && !reduced;

  useEffect(() => {
    let alive = true;
    loadRender().then(
      (m) => alive && setMod(() => m),
      (error: unknown) => {
        console.warn('3D view failed to load', error);
        if (alive) setStatus('failed');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (mod === null || host === null) return;
    const v = mod.BoardView.create(host);
    if (v === null) {
      setStatus('unavailable');
      return;
    }
    setView(v);
    setStatus('ready');
    const offHover = v.onHover((cell) => onHover.current(cell));
    const offPlanes = v.onPlanes4((p) => (planes4.value = { xw: p.xw, yw: p.yw, zw: p.zw }));
    return () => {
      offHover();
      offPlanes();
      v.dispose();
      setView(null);
    };
  }, [mod]);

  // Options first, then the board, so the first build already has the right view.
  useEffect(() => {
    view?.setOptions({
      ghosts,
      net,
      facet: tesseract ? props.facet : null,
      planes4: { xw: planes.xw, yw: planes.yw, zw: planes.zw },
    });
  }, [view, ghosts, net, tesseract, props.facet, planes.xw, planes.yw, planes.zw]);

  useEffect(() => view?.setInput(props.input), [view, props.input]);
  useEffect(() => view?.setHover(props.hovered), [view, props.hovered]);
  useEffect(() => view?.setAutoRotate(spinning), [view, spinning]);

  // --- the tracer ---
  const [traceOn, setTraceOn] = useState(false);
  const [dwelt, setDwelt] = useState<CellId | null>(null);
  const [picked, setPicked] = useState<Vec3i | null>(null);
  const [run, setRun] = useState<{ result: TraceResult; index: number; done: boolean } | null>(
    null,
  );
  const start = props.selected ?? dwelt;

  // The start follows the pointer, but only once it rests on a cell: moving from the board to
  // the picker crosses other cells, which must not steal the start.
  useEffect(() => {
    if (!traceOn || props.hovered === null) return;
    const cell = props.hovered;
    const id = setTimeout(() => setDwelt(cell), DWELL_MS);
    return () => clearTimeout(id);
  }, [traceOn, props.hovered]);

  const clearTrace = () => {
    setRun(null);
    setPicked(null);
    view?.setTrace(null);
    traceHighlight.value = null;
  };

  // A new space or size: the old walk means nothing there.
  useEffect(() => {
    clearTrace();
    setDwelt(null);
  }, [topology]);

  useEffect(() => {
    if (view === null) return;
    return view.onTraceProgress((index, done) => setRun((r) => r && { ...r, index, done }));
  }, [view]);

  useEffect(() => {
    if (run === null) {
      traceHighlight.value = null;
      return;
    }
    const cells = run.result.cells.slice(0, run.index + 1);
    traceHighlight.value = { node: props.node, cells, current: cells[cells.length - 1] as CellId };
  }, [run, props.node]);

  useEffect(() => () => void (traceHighlight.value = null), []);

  const walk = (v: Vec3i, from: CellId | null) => {
    if (mod === null || view === null || from === null) return;
    const result = mod.trace(topology, from, toDir(topology, from, v));
    setPicked(v);
    setDwelt(from);
    setRun({ result, index: 0, done: result.steps === 0 });
    view.setTrace({ cells: result.cells, dirs: result.dirs }, { animate: !reduced });
  };

  const toggleTrace = () => {
    if (traceOn) clearTrace();
    else setDwelt(props.hovered);
    setTraceOn(!traceOn);
  };

  // X / Y / Z (and W on the tesseract) pick an axis direction; Shift reverses; Escape closes.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event: KeyboardEvent) => {
    if (!traceOn) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input:not([type="checkbox"]):not([type="range"]), textarea, select')) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearTrace();
      setTraceOn(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const axis = ['x', 'y', 'z', 'w'].indexOf(event.key.toLowerCase());
    if (axis < 0) return;
    const from = props.hovered ?? start;
    if (from === null) return;
    const i = pickerAxes(topology, from).indexOf(axis);
    if (i < 0) return;
    event.preventDefault();
    const s = event.shiftKey ? -1 : 1;
    walk([0, 1, 2].map((k) => (k === i ? s : 0)) as unknown as Vec3i, from);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);

  const message =
    status === 'unavailable'
      ? 'The 3D view needs WebGL, which this browser does not provide. The 2D board has everything.'
      : status === 'failed'
        ? 'The 3D view could not be loaded. The 2D board has everything.'
        : null;

  const axes = pickerAxes(topology, start).map(axisName) as [string, string, string];
  const keyNames = axes.map((a) => a.toUpperCase()).join(', ');
  const fromLabel =
    start === null
      ? 'Hover a cell to start there.'
      : `From ${coordText(topology, start)}. Pick a direction, or press ${keyNames} (Shift reverses).`;

  return (
    <section class="view3d" aria-label="3D board">
      <div class="view3d-header">
        {wrapped && (
          <div class="view3d-choice">
            <span class="t-label">Ghost copies</span>
            <Segmented
              label="Ghost copies"
              options={[
                { value: 'off', label: 'Off' },
                { value: 'faces', label: 'Faces' },
                { value: 'all', label: 'All' },
              ]}
              value={ghosts}
              onChange={(v) => (ghostChoice.value = v)}
            />
          </div>
        )}
        {tesseract && (
          <Segmented
            label="Tesseract view"
            options={[
              { value: 'schlegel', label: 'Schlegel' },
              { value: 'net', label: 'Net' },
            ]}
            value={net ? 'net' : 'schlegel'}
            onChange={(v) => (tesseractView.value = v)}
          />
        )}
        <span class="view3d-buttons">
          <Button class="btn--small" ariaPressed={traceOn} onClick={toggleTrace}>
            Trace
          </Button>
          {schlegel && (
            <Button class="btn--small" onClick={() => view?.reset4D()}>
              Reset 4D
            </Button>
          )}
          <Button class="btn--small" onClick={() => view?.resetView()}>
            Reset view
          </Button>
        </span>
      </div>
      <div
        class={`view3d-host ${status === 'ready' ? '' : 'view3d-host--empty'}`}
        ref={hostRef}
        data-status={status}
      >
        {message !== null && <p class="t-body measure view3d-message">{message}</p>}
      </div>
      {schlegel && (
        <div class="view3d-4d">
          {(['xw', 'yw', 'zw'] as const).map((plane) => (
            <AngleSlider
              key={plane}
              label={plane.toUpperCase()}
              value={planes[plane]}
              onChange={(r) => (planes4.value = { ...planes, [plane]: r })}
            />
          ))}
          <span title={reduced ? 'Off while the system asks for reduced motion.' : undefined}>
            <Toggle checked={spinning} disabled={reduced} onChange={(v) => (autoRotate.value = v)}>
              Auto-rotate XW
            </Toggle>
          </span>
        </div>
      )}
      {traceOn && (
        <div class="view3d-trace">
          <DirectionPicker
            axes={axes}
            value={picked}
            disabled={start === null || mod === null}
            onPick={(v) => walk(v, start)}
          />
          <div class="view3d-trace-text">
            <p class="t-caption t-num">{fromLabel}</p>
            {run !== null &&
              (run.done ? (
                <Caption
                  class="trace-result"
                  {...(mod?.traceCaption(topology, run.result) ?? { lead: '', text: '' })}
                />
              ) : (
                <p class="t-caption t-num trace-result">
                  Walking: step {run.index} of {run.result.steps}.
                </p>
              ))}
          </div>
        </div>
      )}
      <div class="view3d-footer">
        <p class="t-caption t-grey">{schlegel ? HINT_4D : HINT}</p>
        <p class={`t-caption t-num view3d-caption ${props.caption === null ? 't-grey' : ''}`}>
          {props.caption ?? 'Hover a cell to see its coordinates and lines.'}
        </p>
        {geometryCaptions(topology, props.input, ghosts, net, mod).map((c) => (
          <Caption key={c.lead} lead={c.lead} text={c.text} class="view3d-geometry" />
        ))}
      </div>
    </section>
  );
}

function coordText(topology: Topology, cell: CellId): string {
  const q = topology.coords(cell);
  if (topology instanceof TesseractSurface) {
    const { index, axis } = topology.facet(cell);
    const free = [0, 1, 2, 3].filter((k) => k !== axis).map((k) => q[k]);
    return `(${free.join(', ')}) in cube ${axisName(axis)} = ${index & 1 ? topology.n : 0}`;
  }
  return `(${q.join(', ')})`;
}

/** The captions that explain what the picture shows; every claim is about this space. */
function geometryCaptions(
  topology: Topology,
  input: SceneInput,
  ghosts: GhostChoice,
  net: boolean,
  mod: RenderModule | null,
): { lead: string; text: string }[] {
  if (topology instanceof TesseractSurface) {
    const facets = input.win?.cells.map((c) => topology.facet(c).index) ?? [];
    const crosses = facets.some((f, i) => i > 0 && f !== facets[i - 1]);
    if (net) {
      const out = [
        {
          lead: 'Net.',
          text: 'The eight cubes unfolded into 3D, each at its true shape and size. Faces that touch here are glued, and so are faces with the same letter: in 4D they are one face.',
        },
      ];
      if (crosses) {
        out.push({
          lead: 'Win line.',
          text: 'Drawn in each cube it passes through. Where it is cut, the green letters show where it leaves one cube and enters the next.',
        });
      }
      return out;
    }
    const out = [
      {
        lead: 'Edges.',
        text: 'The black lines are where three cubes meet, at 270°, not 360°. Space is curved on these edges, so lines stop.',
      },
    ];
    if (crosses) {
      out.push({
        lead: 'Win line.',
        text: 'It bends where it passes from one cube into the next. Straight on the surface: unfold the two cubes and it is a straight line.',
      });
    }
    return out;
  }
  if (!(topology instanceof CubicQuotient) || !topology.wrapped) {
    return [{ lead: 'Flat cube.', text: 'An ordinary bounded box: lines stop at its walls.' }];
  }
  if (ghosts === 'off' || mod === null) {
    return [
      {
        lead: 'One cube.',
        text: 'Lines that leave through a face come back through the glued face. Turn on ghost copies to look around the space from inside.',
      },
    ];
  }
  return [{ lead: 'Inside view.', text: mod.coverCaption(topology) }];
}
