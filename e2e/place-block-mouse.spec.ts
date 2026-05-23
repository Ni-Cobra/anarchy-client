import { test, expect, type Page } from "./test-shared";
import { adminPlaceFlag, adminTeleport } from "./admin";

// Task 010 regression e2e: drive a *real* right-click through the browser
// onto an Air tile in reach and verify the server places the held block.
// `place-block.spec.ts` already exercises the wire layer by calling
// `sendPlaceBlock` directly; this spec covers the input → wire chain that
// `break_place.ts` owns. A user-reported regression silently swallowed
// the mouse-driven place, but neither the unit tests nor the existing
// e2e exercised the mouse → wire seam end-to-end.

const FLAG_CHUNK = { cx: 0, cy: 0 } as const;
const TARGET = { lx: 2, ly: 0 } as const;
const TARGET_CENTER = { x: 2.5, y: 0.5 } as const;
const BLOCK_TYPE_AIR = 0;
const BLOCK_TYPE_GOLD = 4;

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

async function waitForTopBlockKind(
  page: Page,
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  kind: number,
): Promise<void> {
  await page.waitForFunction(
    ({ cx, cy, lx, ly, kind }) => {
      const chunk = window.__anarchy!.terrain.get(cx, cy);
      if (!chunk) return false;
      const block = chunk.top.blocks[ly * 16 + lx];
      return block !== undefined && block.kind === kind;
    },
    { cx, cy, lx, ly, kind },
  );
}

async function rightClickAtTile(
  page: Page,
  worldX: number,
  worldY: number,
): Promise<void> {
  // Snapshot buffer interpolates the camera with 100 ms render delay;
  // give it a beat to settle so worldToClient is current.
  await page.waitForTimeout(200);
  const pixel = await page.evaluate(
    (args: { x: number; y: number }) =>
      window.__anarchy!.worldToClient(args.x, args.y),
    { x: worldX, y: worldY },
  );
  if (pixel === null) {
    throw new Error("worldToClient returned null (canvas not laid out yet)");
  }
  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
}

test("real right-click on an Air tile places the held block", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const self = await openClient(page, "placemouse");
  // Task 060: spawn lands randomly inside the 32×32 origin rectangle —
  // teleport to (0.5, 0.5) so the cursor-offset target cell (2, 0) sits
  // in reach (~2.06 tiles from the player).
  await adminTeleport(self.id, 0.5, 0.5);
  await page.waitForFunction(
    (id) => {
      const a = window.__anarchy;
      if (!a) return false;
      const me = a.world.getPlayer(id);
      return me !== undefined && Math.abs(me.x - 0.5) < 0.05 && Math.abs(me.y - 0.5) < 0.05;
    },
    self.id,
  );

  // Default starter inventory has 10 Gold in slot 0 — placement ships
  // Gold to the cell once the wire round-trip lands.
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    TARGET.lx,
    TARGET.ly,
    BLOCK_TYPE_AIR,
  );

  await rightClickAtTile(page, TARGET_CENTER.x, TARGET_CENTER.y);

  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    TARGET.lx,
    TARGET.ly,
    BLOCK_TYPE_GOLD,
  );
});

test("real right-click on a non-flag, non-chest tile still places (regression: task 360 must not swallow the click)", async ({
  page,
}) => {
  // The bug report on task 010 fingered task 360's flag-interact router as
  // a likely culprit. Drive a real right-click and assert the place path
  // still ships — this would have caught a `pickFlagTargetAt` returning
  // a truthy result for a non-flag cell.
  test.setTimeout(30_000);
  const self2 = await openClient(page, "placemouse2");
  await adminTeleport(self2.id, 0.5, 0.5);
  await page.waitForFunction(
    (id) => {
      const a = window.__anarchy;
      if (!a) return false;
      const me = a.world.getPlayer(id);
      return me !== undefined && Math.abs(me.x - 0.5) < 0.05 && Math.abs(me.y - 0.5) < 0.05;
    },
    self2.id,
  );
  const ALT = { lx: 1, ly: 1 } as const;
  const ALT_CENTER = { x: 1.5, y: 1.5 } as const;
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    ALT.lx,
    ALT.ly,
    BLOCK_TYPE_AIR,
  );
  await rightClickAtTile(page, ALT_CENTER.x, ALT_CENTER.y);
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    ALT.lx,
    ALT.ly,
    BLOCK_TYPE_GOLD,
  );
});

test("real right-click on a non-flag tile within FLAG_INTERACT_RANGE_TILES of an existing flag still places", async ({
  page,
}) => {
  // Specific regression scope from task 010: when a faction flag has
  // been placed nearby, does the flag-interact router still allow
  // non-flag clicks to fall through to place? The unit test pins this,
  // but a real-mouse round-trip catches a class of bugs the unit can't
  // (e.g. a renderer pick returning Flag for the wrong cell).
  test.setTimeout(30_000);
  const self = await openClient(page, "placemouseflag");
  await adminTeleport(self.id, 0.5, 0.5);
  await page.waitForFunction(
    (id) => {
      const a = window.__anarchy;
      if (!a) return false;
      const me = a.world.getPlayer(id);
      return me !== undefined && Math.abs(me.x - 0.5) < 0.05 && Math.abs(me.y - 0.5) < 0.05;
    },
    self.id,
  );
  // Plant a flag in range of the player (player at (0.5, 0.5)).
  // Flag at chunk (0,0) local (3, 0) → tile centre (3.5, 0.5) →
  // distance 3 tiles, inside FLAG_INTERACT_RANGE_TILES (= 4).
  await adminPlaceFlag(self.id, 0, 0, 3, 0, 0);
  await page.waitForFunction(() => {
    const chunk = window.__anarchy!.terrain.get(0, 0);
    return chunk !== undefined && chunk.top.blocks[0 * 16 + 3]?.kind === 27;
  });
  // Target an Air tile *not* on the flag — (1, 0). Distance to player
  // is 0.71 tiles, comfortably in reach. Distance to flag is 2 tiles,
  // also inside FLAG_INTERACT_RANGE_TILES — so a buggy flag router
  // that intercepts based on player-flag proximity (rather than the
  // cursor's pick kind) would silently swallow this click.
  const ALT = { lx: 1, ly: 0 } as const;
  const ALT_CENTER = { x: 1.5, y: 0.5 } as const;
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    ALT.lx,
    ALT.ly,
    BLOCK_TYPE_AIR,
  );
  await rightClickAtTile(page, ALT_CENTER.x, ALT_CENTER.y);
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    ALT.lx,
    ALT.ly,
    BLOCK_TYPE_GOLD,
  );
});

test("real right-click after pressing E to open the inventory side panel still places", async ({
  page,
}) => {
  // The user-reported phrasing was "select a placeable block in
  // inventory, click an empty tile". Cover the open-inventory-then-click
  // path — clicking the world canvas while the side panel is mounted
  // should still bubble to the bootstrap-level mousedown handler.
  test.setTimeout(30_000);
  const self3 = await openClient(page, "placemouse3");
  await adminTeleport(self3.id, 0.5, 0.5);
  await page.waitForFunction(
    (id) => {
      const a = window.__anarchy;
      if (!a) return false;
      const me = a.world.getPlayer(id);
      return me !== undefined && Math.abs(me.x - 0.5) < 0.05 && Math.abs(me.y - 0.5) < 0.05;
    },
    self3.id,
  );
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    TARGET.lx,
    TARGET.ly,
    BLOCK_TYPE_AIR,
  );
  // Toggle the inventory side panel open via the E key.
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => window.__anarchy!.isInventoryOpen());
  await rightClickAtTile(page, TARGET_CENTER.x, TARGET_CENTER.y);
  await waitForTopBlockKind(
    page,
    FLAG_CHUNK.cx,
    FLAG_CHUNK.cy,
    TARGET.lx,
    TARGET.ly,
    BLOCK_TYPE_GOLD,
  );
});
