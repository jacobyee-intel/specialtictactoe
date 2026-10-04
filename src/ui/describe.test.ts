import { describe, expect, it } from 'vitest';
import { createTopology } from '@/geometry';
import { crafted, scenario } from '@/engine/__tests__/helpers';
import type { EngineEvent, GameState } from '@/engine';
import {
  coordLabel,
  eventSentence,
  eventSummary,
  keepCoordsTogether,
  missingSentence,
  nodeAriaLabel,
  originSentence,
  originSummary,
  resultSentence,
  statusCaption,
} from './describe';

describe('coordLabel', () => {
  it('prints cubic coordinates', () => {
    const t = createTopology('torus3', 3);
    expect(coordLabel(t, t.cellAt([2, 0, 1]))).toBe('(2, 0, 1)');
  });

  it('prints the free coordinates and the cube on the tesseract', () => {
    const t = createTopology('tesseract', 4);
    expect(coordLabel(t, t.cellAt([2, 0, 1, -1]))).toBe('(2, 0, 1) in cube w = 0');
    expect(coordLabel(t, t.cellAt([2, 0, 1, 4]))).toBe('(2, 0, 1) in cube w = 4');
    // Cube x = 0 has free axes y, z, w, in that order.
    expect(coordLabel(t, t.cellAt([-1, 3, 2, 1]))).toBe('(3, 2, 1) in cube x = 0');
  });
});

/** A short game that produces every origin kind. */
function everyOrigin() {
  const g = scenario({ w: 3 });
  const [n1, n2] = g.line(g.c(1, 1, 1), g.c(0, 0, 0));
  const [a, b] = g.split(n2 as number);
  g.endTurn();
  // P2 on a and b (step 3): transfer from a to b, then place on b.
  const t = g.transfer(a, g.c(0, 0, 0), b, g.c(2, 2, 2));
  const placed = g.place(b, g.c(0, 2, 0));
  g.endTurn();
  // P1 on t.source (step 4): time travel its (1,1,1) back to n2 (step 2).
  const tt = g.timeTravel(t.source, g.c(1, 1, 1), n2 as number, g.c(2, 0, 0));
  return { g, n1: n1 as number, n2: n2 as number, a, b, t, placed, tt };
}

describe('originSentence and originSummary', () => {
  const { g, n1, n2, a, t, placed, tt } = everyOrigin();
  const s = g.state;

  it('describes the root', () => {
    expect(originSentence(s, 0)).toBe('The starting board, where every timeline begins.');
    expect(originSummary(s, 0)).toBe('Start');
  });

  it('describes a placement by the creator (the player not to move there)', () => {
    expect(originSentence(s, n1)).toBe('Created when Player 1 placed at (1, 1, 1).');
    expect(originSentence(s, n2)).toBe('Created when Player 2 placed at (0, 0, 0).');
    expect(originSummary(s, n1)).toBe('Placed (1, 1, 1)');
  });

  it('describes a split', () => {
    expect(originSentence(s, a)).toBe(`Created when Player 1 split #${n2}.`);
    expect(originSummary(s, a)).toBe(`Split of #${n2}`);
  });

  it('describes both ends of a transfer and the received mark', () => {
    expect(originSentence(s, t.source)).toBe(
      `Created when Player 2 moved the mark at (0, 0, 0) to #${4} at (2, 2, 2).`,
    );
    expect(originSummary(s, t.source)).toBe('Moved (0, 0, 0) to #4');
    expect(originSentence(s, placed)).toBe(
      `Created when Player 2 placed at (0, 2, 0). It includes a mark received from #${a} at (2, 2, 2).`,
    );
  });

  it('describes both ends of a time travel', () => {
    expect(originSentence(s, tt.source)).toBe(
      `Created when Player 1 sent the mark at (1, 1, 1) back in time to #${tt.arrival}.`,
    );
    expect(originSentence(s, tt.arrival)).toBe(
      `Created when Player 1 sent a mark back from #${tt.source}; it landed at (2, 0, 0).`,
    );
    expect(originSummary(s, tt.arrival)).toBe(`Mark from #${tt.source} at (2, 0, 0)`);
    expect(originSummary(s, tt.source)).toBe(`Sent (1, 1, 1) back to #${tt.arrival}`);
  });

  it('mentions a pending received mark on a head', () => {
    const h = crafted({}, [
      { parent: null, board: '1' + '0'.repeat(26) },
      { parent: 0, board: '12' + '0'.repeat(25) },
      { parent: 0, board: '10' + '0'.repeat(25) },
    ]);
    h.state = { ...h.state, current: 1 };
    h.transfer(1, 1, 2, 5);
    expect(originSentence(h.state, 2)).toBe(
      'Created when Player 1 split #0. Received a mark from #1 at (2, 1, 0) this turn.',
    );
  });

  it('describes a transfer win and a send-back', () => {
    // P2 owns (0,0,0) and (1,0,0) on head 1; head 2 has P2 at (0,0,0),(1,0,0) missing (2,0,0).
    const h = crafted({}, [
      { parent: null, board: '0'.repeat(27) },
      { parent: 0, board: '2' + '0'.repeat(8) + '2' + '0'.repeat(17) },
      { parent: 0, board: '22' + '0'.repeat(25) },
    ]);
    h.state = { ...h.state, current: 1 };
    const { win } = h.transfer(1, 9, 2, 2);
    expect(originSentence(h.state, win as number)).toBe(
      'Received a mark from #1 at (2, 0, 0), which ended this timeline.',
    );
    expect(originSummary(h.state, win as number)).toBe('Ended by a mark from #1');
    h.endTurn();
    // P1 owes a send-back for the win; its only target with P1 parity is the root.
    const sb = h.sendBack(0, 13);
    expect(originSentence(h.state, sb)).toBe(
      `Created by Player 1’s forced send-back at (1, 1, 1), owed for #${win}.`,
    );
    expect(originSummary(h.state, sb)).toBe(`Send-back at (1, 1, 1) for #${win}`);
  });
});

describe('statusCaption', () => {
  it('covers every status', () => {
    const { g, n2, a, b, t, tt } = everyOrigin();
    const s = g.state;
    expect(statusCaption(s, n2)).toBe('History');
    expect(statusCaption(s, t.source)).toBe('Already acted this turn');
    expect(statusCaption(s, tt.arrival)).toBe('Created this turn; it can act next turn');
    expect(statusCaption(s, a)).toBe('History');
    expect(statusCaption(s, b)).toBe('History');
    const heads = g.heads();
    const other = heads.find((h) => h !== t.source) as number;
    expect(statusCaption(s, other)).toBe('Needs your action');

    g.place(other, g.c(2, 1, 0));
    g.endTurn();
    expect(statusCaption(g.state, tt.arrival)).toBe('Needs your action');
    // A live head of the other player (as left by an out-of-step send-back).
    expect(statusCaption({ ...g.state, current: 0 }, tt.arrival)).toBe('Player 2 moves here');
  });

  it('describes won, frozen and over', () => {
    const g = scenario({ w: 1 });
    g.line(g.c(0, 0, 0), g.c(0, 0, 2), g.c(1, 0, 0), g.c(1, 0, 2));
    const won = g.place(g.heads()[0] as number, g.c(2, 0, 0));
    expect(statusCaption(g.state, won)).toBe('Won by Player 1 this turn (scored at End turn)');
    g.endTurn();
    expect(statusCaption(g.state, won)).toBe('Won by Player 1');
    expect(g.state.phase).toBe('over');
  });
});

describe('resultSentence', () => {
  it('words wins, concessions and draws', () => {
    expect(resultSentence({ kind: 'win', winner: 0, reason: 'score' }, [3, 1])).toBe(
      'Player 1 wins 3–1',
    );
    expect(resultSentence({ kind: 'win', winner: 1, reason: 'score' }, [1, 3])).toBe(
      'Player 2 wins 3–1',
    );
    expect(resultSentence({ kind: 'win', winner: 1, reason: 'concede' }, [0, 0])).toBe(
      'Player 2 wins by concession',
    );
    expect(resultSentence({ kind: 'draw', reason: 'turnLimit' }, [1, 1])).toBe(
      'Draw: round limit reached',
    );
    expect(resultSentence({ kind: 'draw', reason: 'noTimelines' }, [0, 0])).toBe(
      'Draw: no live timelines left',
    );
  });
});

describe('eventSentence and eventSummary', () => {
  const s = scenario().state;
  const cases: [EngineEvent, string][] = [
    [
      {
        type: 'actionApplied',
        player: 0,
        action: { kind: 'place', head: 3, cell: 13 },
        created: [],
      },
      'Player 1 placed at (1, 1, 1) on #3',
    ],
    [
      { type: 'actionApplied', player: 1, action: { kind: 'split', head: 2 }, created: [] },
      'Player 2 split #2',
    ],
    [
      {
        type: 'actionApplied',
        player: 0,
        action: { kind: 'timeTravel', head: 5, fromCell: 0, target: 2, toCell: 1 },
        created: [],
      },
      'Player 1 sent a mark from #5 back to #2',
    ],
    [
      {
        type: 'actionApplied',
        player: 0,
        action: { kind: 'transfer', head: 5, fromCell: 0, targetHead: 6, toCell: 1 },
        created: [],
      },
      'Player 1 moved a mark from #5 to #6',
    ],
    [{ type: 'timelineWon', node: 14, winner: 0, lineId: 0 }, 'Player 1 won timeline #14'],
    [{ type: 'timelineDrawn', node: 9, filler: 1 }, 'Timeline #9 was drawn'],
    [{ type: 'sendBackRequired', player: 1, terminal: 14 }, 'Player 2 owes a send-back for #14'],
    [
      { type: 'sendBackApplied', player: 1, target: 6, cell: 0, node: 20 },
      'Player 2 sent a mark back to #6',
    ],
    [
      { type: 'sendBackSkipped', player: 1, terminal: 3 },
      'Player 2 had nowhere to send back for #3',
    ],
    [{ type: 'turnSkipped', player: 1, round: 4 }, 'Player 2 had no timelines; turn skipped'],
    [{ type: 'controlPassed', player: 0, round: 5 }, 'Player 1 to move, round 5'],
    [
      { type: 'gameOver', result: { kind: 'draw', reason: 'turnLimit' } },
      'Draw: round limit reached',
    ],
  ];

  it.each(cases)('%o', (event, text) => {
    expect(eventSentence(s, event)).toBe(text);
  });

  it('summarises only the notable events since an index', () => {
    const events = cases.map(([e]) => e);
    const state: GameState = { ...s, events };
    expect(eventSummary(state, 0)).toBe(
      [
        'Player 1 won timeline #14',
        'Timeline #9 was drawn',
        'Player 2 sent a mark back to #6',
        'Player 2 had nowhere to send back for #3',
        'Player 2 had no timelines; turn skipped',
        'Draw: round limit reached',
      ].join(' · '),
    );
    expect(eventSummary(state, events.length - 2)).toBe('Draw: round limit reached');
    expect(eventSummary(state, events.length)).toBeNull();
  });

  it('keeps coordinates on one line', () => {
    expect(keepCoordsTogether('Send (1, 2, 0) to #4 at (0, 0, 2) now')).toBe(
      'Send (1,\u00a02,\u00a00) to #4 at (0,\u00a00,\u00a02) now',
    );
  });

  it('counts missing timelines', () => {
    expect(missingSentence(0)).toBeNull();
    expect(missingSentence(1)).toBe('1 timeline still needs an action');
    expect(missingSentence(2)).toBe('2 timelines still need an action');
  });
});

describe('nodeAriaLabel', () => {
  it('names the node, its step, the mover and the status', () => {
    const g = scenario();
    const [n1] = g.line(g.c(1, 1, 1));
    expect(nodeAriaLabel(g.state, 0)).toBe('Node 0, step 0, Player 1 to move, history');
    expect(nodeAriaLabel(g.state, n1 as number)).toBe(
      'Node 1, step 1, Player 2 to move, needs action',
    );
    expect(nodeAriaLabel(g.state, n1 as number, true)).toBe(
      'Node 1, step 1, Player 2 to move, needs action, valid target',
    );
    const [a, b] = g.split(n1 as number);
    expect(nodeAriaLabel(g.state, a)).toBe('Node 2, step 2, Player 1 to move, created this turn');
    g.endTurn();
    g.transfer(a, g.c(1, 1, 1), b, g.c(0, 0, 0));
    expect(nodeAriaLabel(g.state, b)).toBe(
      'Node 3, step 2, Player 1 to move, needs action, received a mark',
    );
    const won = g.place(b, g.c(2, 2, 2));
    expect(nodeAriaLabel(g.state, won)).toBe('Node 5, step 3, won by Player 1, this turn');
    g.endTurn();
    expect(nodeAriaLabel(g.state, won)).toBe('Node 5, step 3, won by Player 1');
  });
});
