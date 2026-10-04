import { describe, expect, it } from 'vitest';
import {
  CubicQuotient,
  TOPOLOGY_IDS,
  TOPOLOGY_INFO,
  TesseractSurface,
  createTopology,
  isTopologyId,
} from '@/geometry';

describe('registry', () => {
  it('lists every space once, with matching ids', () => {
    expect([...TOPOLOGY_IDS].sort()).toEqual(Object.keys(TOPOLOGY_INFO).sort());
    for (const id of TOPOLOGY_IDS) expect(TOPOLOGY_INFO[id].id).toBe(id);
  });

  it('uses the agreed names', () => {
    expect(TOPOLOGY_IDS.map((id) => TOPOLOGY_INFO[id].fullName)).toEqual([
      '3-torus (torocosm)',
      'Quarter-turn space (tetracosm)',
      'First amphicosm (Klein bottle × circle)',
      'Tesseract surface',
      'Flat cube (Euclidean baseline)',
    ]);
    expect(TOPOLOGY_INFO.torus3.conwayName).toBe('torocosm');
    expect(TOPOLOGY_INFO.tetracosm.conwayName).toBe('tetracosm');
    expect(TOPOLOGY_INFO.tesseract.conwayName).toBeNull();
    expect(TOPOLOGY_INFO.flat.conwayName).toBeNull();
  });

  it('records orientability, holonomy, curvature and size ranges', () => {
    expect(TOPOLOGY_INFO.amphicosm1.orientable).toBe(false);
    expect(TOPOLOGY_IDS.filter((id) => !TOPOLOGY_INFO[id].orientable)).toEqual(['amphicosm1']);
    expect(TOPOLOGY_INFO.torus3.holonomy).toBe('trivial');
    expect(TOPOLOGY_INFO.tetracosm.holonomy).toBe('Z/4 (quarter turn about z)');
    expect(TOPOLOGY_INFO.amphicosm1.holonomy).toBe('Z/2 (reflection in x)');
    expect(TOPOLOGY_INFO.tesseract.curvature).toBe('positive on edges (cone angle 270°)');
    expect(TOPOLOGY_INFO.flat.curvature).toBe('flat, with boundary');
    expect(TOPOLOGY_INFO.tesseract.nRange).toEqual([2, 4]);
    for (const id of ['flat', 'torus3', 'tetracosm', 'amphicosm1'] as const) {
      expect(TOPOLOGY_INFO[id].nRange).toEqual([3, 6]);
    }
    for (const id of TOPOLOGY_IDS) expect(TOPOLOGY_INFO[id].blurb.length).toBeGreaterThan(20);
  });

  it('creates the right implementation', () => {
    for (const id of TOPOLOGY_IDS) {
      const t = createTopology(id, 3);
      expect(t.id).toBe(id);
      expect(t.n).toBe(3);
      expect(t).toBeInstanceOf(id === 'tesseract' ? TesseractSurface : CubicQuotient);
    }
  });

  it('recognizes topology ids', () => {
    expect(isTopologyId('tetracosm')).toBe(true);
    expect(isTopologyId('klein')).toBe(false);
    expect(isTopologyId(3)).toBe(false);
  });
});
