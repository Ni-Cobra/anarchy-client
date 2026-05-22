// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BlockType,
  DEFAULT_FACING,
  HOTBAR_SLOTS,
  INVENTORY_SIZE,
  Inventory,
  ItemId,
  MAX_PLAYER_HEALTH,
  World,
  type Player,
  type Slot,
} from "../game/index.js";
import type { Renderer } from "../render/index.js";
import { attachBreakAndPlace, type BreakPlaceDeps } from "./break_place.js";

// Local structural alias for the renderer's `pickAtCursor` return shape.
// Avoids re-exporting `PickResult` from `render/index.ts` purely for a
// test stub — `attachBreakAndPlace` only consumes the structural fields
// `chunkCoord`, `localXY`, and `block.kind`.
interface MockPick {
  readonly chunkCoord: readonly [number, number];
  readonly localXY: readonly [number, number];
  readonly layer: "top" | "ground";
  readonly block: { readonly kind: BlockType };
}

// Task 555 regression: the held-break path must ship `BreakIntent` for
// every targetable cell — including ores whose `min_tool_tier` exceeds
// the player's equipped pickaxe. The pre-fix code refused to send a
// non-null target when `pick.gated` was true, so an empty-hand player
// clicking on IronOre never got the slow under-tooled break going (the
// server-side task 520 path was wired correctly but the wire intent
// never arrived). This pins that the gate has been removed from the
// outbound intent — the hint can still surface, but the swing always
// reaches the server.

const PLAYER_ID = 1;
const LOCAL_X = 0.5;
const LOCAL_Y = 0.5;

function buildPlayer(): Player {
  return {
    id: PLAYER_ID,
    x: LOCAL_X,
    y: LOCAL_Y,
    facing: DEFAULT_FACING,
    username: "tester",
    colorIndex: 0,
    equippedUtility: null,
    openChests: [],
    health: MAX_PLAYER_HEALTH,
    effects: [],
    xp: 0,
  };
}

function buildWorld(): World {
  const w = new World();
  w.applySnapshot([buildPlayer()]);
  return w;
}

interface MockRendererCalls {
  pickCalls: { x: number; y: number }[];
  setCursorCalls: ({ x: number; y: number } | null)[];
  attackPickCalls: { x: number; y: number }[];
}

function buildRenderer(
  pick: MockPick | null,
  attackPick:
    | { kind: "player"; id: number }
    | { kind: "entity"; id: number }
    | null = null,
): { renderer: Renderer; calls: MockRendererCalls } {
  const calls: MockRendererCalls = {
    pickCalls: [],
    setCursorCalls: [],
    attackPickCalls: [],
  };
  const renderer = {
    pickAtCursor: (ndc: { x: number; y: number }) => {
      calls.pickCalls.push({ x: ndc.x, y: ndc.y });
      return pick;
    },
    setCursorNdc: (ndc: { x: number; y: number } | null) => {
      calls.setCursorCalls.push(ndc === null ? null : { x: ndc.x, y: ndc.y });
    },
    pickAttackTargetAtCursor: (ndc: { x: number; y: number }) => {
      calls.attackPickCalls.push({ x: ndc.x, y: ndc.y });
      return attackPick;
    },
  };
  return { renderer: renderer as unknown as Renderer, calls };
}

function buildDeps(
  pick: MockPick | null,
  sendBreakIntent: BreakPlaceDeps["sendBreakIntent"],
  sendPlaceBlock: BreakPlaceDeps["sendPlaceBlock"] = vi.fn(),
): { deps: BreakPlaceDeps; rendererCalls: MockRendererCalls } {
  const { renderer, calls } = buildRenderer(pick);
  return {
    deps: {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent,
      sendPlaceBlock,
    },
    rendererCalls: calls,
  };
}

function tilePickAt(
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  kind: BlockType,
): MockPick {
  return {
    chunkCoord: [cx, cy],
    localXY: [lx, ly],
    layer: "top",
    block: { kind },
  };
}

function fireMouseDown(button: number, clientX: number, clientY: number): void {
  window.dispatchEvent(
    new MouseEvent("mousedown", {
      button,
      clientX,
      clientY,
      bubbles: true,
    }),
  );
}

function fireMouseUp(button: number, clientX: number, clientY: number): void {
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      button,
      clientX,
      clientY,
      bubbles: true,
    }),
  );
}

describe("attachBreakAndPlace — task 555 empty-hand gate", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    // happy-dom doesn't size window for us; pin a viewport so the
    // clientX/Y → NDC math in break_place.ts is deterministic.
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("ships a non-null BreakIntent for a gated ore cell (IronOre + empty hand)", () => {
    // The cell is in reach (tile center (1.5, 0.5) is 1 unit from the
    // player at (0.5, 0.5); REACH_BLOCKS = 4) and the player has no
    // equipped pickaxe, so `pickBreakTargetAt` flags it `gated`. The
    // fix is that the intent ships anyway — the server's task 520 slow
    // path handles the rest.
    const sendBreakIntent = vi.fn();
    const { deps } = buildDeps(
      tilePickAt(0, 0, 1, 0, BlockType.IronOre),
      sendBreakIntent,
    );
    detach = attachBreakAndPlace(window, deps);

    fireMouseDown(0, 400, 300);

    expect(sendBreakIntent).toHaveBeenCalledTimes(1);
    expect(sendBreakIntent).toHaveBeenLastCalledWith({
      cx: 0,
      cy: 0,
      lx: 1,
      ly: 0,
    });
  });

  it("releases the held break on mouseup even after a gated start", () => {
    const sendBreakIntent = vi.fn();
    const { deps } = buildDeps(
      tilePickAt(0, 0, 1, 0, BlockType.CopperOre),
      sendBreakIntent,
    );
    detach = attachBreakAndPlace(window, deps);

    fireMouseDown(0, 400, 300);
    fireMouseUp(0, 400, 300);

    expect(sendBreakIntent.mock.calls).toEqual([
      [{ cx: 0, cy: 0, lx: 1, ly: 0 }],
      [null],
    ]);
  });

  it("still ships the intent for non-gated cells (regression guard for Stone)", () => {
    const sendBreakIntent = vi.fn();
    const { deps } = buildDeps(
      tilePickAt(0, 0, 1, 0, BlockType.Stone),
      sendBreakIntent,
    );
    detach = attachBreakAndPlace(window, deps);

    fireMouseDown(0, 400, 300);

    expect(sendBreakIntent).toHaveBeenCalledTimes(1);
    expect(sendBreakIntent).toHaveBeenLastCalledWith({
      cx: 0,
      cy: 0,
      lx: 1,
      ly: 0,
    });
  });

  it("ships null when the picker returns null (no cell under cursor)", () => {
    const sendBreakIntent = vi.fn();
    const { deps } = buildDeps(null, sendBreakIntent);
    detach = attachBreakAndPlace(window, deps);

    fireMouseDown(0, 400, 300);

    expect(sendBreakIntent).toHaveBeenCalledTimes(1);
    expect(sendBreakIntent).toHaveBeenLastCalledWith(null);
  });
});

describe("attachBreakAndPlace — task 070b target-pick", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  function buildAttackDeps(opts: {
    attackPick:
      | { kind: "player"; id: number }
      | { kind: "entity"; id: number }
      | null;
    targetPos: { x: number; y: number } | null;
    sendAttackIntent: BreakPlaceDeps["sendAttackIntent"];
    sendBreakIntent?: BreakPlaceDeps["sendBreakIntent"];
  }): BreakPlaceDeps {
    const { renderer } = buildRenderer(null, opts.attackPick);
    return {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent: opts.sendBreakIntent ?? vi.fn(),
      sendPlaceBlock: vi.fn(),
      sendAttackIntent: opts.sendAttackIntent,
      getAttackTargetPosition: () => opts.targetPos,
    };
  }

  it("ships AttackIntent for a player target in range (not BreakIntent)", () => {
    const sendAttackIntent = vi.fn();
    const sendBreakIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildAttackDeps({
        attackPick: { kind: "player", id: 99 },
        // Player at (2.5, 0.5) is ~2 tiles from local (0.5, 0.5) — well
        // inside the 6-tile ATTACK_RANGE.
        targetPos: { x: 2.5, y: 0.5 },
        sendAttackIntent,
        sendBreakIntent,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("player", 99);
    expect(sendBreakIntent).not.toHaveBeenCalled();
  });

  it("admits a target at 5.5 tiles (would have rejected pre-110)", () => {
    // Task 110 bumped ATTACK_RANGE_TILES 4 → 6. A target 5.5 tiles east
    // would have rejected under the old gate but admits now.
    const sendAttackIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildAttackDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 6.0, y: 0.5 },
        sendAttackIntent,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("player", 99);
  });

  it("ships AttackIntent for an entity target in range", () => {
    const sendAttackIntent = vi.fn();
    const sendBreakIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildAttackDeps({
        attackPick: { kind: "entity", id: 42 },
        targetPos: { x: 1.5, y: 1.5 },
        sendAttackIntent,
        sendBreakIntent,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("entity", 42);
    expect(sendBreakIntent).not.toHaveBeenCalled();
  });

  it("suppresses AttackIntent when the target is beyond ATTACK_RANGE_TILES", () => {
    const sendAttackIntent = vi.fn();
    const sendBreakIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildAttackDeps({
        attackPick: { kind: "player", id: 99 },
        // ~30 tiles east — far beyond the 6-tile range gate.
        targetPos: { x: 30.5, y: 0.5 },
        sendAttackIntent,
        sendBreakIntent,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).not.toHaveBeenCalled();
    // Out-of-range click also suppresses the held-break so the user's
    // intent (attack) isn't misinterpreted as a swing at the air.
    expect(sendBreakIntent).not.toHaveBeenCalled();
  });

  it("falls through to BreakIntent when no target is under the cursor", () => {
    const sendAttackIntent = vi.fn();
    const sendBreakIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildAttackDeps({
        attackPick: null,
        targetPos: null,
        sendAttackIntent,
        sendBreakIntent,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).not.toHaveBeenCalled();
    // BreakIntent ships with `null` because the test renderer's
    // pickAtCursor returns null (no block under cursor).
    expect(sendBreakIntent).toHaveBeenCalledTimes(1);
    expect(sendBreakIntent).toHaveBeenLastCalledWith(null);
  });
});

describe("attachBreakAndPlace — task 200c blowgun routing", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  function inventoryWithBlowgunAndDarts(darts: number): Inventory {
    const inv = new Inventory();
    const slots: Slot[] = new Array(INVENTORY_SIZE).fill(null);
    slots[0] = { item: ItemId.Blowgun, count: 1 };
    if (darts > 0) {
      slots[1] = { item: ItemId.PoisonDart, count: darts };
    }
    inv.replaceFromWire(slots, null, null, [], 0, null, null);
    return inv;
  }

  function inventoryNoBlowgun(): Inventory {
    const inv = new Inventory();
    inv.replaceFromWire(new Array(INVENTORY_SIZE).fill(null) as Slot[]);
    return inv;
  }

  function buildBlowgunDeps(opts: {
    attackPick: { kind: "player"; id: number } | { kind: "entity"; id: number } | null;
    targetPos: { x: number; y: number } | null;
    inventory: Inventory;
    sendFireBlowgunIntent: BreakPlaceDeps["sendFireBlowgunIntent"];
    sendPlaceBlock?: BreakPlaceDeps["sendPlaceBlock"];
    nowMs?: () => number;
    onBlowgunFireDispatched?: (nowMs: number) => void;
    pick?: MockPick | null;
  }): BreakPlaceDeps {
    const { renderer } = buildRenderer(opts.pick ?? null, opts.attackPick);
    return {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => opts.inventory,
      sendBreakIntent: vi.fn(),
      sendPlaceBlock: opts.sendPlaceBlock ?? vi.fn(),
      sendFireBlowgunIntent: opts.sendFireBlowgunIntent,
      getAttackTargetPosition: () => opts.targetPos,
      onBlowgunFireDispatched: opts.onBlowgunFireDispatched,
      nowMs: opts.nowMs,
    };
  }

  function fireRightClick(clientX: number, clientY: number): void {
    fireMouseDown(2, clientX, clientY);
  }

  it("ships FireBlowgunIntent on right-click against a player in range", () => {
    const sendFire = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 4.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(5),
        sendFireBlowgunIntent: sendFire,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(1);
    expect(sendFire).toHaveBeenCalledWith("player", 99);
  });

  it("ships FireBlowgunIntent on right-click against an entity in range", () => {
    const sendFire = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "entity", id: 42 },
        targetPos: { x: 1.5, y: 1.5 },
        inventory: inventoryWithBlowgunAndDarts(2),
        sendFireBlowgunIntent: sendFire,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(1);
    expect(sendFire).toHaveBeenCalledWith("entity", 42);
  });

  it("falls through to PlaceBlock on right-click on a block while blowgun is equipped (task 010-blowgun-place)", () => {
    // Regression for the user-reported "blowgun blocks block placement"
    // bug: with the blowgun equipped and the cursor over a non-entity
    // tile, the click must still place. The blowgun only intercepts
    // right-clicks that land on an entity / player.
    const sendFire = vi.fn();
    const sendPlace = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: null,
        targetPos: null,
        inventory: inventoryWithBlowgunAndDarts(3),
        sendFireBlowgunIntent: sendFire,
        sendPlaceBlock: sendPlace,
        pick: tilePickAt(0, 0, 1, 0, BlockType.Air),
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).not.toHaveBeenCalled();
    expect(sendPlace).toHaveBeenCalledTimes(1);
    expect(sendPlace).toHaveBeenCalledWith(0, 0, 1, 0);
  });

  it("suppresses both fire and place when targeting an entity but the cooldown gate is hot", () => {
    // Targeting an entity → user's intent is to shoot. If we can't fire
    // (cooldown), the click must NOT silently turn into a place-block —
    // that would surprise the user when their dart fizzle bursts a tile
    // under the entity.
    const sendFire = vi.fn();
    const sendPlace = vi.fn();
    let now = 1_000_000;
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 4.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(5),
        sendFireBlowgunIntent: sendFire,
        sendPlaceBlock: sendPlace,
        pick: tilePickAt(0, 0, 1, 0, BlockType.Air),
        nowMs: () => now,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(1);
    now += 200;
    fireRightClick(400, 300);
    // Cooldown blocked the second fire; place did NOT take over.
    expect(sendFire).toHaveBeenCalledTimes(1);
    expect(sendPlace).not.toHaveBeenCalled();
  });

  it("does not fire when no dart is in inventory", () => {
    const sendFire = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 4.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(0),
        sendFireBlowgunIntent: sendFire,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).not.toHaveBeenCalled();
  });

  it("does not fire when target is beyond BLOWGUN_RANGE_TILES", () => {
    const sendFire = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 12.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(5),
        sendFireBlowgunIntent: sendFire,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).not.toHaveBeenCalled();
  });

  it("local cooldown gate suppresses a second fire inside 1 s", () => {
    const sendFire = vi.fn();
    let nowMs = 1_000_000;
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 4.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(5),
        sendFireBlowgunIntent: sendFire,
        nowMs: () => nowMs,
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(1);

    nowMs += 500;
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(1);

    nowMs += 600;
    fireRightClick(400, 300);
    expect(sendFire).toHaveBeenCalledTimes(2);
  });

  it("notifies the session of dispatched fires via onBlowgunFireDispatched", () => {
    const sendFire = vi.fn();
    const onDispatched = vi.fn();
    let nowMs = 50_000;
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: { kind: "player", id: 99 },
        targetPos: { x: 4.5, y: 0.5 },
        inventory: inventoryWithBlowgunAndDarts(5),
        sendFireBlowgunIntent: sendFire,
        onBlowgunFireDispatched: onDispatched,
        nowMs: () => nowMs,
      }),
    );
    fireRightClick(400, 300);
    expect(onDispatched).toHaveBeenCalledTimes(1);
    expect(onDispatched).toHaveBeenCalledWith(50_000);
  });

  it("does not run the blowgun path when no blowgun is equipped", () => {
    const sendFire = vi.fn();
    const sendPlace = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildBlowgunDeps({
        attackPick: null,
        targetPos: null,
        inventory: inventoryNoBlowgun(),
        sendFireBlowgunIntent: sendFire,
        sendPlaceBlock: sendPlace,
        pick: tilePickAt(0, 0, 1, 0, BlockType.Air),
      }),
    );
    fireRightClick(400, 300);
    expect(sendFire).not.toHaveBeenCalled();
    expect(sendPlace).toHaveBeenCalledTimes(1);
  });

  it("hotbar slot count is the standard 9", () => {
    expect(HOTBAR_SLOTS).toBe(9);
  });
});

describe("attachBreakAndPlace — task 360 flag routing", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  function buildFlagDeps(opts: {
    pick: MockPick | null;
    sendFlagInteractIntent: BreakPlaceDeps["sendFlagInteractIntent"];
    sendBreakIntent?: BreakPlaceDeps["sendBreakIntent"];
    sendPlaceBlock?: BreakPlaceDeps["sendPlaceBlock"];
  }): BreakPlaceDeps {
    const { renderer } = buildRenderer(opts.pick);
    return {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent: opts.sendBreakIntent ?? vi.fn(),
      sendPlaceBlock: opts.sendPlaceBlock ?? vi.fn(),
      sendFlagInteractIntent: opts.sendFlagInteractIntent,
    };
  }

  it("left-click on a flag in range ships a Steal active=true intent (not a BreakIntent)", () => {
    const sendFlag = vi.fn();
    const sendBreak = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
        sendBreakIntent: sendBreak,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendFlag).toHaveBeenCalledTimes(1);
    expect(sendFlag).toHaveBeenCalledWith(0, 0, 1, 0, "steal", true);
    // Held-break path is suppressed when the click resolves to a flag.
    expect(sendBreak).not.toHaveBeenCalled();
  });

  it("right-click on a flag in range ships a Deposit active=true intent (not a PlaceBlock)", () => {
    const sendFlag = vi.fn();
    const sendPlace = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
        sendPlaceBlock: sendPlace,
      }),
    );

    fireMouseDown(2, 400, 300);

    expect(sendFlag).toHaveBeenCalledTimes(1);
    expect(sendFlag).toHaveBeenCalledWith(0, 0, 1, 0, "deposit", true);
    expect(sendPlace).not.toHaveBeenCalled();
  });

  it("releases the flag-interact hold on mouseup (active=false against the same flag + mode)", () => {
    const sendFlag = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
      }),
    );

    fireMouseDown(0, 400, 300);
    fireMouseUp(0, 400, 300);

    expect(sendFlag.mock.calls).toEqual([
      [0, 0, 1, 0, "steal", true],
      [0, 0, 1, 0, "steal", false],
    ]);
  });

  it("right-click release also ships active=false even though break-release-on-mouseup only fires for left", () => {
    const sendFlag = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
      }),
    );

    fireMouseDown(2, 400, 300);
    fireMouseUp(2, 400, 300);

    expect(sendFlag.mock.calls).toEqual([
      [0, 0, 1, 0, "deposit", true],
      [0, 0, 1, 0, "deposit", false],
    ]);
  });

  it("flag beyond FLAG_INTERACT_RANGE_TILES is dropped (falls through to BreakIntent on left, PlaceBlock on right)", () => {
    const sendFlag = vi.fn();
    const sendBreak = vi.fn();
    const sendPlace = vi.fn();
    // Player at (0.5, 0.5); flag at chunk (0,0) local (10, 0) → tile centre
    // (10.5, 0.5) → distance 10 tiles, well past the 4-tile gate.
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 10, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
        sendBreakIntent: sendBreak,
        sendPlaceBlock: sendPlace,
      }),
    );

    fireMouseDown(0, 400, 300);
    // Out of flag range → flag path drops. Out of break range (10 > 4)
    // → break pick returns null and BreakIntent ships as null.
    expect(sendFlag).not.toHaveBeenCalled();
    expect(sendBreak).toHaveBeenCalledTimes(1);
    expect(sendBreak).toHaveBeenCalledWith(null);

    fireMouseDown(2, 400, 300);
    expect(sendFlag).not.toHaveBeenCalled();
    // Right-click on out-of-reach picks: place gate returns null → no place.
    expect(sendPlace).not.toHaveBeenCalled();
  });

  it("falls through normally when sendFlagInteractIntent isn't provided (existing deps don't change behaviour)", () => {
    // No `sendFlagInteractIntent` in deps — a left-click on a flag block
    // routes through the normal held-break path as if the flag check
    // were absent. This pins back-compat for tests that haven't been
    // updated to the new dep.
    const sendBreak = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: undefined,
        sendBreakIntent: sendBreak,
      }),
    );

    fireMouseDown(0, 400, 300);
    expect(sendBreak).toHaveBeenCalledTimes(1);
    expect(sendBreak).toHaveBeenCalledWith({ cx: 0, cy: 0, lx: 1, ly: 0 });
  });

  it("detach during an active hold ships the release", () => {
    const sendFlag = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDeps({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        sendFlagInteractIntent: sendFlag,
      }),
    );

    fireMouseDown(0, 400, 300);
    detach!();
    detach = null;

    expect(sendFlag.mock.calls).toEqual([
      [0, 0, 1, 0, "steal", true],
      [0, 0, 1, 0, "steal", false],
    ]);
  });
});

// Task 170: drain-to-destroy fall-through. Before the fix, every click on
// a flag block within `FLAG_INTERACT_RANGE_TILES` routed unconditionally to
// `sendFlagInteractIntent`, so a faction-drained flag could never be
// broken (server-side admission rejected the steal because faction xp == 0,
// and the held break never started). The fix: the click router consults
// `getFactionXpAt` and falls through to the break path when the cell holds
// an unclaimed or drained flag.
describe("attachBreakAndPlace — task 170 drain-to-destroy fall-through", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  function buildFlagDepsWithXp(opts: {
    pick: MockPick | null;
    factionXp: number | null;
    sendFlagInteractIntent: BreakPlaceDeps["sendFlagInteractIntent"];
    sendBreakIntent?: BreakPlaceDeps["sendBreakIntent"];
    sendPlaceBlock?: BreakPlaceDeps["sendPlaceBlock"];
  }): BreakPlaceDeps {
    const { renderer } = buildRenderer(opts.pick);
    return {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent: opts.sendBreakIntent ?? vi.fn(),
      sendPlaceBlock: opts.sendPlaceBlock ?? vi.fn(),
      sendFlagInteractIntent: opts.sendFlagInteractIntent,
      getFactionXpAt: () => opts.factionXp,
    };
  }

  it("left-click on a drained claimed flag (xp=0) falls through to BreakIntent", () => {
    const sendFlag = vi.fn();
    const sendBreak = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDepsWithXp({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        factionXp: 0,
        sendFlagInteractIntent: sendFlag,
        sendBreakIntent: sendBreak,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendFlag).not.toHaveBeenCalled();
    expect(sendBreak).toHaveBeenCalledTimes(1);
    expect(sendBreak).toHaveBeenCalledWith({ cx: 0, cy: 0, lx: 1, ly: 0 });
  });

  it("left-click on an unclaimed flag (no faction) falls through to BreakIntent", () => {
    const sendFlag = vi.fn();
    const sendBreak = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDepsWithXp({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        factionXp: null,
        sendFlagInteractIntent: sendFlag,
        sendBreakIntent: sendBreak,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendFlag).not.toHaveBeenCalled();
    expect(sendBreak).toHaveBeenCalledTimes(1);
    expect(sendBreak).toHaveBeenCalledWith({ cx: 0, cy: 0, lx: 1, ly: 0 });
  });

  it("left-click on a claimed flag with xp > 0 still intercepts (legacy behavior)", () => {
    const sendFlag = vi.fn();
    const sendBreak = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDepsWithXp({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        factionXp: 5,
        sendFlagInteractIntent: sendFlag,
        sendBreakIntent: sendBreak,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendFlag).toHaveBeenCalledTimes(1);
    expect(sendFlag).toHaveBeenCalledWith(0, 0, 1, 0, "steal", true);
    expect(sendBreak).not.toHaveBeenCalled();
  });

  it("right-click on a drained claimed flag still intercepts as Deposit", () => {
    // A fresh `try_create_faction` starts at xp == 0, so the deposit
    // affordance must still fire — losing it would break the very flow
    // the user uses to build XP up on their own faction. The drain-to-
    // destroy fall-through is left-button-only.
    const sendFlag = vi.fn();
    const sendPlace = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDepsWithXp({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        factionXp: 0,
        sendFlagInteractIntent: sendFlag,
        sendPlaceBlock: sendPlace,
      }),
    );

    fireMouseDown(2, 400, 300);

    expect(sendFlag).toHaveBeenCalledTimes(1);
    expect(sendFlag).toHaveBeenCalledWith(0, 0, 1, 0, "deposit", true);
    expect(sendPlace).not.toHaveBeenCalled();
  });

  it("right-click on an unclaimed flag falls through to PlaceBlock", () => {
    // No bound faction → nothing to deposit into; the click belongs to
    // the regular right-click handling.
    const sendFlag = vi.fn();
    const sendPlace = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildFlagDepsWithXp({
        pick: tilePickAt(0, 0, 1, 0, BlockType.Flag),
        factionXp: null,
        sendFlagInteractIntent: sendFlag,
        sendPlaceBlock: sendPlace,
      }),
    );

    fireMouseDown(2, 400, 300);

    expect(sendFlag).not.toHaveBeenCalled();
    expect(sendPlace).toHaveBeenCalledTimes(1);
    expect(sendPlace).toHaveBeenCalledWith(0, 0, 1, 0);
  });
});

// Task 030: the local attack-cooldown gate. A left-click on an in-range
// attack target while the local sword is still cooling down must NOT
// ship `AttackIntent` (the server would silently reject it). Instead the
// cursor-anchored hint surfaces "Attack on cooldown" for ~1 s.
describe("attachBreakAndPlace — task 030 attack cooldown hint", () => {
  let detach: (() => void) | null = null;

  const HINT_HOST_ID = "anarchy-cursor-hint";

  // Server cooldown window — mirrored from `ui/sword_cooldown_ring.ts`.
  const ATTACK_COOLDOWN_MS = 5000;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.useRealTimers();
  });

  function buildCooldownDeps(opts: {
    sendAttackIntent: BreakPlaceDeps["sendAttackIntent"];
    getLocalStrikeStartedMs: () => number | null;
    nowMs: () => number;
  }): BreakPlaceDeps {
    const { renderer } = buildRenderer(null, { kind: "player", id: 99 });
    return {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent: vi.fn(),
      sendPlaceBlock: vi.fn(),
      sendAttackIntent: opts.sendAttackIntent,
      // In-range player target (2 tiles east, well inside ATTACK_RANGE_TILES = 6).
      getAttackTargetPosition: () => ({ x: 2.5, y: 0.5 }),
      getLocalStrikeStartedMs: opts.getLocalStrikeStartedMs,
      nowMs: opts.nowMs,
    };
  }

  it("suppresses AttackIntent and surfaces the transient hint while on cooldown", () => {
    const sendAttackIntent = vi.fn();
    // strikeMs = 0, now = 100 → 100 ms into the 5 s window.
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => 0,
        nowMs: () => 100,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).not.toHaveBeenCalled();
    const chip = document.getElementById(HINT_HOST_ID);
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("Attack on cooldown");
    expect(chip!.style.display).toBe("block");
  });

  it("ships AttackIntent once the cooldown has elapsed", () => {
    const sendAttackIntent = vi.fn();
    // Cooldown started at 0, now = ATTACK_COOLDOWN_MS → just past the window.
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => 0,
        nowMs: () => ATTACK_COOLDOWN_MS,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("player", 99);
    // The hint stays absent for an allowed click — no host should have
    // been created.
    expect(document.getElementById(HINT_HOST_ID)).toBeNull();
  });

  it("ships AttackIntent when the local player has never struck (null strike)", () => {
    const sendAttackIntent = vi.fn();
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => null,
        nowMs: () => 5_000_000,
      }),
    );

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("player", 99);
    expect(document.getElementById(HINT_HOST_ID)).toBeNull();
  });

  it("re-showing on a spammed click refreshes the chip (single instance, latest text wins)", () => {
    const sendAttackIntent = vi.fn();
    let now = 200;
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => 0,
        nowMs: () => now,
      }),
    );

    fireMouseDown(0, 400, 300);
    expect(document.getElementById(HINT_HOST_ID)?.textContent).toBe(
      "Attack on cooldown",
    );

    now = 400;
    fireMouseDown(0, 400, 300);
    // Still exactly one host element under the same id; text unchanged.
    expect(document.querySelectorAll(`#${HINT_HOST_ID}`).length).toBe(1);
    expect(document.getElementById(HINT_HOST_ID)?.textContent).toBe(
      "Attack on cooldown",
    );
    // No `AttackIntent` shipped across either click — both were inside
    // the cooldown window.
    expect(sendAttackIntent).not.toHaveBeenCalled();
  });

  it("the hint auto-fades after ~1 s and stays hidden once cooldown elapses", () => {
    vi.useFakeTimers();
    const sendAttackIntent = vi.fn();
    // Strike at t=0, now=100 ⇒ 4.9 s of cooldown remaining ⇒ fade caps at 1 s.
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => 0,
        nowMs: () => 100,
      }),
    );

    fireMouseDown(0, 400, 300);
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("block");

    vi.advanceTimersByTime(999);
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("block");
    vi.advanceTimersByTime(1);
    // Fade fires; chip hides.
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("none");
  });

  it("fade is clamped to remaining cooldown when less than 1 s is left", () => {
    vi.useFakeTimers();
    const sendAttackIntent = vi.fn();
    // Strike at t=0, now = ATTACK_COOLDOWN_MS - 250 ⇒ 250 ms remaining.
    // Fade should cap at 250 ms, not 1000 ms — the chip must not outlive
    // the cooldown it explains.
    detach = attachBreakAndPlace(
      window,
      buildCooldownDeps({
        sendAttackIntent,
        getLocalStrikeStartedMs: () => 0,
        nowMs: () => ATTACK_COOLDOWN_MS - 250,
      }),
    );

    fireMouseDown(0, 400, 300);
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("block");

    vi.advanceTimersByTime(249);
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("block");
    vi.advanceTimersByTime(1);
    expect(document.getElementById(HINT_HOST_ID)?.style.display).toBe("none");
  });

  it("legacy callers (no getLocalStrikeStartedMs dep) ship attacks unchanged", () => {
    // A previously-wired test surface with no cooldown dep should keep
    // shipping the intent — the gate is purely additive.
    const sendAttackIntent = vi.fn();
    const { renderer } = buildRenderer(null, { kind: "player", id: 99 });
    detach = attachBreakAndPlace(window, {
      world: buildWorld(),
      renderer,
      getLocalPlayerId: () => PLAYER_ID,
      getInventory: () => new Inventory(),
      sendBreakIntent: vi.fn(),
      sendPlaceBlock: vi.fn(),
      sendAttackIntent,
      getAttackTargetPosition: () => ({ x: 2.5, y: 0.5 }),
      // No `getLocalStrikeStartedMs`.
    });

    fireMouseDown(0, 400, 300);

    expect(sendAttackIntent).toHaveBeenCalledTimes(1);
    expect(sendAttackIntent).toHaveBeenCalledWith("player", 99);
  });
});
