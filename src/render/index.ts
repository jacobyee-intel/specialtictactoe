/**
 * The 3D board (three.js). This module is loaded lazily by `<Board3D>` with a dynamic
 * `import()`, so three.js lands in its own chunk and the start and multiverse screens never
 * download it. The pure helpers the 3D view's captions need (tracer, cover captions) live here
 * too, for the same reason.
 */
export {
  BoardView,
  TRACE_CELLS_PER_SECOND,
  prefersReducedMotion,
  type BoardViewDebug,
  type TraceWalk,
  type ViewOptions,
} from './BoardView';
export {
  buildSceneModel,
  type GhostSetting,
  type SceneInput,
  type SceneModel,
  type SceneOptions,
} from './sceneModel';
export { DEFAULT_PLANES4, type Planes4 } from './four';
export { coverCaption, type GhostRange } from './cover';
export { formatDir, trace, traceCaption, type TraceEnd, type TraceResult } from './tracer';
