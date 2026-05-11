import { test, expect, type Page } from "@playwright/test";
import { adminSetBlock } from "./admin";

// Task 520 e2e: a Wood Pickaxe (below the IronOre tier gate) still
// progresses the held break, but at one durability point per
// `UNDER_TOOLED_BREAK_MULTIPLIER` ticks — dramatically slower than a
// matched-tool break. The pre-task behavior would have applied the bare
// 1 dur/tick (≈ 3 s for the 60-durability ore at 20 Hz); the
// post-task behavior is ≈ 30 s, so an `OBSERVE_WINDOW_MS` of 4 s comfortably
// distinguishes the two — under the old rate the cell would have broken
// and `RawIron` would have landed in the inventory; under the new rate
// it must still be IronOre with no drop.

const ITEM_ID_RAW_IRON = 26;
// `BlockType.IronOre` from the client mirror (`src/game/terrain.ts`).
const BLOCK_TYPE_IRON_ORE = 19;

interface SelfView {
  id: number;
  x: number;
  y: number;
}

async function openClient(page: Page, username: string): Promise<SelfView> {
  await page.goto(`/?username=${username}&color=0`);
  await page.waitForFunction(() => window.__anarchy !== undefined);
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

test("under-tooled held break: no pickaxe equipped vs IronOre tanks the break", async ({
  page,
}) => {
  const cx = 0;
  const cy = 0;
  const lx = 1;
  const ly = 0;
  try {
    await openClient(page, "under-tooled");

    // Starter loadout (testing mode) seeds the ten pickaxes / axes into
    // panel slots but intentionally does NOT auto-equip any of them. The
    // freshly admitted player therefore has no equipped pickaxe at all —
    // which is `below_gate` against any tier-gated ore, exactly the
    // scenario the task targets.

    await adminSetBlock(cx, cy, "top", lx, ly, "iron_ore");
    await page.waitForFunction(
      ({ cx, cy, lx, ly, expected }) => {
        const a = window.__anarchy;
        if (!a) return false;
        const chunk = a.terrain.get(cx, cy);
        if (!chunk) return false;
        const idx = ly * 16 + lx;
        return chunk.top.blocks[idx]?.kind === expected;
      },
      { cx, cy, lx, ly, expected: BLOCK_TYPE_IRON_ORE },
    );

    // Start the held break and let it run for an observe window long
    // enough that the pre-task behavior (1 dur/tick) would have cleared
    // the 60-durability cell, but the post-task throttled rate (1 dur per
    // `UNDER_TOOLED_BREAK_MULTIPLIER = 10` ticks) cannot.
    await page.evaluate(
      ({ cx, cy, lx, ly }) =>
        window.__anarchy!.sendBreakIntent({ cx, cy, lx, ly }),
      { cx, cy, lx, ly },
    );
    await page.waitForTimeout(4000);

    // Cell must still be IronOre — break did not finish.
    const stillOre = await page.evaluate(
      ({ cx, cy, lx, ly, expected }) => {
        const a = window.__anarchy;
        if (!a) return false;
        const chunk = a.terrain.get(cx, cy);
        if (!chunk) return false;
        const idx = ly * 16 + lx;
        return chunk.top.blocks[idx]?.kind === expected;
      },
      { cx, cy, lx, ly, expected: BLOCK_TYPE_IRON_ORE },
    );
    expect(stillOre).toBe(true);

    // No drop deposited — even if the cell eventually breaks, an
    // under-tooled finish suppresses the inventory deposit.
    const rawIronCount = await page.evaluate(
      (item) => window.__anarchy!.inventory.countOf(item),
      ITEM_ID_RAW_IRON,
    );
    expect(rawIronCount).toBe(0);

    await page.evaluate(() => window.__anarchy!.sendBreakIntent(null));
  } finally {
    // Defensive cleanup so a mid-spec failure can't seed an IronOre that
    // leaks into a later spec sharing chunk (0, 0).
    await adminSetBlock(cx, cy, "top", lx, ly, "air").catch(() => {});
  }
});
