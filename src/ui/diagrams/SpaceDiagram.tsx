/**
 * The start screen's graphic (design-system §8): the selected space's fundamental cube as an
 * axonometric line drawing, hand-authored in SVG.
 *
 * - Wrapped spaces: the three hidden faces are pulled out of the cube (an exploded view), so
 *   every glued pair shows both of its arrows without overlap. Pair a/b/c = x/y/z faces.
 * - Flat cube: the plain cube; its faces are walls.
 * - Tesseract: a Schlegel diagram, an inner cube inside an outer cube with matching corners
 *   joined, which shows the 8 cubic cells of the hypercube's surface.
 *
 * All drawings share one viewBox and one cube position, so switching spaces never moves the
 * cube; only the gluing changes. Strokes do not scale with the SVG, so lines stay exactly 2 px
 * and 1 px at any width.
 */
import type { JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TOPOLOGY_INFO, type TopologyId } from '@/geometry';
import { COLORS } from '../tokens';
import { ARROW_GLYPH, GLUING_CAPTION, gluedPairs, type FaceFrame, type GluedPair } from './gluing';
import {
  CUBE_EDGES,
  CUBE_VERTICES,
  add,
  faceMatrix,
  isHiddenEdge,
  pathD,
  project,
  round,
  scale,
  viewDeg,
  type Point2,
  type Vec3,
  type View,
} from './iso';

/** Near-isometric, turned enough that the hidden back corner clears the front one. */
const VIEW: View = viewDeg(36, 30);
/** Cube edge length, in viewBox units (≈ px at the usual column width). */
const EDGE = 172;
/** How far the hidden faces are pulled out of the cube, in cube edges. */
const EXPLODE = 0.95;
/** Size of the tesseract's inner cube relative to the outer one. */
const INNER = 0.42;
const PAD = 24;

const AXIS: Readonly<Record<GluedPair['axis'], Vec3>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

const raw = (p: Vec3): Point2 => project(scale(p, EDGE), VIEW);

/** The viewBox: the exploded drawing's extent, so the cube sits in the same place for all spaces. */
const BOX = (() => {
  const pts: Point2[] = [];
  for (const v of CUBE_VERTICES) {
    pts.push(raw(v));
    for (const a of Object.values(AXIS)) pts.push(raw(add(v, scale(a, -EXPLODE))));
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  return {
    minX,
    minY,
    width: Math.max(...xs) + PAD - minX,
    height: Math.max(...ys) + PAD - minY,
  };
})();

/** World point (cube units) → viewBox point. */
const P = (p: Vec3): Point2 => {
  const q = raw(p);
  return { x: q.x - BOX.minX, y: q.y - BOX.minY };
};

const corner = (i: number): Vec3 => CUBE_VERTICES[i] as Vec3;

function frameCorners(f: FaceFrame): Vec3[] {
  return [f.origin, add(f.origin, f.U), add(add(f.origin, f.U), f.V), add(f.origin, f.V)];
}

function shift(f: FaceFrame, by: Vec3): FaceFrame {
  return { ...f, origin: add(f.origin, by) };
}

/** The SVG matrix that paints face-local (u, v) coordinates onto frame `f`. */
function matrixOf(f: FaceFrame): string {
  const m = faceMatrix(scale(f.origin, EDGE), scale(f.U, EDGE), scale(f.V, EDGE), VIEW);
  const [a, b, c, d, e, g] = m;
  return `matrix(${[a, b, c, d, e - BOX.minX, g - BOX.minY].map((n) => round(n, 3)).join(' ')})`;
}

const GLYPH_POINTS = ARROW_GLYPH.map(([u, v]) => `${u},${v}`).join(' ');

/**
 * Where each pair's letter sits on its visible face, in world coordinates: near a corner, clear
 * of the arrow and the edges. The pulled-out partner face gets the same point, shifted with it.
 * Letters belong to the face, not to the arrow, so they do not move when the arrow turns.
 */
const LETTER_AT: Readonly<Record<GluedPair['axis'], Vec3>> = {
  x: [1, 0.16, 0.84],
  y: [0.84, 1, 0.84],
  z: [0.18, 0.82, 1],
};

function Arrow({ frame }: { frame: FaceFrame }) {
  return <polygon points={GLYPH_POINTS} transform={matrixOf(frame)} fill={COLORS.p1} />;
}

function Letter({ at, letter }: { at: Vec3; letter: string }) {
  const p = P(at);
  return (
    <text
      x={round(p.x)}
      y={round(p.y)}
      class="diagram-letter"
      text-anchor="middle"
      dominant-baseline="central"
    >
      {letter}
    </text>
  );
}

function Edge(props: { from: Vec3; to: Vec3; hidden?: boolean; thin?: boolean }) {
  const a = P(props.from);
  const b = P(props.to);
  return (
    <line
      x1={round(a.x)}
      y1={round(a.y)}
      x2={round(b.x)}
      y2={round(b.y)}
      class={props.hidden ? 'diagram-hidden' : props.thin ? 'diagram-thin' : 'diagram-edge'}
    />
  );
}

/** The three faces of the unit cube that face the eye, as corner index quads. */
const FRONT_FACES: readonly (readonly number[])[] = [
  [1, 3, 7, 5], // x = 1
  [2, 3, 7, 6], // y = 1
  [4, 5, 7, 6], // z = 1
];

/**
 * A cube given by its minimum corner and size, hidden edges dashed. When `opaque`, its front
 * faces are filled white, so whatever lies behind the cube (the pulled-out back faces) is
 * occluded and reads as being behind it.
 */
function Cube(props: { at?: Vec3; size?: number; opaque?: boolean }) {
  const { at = [0, 0, 0], size = 1 } = props;
  const v = (i: number) => add(at, scale(corner(i), size));
  const edges = [...CUBE_EDGES].sort((e, f) => +isHiddenEdge(f, VIEW) - +isHiddenEdge(e, VIEW));
  return (
    <g>
      {props.opaque &&
        FRONT_FACES.map((quad, i) => (
          <path
            key={i}
            d={pathD(
              quad.map((q) => P(v(q))),
              true,
            )}
            class="diagram-fill"
          />
        ))}
      {edges.map((e) => (
        <Edge key={`${e[0]}-${e[1]}`} from={v(e[0])} to={v(e[1])} hidden={isHiddenEdge(e, VIEW)} />
      ))}
    </g>
  );
}

/** Leftmost x of the unit cube's silhouette, in viewBox units. */
const CUBE_LEFT = Math.min(...CUBE_VERTICES.map((v) => P(v).x));

/**
 * A 12 px label to the left of the cube with a horizontal 1 px leader ending in a dot on
 * `target` (a point on the cube's outline, so the leader crosses nothing).
 */
function Callout(props: { text: string; target: Vec3 }) {
  const t = P(props.target);
  const end = CUBE_LEFT - 32;
  return (
    <g>
      <line x1={round(end)} y1={round(t.y)} x2={round(t.x)} y2={round(t.y)} class="diagram-thin" />
      <circle cx={round(t.x)} cy={round(t.y)} r={3} fill={COLORS.black} />
      <text
        x={round(end - 8)}
        y={round(t.y)}
        class="diagram-callout"
        text-anchor="end"
        dominant-baseline="central"
      >
        {props.text}
      </text>
    </g>
  );
}

function GluedCube({ pairs }: { pairs: GluedPair[] }) {
  return (
    <g>
      {pairs.map((pair) => {
        const out = scale(AXIS[pair.axis], -EXPLODE);
        const plate = shift(pair.near, out);
        const plateCorners = frameCorners(plate);
        const faceCorners = frameCorners(pair.near);
        return (
          <g key={pair.letter}>
            {faceCorners.map((c, i) => (
              <line
                key={i}
                x1={round(P(c).x)}
                y1={round(P(c).y)}
                x2={round(P(plateCorners[i] as Vec3).x)}
                y2={round(P(plateCorners[i] as Vec3).y)}
                class="diagram-leader"
              />
            ))}
            <path d={pathD(plateCorners.map(P), true)} class="diagram-plate" />
            <Arrow frame={plate} />
            <Letter
              at={add(LETTER_AT[pair.axis], add(out, scale(AXIS[pair.axis], -1)))}
              letter={pair.letter}
            />
          </g>
        );
      })}
      <Cube opaque />
      {pairs.map((pair) => (
        <g key={pair.letter}>
          <Arrow frame={pair.far} />
          <Letter at={LETTER_AT[pair.axis]} letter={pair.letter} />
        </g>
      ))}
    </g>
  );
}

function FlatCube() {
  return (
    <g>
      <Cube />
      <Callout text="boundary" target={[1, 0.2, 0.55]} />
    </g>
  );
}

function Schlegel() {
  const lo = (1 - INNER) / 2;
  const inner = (i: number) => add([lo, lo, lo], scale(corner(i), INNER));
  return (
    <g>
      {CUBE_VERTICES.map((_, i) => (
        <Edge key={i} from={corner(i)} to={inner(i)} thin={i !== 0} hidden={i === 0} />
      ))}
      <Cube />
      <Cube at={[lo, lo, lo]} size={INNER} />
      <Callout text="edge" target={[1, 0, 0.5]} />
    </g>
  );
}

interface Description {
  /** Accessible description of the drawing. */
  readonly label: string;
  /** Legend rows: key, subject, how it is glued. */
  readonly rows: readonly (readonly [string, string, string])[];
}

function describe(id: TopologyId): Description {
  const name = TOPOLOGY_INFO[id].displayName;
  if (id === 'flat') {
    return {
      label: `${name}: a plain cube whose faces are walls.`,
      rows: [['', 'All faces', 'boundary']],
    };
  }
  if (id === 'tesseract') {
    return {
      label: `${name}: an inner cube inside an outer cube with matching corners joined, 8 cubes in all.`,
      rows: [['', '8 cubes', 'edges blocked']],
    };
  }
  const pairs = gluedPairs(id);
  return {
    label: `${name}: ${pairs.map((p) => `faces ${p.letter} glued ${GLUING_CAPTION[p.kind]}`).join(', ')}.`,
    rows: pairs.map((p) => [p.letter, `${p.axis} faces`, GLUING_CAPTION[p.kind]]),
  };
}

/**
 * ViewBox units per screen pixel of the rendered SVG. Strokes opt out of scaling with
 * `vector-effect`, but text cannot, so labels are sized by this factor (the `--u` CSS variable)
 * to stay 12 px however wide the column is.
 */
function useUnitsPerPixel(): [RefObject<SVGSVGElement | null>, number] {
  const ref = useRef<SVGSVGElement>(null);
  const [unit, setUnit] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setUnit(BOX.width / width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, unit];
}

export function SpaceDiagram({ topology }: { topology: TopologyId }) {
  const { label, rows } = describe(topology);
  const [svgRef, unit] = useUnitsPerPixel();
  let drawing: JSX.Element;
  if (topology === 'flat') drawing = <FlatCube />;
  else if (topology === 'tesseract') drawing = <Schlegel />;
  else drawing = <GluedCube pairs={gluedPairs(topology)} />;
  const viewBox = [0, 0, BOX.width, BOX.height].map((n) => round(n)).join(' ');

  return (
    <figure class="diagram">
      <svg
        ref={svgRef}
        class="diagram-svg"
        viewBox={viewBox}
        role="img"
        aria-label={label}
        style={`--u: ${round(unit, 3)}`}
      >
        {drawing}
      </svg>
      <figcaption>
        <dl class="diagram-legend">
          {rows.map(([key, subject, gluing]) => (
            <div key={subject} class="diagram-legend-row">
              <dt class="t-bold">{key}</dt>
              <dd>{subject}</dd>
              <dd>{gluing}</dd>
            </div>
          ))}
        </dl>
      </figcaption>
    </figure>
  );
}
