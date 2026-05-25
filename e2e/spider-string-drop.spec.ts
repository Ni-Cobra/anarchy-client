import { test, expect, type Page } from "./test-shared";

import {
  AdminItemId,
  adminDamageEntity,
  adminSpawnEntity,
  adminTeleport,
} from "./admin";

// Task 080 e2e: killing a spider drops 2-4 String items straight into
// the killer's inventory. The kill is driven through `/admin/damage-entity`
// with the killer attribution query parameter so the server's drop table
// fires the same way an in-engine sword swing would route through
// `damage_entity(..., Some(attacker))`.

const SPAWN_TILE = { x: 0.5, y: 0.5 } as const;
const SPIDER_TILE = { tileX: 4, tileY: 4 } as const;

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

async function readStringCount(page: Page): Promise<number> {
  return await page.evaluate((itemId: number) => {
    const inv = window.__anarchy!.inventory;
    return inv.countOf(itemId);
  }, AdminItemId.String);
}

test("killing a spider deposits 2-4 strings into the killer's inventory", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const me = await openClient(page, "spider-string");
    await adminTeleport(me.id, SPAWN_TILE.x, SPAWN_TILE.y);

    // Pre-condition: the killer's inventory carries no String.
    expect(await readStringCount(page)).toBe(0);

    const spiderId = await adminSpawnEntity(
      "spider",
      SPIDER_TILE.tileX,
      SPIDER_TILE.tileY,
    );
    expect(spiderId).toBeGreaterThan(0);

    // Wait for the spider mesh to surface so we know the chunk is in view
    // and the inventory wire path is live.
    await page.waitForFunction(
      (id: number) => {
        const a = window.__anarchy;
        if (!a) return false;
        return a.getRenderedEntities()[id] !== undefined;
      },
      spiderId,
      { timeout: 5_000 },
    );

    // Kill with attribution to the local player. Spider max HP = 20; a
    // 9999-damage hit zeroes it, and the killer query parameter routes
    // the drop table into the local player's inventory.
    const outcome = await adminDamageEntity(spiderId, 9999, me.id);
    expect(outcome.kind).toBe("killed");

    // The InventoryUpdate ships on the next tick; poll the local mirror
    // until at least one String stack lands. The drop is 2..=4 uniform.
    const finalCount = await page
      .waitForFunction(
        (itemId: number) => {
          const c = window.__anarchy!.inventory.countOf(itemId);
          return c >= 1 ? c : null;
        },
        AdminItemId.String,
        { timeout: 5_000 },
      )
      .then((handle) => handle.jsonValue() as Promise<number>);

    expect(finalCount).toBeGreaterThanOrEqual(2);
    expect(finalCount).toBeLessThanOrEqual(4);

    // Spider mesh should be gone too — the kill removed the entity from
    // its chunk before the drop ran.
    await page.waitForFunction(
      (id: number) => {
        const a = window.__anarchy;
        if (!a) return false;
        return a.getRenderedEntities()[id] === undefined;
      },
      spiderId,
      { timeout: 5_000 },
    );
  } finally {
    await ctx.close();
  }
});

test("killing a spider without killer attribution drops nothing", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const me = await openClient(page, "spider-no-attr");
    await adminTeleport(me.id, SPAWN_TILE.x, SPAWN_TILE.y);

    expect(await readStringCount(page)).toBe(0);

    const spiderId = await adminSpawnEntity("spider", 5, 5);
    await page.waitForFunction(
      (id: number) => window.__anarchy!.getRenderedEntities()[id] !== undefined,
      spiderId,
      { timeout: 5_000 },
    );

    // No killer query parameter → preserves the original removal-only
    // behaviour. No drop, no inventory mutation.
    const outcome = await adminDamageEntity(spiderId, 9999);
    expect(outcome.kind).toBe("killed");

    // Spider mesh disappears; inventory stays empty. Give the wire a
    // generous window — if a stray drop were going to fire, it would
    // ship within ~1-2 ticks (~100ms).
    await page.waitForFunction(
      (id: number) => window.__anarchy!.getRenderedEntities()[id] === undefined,
      spiderId,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(500);
    expect(await readStringCount(page)).toBe(0);
  } finally {
    await ctx.close();
  }
});

// The full-inventory-overflow case is exercised by the server-side
// integration test `world_entity_drops::killing_spider_with_full_inventory_discards_overflow_silently`
// — packing all 45 slots from the e2e harness costs ~45 sequential
// HTTP round-trips, which makes the spec flaky and slow without
// adding coverage beyond the integration test.
