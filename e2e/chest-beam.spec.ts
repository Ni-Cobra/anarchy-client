import { test, expect, type Page } from "@playwright/test";

import { AdminItemId, adminGiveItem, adminSetBlock } from "./admin";

// Task 040 e2e: visual cue tying a player to each chest they have open.
// Drives the chest-open lifecycle end-to-end and asserts the renderer's
// chest-beam pool reflects the open-chest set carried on every
// `PlayerSnapshot`.

const CHEST_A = { cx: 0, cy: 0, lx: 3, ly: 0 } as const;
const CHEST_B = { cx: 0, cy: 0, lx: 3, ly: 1 } as const;

async function openClient(page: Page, username: string): Promise<void> {
  await page.goto(`/?username=${username}&color=0`);
  await page.waitForFunction(() => window.__anarchy !== undefined);
  await page.waitForFunction(() => {
    const a = window.__anarchy;
    if (!a) return false;
    return a.getLocalPlayerId() !== null && a.inventory.countOf(4) === 10;
  });
}

async function placeChestAt(
  page: Page,
  cx: number,
  cy: number,
  lx: number,
  ly: number,
): Promise<void> {
  await page.evaluate((tile) => {
    window.__anarchy!.sendPlaceBlock(tile.cx, tile.cy, tile.lx, tile.ly);
  }, { cx, cy, lx, ly });
  await page.waitForFunction(
    (tile) => {
      const a = window.__anarchy;
      if (!a) return false;
      const chunk = a.terrain.get(tile.cx, tile.cy);
      if (!chunk) return false;
      const idx = tile.ly * 16 + tile.lx;
      const kind = chunk.top.blocks[idx]?.kind;
      return kind !== undefined && kind !== 0;
    },
    { cx, cy, lx, ly },
  );
}

test("a beam appears per opened chest and clears on close", async ({ page }) => {
  test.setTimeout(20_000);
  await openClient(page, "chest-beam");

  const playerId = await page.evaluate(
    () => window.__anarchy!.getLocalPlayerId()!,
  );
  await adminGiveItem(playerId, AdminItemId.Chest, 2);
  await page.waitForFunction(
    () => window.__anarchy!.inventory.countOf(36) === 2,
  );

  try {
    await page.keyboard.press("Digit2");
    await page.waitForFunction(
      () => window.__anarchy!.getSelectedHotbarSlot() === 1,
    );
    await placeChestAt(page, CHEST_A.cx, CHEST_A.cy, CHEST_A.lx, CHEST_A.ly);
    await placeChestAt(page, CHEST_B.cx, CHEST_B.cy, CHEST_B.lx, CHEST_B.ly);
    await page.waitForFunction(
      () => window.__anarchy!.inventory.countOf(36) === 0,
    );

    // No chests open yet → no beams.
    expect(
      await page.evaluate(() => window.__anarchy!.getChestBeamCount()),
    ).toBe(0);

    await page.evaluate((tile) => {
      window.__anarchy!.sendOpenChest(tile.cx, tile.cy, tile.lx, tile.ly);
    }, CHEST_A);
    await page.waitForFunction(
      () => window.__anarchy!.getChestBeamCount() === 1,
    );

    await page.evaluate((tile) => {
      window.__anarchy!.sendOpenChest(tile.cx, tile.cy, tile.lx, tile.ly);
    }, CHEST_B);
    await page.waitForFunction(
      () => window.__anarchy!.getChestBeamCount() === 2,
    );

    // Close A — one beam left, pointed at B.
    await page.evaluate((tile) => {
      window.__anarchy!.sendCloseChest(tile.cx, tile.cy, tile.lx, tile.ly);
    }, CHEST_A);
    await page.waitForFunction(
      () => window.__anarchy!.getChestBeamCount() === 1,
    );

    await page.evaluate((tile) => {
      window.__anarchy!.sendCloseChest(tile.cx, tile.cy, tile.lx, tile.ly);
    }, CHEST_B);
    await page.waitForFunction(
      () => window.__anarchy!.getChestBeamCount() === 0,
    );
  } finally {
    await adminSetBlock(CHEST_A.cx, CHEST_A.cy, "top", CHEST_A.lx, CHEST_A.ly, "air").catch(() => {});
    await adminSetBlock(CHEST_B.cx, CHEST_B.cy, "top", CHEST_B.lx, CHEST_B.ly, "air").catch(() => {});
  }
});

