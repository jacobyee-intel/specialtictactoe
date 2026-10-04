import { describe, expect, it } from 'vitest';
import { createTopology } from '@/geometry';
import { scenario } from '@/engine/__tests__/helpers';
import { layoutPanels } from './board2d/layout';
import { IDLE, syncFlow, type Flow } from './flow';
import {
  NO_SELECTION,
  actButtons,
  clickCell,
  confirmSentence,
  hoverCaption,
  moveCursor,
  pickPrompt,
  sendBackPrompt,
  splitPreviewText,
  timelineMode,
  validSelection,
} from './timelineModel';

/** P1 to move on n2 (step 2) with P1 at (1,1,1) and P2 at (0,0,0). */
function early() {
  const g = scenario({ w: 3 });
  const [n1, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
  return { g, n1: n1 as number, n2: n2 as number };
}

describe('timelineMode', () => {
  it('acts on a head that needs an action, reads everything else with a reason', () => {
    const { g, n1, n2 } = early();
    expect(timelineMode(g.state, n2, IDLE)).toEqual({ kind: 'act' });
    expect(timelineMode(g.state, n2, IDLE, true)).toEqual({
      kind: 'read',
      reason: 'Read-only view',
    });
    expect(timelineMode(g.state, n1, IDLE)).toEqual({ kind: 'read', reason: 'History' });
    const child = g.place(n2, g.c(2, 2, 2));
    expect(timelineMode(g.state, n2, IDLE)).toEqual({
      kind: 'read',
      reason: 'Already acted this turn',
    });
    expect(timelineMode(g.state, child, IDLE)).toEqual({
      kind: 'read',
      reason: 'Created this turn; it can act next turn',
    });
  });

  it('picks cells on the target of a flow', () => {
    const { g, n2 } = early();
    const flow: Flow = {
      kind: 'timeTravel',
      head: n2,
      fromCell: g.c(1, 1, 1),
      target: 0,
      cell: null,
    };
    const mode = timelineMode(g.state, 0, flow);
    expect(mode.kind).toBe('pickCell');
    if (mode.kind === 'pickCell') expect(mode.cells).toHaveLength(27);
    // The source head is not actionable while its mark is being sent.
    expect(timelineMode(g.state, n2, flow)).toEqual({
      kind: 'read',
      reason: 'Finish picking a target first',
    });
  });
});

describe('selection', () => {
  it('selects an empty cell to place, an own mark to send, and toggles off', () => {
    const { g, n2 } = early();
    const s = g.state;
    const place = clickCell(s, n2, NO_SELECTION, g.c(2, 2, 2));
    expect(place).toEqual({ kind: 'place', cell: g.c(2, 2, 2) });
    expect(clickCell(s, n2, place, g.c(2, 2, 2))).toEqual(NO_SELECTION);
    const send = clickCell(s, n2, place, g.c(1, 1, 1));
    expect(send).toEqual({ kind: 'send', cell: g.c(1, 1, 1) });
    // The opponent's mark is neither.
    expect(clickCell(s, n2, send, g.c(0, 0, 0))).toEqual(NO_SELECTION);
  });

  it('drops a selection that is no longer valid', () => {
    const { g, n2 } = early();
    const sel = { kind: 'send', cell: g.c(1, 1, 1) } as const;
    expect(validSelection(g.state, n2, sel)).toBe(sel);
    // Once the head has acted, none of its marks can be sent any more.
    g.place(n2, g.c(2, 2, 2));
    expect(validSelection(g.state, n2, sel)).toEqual(NO_SELECTION);
  });
});

describe('actButtons', () => {
  const reasons = (b: ReturnType<typeof actButtons>) =>
    Object.fromEntries(b.map((x) => [x.id, x.disabledReason]));

  it('explains every disabled button', () => {
    const { g, n2 } = early();
    expect(reasons(actButtons(g.state, n2, NO_SELECTION))).toEqual({
      place: 'Select an empty cell first',
      split: null,
      timeTravel: 'Select one of your marks first',
      transfer: 'Select one of your marks first',
      undo: 'Nothing to undo',
      clear: 'Nothing to clear',
    });
    const send = { kind: 'send', cell: g.c(1, 1, 1) } as const;
    expect(reasons(actButtons(g.state, n2, send))).toMatchObject({
      place: 'Select an empty cell first',
      timeTravel: null,
      transfer: 'No other timeline at the same step can receive a mark.',
    });
    const place = { kind: 'place', cell: g.c(2, 2, 2) } as const;
    expect(reasons(actButtons(g.state, n2, place)).place).toBeNull();
  });

  it('enables Undo and Clear once the draft has an action', () => {
    const g = scenario();
    const [a, b] = g.split(0);
    void a;
    void b;
    const r = reasons(actButtons(g.state, 0, NO_SELECTION));
    // The root has acted, so the actions are refused with the engine's reason.
    expect(r.split).toBe('That timeline already has an action this turn.');
    expect(r.undo).toBeNull();
    expect(r.clear).toBeNull();
  });

  it('previews a split', () => {
    const { g, n2 } = early();
    expect(splitPreviewText(g.state, n2)).toBe(
      'Two timelines at T = 3 with this board. Player 2 moves first in both.',
    );
  });
});

describe('flow captions', () => {
  it('prompts and confirms each flow', () => {
    const { g, n2 } = early();
    const tt: Flow = {
      kind: 'timeTravel',
      head: n2,
      fromCell: g.c(1, 1, 1),
      target: null,
      cell: null,
    };
    expect(pickPrompt(g.state, tt)).toBe('Choose a past node for your mark');
    expect(pickPrompt(g.state, { ...tt, kind: 'transfer' })).toBe(
      'Choose a timeline to receive your mark',
    );
    expect(pickPrompt(g.state, IDLE)).toBeNull();
    expect(confirmSentence(g.state, tt)).toBeNull();
    expect(confirmSentence(g.state, { ...tt, target: 0 })).toBe(
      'Pick an empty cell on #0 for (1, 1, 1)',
    );
    expect(confirmSentence(g.state, { ...tt, target: 0, cell: g.c(0, 0, 2) })).toBe(
      'Send (1, 1, 1) to #0 at (0, 0, 2)',
    );
  });

  it('words the forced send-back', () => {
    const g = scenario({ w: 3 });
    g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2));
    const won = g.place(g.heads()[0] as number, g.c(2, 0, 0));
    g.endTurn();
    const flow = syncFlow(IDLE, g.state);
    const text = `Player 2: forced send-back. Timeline #${won} was won by Player 1. Choose a past node.`;
    expect(pickPrompt(g.state, flow)).toBe(text);
    expect(sendBackPrompt(g.state, 1, won)).toBe(text);
    if (flow.kind !== 'sendBack') throw new Error('expected a send-back flow');
    expect(confirmSentence(g.state, { ...flow, target: 1, cell: 13 })).toBe(
      'Send a new mark back to #1 at (1, 1, 1)',
    );
  });
});

describe('moveCursor', () => {
  const t = createTopology('torus3', 3);
  const panels = layoutPanels(t, { halos: true });
  const at = (x: number, y: number, z: number) => t.cellAt([x, y, z]);

  it('starts on the first cell and moves within the panel, stopping at its edges', () => {
    expect(moveCursor(panels, null, 'ArrowRight')).toBe(at(0, 0, 0));
    expect(moveCursor(panels, at(0, 0, 0), 'ArrowRight')).toBe(at(1, 0, 0));
    expect(moveCursor(panels, at(1, 0, 0), 'ArrowDown')).toBe(at(1, 1, 0));
    // Halo ghosts are not cursor stops.
    expect(moveCursor(panels, at(0, 0, 0), 'ArrowLeft')).toBe(at(0, 0, 0));
    expect(moveCursor(panels, at(2, 2, 1), 'ArrowDown')).toBe(at(2, 2, 1));
  });

  it('changes panel with PageUp and PageDown, keeping the position', () => {
    expect(moveCursor(panels, at(2, 1, 0), 'PageDown')).toBe(at(2, 1, 1));
    expect(moveCursor(panels, at(2, 1, 2), 'PageDown')).toBe(at(2, 1, 2));
    expect(moveCursor(panels, at(2, 1, 1), 'PageUp')).toBe(at(2, 1, 0));
  });
});

describe('hoverCaption', () => {
  it('gives coordinates, the line count and the content', () => {
    const { g, n2 } = early();
    expect(hoverCaption(g.state, n2, g.c(1, 1, 1))).toBe(
      '(1, 1, 1) · 13 lines through this cell · Player 1',
    );
    expect(hoverCaption(g.state, n2, g.c(2, 2, 2))).toBe(
      '(2, 2, 2) · 7 lines through this cell · empty',
    );
  });
});
