import { useEffect, useRef, useState } from 'preact/hooks';
import type { CellId } from '@/engine';
import type { BoardView, SceneInput } from '@/render';
import { Button } from './Button';

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

/**
 * The 3D view of a node's board (Stage 7). A thin Preact shell around the imperative
 * `BoardView`: it lazy-loads the render module, mounts the view, and forwards the board, the
 * shared hover and the view's own hover. Left-click does nothing here; every action stays on the
 * 2D board.
 */
export function Board3D(props: {
  /** The node's board; its identity must change only when the board does (it is rebuilt). */
  readonly input: SceneInput;
  readonly hovered: CellId | null;
  readonly onHover: (cell: CellId | null) => void;
  /** The hover caption, shared with the 2D board. */
  readonly caption: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mod, setMod] = useState<RenderModule | null>(null);
  const [view, setView] = useState<BoardView | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const onHover = useRef(props.onHover);
  onHover.current = props.onHover;

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
    const off = v.onHover((cell) => onHover.current(cell));
    return () => {
      off();
      v.dispose();
      setView(null);
    };
  }, [mod]);

  useEffect(() => {
    if (mod !== null && view !== null) view.setState(mod.buildSceneModel(props.input));
  }, [mod, view, props.input]);

  useEffect(() => view?.setHover(props.hovered), [view, props.hovered]);

  const message =
    status === 'unavailable'
      ? 'The 3D view needs WebGL, which this browser does not provide. The 2D board has everything.'
      : status === 'failed'
        ? 'The 3D view could not be loaded. The 2D board has everything.'
        : null;

  return (
    <section class="view3d" aria-label="3D board">
      <div class="view3d-header">
        <Button class="btn--small" onClick={() => view?.resetView()}>
          Reset view
        </Button>
      </div>
      <div
        class={`view3d-host ${status === 'ready' ? '' : 'view3d-host--empty'}`}
        ref={hostRef}
        data-status={status}
      >
        {message !== null && <p class="t-body measure view3d-message">{message}</p>}
      </div>
      <div class="view3d-footer">
        <p class="t-caption t-grey">{HINT}</p>
        <p class={`t-caption t-num view3d-caption ${props.caption === null ? 't-grey' : ''}`}>
          {props.caption ?? 'Hover a cell to see its coordinates and lines.'}
        </p>
      </div>
    </section>
  );
}
