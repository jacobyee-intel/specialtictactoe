import { signal } from '@preact/signals';
import { TOPOLOGY_IDS, TOPOLOGY_INFO, type TopologyId } from '@/geometry';
import { Button, ButtonLink } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { Stepper } from '../components/Stepper';
import { SpaceDiagram } from '../diagrams/SpaceDiagram';
import { README_URL, VIDEO_URL } from '../links';
import { navigate } from '../router';
import {
  cellCount,
  clampForTopology,
  fieldRange,
  formErrors,
  initialInput,
  setField,
  startBlocker,
  stepField,
  winningLineCount,
  type NumberField,
  type StartInput,
} from '../startForm';
import { game, startGame } from '../store';

/**
 * The form lives outside the component so it survives a trip into a game and back: after
 * quitting, the previous settings are still there.
 */
const form = signal<StartInput>(initialInput());

const SPACE_OPTIONS = TOPOLOGY_IDS.map((id) => ({ value: id, label: TOPOLOGY_INFO[id].fullName }));

const STEPPERS: readonly { field: NumberField; name: string; label: string; bigStep: number }[] = [
  { field: 'n', name: 'N', label: 'Cells per side', bigStep: 1 },
  { field: 'm', name: 'M', label: 'In a row to win', bigStep: 1 },
  { field: 'w', name: 'W', label: 'Timelines to win', bigStep: 1 },
  { field: 'l', name: 'L', label: 'Round limit', bigStep: 5 },
];

const fmt = new Intl.NumberFormat('en-US');

function Fact(props: { lead: string; children: string }) {
  return (
    <p>
      <span class="t-bold">{props.lead}.</span> {props.children}
    </p>
  );
}

function SpaceFacts({ input, nOk }: { input: StartInput; nOk: boolean }) {
  const info = TOPOLOGY_INFO[input.topology];
  const lines = winningLineCount(input);
  return (
    <div class="space-facts">
      <p class="t-body measure">{info.blurb}</p>
      <div class="t-caption space-facts-list">
        <Fact lead="Orientable">{info.orientable ? 'Yes.' : 'No.'}</Fact>
        <Fact lead="Holonomy">{`${info.holonomy}.`}</Fact>
        <Fact lead="Curvature">{`${info.curvature}.`}</Fact>
      </div>
      <dl class="stats">
        <div>
          <dt class="t-label">Cells</dt>
          <dd class="t-heading t-num">
            {nOk ? fmt.format(cellCount(input.topology, input.n)) : '–'}
          </dd>
        </div>
        <div>
          <dt class="t-label">Winning lines</dt>
          <dd class="t-heading t-num" aria-live="polite">
            {lines === null ? '–' : fmt.format(lines)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function StartScreen() {
  const input = form.value;
  const errors = formErrors(input);
  const blocker = startBlocker(errors);
  const inProgress = game.value !== null;

  const update = (next: StartInput) => {
    form.value = next;
  };

  return (
    <div class="page start">
      <div class="bar start-bar" />
      <div class="grid">
        <main class="col-1-7 start-main">
          <h1 class="t-display t-bold start-title">
            Multiverse
            <br />
            Tic-Tac-Toe
            <br />
            in Impossible
            <br />
            Spaces
          </h1>
          <p class="t-body measure start-pitch">
            Three-dimensional tic-tac-toe on boards that wrap around, twist and mirror. Split a game
            into parallel timelines, send marks back in time or across to another board, and be the
            first to win W timelines.
          </p>

          <section class="form-section" aria-labelledby="space-heading">
            <h2 id="space-heading" class="t-label section-label">
              Space
            </h2>
            <div class="space-choice">
              <Segmented
                label="Space"
                orientation="vertical"
                options={SPACE_OPTIONS}
                value={input.topology}
                onChange={(id: TopologyId) => update(clampForTopology(form.value, id))}
              />
            </div>
            <SpaceFacts input={input} nOk={errors.n === undefined} />
          </section>

          <section class="form-section" aria-labelledby="params-heading">
            <h2 id="params-heading" class="t-label section-label">
              Parameters
            </h2>
            <div class="steppers">
              {STEPPERS.map(({ field, name, label, bigStep }) => {
                const [min, max] = fieldRange(input, field);
                return (
                  <Stepper
                    key={field}
                    name={name}
                    label={label}
                    value={input[field]}
                    min={min}
                    max={max}
                    bigStep={bigStep}
                    error={errors[field]}
                    onStep={(delta) => update(stepField(form.value, field, delta))}
                    onInput={(value) => update(setField(form.value, field, value))}
                  />
                );
              })}
            </div>
          </section>

          <div class="button-row start-actions">
            <Button variant="primary" disabledReason={blocker} onClick={() => startGame(input)}>
              {inProgress ? 'Start new game' : 'Start game'}
            </Button>
            {inProgress && (
              <Button onClick={() => navigate({ screen: 'multiverse' })}>Resume game</Button>
            )}
            <ButtonLink href={README_URL}>How to play</ButtonLink>
            {VIDEO_URL !== null && <ButtonLink href={VIDEO_URL}>Video</ButtonLink>}
          </div>
          {inProgress && (
            <p class="t-caption t-grey start-note">Starting a new game ends the one in progress.</p>
          )}
        </main>
        <aside class="col-8-12 start-diagram" aria-label="Diagram of the selected space">
          <SpaceDiagram topology={input.topology} />
        </aside>
      </div>
    </div>
  );
}
