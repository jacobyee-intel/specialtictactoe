/**
 * The 3D board (three.js). This module is loaded lazily by `<Board3D>` with a dynamic
 * `import()`, so three.js lands in its own chunk and the start and multiverse screens never
 * download it.
 */
export { BoardView, type BoardViewDebug } from './BoardView';
export { buildSceneModel, type SceneInput, type SceneModel, type SceneOptions } from './sceneModel';
