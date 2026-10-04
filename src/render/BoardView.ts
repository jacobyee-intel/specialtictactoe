/**
 * The imperative three.js controller behind `<Board3D>`. Preact owns the DOM around it; this
 * class owns one canvas, the camera, the controls and the board objects, and talks to the UI
 * only through {@link BoardView.setState}, {@link BoardView.setHover} and {@link BoardView.onHover}.
 *
 * ## Render on demand
 *
 * Nothing animates on its own (design-system §9), so there is no render loop: a frame is drawn
 * only when the state, the hover or the camera changes, and kept going only while the controls'
 * damping is still settling, the tesseract auto-rotates, or the tracer's walker is walking.
 *
 * ## Turning in 4D
 *
 * Shift + right-drag turns the tesseract in the XW (horizontal) and YW (vertical) planes, and
 * Shift + wheel in ZW. These events are caught on the host in the capture phase, before
 * OrbitControls sees them, so an ordinary right-drag still orbits the 3D camera. A new
 * orientation rebuilds the pure model and writes it into the existing buffers
 * (`BoardScene.refresh`), at most once per frame.
 *
 * ## One WebGL context per page
 *
 * Browsers cap live WebGL contexts (about 16) and warn when an old one is dropped, and creating
 * a context is slow. The renderer is therefore shared: each view borrows it, and on dispose
 * frees everything it uploaded and hands the canvas back. Its `info.memory` counters then return
 * to zero, which the E2E uses to check that moving between timelines does not leak.
 */
import {
  Color,
  Matrix4,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CellId, Dir } from '@/geometry';
import { COLORS } from '@/ui/tokens';
import {
  COVER_VIEW_DIR,
  DEFAULT_VIEW_DIR,
  NET_VIEW_DIR,
  FOV,
  applyFit,
  configureControls,
  fitPoints,
  type CameraFit,
} from './controls';
import { DEFAULT_PLANES4, type Planes4 } from './four';
import { createMaterials, type Materials } from './materials';
import { pickCell } from './picking';
import { GHOST_LAYER, HoverBox, buildScene, type BoardScene } from './scene';
import {
  buildSceneModel,
  type GhostSetting,
  type Placement,
  type SceneInput,
  type SceneModel,
  type Vec3,
} from './sceneModel';

/** Device pixel ratio cap: beyond 2 the cost grows with no visible gain. */
const MAX_PIXEL_RATIO = 2;
/** The tracer's walker speed. */
export const TRACE_CELLS_PER_SECOND = 6;
/** Auto-rotate speed in the XW plane (one turn in 18 s). */
const AUTO_RADIANS_PER_SECOND = Math.PI / 9;
/** Shift + drag: radians per CSS pixel; Shift + wheel: radians per wheel unit. */
const DRAG_RADIANS_PER_PX = 0.01;
const WHEEL_RADIANS_PER_UNIT = 0.002;
const TAU = 2 * Math.PI;

let shared: WebGLRenderer | null = null;
let unavailable = false;
/** The view currently holding the shared canvas (there is one 3D view per page). */
let current: BoardView | null = null;

/** The page's renderer, created on first use; null if WebGL is not available. */
function acquireRenderer(): WebGLRenderer | null {
  if (shared !== null) return shared;
  if (unavailable) return null;
  try {
    const canvas = document.createElement('canvas');
    // Probe first: three.js logs an error when context creation fails, which is noise here.
    const probe = canvas.getContext('webgl2');
    if (probe === null) throw new Error('no WebGL2');
    shared = new WebGLRenderer({ canvas, context: probe, antialias: true });
    shared.setClearColor(new Color(COLORS.white), 1);
    return shared;
  } catch {
    unavailable = true;
    return null;
  }
}

/** True when the player asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Frame-time samples kept for the debug hook (ms spent in `renderer.render`). */
const SAMPLES = 240;

/** How the space is shown; every field is optional in `setOptions`. */
export interface ViewOptions {
  readonly ghosts: GhostSetting;
  readonly net: boolean;
  /** Tesseract: the cube chosen in the 2D filter (null: all). */
  readonly facet: number | null;
  readonly planes4: Planes4;
}

const DEFAULT_OPTIONS: ViewOptions = {
  ghosts: 'off',
  net: false,
  facet: null,
  planes4: DEFAULT_PLANES4,
};

export interface TraceWalk {
  readonly cells: readonly CellId[];
  readonly dirs: readonly Dir[];
}

export interface BoardViewDebug {
  readonly camera: { position: number[]; target: number[]; zoom: number };
  readonly frames: number;
  readonly frameTimes: readonly number[];
  /** ms spent per frame rebuilding the 4D projection (model + buffer writes). */
  readonly updateTimes: readonly number[];
  readonly memory: { geometries: number; textures: number };
  readonly drawCalls: number;
  readonly hovered: CellId | null;
  readonly mode: string | null;
  readonly key: string | null;
  readonly planes4: Planes4;
  readonly autoRotate: boolean;
  readonly ghosts: { copies: number; cells: number; marks: number } | null;
  /** Ghost copies highlighted with the hovered cell. */
  readonly hoverCopies: number;
  /** The F of each copy, read back from the rendered instance matrices (world boxes). */
  readonly landmarks: { offset: number[]; boxes: { min: number[]; max: number[] }[] }[];
  readonly win: { paths: number[][][] } | null;
  readonly wires: number;
  readonly selectedCube: boolean;
  readonly tags: { text: string; kind: string; visible: boolean }[];
  readonly trace: { t: number; steps: number; walker: number[] | null; done: boolean } | null;
}

export class BoardView {
  private readonly renderer: WebGLRenderer;
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tagLayer: HTMLDivElement;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly materials: Materials;
  private readonly hoverBox: HoverBox;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly observer: ResizeObserver;
  private readonly listeners = new Set<(cell: CellId | null) => void>();
  private readonly planeListeners = new Set<(planes: Planes4) => void>();
  private readonly traceListeners = new Set<(index: number, done: boolean) => void>();
  private board: BoardScene | null = null;
  private model: SceneModel | null = null;
  private input: SceneInput | null = null;
  private options: ViewOptions = DEFAULT_OPTIONS;
  private hovered: CellId | null = null;
  /** The cell this view last reported under the pointer (so leaving reports null once). */
  private emitted: CellId | null = null;
  private fittedKey: string | null = null;
  /** True once the player moved the camera: resizes then keep their view instead of refitting. */
  private userMoved = false;
  private size = { width: 0, height: 0 };
  private frame = 0;
  private pickPending = false;
  private disposed = false;
  private frames = 0;
  private drawCalls = 0;
  private readonly frameTimes: number[] = [];
  private readonly updateTimes: number[] = [];
  /** The 4D orientation changed since the last frame: re-project before drawing. */
  private dirty4 = false;
  private autoRotate = false;
  private lastTime = 0;
  private lastPlaneReport = 0;
  private drag4: { id: number; x: number; y: number } | null = null;
  private walk: TraceWalk | null = null;
  private traceT = 0;
  private traceStart = 0;
  private traceIndex = -1;
  private traceAnimating = false;
  private tagNodes: HTMLSpanElement[] = [];

  /** Mount a view into `host`, or return null when WebGL is unavailable. */
  static create(host: HTMLElement): BoardView | null {
    const renderer = acquireRenderer();
    if (renderer === null) return null;
    current?.dispose();
    current = new BoardView(renderer, host);
    if (import.meta.env.DEV) installDebugHook();
    return current;
  }

  private constructor(renderer: WebGLRenderer, host: HTMLElement) {
    this.renderer = renderer;
    this.host = host;
    this.canvas = renderer.domElement;
    this.canvas.className = 'view3d-canvas';
    host.appendChild(this.canvas);
    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'view3d-tags';
    this.tagLayer.setAttribute('aria-hidden', 'true');
    host.appendChild(this.tagLayer);
    this.materials = createMaterials();
    this.hoverBox = new HoverBox(this.materials);
    this.scene.add(this.hoverBox.object);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.addEventListener('change', this.requestRender);
    this.controls.addEventListener('start', this.onControlStart);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    host.addEventListener('pointerdown', this.onPointerDown4, { capture: true });
    host.addEventListener('pointermove', this.onPointerMove4, { capture: true });
    host.addEventListener('pointerup', this.onPointerUp4, { capture: true });
    host.addEventListener('pointercancel', this.onPointerUp4, { capture: true });
    host.addEventListener('wheel', this.onWheel4, { capture: true, passive: false });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /**
   * Show a board. Phase A's entry point: `setInput` with the options as they are. The model is
   * rebuilt here from the input; the camera is refitted only when the view's key changes.
   */
  setState(model: SceneModel): void {
    if (this.disposed) return;
    this.install(model);
  }

  /** Show a node's board with the current options. */
  setInput(input: SceneInput): void {
    if (this.disposed) return;
    this.input = input;
    this.rebuild();
  }

  /** Change how the space is shown (ghosts, net, chosen cube, 4D orientation). */
  setOptions(options: Partial<ViewOptions>): void {
    if (this.disposed) return;
    const next = { ...this.options, ...options };
    const onlyPlanes =
      next.ghosts === this.options.ghosts &&
      next.net === this.options.net &&
      next.facet === this.options.facet;
    if (onlyPlanes && samePlanes(next.planes4, this.options.planes4)) return;
    this.options = next;
    if (onlyPlanes) {
      this.dirty4 = true;
      this.requestRender();
    } else {
      this.rebuild();
    }
  }

  get planes4(): Planes4 {
    return this.options.planes4;
  }

  /** Back to the default 4D orientation. */
  reset4D(): void {
    this.setOptions({ planes4: DEFAULT_PLANES4 });
    this.reportPlanes(true);
  }

  /** Turn the tesseract in the XW plane continuously (ignored under reduced motion). */
  setAutoRotate(on: boolean): void {
    this.autoRotate = on && !prefersReducedMotion();
    this.lastTime = 0;
    this.requestRender();
  }

  /** Listen for 4D orientation changes made in the view (drag, wheel, auto-rotate). */
  onPlanes4(listener: (planes: Planes4) => void): () => void {
    this.planeListeners.add(listener);
    return () => this.planeListeners.delete(listener);
  }

  /**
   * Show a tracer walk (or none). With `animate`, the walker goes at 6 cells per second;
   * otherwise (reduced motion) the whole walk shows at once.
   */
  setTrace(walk: TraceWalk | null, { animate = true }: { animate?: boolean } = {}): void {
    if (this.disposed) return;
    this.walk = walk;
    this.traceIndex = -1;
    this.traceT = walk === null || animate ? 0 : walk.cells.length - 1;
    this.traceAnimating = walk !== null && animate && walk.cells.length > 1;
    this.traceStart = 0;
    this.rebuild();
    this.reportTrace();
  }

  /** Listen for the walker reaching each cell of the walk (index into its cells). */
  onTraceProgress(listener: (index: number, done: boolean) => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  /** Highlight a cell hovered elsewhere (the 2D board). Does not call the hover listeners. */
  setHover(cell: CellId | null): void {
    if (this.disposed || cell === this.hovered) return;
    this.hovered = cell;
    if (this.model?.mode === 'schlegel' && this.input !== null) {
      // The hovered cube's grid is part of the model: rebuild when the cube changes.
      const facet = this.hoverFacet();
      if (facet !== this.builtHoverFacet) this.rebuild();
    }
    this.showHover();
    this.requestRender();
  }

  /** Listen for the cell under the pointer (null when it leaves the board). */
  onHover(listener: (cell: CellId | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Back to the fitted camera. */
  resetView(): void {
    this.userMoved = false;
    this.fit();
    this.requestRender();
  }

  debug(): BoardViewDebug {
    const p = this.camera.position;
    const t = this.controls.target;
    const m = this.model;
    return {
      camera: { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], zoom: p.distanceTo(t) },
      frames: this.frames,
      frameTimes: [...this.frameTimes],
      updateTimes: [...this.updateTimes],
      memory: { ...this.renderer.info.memory },
      drawCalls: this.drawCalls,
      hovered: this.hovered,
      mode: m?.mode ?? null,
      key: m?.key ?? null,
      planes4: { ...this.options.planes4 },
      autoRotate: this.autoRotate,
      ghosts:
        m?.ghosts == null
          ? null
          : {
              copies: m.ghosts.offsets.length,
              cells: this.board?.parts.cells !== undefined ? m.ghosts.cells.length : 0,
              marks: (this.board?.parts.ghostMarks ?? []).reduce(
                (s, x) => s + ((x.geometry.userData as { copies?: number }).copies ?? 0),
                0,
              ),
            },
      hoverCopies: this.hoverBox.copyCount,
      landmarks: this.readLandmarks(),
      win: m?.win == null ? null : { paths: m.win.paths.map((path) => path.map((q) => [...q])) },
      wires: (m?.wires.length ?? 0) / 6,
      selectedCube: m?.selectedOutline != null,
      tags: (m?.tags ?? []).map((tag, i) => ({
        text: tag.text,
        kind: tag.kind,
        visible: this.tagNodes[i]?.style.display !== 'none',
      })),
      trace:
        this.walk === null
          ? null
          : {
              t: this.traceT,
              steps: this.walk.cells.length - 1,
              walker: this.walkerPos === null ? null : [...this.walkerPos],
              done: !this.traceAnimating,
            },
    };
  }

  /** Client (page) coordinates of a scene point, for the E2E (null when off screen). */
  screenOf(pos: readonly number[]): { x: number; y: number } | null {
    const v = this.projected.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0).project(this.camera);
    if (v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  /** A cell's scene position (E2E). */
  debugCell(cell: CellId): Vec3 | null {
    return this.model?.cells[cell]?.pos ?? null;
  }

  /** Every ghost cell with its source cell, copy offset and screen point (E2E). */
  ghostScreen(): { cell: CellId; offset: number[]; x: number; y: number }[] {
    const g = this.model?.ghosts;
    if (g == null) return [];
    const per = this.model === null ? 1 : this.model.cells.length;
    return g.cells.flatMap((c, i) => {
      const at = this.screenOf(c.pos);
      const offset = g.offsets[Math.floor(i / per)] ?? [0, 0, 0];
      return at === null ? [] : [{ cell: c.cell, offset: [...offset], ...at }];
    });
  }

  /** Free everything this view created and hand the shared canvas back. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.dispose();
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.removeEventListener('pointerdown', this.onPointerDown4, { capture: true });
    this.host.removeEventListener('pointermove', this.onPointerMove4, { capture: true });
    this.host.removeEventListener('pointerup', this.onPointerUp4, { capture: true });
    this.host.removeEventListener('pointercancel', this.onPointerUp4, { capture: true });
    this.host.removeEventListener('wheel', this.onWheel4, { capture: true });
    this.board?.dispose();
    this.board = null;
    this.hoverBox.dispose();
    this.materials.dispose();
    this.renderer.renderLists.dispose();
    this.listeners.clear();
    this.planeListeners.clear();
    this.traceListeners.clear();
    this.tagLayer.remove();
    if (this.canvas.parentElement === this.host) this.canvas.remove();
    if (current === this) current = null;
  }

  // --- internals ---------------------------------------------------------------------------

  private builtHoverFacet: number | null = null;
  private walkerPos: Vec3 | null = null;

  private hoverFacet(): number | null {
    const input = this.input;
    if (input === null || this.hovered === null || input.topology.id !== 'tesseract') return null;
    return Math.floor(this.hovered / input.topology.n ** 3);
  }

  /** Build the model from the input and options, and show it (refreshing in place if it can). */
  private rebuild(): void {
    const input = this.input;
    if (input === null) return;
    const start = performance.now();
    this.builtHoverFacet = this.options.net ? null : this.hoverFacet();
    const model = buildSceneModel(input, {
      ghosts: this.options.ghosts,
      net: this.options.net,
      facet: this.options.facet,
      hoverFacet: this.builtHoverFacet,
      planes4: this.options.planes4,
      trace: this.walk,
    });
    this.install(model);
    this.updateTimes.push(performance.now() - start);
    if (this.updateTimes.length > SAMPLES) this.updateTimes.shift();
  }

  private install(model: SceneModel): void {
    this.model = model;
    if (this.board === null || !this.board.refresh(model)) {
      this.board?.dispose();
      this.board = buildScene(model, this.materials);
      this.scene.add(this.board.root);
      this.buildTags(model);
    }
    this.walkerPos = this.board.showTrace(this.traceT);
    if (model.key !== this.fittedKey) {
      this.userMoved = false;
      this.fit();
    }
    this.showHover();
    this.requestRender();
  }

  private buildTags(model: SceneModel): void {
    for (const node of this.tagNodes) node.remove();
    this.tagNodes = model.tags.map((tag) => {
      const span = document.createElement('span');
      span.className = `view3d-tag view3d-tag--${tag.kind}`;
      span.textContent = tag.text;
      this.tagLayer.appendChild(span);
      return span;
    });
  }

  private readonly projected = new Vector3();

  /** Move the HTML tags to their projected points (after the camera is final for the frame). */
  private placeTags(): void {
    const tags = this.model?.tags ?? [];
    if (tags.length === 0) return;
    const { width, height } = this.size;
    tags.forEach((tag, i) => {
      const node = this.tagNodes[i];
      if (node === undefined) return;
      const v = this.projected.set(...tag.pos).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      node.style.display = visible ? '' : 'none';
      if (!visible) return;
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    });
  }

  private readLandmarks(): BoardViewDebug['landmarks'] {
    const m = this.model;
    const meshes = this.board?.parts.landmark;
    if (m === null || meshes == null) return [];
    const solid = (i: number) => {
      const mat = new Matrix4();
      meshes[0].getMatrixAt(i, mat);
      const e = mat.elements;
      const c = [e[12] as number, e[13] as number, e[14] as number];
      const s = [e[0] as number, e[5] as number, e[10] as number].map(Math.abs);
      return {
        min: c.map((v, k) => v - (s[k] as number) / 2),
        max: c.map((v, k) => v + (s[k] as number) / 2),
      };
    };
    // The ghost Fs are baked: read each box back from its block of vertices.
    const pos = meshes[1].geometry.getAttribute('position');
    const per = (meshes[1].geometry.userData as { verticesPerCopy: number }).verticesPerCopy;
    const baked = (i: number) => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let k = i * per; k < (i + 1) * per; k++) {
        const v = [pos.getX(k), pos.getY(k), pos.getZ(k)];
        v.forEach((x, a) => {
          min[a] = Math.min(min[a] as number, x);
          max[a] = Math.max(max[a] as number, x);
        });
      }
      return { min, max };
    };
    return m.landmark.map((copy, ci) => ({
      offset: [...copy.offset],
      boxes: copy.boxes.map((_, bi) => (ci === 0 ? solid(bi) : baked((ci - 1) * 3 + bi))),
    }));
  }

  private fit(): void {
    if (this.model === null || this.size.width === 0 || this.size.height === 0) return;
    const fit: CameraFit = fitPoints(this.model.fitPoints, {
      aspect: this.size.width / this.size.height,
      direction:
        this.model.mode === 'cover'
          ? COVER_VIEW_DIR
          : this.model.mode === 'net'
            ? NET_VIEW_DIR
            : DEFAULT_VIEW_DIR,
      // The Schlegel ball already bounds every 4D orientation, and the net is fitted to its
      // cubes' corners, so both need only a small margin (the tags sit inside the faces).
      ...(this.model.mode === 'schlegel' || this.model.mode === 'net' ? { margin: 0.04 } : {}),
    });
    applyFit(this.camera, fit);
    configureControls(this.controls, fit);
    this.fittedKey = this.model.key;
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.materials.setResolution(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved || this.fittedKey === null) this.fit();
    this.requestRender();
  }

  private showHover(): void {
    const m = this.model;
    const at = this.hovered === null ? null : (m?.cells[this.hovered] ?? null);
    const table = this.board?.ghostTable;
    const copies: Placement[] = [];
    if (at !== null && table != null && m?.ghosts != null) {
      for (const id of table.instancesOf(at.cell)) {
        const g = m.ghosts.cells[id];
        if (g !== undefined) copies.push(g);
      }
    }
    this.hoverBox.show(at, copies);
  }

  private readonly requestRender = (): void => {
    if (this.frame === 0 && !this.disposed) this.frame = requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (now: number): void => {
    this.frame = 0;
    if (this.disposed || this.size.width === 0 || this.model === null) return;
    const dt = this.lastTime === 0 ? 0 : Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const turning = this.autoRotate && this.model.mode === 'schlegel';
    if (turning && dt > 0) {
      const p = this.options.planes4;
      this.options = {
        ...this.options,
        planes4: { ...p, xw: wrap(p.xw + dt * AUTO_RADIANS_PER_SECOND) },
      };
      this.dirty4 = true;
      this.reportPlanes(false);
    }
    if (this.dirty4) {
      this.dirty4 = false;
      if (this.model.mode === 'schlegel') this.rebuild();
    }
    if (this.traceAnimating && this.walk !== null) {
      if (this.traceStart === 0) this.traceStart = now;
      const steps = this.walk.cells.length - 1;
      this.traceT = Math.min(steps, ((now - this.traceStart) / 1000) * TRACE_CELLS_PER_SECOND);
      if (this.traceT >= steps) this.traceAnimating = false;
      this.walkerPos = this.board?.showTrace(this.traceT) ?? null;
      this.reportTrace();
    }
    // With damping on, `update` keeps moving the camera for a few frames after a drag.
    const moving = this.controls.update();
    this.placeTags();
    const start = performance.now();
    this.draw();
    const elapsed = performance.now() - start;
    this.frames++;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > SAMPLES) this.frameTimes.shift();
    if (moving || turning || this.traceAnimating) this.requestRender();
    else this.lastTime = 0;
  };

  /**
   * One frame. With ghost copies, two passes: the ghost layer, then (depth cleared) the board,
   * so the fundamental cube is always drawn over its copies.
   */
  private draw(): void {
    const r = this.renderer;
    const info = r.info;
    info.autoReset = false;
    info.reset();
    r.autoClear = false;
    r.clear();
    if (this.model?.mode === 'cover') {
      this.camera.layers.set(GHOST_LAYER);
      r.render(this.scene, this.camera);
      r.clearDepth();
    }
    this.camera.layers.set(0);
    r.render(this.scene, this.camera);
    this.drawCalls = info.render.calls;
  }

  private reportTrace(): void {
    if (this.walk === null) return;
    const index = Math.floor(this.traceT + 1e-9);
    const done = !this.traceAnimating;
    if (index === this.traceIndex && !done) return;
    if (index === this.traceIndex && done && this.reportedDone) return;
    this.traceIndex = index;
    this.reportedDone = done;
    for (const listener of this.traceListeners) listener(index, done);
  }

  private reportedDone = false;

  private reportPlanes(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPlaneReport < 50) return;
    this.lastPlaneReport = now;
    const planes = this.options.planes4;
    for (const listener of this.planeListeners) listener(planes);
  }

  private turn(delta: Partial<Record<'xw' | 'yw' | 'zw', number>>): void {
    const p = this.options.planes4;
    this.setOptions({
      planes4: {
        ...p,
        xw: wrap(p.xw + (delta.xw ?? 0)),
        yw: wrap(p.yw + (delta.yw ?? 0)),
        zw: wrap(p.zw + (delta.zw ?? 0)),
      },
    });
    this.reportPlanes(false);
  }

  private readonly onPointerDown4 = (event: PointerEvent): void => {
    if (!event.shiftKey || event.button !== 2 || this.model?.mode !== 'schlegel') return;
    event.preventDefault();
    event.stopPropagation();
    this.drag4 = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.host.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove4 = (event: PointerEvent): void => {
    const drag = this.drag4;
    if (drag === null || event.pointerId !== drag.id) return;
    event.stopPropagation();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    this.drag4 = { ...drag, x: event.clientX, y: event.clientY };
    this.turn({ xw: dx * DRAG_RADIANS_PER_PX, yw: dy * DRAG_RADIANS_PER_PX });
  };

  private readonly onPointerUp4 = (event: PointerEvent): void => {
    if (this.drag4 === null || event.pointerId !== this.drag4.id) return;
    event.stopPropagation();
    this.drag4 = null;
    this.host.releasePointerCapture?.(event.pointerId);
    this.reportPlanes(true);
  };

  private readonly onWheel4 = (event: WheelEvent): void => {
    if (!event.shiftKey || this.model?.mode !== 'schlegel') return;
    event.preventDefault();
    event.stopPropagation();
    // Some platforms turn Shift + wheel into a horizontal scroll.
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    this.turn({ zw: delta * WHEEL_RADIANS_PER_UNIT });
    this.reportPlanes(true);
  };

  private readonly onControlStart = (): void => {
    this.userMoved = true;
  };

  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  private readonly onPointerMove = (event: PointerEvent): void => {
    // While a button is down the player is orbiting or panning, not pointing.
    if (event.buttons !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (this.pickPending) return;
    this.pickPending = true;
    requestAnimationFrame(() => {
      this.pickPending = false;
      if (!this.disposed) this.pick();
    });
  };

  private readonly onPointerLeave = (): void => this.emit(null);

  private pick(): void {
    if (this.board === null) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const cell = pickCell(
      this.board.pickLayers.map(({ mesh, table }) => ({
        table,
        hits: mesh.count === 0 ? [] : this.raycaster.intersectObject(mesh, false),
      })),
    );
    this.setHover(cell);
    this.emit(cell);
  }

  private emit(cell: CellId | null): void {
    if (cell === this.emitted) return;
    this.emitted = cell;
    for (const listener of this.listeners) listener(cell);
  }
}

const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

const samePlanes = (a: Planes4, b: Planes4) =>
  a.xw === b.xw &&
  a.yw === b.yw &&
  a.zw === b.zw &&
  (a.xy ?? 0) === (b.xy ?? 0) &&
  (a.xz ?? 0) === (b.xz ?? 0) &&
  (a.yz ?? 0) === (b.yz ?? 0);

/**
 * Dev-only test hook: `window.__board3d.view()` is the live view (camera, frame times, mode, 4D
 * angles, ghosts, landmarks, tracer) and `memory()` the shared renderer's live GPU resources,
 * which must return to zero between views. `set4D` and `autoRotate` drive the 4D view.
 */
function installDebugHook(): void {
  const w = window as unknown as { __board3d?: object };
  w.__board3d ??= {
    view: () => current?.debug() ?? null,
    memory: () => (shared === null ? null : { ...shared.info.memory }),
    set4D: (planes: Partial<Planes4>) =>
      current?.setOptions({ planes4: { ...(current?.planes4 ?? DEFAULT_PLANES4), ...planes } }),
    autoRotate: (on: boolean) => current?.setAutoRotate(on),
    screenOf: (pos: number[]) => current?.screenOf(pos) ?? null,
    cellScreen: (cell: number) => {
      const at = current?.debugCell(cell);
      return at == null ? null : (current?.screenOf(at) ?? null);
    },
    ghostScreen: () => current?.ghostScreen() ?? [],
  };
}
