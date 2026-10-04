/** Pure topology and line math with no DOM dependencies. */
export { mod } from './math';
export type { CellId, Dir, Layout2D, Player, StepResult, Topology, TopologyId } from './types';
export { DIRECTIONS_3D, dir3, dir4, internDir, isUnitDir, negateDir } from './directions';
export {
  CubicQuotient,
  applyAffine,
  applyLinear,
  composeAffine,
  type Affine3,
  type CubicTopologyId,
} from './cubic';
export { TesseractSurface, type Facet } from './tesseract';
export { buildLineIndex, lineCells, linesThroughCell, type LineIndex } from './lines';
export { EMPTY, completesLine, isFull, markOf, openLines, threats, type Threat } from './analysis';
export {
  TOPOLOGY_IDS,
  TOPOLOGY_INFO,
  createTopology,
  isTopologyId,
  type TopologyInfo,
} from './registry';
