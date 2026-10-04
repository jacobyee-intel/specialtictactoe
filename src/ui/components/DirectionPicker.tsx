import { useState } from 'preact/hooks';
import { COLORS } from '../tokens';

export type Vec3i = readonly [number, number, number];

/** Oblique projection of the 3 × 3 × 3 grid: x to the right, y back and right, z up. */
const UNIT = 28;
const DEPTH: readonly [number, number] = [12, -9];
const CX = 52;
const CY = 54;
const WIDTH = 128;
const HEIGHT = 104;

const project = ([x, y, z]: Vec3i): [number, number] => [
  CX + UNIT * x + DEPTH[0] * y,
  CY - UNIT * z + DEPTH[1] * y,
];

const DOTS: Vec3i[] = [];
for (let z = -1; z <= 1; z++) {
  for (let y = 1; y >= -1; y--) {
    for (let x = -1; x <= 1; x++) if (x !== 0 || y !== 0 || z !== 0) DOTS.push([x, y, z]);
  }
}

const neg = (v: Vec3i): Vec3i => [0 - v[0], 0 - v[1], 0 - v[2]];
const same = (a: Vec3i | null, b: Vec3i) => a !== null && a.every((v, i) => v === b[i]);
const fmt = (v: Vec3i) => `(${v.map((c) => (c < 0 ? `\u2212${-c}` : c)).join(', ')})`;

/**
 * The tracer's direction picker: a 3 × 3 × 3 grid of dots in an oblique view, the start cell
 * at the centre. Each of the 26 outer dots is a direction; opposite dots are the same line (13
 * pairs), walked the way of the dot clicked. The chosen pair is drawn as a black line through
 * the centre.
 */
export function DirectionPicker(props: {
  /** Names of the picker's three axes (x, y, z; or a tesseract cube's free axes). */
  readonly axes: readonly [string, string, string];
  readonly value: Vec3i | null;
  readonly disabled: boolean;
  readonly onPick: (v: Vec3i) => void;
}) {
  const [hover, setHover] = useState<Vec3i | null>(null);
  const v = props.value;
  const ends: [Vec3i, Vec3i][] = [
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [0, 0, 1],
    ],
  ];
  // Back dots first, so nearer dots are drawn on top.
  const order = [...DOTS].sort((a, b) => b[1] - a[1]);
  return (
    <svg
      class={`dir-picker ${props.disabled ? 'dir-picker--disabled' : ''}`}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Trace direction"
    >
      {ends.map(([a, b], i) => {
        const [x1, y1] = project(a);
        const [x2, y2] = project(b);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.grey30} stroke-width={1} />
        );
      })}
      {ends.map(([, b], i) => {
        // Each axis name sits just beyond the axis's + end, clear of the dots.
        const [x, y] = project(b.map((c) => c * (i === 1 ? 2.1 : 1.5)) as unknown as Vec3i);
        return (
          <text
            key={`l${i}`}
            x={x}
            y={y}
            class="dir-picker-axis"
            text-anchor="middle"
            dominant-baseline="central"
          >
            {props.axes[i]}
          </text>
        );
      })}
      {v !== null &&
        (() => {
          const [x1, y1] = project(neg(v));
          const [x2, y2] = project(v);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.black} stroke-width={2} />;
        })()}
      <circle cx={CX} cy={CY} r={5} fill={COLORS.white} stroke={COLORS.black} stroke-width={2} />
      {order.map((d) => {
        const [x, y] = project(d);
        const picked = same(v, d);
        const opposite = v !== null && same(neg(v), d);
        const hot = same(hover, d) && !props.disabled;
        return (
          <g
            key={d.join()}
            class="dir-picker-dot"
            data-dir={d.join(',')}
            role="button"
            aria-label={`Trace along ${fmt(d)}`}
            aria-pressed={picked ? 'true' : 'false'}
            aria-disabled={props.disabled ? 'true' : undefined}
            onClick={() => !props.disabled && props.onPick(d)}
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{fmt(d)}</title>
            <circle cx={x} cy={y} r={6.5} fill="transparent" />
            <circle
              cx={x}
              cy={y}
              r={picked || hot ? 4.5 : opposite ? 3.5 : 3}
              fill={picked || hot ? COLORS.black : opposite ? COLORS.white : COLORS.grey60}
              stroke={opposite ? COLORS.black : 'none'}
              stroke-width={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
