import { test, expect, type Page } from "./test-shared";

import {
  AdminItemId,
  adminGiveItem,
  adminSetBlock,
  adminTeleport,
} from "./admin";

// Task 220 e2e: craft cloth + flag via real UI clicks, place the flag via
// the wire path, and verify the placed flag carries the crafter's color
// frozen onto its `ItemStack.extra.flag.colorIndex` — and the matching
// chunk's `flagBlocks` map. A second client then held-breaks the flag and
// receives a Flag stack stamped with the *placer's* color, not the
// breaker's — pinning the color-travels-with-the-stack invariant
// end-to-end through the real wire path.

const ITEM_STRING = AdminItemId.String;
const ITEM_WOOD = AdminItemId.Wood;
const ITEM_CLOTH = AdminItemId.Cloth;
const ITEM_FLAG = AdminItemId.Flag;
const ITEM_GOLD = AdminItemId.Gold;

const FLAG_CHUNK = { cx: 0, cy: 0 } as const;
const FLAG_CELL = { lx: 3, ly: 0 } as const;
// Numeric BlockType.Flag — client enum value 27 mirrors the proto / server
// constant. Hard-coded here for the same reason the other e2e specs hard-
// code their numeric kinds: the spec is a regression guard against drift
// on either side of the wire.
const BLOCK_TYPE_FLAG = 27;
const BLOCK_TYPE_AIR = 0;

interface SelfView {
  id: number;
  x: number;
  y: number;
}

async function openClient(
  page: Page,
  username: string,
  color: number,
): Promise<SelfView> {
  await page.goto(`/?username=${username}&color=${color}`);
  await page.waitForFunction(() => window.__anarchy !== undefined);
  await page.waitForFunction((goldId: number) => {
    const a = window.__anarchy;
    if (!a) return false;
    return a.getLocalPlayerId() !== null && a.inventory.countOf(goldId) === 10;
  }, ITEM_GOLD);
  return await page
    .waitForFunction(() => {
      const a = window.__anarchy;
      if (!a) return null;
      const id = a.getLocalPlayerId();
      if (id === null || id === 0) return null;
      const me = a.world.getPlayer(id);
      if (!me) return null;
      return { id: me.id, x: me.x, y: me.y };
    })
    .then((h) => h.jsonValue() as Promise<SelfView>);
}

/** Find the inventory slot index holding `itemId`, or `-1` if absent. */
async function findSlotFor(page: Page, itemId: number): Promise<number> {
  return await page.evaluate((id: number) => {
    const inv = window.__anarchy!.inventory;
    for (let i = 0; i < 45; i++) {
      const s = inv.slot(i);
      if (s !== null && s.item === id) return i;
    }
    return -1;
  }, itemId);
}

test("flag craft via UI stamps the crafter's color; placement writes it to the chunk; another player breaking the flag picks up a stack with the placer's color", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const placerColor = 3;
  const breakerColor = 7;

  try {
    // ---- A: craft cloth + flag via the real crafting UI. ----
    const selfA = await openClient(a, "flag-placer", placerColor);
    // Seed A's inventory with 6 String + 1 Wood. Two Cloth come from the
    // cloth recipe (6 String → 1 Cloth at a time); the spec runs two
    // cloth crafts so the flag recipe (2 Cloth + 1 Wood) is satisfied
    // exclusively from real UI clicks.
    await adminGiveItem(selfA.id, ITEM_STRING, 12);
    await adminGiveItem(selfA.id, ITEM_WOOD, 1);
    await a.waitForFunction(
      ({ stringId, woodId }) => {
        const inv = window.__anarchy!.inventory;
        return inv.countOf(stringId) === 12 && inv.countOf(woodId) === 1;
      },
      { stringId: ITEM_STRING, woodId: ITEM_WOOD },
    );

    // Open the inventory/crafting panel.
    await a.keyboard.press("KeyE");

    // Craft cloth twice → 2 Cloth.
    await expect(
      a.locator(".anarchy-crafting-row[data-recipe-id='cloth']"),
    ).toHaveCount(1, { timeout: 5_000 });
    await a.locator(".anarchy-crafting-row[data-recipe-id='cloth']").click();
    await a.waitForFunction((id: number) => {
      return window.__anarchy!.inventory.countOf(id) === 1;
    }, ITEM_CLOTH);
    await a.locator(".anarchy-crafting-row[data-recipe-id='cloth']").click();
    await a.waitForFunction((id: number) => {
      return window.__anarchy!.inventory.countOf(id) === 2;
    }, ITEM_CLOTH);

    // Craft flag — 2 Cloth + 1 Wood → 1 Flag stamped with color 3.
    await expect(
      a.locator(".anarchy-crafting-row[data-recipe-id='flag']"),
    ).toHaveCount(1, { timeout: 5_000 });
    await a.locator(".anarchy-crafting-row[data-recipe-id='flag']").click();
    await a.waitForFunction(
      ({ flagId, woodId, clothId }) => {
        const inv = window.__anarchy!.inventory;
        return (
          inv.countOf(flagId) === 1 &&
          inv.countOf(woodId) === 0 &&
          inv.countOf(clothId) === 0
        );
      },
      { flagId: ITEM_FLAG, woodId: ITEM_WOOD, clothId: ITEM_CLOTH },
    );
    // Close the crafting panel before continuing — the place gate doesn't
    // care about the panel, but matching the user flow keeps the rest of
    // the spec close to real-world inputs.
    await a.keyboard.press("KeyE");

    // The crafted Flag stack carries A's color frozen in `extra.flag.colorIndex`.
    // Task 610 places crafted output in main first, so the flag is most
    // likely outside the hotbar (slot >= 9). Move it to a free hotbar
    // slot before placing — the place path reads `selected_hotbar_slot`.
    const flagSlotCrafted = await findSlotFor(a, ITEM_FLAG);
    expect(flagSlotCrafted).toBeGreaterThanOrEqual(0);
    const flagExtraA = await a.evaluate((slot: number) => {
      const s = window.__anarchy!.inventory.slot(slot);
      return s?.extra ?? null;
    }, flagSlotCrafted);
    expect(flagExtraA).toEqual({ kind: "flag", colorIndex: placerColor });

    const PLACE_HOTBAR_SLOT = 1; // 0 holds the default 10 Gold seed.
    if (flagSlotCrafted !== PLACE_HOTBAR_SLOT) {
      await a.evaluate(
        ({ src, dst }) => {
          window.__anarchy!.sendMoveSlot(src, dst);
        },
        { src: flagSlotCrafted, dst: PLACE_HOTBAR_SLOT },
      );
      await a.waitForFunction(
        ({ slot, flagId }) => {
          const s = window.__anarchy!.inventory.slot(slot);
          return s !== null && s.item === flagId;
        },
        { slot: PLACE_HOTBAR_SLOT, flagId: ITEM_FLAG },
      );
    }
    // Press the digit hotkey for slot N+1 (UI is 1-indexed) to drive the
    // inventory UI's `selectHotbarSlot` helper — it both updates the
    // local UI state AND ships the wire `SelectSlot` intent. A bare
    // `sendSelectSlot` wire call would update the server but the local
    // UI's selected slot (which the place validation gate reads) stays
    // at the digit-key-driven value.
    await a.keyboard.press(`Digit${PLACE_HOTBAR_SLOT + 1}`);
    await a.waitForFunction(
      (slot: number) =>
        window.__anarchy!.getSelectedHotbarSlot() === slot,
      PLACE_HOTBAR_SLOT,
    );
    await a.evaluate((tile) => {
      window.__anarchy!.sendPlaceBlock(tile.cx, tile.cy, tile.lx, tile.ly);
    }, { ...FLAG_CHUNK, ...FLAG_CELL });

    // The placed cell is a Flag block and its color sits in the chunk's
    // flagBlocks map under `flagCellKey(lx, ly)`.
    await a.waitForFunction(
      (tile) => {
        const a = window.__anarchy;
        if (!a) return false;
        const chunk = a.terrain.get(tile.cx, tile.cy);
        if (!chunk) return false;
        const idx = tile.ly * 16 + tile.lx;
        const kind = chunk.top.blocks[idx]?.kind;
        if (kind !== tile.expectedKind) return false;
        const state = chunk.flagBlocks.get(`${tile.lx},${tile.ly}`);
        return state !== undefined && state.colorIndex === tile.expectedColor;
      },
      {
        ...FLAG_CHUNK,
        ...FLAG_CELL,
        expectedKind: BLOCK_TYPE_FLAG,
        expectedColor: placerColor,
      },
    );
    // The crafted flag stack was consumed by placement.
    await a.waitForFunction((id: number) => {
      return window.__anarchy!.inventory.countOf(id) === 0;
    }, ITEM_FLAG);

    // ---- B: connect, walk in, break the flag, verify the stack color. ----
    const selfB = await openClient(b, "flag-breaker", breakerColor);
    expect(selfB.id).not.toBe(selfA.id);

    // Same wire mirror shows the placed flag with A's color.
    await b.waitForFunction(
      (tile) => {
        const a = window.__anarchy;
        if (!a) return false;
        const chunk = a.terrain.get(tile.cx, tile.cy);
        if (!chunk) return false;
        const idx = tile.ly * 16 + tile.lx;
        const kind = chunk.top.blocks[idx]?.kind;
        if (kind !== tile.expectedKind) return false;
        const state = chunk.flagBlocks.get(`${tile.lx},${tile.ly}`);
        return state !== undefined && state.colorIndex === tile.expectedColor;
      },
      {
        ...FLAG_CHUNK,
        ...FLAG_CELL,
        expectedKind: BLOCK_TYPE_FLAG,
        expectedColor: placerColor,
      },
    );

    // Teleport B adjacent to the flag (2.5, 0.5 is the tile just west of
    // (3, 0); distance to the cell center (3.5, 0.5) is 1.0 — well within
    // REACH_BLOCKS).
    await adminTeleport(selfB.id, 2.5, 0.5);

    // Hold-break the flag. Flag max_durability = 20, no matching tool
    // kind → BREAK_DAMAGE_PER_TICK = 1 per tick. ~20 ticks ≈ 1s @ 20Hz.
    await b.evaluate((tile) => {
      window.__anarchy!.sendBreakIntent({ ...tile });
    }, { ...FLAG_CHUNK, ...FLAG_CELL });
    await b.waitForFunction(
      (tile) => {
        const a = window.__anarchy;
        if (!a) return false;
        const chunk = a.terrain.get(tile.cx, tile.cy);
        if (!chunk) return false;
        const idx = tile.ly * 16 + tile.lx;
        const kind = chunk.top.blocks[idx]?.kind;
        return kind === tile.expectedKind;
      },
      { ...FLAG_CHUNK, ...FLAG_CELL, expectedKind: BLOCK_TYPE_AIR },
      { timeout: 8_000 },
    );
    await b.evaluate(() => window.__anarchy!.sendBreakIntent(null));

    // B's inventory now carries a Flag stack — stamped with A's color
    // (placerColor), NOT B's color (breakerColor). The chunk's
    // `flagBlocks` entry is also gone.
    await b.waitForFunction((id: number) => {
      return window.__anarchy!.inventory.countOf(id) === 1;
    }, ITEM_FLAG);
    const flagSlotB = await findSlotFor(b, ITEM_FLAG);
    expect(flagSlotB).toBeGreaterThanOrEqual(0);
    const flagExtraB = await b.evaluate((slot: number) => {
      const s = window.__anarchy!.inventory.slot(slot);
      return s?.extra ?? null;
    }, flagSlotB);
    expect(flagExtraB).toEqual({ kind: "flag", colorIndex: placerColor });
    const chunkAfter = await b.evaluate((tile) => {
      const a = window.__anarchy!;
      const chunk = a.terrain.get(tile.cx, tile.cy);
      return chunk ? Array.from(chunk.flagBlocks.keys()) : null;
    }, FLAG_CHUNK);
    expect(chunkAfter).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
    // Defensive cleanup: clear the test cell so subsequent specs that walk
    // through chunk (0, 0) see a quiet world.
    await adminSetBlock(
      FLAG_CHUNK.cx,
      FLAG_CHUNK.cy,
      "top",
      FLAG_CELL.lx,
      FLAG_CELL.ly,
      "air",
    ).catch(() => {});
  }
});
