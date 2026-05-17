import { test, expect, type Page } from "./test-shared";

import {
  adminAttackPlayer,
  adminDamageEntity,
  adminDamagePlayer,
  adminSpawnEntity,
  adminTeleport,
} from "./admin";

// Task 150 e2e: damage feedback (white mesh flash + floating "-N" red
// numbers). Covers:
//  - A real attack lands a damage number on the target.
//  - Admin damage to a remote player (no attack lifecycle) still fires a
//    damage number — the wire `DamageEvent` is source-agnostic.
//  - The local player taking damage gets a damage number on their own mesh.
//  - Entity (spider) damage fires a damage number on the spider mesh.
//  - The floating number clears within its configured lifetime.
//
// Mesh-flash count is intentionally not asserted in this spec: the 150 ms
// flash window can retire faster than Playwright's polling cadence under
// CI load, producing a false negative. `mesh_flash.test.ts` covers the
// flash module's lifecycle directly.

const CHARGE_MS = 700;
const RESOLUTION_PAD_MS = 800;
const DAMAGE_NUMBER_DURATION_MS = 800;

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

async function damageNumberCount(page: Page): Promise<number> {
  return await page.evaluate(() => window.__anarchy!.getDamageNumberCount());
}

test("strike-hit spawns a damage number on the target", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    const meA = await openClient(a, "dmg-flash-a");
    const meB = await openClient(b, "dmg-flash-b");
    await adminTeleport(meA.id, 0.5, 0.5);
    await adminTeleport(meB.id, 2.5, 0.5);
    await a.waitForFunction(
      (id: number) => window.__anarchy!.world.getPlayer(id) !== undefined,
      meB.id,
    );
    await b.waitForFunction(
      (id: number) => window.__anarchy!.world.getPlayer(id) !== undefined,
      meA.id,
    );

    expect(await damageNumberCount(a)).toBe(0);

    // Admin-driven attack: stable across CI clock skew, doesn't need
    // viewport projection. Server runs the charge → strike cycle.
    await adminAttackPlayer(meA.id, meB.id);

    await a.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() >= 1,
      undefined,
      { timeout: CHARGE_MS + RESOLUTION_PAD_MS },
    );

    await a.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() === 0,
      undefined,
      { timeout: DAMAGE_NUMBER_DURATION_MS + 600 },
    );
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("admin damage to a remote player spawns a damage number without an attack", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    const meA = await openClient(a, "dmg-admin-a");
    const meB = await openClient(b, "dmg-admin-b");
    await adminTeleport(meA.id, 0.5, 0.5);
    await adminTeleport(meB.id, 2.5, 0.5);
    await a.waitForFunction(
      (id: number) => window.__anarchy!.world.getPlayer(id) !== undefined,
      meB.id,
    );

    expect(await damageNumberCount(a)).toBe(0);

    // Admin damage bypasses the attack lifecycle entirely; the wire
    // `DamageEvent` is the only signal. Both A (observer) and B
    // (target) should observe the number — assert through A.
    const outcome = await adminDamagePlayer(meB.id, 25);
    expect(outcome.kind).toBe("alive");

    await a.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() >= 1,
      undefined,
      { timeout: 2_000 },
    );
    await a.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() === 0,
      undefined,
      { timeout: DAMAGE_NUMBER_DURATION_MS + 600 },
    );
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("local player taking damage spawns a damage number on their own mesh", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const me = await openClient(page, "dmg-flash-self");
    await adminTeleport(me.id, 0.5, 0.5);
    expect(await damageNumberCount(page)).toBe(0);

    const outcome = await adminDamagePlayer(me.id, 25);
    expect(outcome.kind).toBe("alive");

    await page.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() >= 1,
      undefined,
      { timeout: 2_000 },
    );
    await page.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() === 0,
      undefined,
      { timeout: DAMAGE_NUMBER_DURATION_MS + 600 },
    );
  } finally {
    await ctx.close();
  }
});

test("entity target: damaging a spider spawns a damage number on the spider", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const me = await openClient(page, "dmg-flash-spider");
    await adminTeleport(me.id, 0.5, 0.5);
    // Spawn a spider one tile east so it lands inside the local view.
    const spider = await adminSpawnEntity("spider", 2, 0);
    // Wait for the spider to surface on the renderer side.
    await page.waitForFunction(
      (id: number) => window.__anarchy!.getRenderedEntities()[id] !== undefined,
      spider,
    );

    expect(await damageNumberCount(page)).toBe(0);

    // Damage well below the spider's max HP so the entity survives the
    // hit — keeps the mesh in the scene through the visual.
    const outcome = await adminDamageEntity(spider, 5);
    expect(outcome.kind).toBe("alive");

    await page.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() >= 1,
      undefined,
      { timeout: 2_000 },
    );
    await page.waitForFunction(
      () => window.__anarchy!.getDamageNumberCount() === 0,
      undefined,
      { timeout: DAMAGE_NUMBER_DURATION_MS + 600 },
    );
  } finally {
    await ctx.close();
  }
});
