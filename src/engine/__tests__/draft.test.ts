import { describe, expect, it } from 'vitest';
import {
  addAction,
  canEndTurn,
  clear,
  endTurn,
  missingHeads,
  preview,
  printTree,
  undo,
} from '@/engine';
import { threeHeads } from './fixtures';
import { scenario } from './helpers';

describe('undo and clear (test 17)', () => {
  it('restore every earlier preview exactly, and the preview is deterministic', () => {
    const { g, s, x, y } = threeHeads();
    const snapshots = [
      { tree: g.tree(), nodes: g.state.preview.nodes, ledger: g.state.preview.ledger },
    ];
    const snap = () =>
      snapshots.push({
        tree: g.tree(),
        nodes: g.state.preview.nodes,
        ledger: g.state.preview.ledger,
      });
    g.transfer(s, g.c(0, 0, 0), x, g.c(1, 0, 0));
    snap();
    g.split(x);
    snap();
    g.timeTravel(y, g.c(2, 2, 2), 0, g.c(1, 1, 1));
    snap();
    const committed = g.state.nodes;

    // Replaying the same draft from the committed tree gives an identical preview.
    let again = clear(g.state);
    expect(again.preview.nodes).toHaveLength(committed.length);
    for (const action of g.state.draft) {
      const added = addAction(again, action);
      if (!added.ok) throw new Error(added.message);
      again = added.state;
    }
    expect(again.preview.nodes).toEqual(g.state.preview.nodes);
    expect(printTree(again)).toBe(g.tree());

    for (let i = snapshots.length - 1; i >= 0; i--) {
      const want = snapshots[i] as (typeof snapshots)[number];
      expect(g.tree()).toBe(want.tree);
      expect(g.state.preview.nodes).toEqual(want.nodes);
      expect([...g.state.preview.ledger.acted]).toEqual([...want.ledger.acted]);
      expect([...g.state.preview.ledger.incoming]).toEqual([...want.ledger.incoming]);
      g.undo();
    }
    expect(g.state.nodes).toBe(committed);
    expect(g.state.draft).toEqual([]);
  });

  it('clear empties the draft; undo/clear with nothing to undo return the same state', () => {
    const { g, s } = threeHeads();
    const start = g.state;
    expect(undo(start)).toBe(start);
    expect(clear(start)).toBe(start);
    g.split(s);
    g.place(g.heads()[1] as number, 13);
    g.clear();
    expect(g.tree()).toBe(printTree(start));
    expect(preview(g.state).nodes).toEqual(start.preview.nodes);
  });

  it('a replayed draft is node-for-node identical to the incremental preview', () => {
    const { g, s, x, y } = threeHeads();
    g.transfer(s, g.c(0, 0, 0), x, g.c(1, 0, 0));
    g.split(x);
    g.place(y, g.c(1, 2, 1));
    const incremental = g.state.preview;
    // Undo then redo the last action: the first two are replayed from the snapshot.
    g.undo();
    g.place(y, g.c(1, 2, 1));
    expect(g.state.preview.nodes).toEqual(incremental.nodes);
    expect(g.state.preview.children).toEqual(incremental.children);
    expect(g.state.preview.live).toBe(incremental.live);
  });

  it('ignores stray fields on actions', () => {
    const g = scenario();
    g.act({ kind: 'place', head: 0, cell: 13, extra: true } as never);
    expect(g.state.draft).toEqual([{ kind: 'place', head: 0, cell: 13 }]);
  });
});

describe('canEndTurn (test 18)', () => {
  it('is true only once every required head has acted, counting a transfer win', () => {
    const { g, s, x, y } = threeHeads();
    expect(missingHeads(g.state)).toEqual([s, x, y]);
    expect(canEndTurn(g.state)).toBe(false);
    const fail = endTurn(g.state);
    expect(fail).toMatchObject({
      ok: false,
      reason: 'turnIncomplete',
      message: '3 timelines still need an action.',
    });
    g.transfer(s, g.c(0, 0, 0), y, g.c(1, 1, 1));
    expect(missingHeads(g.state)).toEqual([x]);
    expect(endTurn(g.state)).toMatchObject({ message: '1 timeline still needs an action.' });
    g.place(x, g.c(2, 0, 0));
    expect(missingHeads(g.state)).toEqual([]);
    expect(canEndTurn(g.state)).toBe(true);
  });
});
