/**
 * Property tests (33, 34): random legal play on every space, with the invariants checked after
 * every step. Moves are chosen through the UI query API, and random (mostly illegal) actions
 * check that the queries offer exactly what the validator accepts.
 */
import { describe, expect, it } from 'vitest';
import { completesLine, isFull, lineCells, markOf, type TopologyId } from '@/geometry';
import {
  addAction,
  concede,
  countLive,
  deserialize,
  emptyCells,
  endTurn,
  legalActionKinds,
  missingHeads,
  newGame,
  printTree,
  requiredHeads,
  sendBackTargets,
  sendableCells,
  serialize,
  strictAncestors,
  submitSendBack,
  timeTravelTargets,
  transferTargets,
  undo,
  clear,
  parityPlayer,
  type Action,
  type ActionResult,
  type GameState,
  type TNode,
  type Player,
} from '@/engine';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPACES: readonly [TopologyId, number, number][] = [
  ['flat', 3, 3],
  ['torus3', 3, 3],
  ['tetracosm', 3, 3],
  ['amphicosm1', 3, 3],
  ['tesseract', 2, 2],
];
const GAMES = 200;

/** Set FUZZ_STATS=1 to print how often each rule fired (the app tsconfig has no Node types). */
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

class Fuzz {
  readonly rnd: () => number;
  s: GameState;
  /** Committed nodes already checked for board invariants. */
  checked = 0;
  /** Live count of the committed tree when the current draft began. */
  turnStartLive: number;
  /** Snapshot taken at End Turn, checked once resolution finishes. */
  pending: { preview: GameState['preview']; base: number; events: number } | null = null;
  stats = { steps: 0, wins: 0, draws: 0, sendBacks: 0, skips: 0, tt: 0, transfers: 0, junk: 0 };

  readonly seed: number;
  readonly id: TopologyId;

  constructor(seed: number, id: TopologyId, n: number, m: number) {
    this.seed = seed;
    this.id = id;
    this.rnd = mulberry32(seed);
    const w = 1 + Math.floor(this.rnd() * 3);
    const l = 3 + Math.floor(this.rnd() * 5);
    const maxTimelines = 2 + Math.floor(this.rnd() * 5);
    this.s = newGame({ topology: id, n, m, w, l, maxTimelines });
    this.turnStartLive = this.s.preview.live;
  }

  fail(message: string): never {
    throw new Error(`[${this.id} seed ${this.seed}] ${message}\n${printTree(this.s)}`);
  }

  check(cond: unknown, message: string): asserts cond {
    if (!cond) this.fail(message);
  }

  pick<T>(items: readonly T[]): T {
    this.check(items.length > 0, 'pick from an empty list');
    return items[Math.floor(this.rnd() * items.length)] as T;
  }

  take(result: ActionResult, what: string): void {
    if (!result.ok) this.fail(`${what} rejected: ${result.reason} (${result.message})`);
    this.s = result.state;
  }

  play(): void {
    this.invariants();
    while (this.s.phase !== 'over') {
      this.check(++this.stats.steps < 50_000, 'game did not end');
      if (this.s.phase === 'awaitSendBack') this.sendBackStep();
      else this.draftStep();
      this.invariants();
    }
    this.check(this.s.round <= this.s.config.l + 1, 'round exceeded L + 1');
    for (const e of this.s.events) {
      if (e.type === 'timelineWon') this.stats.wins++;
      if (e.type === 'timelineDrawn') this.stats.draws++;
    }
  }

  sendBackStep(): void {
    const sender = this.s.pendingSendBack?.player as Player;
    if (this.rnd() < 0.01) return this.take(concede(this.s, sender), 'concede');
    const target = this.pick(sendBackTargets(this.s));
    this.take(submitSendBack(this.s, target.node, this.pick(target.cells)), 'sendBack');
  }

  draftStep(): void {
    const r = this.rnd();
    if (r < 0.003) return this.take(concede(this.s, this.s.current), 'concede');
    if (r < 0.06 && this.s.draft.length > 0) {
      this.s = undo(this.s);
      return;
    }
    if (r < 0.07 && this.s.draft.length > 0) {
      this.s = clear(this.s);
      return;
    }
    if (r < 0.15) return this.junk();
    const missing = missingHeads(this.s);
    if (missing.length === 0) {
      this.pending = {
        preview: this.s.preview,
        base: this.s.nodes.length,
        events: this.s.events.length,
      };
      return this.take(endTurn(this.s), 'endTurn');
    }
    const head = this.pick(missing);
    const kinds = legalActionKinds(this.s, head);
    this.check(kinds.place.ok, 'place unavailable on a missing head');
    const weights: [Action['kind'], number][] = [
      ['place', 5],
      ['split', kinds.split.ok ? 1.5 : 0],
      ['timeTravel', kinds.timeTravel.ok ? 2 : 0],
      ['transfer', kinds.transfer.ok ? 2 : 0],
    ];
    let roll = this.rnd() * weights.reduce((sum, [, wt]) => sum + wt, 0);
    const kind = (weights.find(([, wt]) => (roll -= wt) < 0) ?? ['place'])[0];
    this.take(addAction(this.s, this.buildAction(kind, head)), kind);
  }

  /** A legal action of `kind` on `head`, chosen through the query API. */
  buildAction(kind: Action['kind'], head: number): Action {
    switch (kind) {
      case 'place':
        return { kind, head, cell: this.pick(emptyCells(this.s, head)) };
      case 'split':
        return { kind, head };
      case 'timeTravel': {
        this.stats.tt++;
        const fromCell = this.pick(sendableCells(this.s, head));
        const t = this.pick(timeTravelTargets(this.s, head, fromCell));
        return { kind, head, fromCell, target: t.node, toCell: this.pick(t.cells) };
      }
      case 'transfer': {
        this.stats.transfers++;
        const fromCell = this.pick(sendableCells(this.s, head));
        const t = this.pick(transferTargets(this.s, head));
        return { kind, head, fromCell, targetHead: t.node, toCell: this.pick(t.cells) };
      }
    }
  }

  /** A random, usually illegal action: accepted exactly when the queries offer it. */
  junk(): void {
    this.stats.junk++;
    const s = this.s;
    const missing = missingHeads(s);
    const anyId = () => Math.floor(this.rnd() * (s.preview.nodes.length + 2)) - 1;
    const anyCell = () => Math.floor(this.rnd() * (s.topology.cellCount + 2)) - 1;
    const head = this.rnd() < 0.8 && missing.length > 0 ? this.pick(missing) : anyId();
    const ok = missing.includes(head);
    const own = ok ? sendableCells(s, head) : [];
    const fromCell = own.length > 0 && this.rnd() < 0.8 ? this.pick(own) : anyCell();
    const kinds: Action['kind'][] = ['place', 'split', 'timeTravel', 'transfer'];
    let action: Action;
    let offered: boolean;
    switch (this.pick(kinds)) {
      case 'place': {
        const cell = ok && this.rnd() < 0.5 ? this.pick(emptyCells(s, head)) : anyCell();
        action = { kind: 'place', head, cell };
        offered = ok && emptyCells(s, head).includes(cell);
        break;
      }
      case 'split':
        action = { kind: 'split', head };
        offered = ok && legalActionKinds(s, head).split.ok;
        break;
      case 'timeTravel': {
        const anc = ok ? strictAncestors(s, head) : [];
        const target = anc.length > 0 && this.rnd() < 0.7 ? this.pick(anc) : anyId();
        const toCell = anyCell();
        action = { kind: 'timeTravel', head, fromCell, target, toCell };
        offered = timeTravelTargets(s, head, fromCell).some(
          (t) => t.node === target && t.cells.includes(toCell),
        );
        break;
      }
      case 'transfer': {
        const others = requiredHeads(s);
        const targetHead = others.length > 0 && this.rnd() < 0.8 ? this.pick(others) : anyId();
        const toCell = anyCell();
        action = { kind: 'transfer', head, fromCell, targetHead, toCell };
        offered =
          own.includes(fromCell) &&
          transferTargets(s, head).some((t) => t.node === targetHead && t.cells.includes(toCell));
        break;
      }
    }
    const before = serialize(s);
    const result = addAction(s, action);
    this.check(
      result.ok === offered,
      `queries ${offered ? 'offer' : 'reject'} ${JSON.stringify(action)} but addAction says ${result.ok ? 'ok' : result.reason}`,
    );
    this.check(serialize(s) === before, 'addAction mutated its input');
    if (result.ok) this.s = result.state;
  }

  invariants(): void {
    const s = this.s;
    const pv = s.preview;
    const { config } = s;

    // Tree shape, over the whole preview.
    pv.nodes.forEach((node, id) => {
      this.check(node.id === id, `node id ${node.id} at index ${id}`);
      if (node.parent === null) return this.check(id === 0, 'only the root has no parent');
      const parent = pv.nodes[node.parent] as TNode;
      this.check(node.parent < id, `#${id} has a later parent`);
      this.check(node.step === parent.step + 1, `#${id}: child.step !== parent.step + 1`);
      this.check(parent.terminal === null, `terminal #${node.parent} has a child`);
      this.check(pv.children[node.parent]?.includes(id), `#${id} missing from its parent's list`);
    });
    this.check(pv.live === countLive(pv), 'cached live count is stale');

    // Boards: non-terminal nodes hold no line and are not full; wins are real lines.
    for (let id = this.checked; id < pv.nodes.length; id++) this.checkBoard(pv.nodes[id] as TNode);
    this.checked = s.nodes.length;

    // Scores match the committed won nodes, and the won events.
    const wins: [number, number] = [0, 0];
    for (const node of s.nodes) if (node.terminal?.kind === 'win') wins[node.terminal.winner]++;
    this.check(
      wins[0] === s.score[0] && wins[1] === s.score[1],
      `score ${s.score} != wins ${wins}`,
    );

    // Draft actions reference only committed nodes.
    for (const a of s.draft) {
      const ids = [a.head];
      if (a.kind === 'timeTravel') ids.push(a.target);
      if (a.kind === 'transfer') ids.push(a.targetHead);
      this.check(
        ids.every((id) => id < s.nodes.length),
        `draft action references a draft node: ${JSON.stringify(a)}`,
      );
    }

    // With an empty draft the preview is the committed tree.
    if (s.phase === 'draft' && s.draft.length === 0) this.turnStartLive = pv.live;
    switch (s.phase) {
      case 'draft':
        this.check(s.result === null && s.pendingSendBack === null, 'stale result/prompt');
        this.check(s.round <= config.l, 'drafting past the round limit');
        this.check(requiredHeads(s).length > 0, 'drafting with no required heads');
        // Draft actions never push the count past the cap (or past where it already was).
        this.check(
          pv.live <= Math.max(config.maxTimelines, this.turnStartLive),
          `live ${pv.live} > cap ${config.maxTimelines} (turn start ${this.turnStartLive})`,
        );
        break;
      case 'awaitSendBack':
        this.check(s.pendingSendBack !== null, 'no prompt');
        this.check(sendBackTargets(s).length > 0, 'a prompt without targets');
        break;
      case 'over':
        this.check(s.result !== null, 'over without a result');
        break;
    }

    if (this.pending && s.phase !== 'awaitSendBack') this.checkResolution();

    if (this.rnd() < 0.05) {
      const text = serialize(s);
      this.check(serialize(deserialize(text)) === text, 'serialization round trip differs');
    }
  }

  checkBoard(node: TNode): void {
    const { lines } = this.s;
    const t = node.terminal;
    if (t?.kind === 'win') {
      const cells = lineCells(lines, t.lineId);
      this.check(
        [...cells].every((c) => node.board[c] === markOf(t.winner)),
        `#${node.id} won without a line`,
      );
      return (this.stats.wins++, undefined);
    }
    if (t?.kind === 'draw') {
      this.stats.draws++;
      return this.check(isFull(node.board), `#${node.id} drawn but not full`);
    }
    this.check(!isFull(node.board), `live #${node.id} is full`);
    for (let c = 0; c < node.board.length; c++) {
      const v = node.board[c] as number;
      if (v === 0) continue;
      this.check(
        completesLine(node.board, c, (v - 1) as Player, lines) < 0,
        `non-terminal #${node.id} holds a line through c${c}`,
      );
    }
  }

  /** Resolution reproduces the preview's nodes, plus the send-back nodes. */
  checkResolution(): void {
    const { preview, base, events } = this.pending as NonNullable<Fuzz['pending']>;
    this.pending = null;
    const s = this.s;
    const drafted = preview.nodes.slice(base);
    const resolved = s.nodes.slice(base);
    const sendBacks = resolved.filter((n) => n.origin.kind === 'sendBack');
    const others = resolved.filter((n) => n.origin.kind !== 'sendBack');
    const applied = s.events.slice(events).filter((e) => e.type === 'sendBackApplied').length;
    this.stats.sendBacks += applied;
    this.stats.skips += s.events.slice(events).filter((e) => e.type === 'turnSkipped').length;
    this.check(sendBacks.length === applied, 'send-back count mismatch');
    if (s.result?.reason !== 'score' && s.result?.reason !== 'concede') {
      this.check(others.length === drafted.length, 'resolution dropped draft nodes');
    } else {
      this.check(others.length <= drafted.length, 'resolution added draft nodes');
    }
    const idMap = new Map<number, number>();
    others.forEach((n, i) => idMap.set((drafted[i] as TNode).id, n.id));
    const mapId = (id: number) => (id < base ? id : idMap.get(id));
    others.forEach((n, i) => {
      const d = drafted[i] as TNode;
      const o = d.origin;
      const mappedOrigin =
        o.kind === 'ttSource'
          ? { ...o, arrival: mapId(o.arrival) }
          : o.kind === 'ttArrival'
            ? { ...o, source: mapId(o.source) }
            : o;
      this.check(
        n.parent === d.parent &&
          n.step === d.step &&
          n.round === d.round &&
          JSON.stringify(n.terminal) === JSON.stringify(d.terminal) &&
          JSON.stringify(n.received) === JSON.stringify(d.received) &&
          JSON.stringify(n.origin) === JSON.stringify(mappedOrigin) &&
          n.board.every((v, c) => v === d.board[c]),
        `resolved #${n.id} differs from preview #${d.id}`,
      );
    });
    for (const n of sendBacks) {
      const o = n.origin;
      this.check(o.kind === 'sendBack', 'origin');
      const terminal = s.nodes[o.terminal] as TNode;
      this.check(terminal.terminal !== null, 'send-back for a live node');
      const sender = parityPlayer(n.step - 1);
      this.check(
        (s.nodes[n.parent as number] as TNode).step < terminal.step,
        'not strictly earlier',
      );
      this.check(
        strictAncestors(s, o.terminal).includes(n.parent as number),
        'send-back target is not a strict ancestor',
      );
      const t = terminal.terminal;
      const owed = t.kind === 'win' ? 1 - t.winner : 1 - t.filler;
      this.check(sender === owed, 'wrong player sent back');
    }
    if (s.phase === 'draft') {
      // The resolved tree is the preview plus send-back leaves, so the count is exact.
      const liveSendBacks = sendBacks.filter(
        (n) => n.terminal === null && (s.children[n.id] as number[]).length === 0,
      ).length;
      this.check(countLive(s) === preview.live + liveSendBacks, 'live count after resolution');
    }
  }
}

describe('random play (tests 33, 34)', () => {
  for (const [id, n, m] of SPACES) {
    it(`${GAMES} games on ${id} ${n}/${m} never throw and keep every invariant`, () => {
      const totals = {
        steps: 0,
        wins: 0,
        draws: 0,
        sendBacks: 0,
        skips: 0,
        tt: 0,
        transfers: 0,
        junk: 0,
      };
      const results = new Map<string, number>();
      for (let seed = 1; seed <= GAMES; seed++) {
        const f = new Fuzz(seed * 7919 + id.length, id, n, m);
        f.play();
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += f.stats[k];
        const r = f.s.result;
        const key = r ? `${r.kind}:${r.reason}` : 'none';
        results.set(key, (results.get(key) ?? 0) + 1);
      }
      // The games must actually exercise the interesting rules.
      expect(totals.wins).toBeGreaterThan(0);
      expect(totals.sendBacks).toBeGreaterThan(0);
      expect(totals.tt).toBeGreaterThan(0);
      expect(totals.transfers).toBeGreaterThan(0);
      if (env.FUZZ_STATS) console.log(id, totals, Object.fromEntries(results));
    });
  }
});
