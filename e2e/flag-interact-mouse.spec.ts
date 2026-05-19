import { test, expect, type Page } from "./test-shared";

import {
  adminCreateFaction,
  adminFlagInteract,
  adminFlagInteractRelease,
  adminGrantXp,
  adminPlaceFlag,
  adminTeleport,
} from "./admin";

// Task 370 e2e: real-mouse drive of the flag-interact UX. The admin-driven
// `flag-xp.spec.ts` already pins the wire layer (deposit + steal both
// move XP between player and faction); this spec is about the input →
// renderer fan-out — i.e. that a `page.mouse.down/up` on a flag tile
// routes through `break_place.ts` to `sendFlagInteractIntent` AND the
// beam mesh appears under the renderer's `FlagBeamLayer`. The shared
// `worldToClient` test handle (added in this task) is what makes the
// click land on the tile without re-implementing camera math.

const FLAG = { cx: 0, cy: 0, lx: 3, ly: 0 } as const;
const FLAG_CENTER = { x: 3.5, y: 0.5 } as const;
// 2 tiles away from the flag centre — well within the
// `FLAG_INTERACT_RANGE_TILES = 4` gate that `break_place.ts` enforces
// client-side before shipping the intent.
const ADJACENT = { x: 1.5, y: 0.5 } as const;
const BLOCK_TYPE_FLAG = 27;

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

async function setupFlagAndFaction(
  page: Page,
  playerId: number,
  factionName: string,
  color: number,
): Promise<number> {
  await adminPlaceFlag(playerId, FLAG.cx, FLAG.cy, FLAG.lx, FLAG.ly, color);
  await page.waitForFunction(
    (tile) => {
      const a = window.__anarchy;
      if (!a) return false;
      const chunk = a.terrain.get(tile.cx, tile.cy);
      if (!chunk) return false;
      const idx = tile.ly * 16 + tile.lx;
      return chunk.top.blocks[idx]?.kind === tile.expectedKind;
    },
    { ...FLAG, expectedKind: BLOCK_TYPE_FLAG },
    { timeout: 5_000 },
  );
  const factionId = await adminCreateFaction(
    FLAG.cx,
    FLAG.cy,
    FLAG.lx,
    FLAG.ly,
    playerId,
    factionName,
  );
  expect(factionId).toBeGreaterThan(0);
  await page.waitForFunction(
    (id: number) => window.__anarchy!.leaderboardStore.current().has(id),
    factionId,
    { timeout: 5_000 },
  );
  return factionId;
}

async function waitForPlayerAt(
  page: Page,
  id: number,
  x: number,
  y: number,
): Promise<void> {
  await page.waitForFunction(
    (args: { id: number; x: number; y: number }) => {
      const me = window.__anarchy!.world.getPlayer(args.id);
      return (
        me !== undefined &&
        Math.abs(me.x - args.x) < 0.1 &&
        Math.abs(me.y - args.y) < 0.1
      );
    },
    { id, x, y },
    { timeout: 5_000 },
  );
}

async function worldToClient(
  page: Page,
  worldX: number,
  worldY: number,
): Promise<{ x: number; y: number }> {
  const pixel = await page.evaluate(
    (args: { x: number; y: number }) =>
      window.__anarchy!.worldToClient(args.x, args.y),
    { x: worldX, y: worldY },
  );
  if (pixel === null) {
    throw new Error("worldToClient returned null (canvas not laid out yet?)");
  }
  return pixel;
}

test("right-mouse drag on a flag tile deposits XP and renders a beam", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const self = await openClient(page, "depositmouse", 3);
  const factionId = await setupFlagAndFaction(
    page,
    self.id,
    "RealMouseAlpha",
    3,
  );
  await adminGrantXp(self.id, 5);
  await adminTeleport(self.id, ADJACENT.x, ADJACENT.y);
  await waitForPlayerAt(page, self.id, ADJACENT.x, ADJACENT.y);
  await page.waitForFunction(
    (pid: number) => window.__anarchy!.world.getPlayer(pid)?.xp === 5,
    self.id,
  );

  // The snapshot buffer interpolates the local-player camera over
  // `REMOTE_RENDER_DELAY_MS = 100 ms`, so worldToClient is briefly stale
  // right after a teleport. One extra tick + the render delay is enough
  // for the camera to settle onto the new position.
  await page.waitForTimeout(200);

  const pixel = await worldToClient(page, FLAG_CENTER.x, FLAG_CENTER.y);
  expect(pixel.x).toBeGreaterThan(0);
  expect(pixel.y).toBeGreaterThan(0);

  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down({ button: "right" });

  try {
    // The beam mesh exists for as long as the server admits the
    // `flag_interact` (i.e. the next tick after press, until the next
    // tick after release). 5 s is generous against the 50 ms tick.
    await page.waitForFunction(
      () => window.__anarchy!.getFlagBeamCount() >= 1,
      null,
      { timeout: 5_000 },
    );
    // Deposit is 10 XP/s — wait for the faction mirror to register the
    // climb so we know the wire round-trip fired.
    await page.waitForFunction(
      (id: number) => {
        const fac = window.__anarchy!.leaderboardStore.current().get(id);
        return fac !== undefined && fac.xp >= 1;
      },
      factionId,
      { timeout: 10_000 },
    );
  } finally {
    await page.mouse.up({ button: "right" });
  }

  await page.waitForFunction(
    () => window.__anarchy!.getFlagBeamCount() === 0,
    null,
    { timeout: 5_000 },
  );
});

test("left-mouse drag on a flag tile steals XP and renders a beam", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const self = await openClient(page, "stealmouse", 5);
  const factionId = await setupFlagAndFaction(
    page,
    self.id,
    "RealMouseBeta",
    5,
  );

  // Plant XP on the faction via the admin shim so the steal has
  // something to drain. This test is about the input → renderer path
  // for the steal mode; chaining deposit-then-steal through real
  // mouse input would just re-cover the deposit assertions.
  await adminGrantXp(self.id, 10);
  await adminTeleport(self.id, ADJACENT.x, ADJACENT.y);
  await waitForPlayerAt(page, self.id, ADJACENT.x, ADJACENT.y);
  await adminFlagInteract(self.id, FLAG.cx, FLAG.cy, FLAG.lx, FLAG.ly, "deposit");
  await page.waitForFunction(
    (id: number) => {
      const fac = window.__anarchy!.leaderboardStore.current().get(id);
      return fac !== undefined && fac.xp >= 10;
    },
    factionId,
    { timeout: 10_000 },
  );
  await adminFlagInteractRelease(self.id);
  // Brief settle so the release lands a tick before the real-mouse
  // press overwrites it. Mirrors the gap in `flag-xp.spec.ts`.
  await page.waitForTimeout(100);

  await page.waitForTimeout(200);
  const pixel = await worldToClient(page, FLAG_CENTER.x, FLAG_CENTER.y);

  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down({ button: "left" });

  try {
    await page.waitForFunction(
      () => window.__anarchy!.getFlagBeamCount() >= 1,
      null,
      { timeout: 5_000 },
    );
    // Steal moves faction → player; wait for the player's xp to climb
    // off zero (the admin deposit fully drained the player's XP into
    // the faction so the post-release baseline is 0).
    await page.waitForFunction(
      (pid: number) => (window.__anarchy!.world.getPlayer(pid)?.xp ?? 0) >= 1,
      self.id,
      { timeout: 10_000 },
    );
  } finally {
    await page.mouse.up({ button: "left" });
  }

  await page.waitForFunction(
    () => window.__anarchy!.getFlagBeamCount() === 0,
    null,
    { timeout: 5_000 },
  );
});
