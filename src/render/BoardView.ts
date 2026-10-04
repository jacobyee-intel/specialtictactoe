/**
 * The imperative three.js controller behind `<Board3D>`. Preact owns the DOM around it; this
 * class owns one canvas, the camera, the controls and the board objects, and talks to the UI
 * only through {@link BoardView.setState}, {@link BoardView.setHover} and {@link BoardView.onHover}.
 *
 * ## Render on demand
 *
 * Nothing animates on its own (design-system §9), so there is no render loop: a frame is drawn
 * only when the state, the hover or the camera changes, and kept going only while the controls'
 * damping is still settling.
 *
 * ## One WebGL context per page
 *
 * Browsers cap live WebGL contexts (about 16) and warn when an old one is dropped, and creating
 * a context is slow. The renderer is therefore shared: each view borrows it, and on dispose
 * frees everything it uploaded and hands the canvas back. Its `info.memory` counters then return
 * to zero, which the E2E uses to check that moving between timelines does not leak.
 */
import { PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer, Color } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CellId } from '@/geometry';
import { COLORS } from '@/ui/tokens';
import { FOV, applyFit, configureControls, fitCube, type CameraFit } from './controls';
import { createMaterials, type Materials } from './materials';
import { pickCell } from './picking';
import { HoverBox, buildScene, type BoardScene } from './scene';
import type { SceneModel } from './sceneModel';

/** Device pixel ratio cap: beyond 2 the cost grows with no visible gain. */
const MAX_PIXEL_RATIO = 2;

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

/** Frame-time samples kept for the debug hook (ms spent in `renderer.render`). */
const SAMPLES = 240;

export interface BoardViewDebug {
  readonly camera: { position: number[]; target: number[]; zoom: number };
  readonly frames: number;
  readonly frameTimes: readonly number[];
  readonly memory: { geometries: number; textures: number };
  readonly drawCalls: number;
  readonly hovered: CellId | null;
}

export class BoardView {
  private readonly renderer: WebGLRenderer;
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly materials: Materials;
  private readonly hoverBox: HoverBox;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly observer: ResizeObserver;
  private readonly listeners = new Set<(cell: CellId | null) => void>();
  private board: BoardScene | null = null;
  private model: SceneModel | null = null;
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
    this.materials = createMaterials();
    this.hoverBox = new HoverBox(this.materials);
    this.scene.add(this.hoverBox.object);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.addEventListener('change', this.requestRender);
    this.controls.addEventListener('start', this.onControlStart);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** Show a board. The camera is refitted only when the space or its size changes. */
  setState(model: SceneModel): void {
    if (this.disposed) return;
    this.board?.dispose();
    this.model = model;
    this.board = buildScene(model, this.materials);
    this.scene.add(this.board.root);
    if (model.key !== this.fittedKey) {
      this.userMoved = false;
      this.fit();
    }
    this.showHover();
    this.requestRender();
  }

  /** Highlight a cell hovered elsewhere (the 2D board). Does not call the hover listeners. */
  setHover(cell: CellId | null): void {
    if (this.disposed || cell === this.hovered) return;
    this.hovered = cell;
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
    return {
      camera: { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], zoom: p.distanceTo(t) },
      frames: this.frames,
      frameTimes: [...this.frameTimes],
      memory: { ...this.renderer.info.memory },
      drawCalls: this.drawCalls,
      hovered: this.hovered,
    };
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
    this.board?.dispose();
    this.board = null;
    this.hoverBox.dispose();
    this.materials.dispose();
    this.renderer.renderLists.dispose();
    this.listeners.clear();
    if (this.canvas.parentElement === this.host) this.canvas.remove();
    if (current === this) current = null;
  }

  // --- internals ---------------------------------------------------------------------------

  private fit(): void {
    if (this.model === null || this.size.width === 0 || this.size.height === 0) return;
    const fit: CameraFit = fitCube(this.model.bounds, {
      aspect: this.size.width / this.size.height,
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
    const at = this.hovered === null ? null : (this.model?.cells[this.hovered] ?? null);
    this.hoverBox.show(at);
  }

  private readonly requestRender = (): void => {
    if (this.frame === 0 && !this.disposed) this.frame = requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (): void => {
    this.frame = 0;
    if (this.disposed || this.size.width === 0 || this.model === null) return;
    // With damping on, `update` keeps moving the camera for a few frames after a drag.
    const moving = this.controls.update();
    const start = performance.now();
    this.renderer.render(this.scene, this.camera);
    const elapsed = performance.now() - start;
    this.drawCalls = this.renderer.info.render.calls;
    this.frames++;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > SAMPLES) this.frameTimes.shift();
    if (moving) this.requestRender();
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

/**
 * Dev-only test hook: `window.__board3d.view()` is the live view (camera state, frame times) and
 * `memory()` the shared renderer's live GPU resources, which must return to zero between views.
 */
function installDebugHook(): void {
  const w = window as unknown as { __board3d?: object };
  w.__board3d ??= {
    view: () => current?.debug() ?? null,
    memory: () => (shared === null ? null : { ...shared.info.memory }),
  };
}
