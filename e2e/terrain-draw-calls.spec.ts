import { test, expect, type Page } from "./test-shared";
import { adminTeleport } from "./admin";

// BACKLOG 350 — measure per-frame WebGL draw-call cost at view radius 2 in
// a populated world. Captured numbers go in the DONE entry; the spec stays
// in the suite as a regression smoke (loose upper bound) so a future
// terrain-meshing regression surfaces here.
//
// The shared-server fixture clears the 5×5 spawn region (chunks
// `-2..=2`) for spawn-stability, so this spec teleports the player to a
// chunk outside that box. The destination is generated on demand by the
// admin endpoint, so the resulting view window carries 25 chunks of
// authentic worldgen output (ground + scattered top blocks).

interface SelfView {
  id: number;
  x: number;
  y: number;
}

async function openClient(page: Page, username = "draw-tester"): Promise<void> {
  await page.goto(`/?username=${encodeURIComponent(username)}&color=0`);
  await page.waitForFunction(() => window.__anarchy !== undefined);
}

async function waitForSelfSpawn(page: Page): Promise<SelfView> {
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
    .then((handle) => handle.jsonValue() as Promise<SelfView>);
}

test("phase-1 measurement: capture WebGL draw-call stats at view radius 2", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openClient(page);
  const me = await waitForSelfSpawn(page);
  expect(me.id).toBeGreaterThan(0);

  // Teleport well outside the spawn-clear box. Chunk (12, 12) is far enough
  // that the 5×5 view window (chunks 10..=14 × 10..=14) sits in fresh
  // worldgen output with grass / trees / scattered top blocks.
  const TARGET_WORLD_X = 12 * 16 + 0.5;
  const TARGET_WORLD_Y = 12 * 16 + 0.5;
  await adminTeleport(me.id, TARGET_WORLD_X, TARGET_WORLD_Y);

  // Wait until the local player position has caught up server-side AND the
  // terrain mirror carries the full 5×5 radius-2 window (25 chunks).
  await page.waitForFunction(
    ({ peerId, tx, ty }) => {
      const a = window.__anarchy;
      if (!a) return false;
      const p = a.world.getPlayer(peerId);
      if (!p) return false;
      if (Math.abs(p.x - tx) > 1 || Math.abs(p.y - ty) > 1) return false;
      let count = 0;
      for (const _ of a.terrain.iter()) count++;
      return count >= 25;
    },
    { peerId: me.id, tx: TARGET_WORLD_X, ty: TARGET_WORLD_Y },
    { timeout: 20_000 },
  );

  // The terrain group is rebuilt asynchronously from chunk events; give
  // the renderer a few frames to land them all + sample over 30 frames so
  // the per-frame `info.render` snapshot is steady-state.
  const stats = await page.evaluate(async () => {
    const a = window.__anarchy!;
    // Idle one rAF tick so terrain group updates from the latest tick
    // have rendered before we open the sample window.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const samples: Array<{
      calls: number;
      triangles: number;
      frameCounter: number;
      terrainMeshes: number;
      sceneMeshes: number;
    }> = [];
    const intervals: number[] = [];
    const sampleFrames = 30;
    let prev = performance.now();
    for (let i = 0; i < sampleFrames; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      intervals.push(now - prev);
      prev = now;
      samples.push(a.getRenderStats());
    }
    const sum = (k: keyof (typeof samples)[number]) =>
      samples.reduce((s, x) => s + x[k], 0);
    const sumIntervals = intervals.reduce((s, x) => s + x, 0);
    return {
      avgCalls: sum("calls") / samples.length,
      avgTriangles: sum("triangles") / samples.length,
      maxCalls: Math.max(...samples.map((s) => s.calls)),
      maxTriangles: Math.max(...samples.map((s) => s.triangles)),
      terrainMeshes: samples[samples.length - 1].terrainMeshes,
      sceneMeshes: samples[samples.length - 1].sceneMeshes,
      avgFrameMs: sumIntervals / intervals.length,
      maxFrameMs: Math.max(...intervals),
      sampleFrames,
    };
  });

  // Loud log so the numbers land in the test report even on green.
  // eslint-disable-next-line no-console
  console.log(
    `[terrain-draw-calls] avgCalls=${stats.avgCalls.toFixed(1)} ` +
      `maxCalls=${stats.maxCalls} ` +
      `avgTriangles=${stats.avgTriangles.toFixed(0)} ` +
      `maxTriangles=${stats.maxTriangles} ` +
      `terrainMeshes=${stats.terrainMeshes} ` +
      `sceneMeshes=${stats.sceneMeshes} ` +
      `avgFrameMs=${stats.avgFrameMs.toFixed(2)} ` +
      `maxFrameMs=${stats.maxFrameMs.toFixed(2)} ` +
      `samples=${stats.sampleFrames}`,
  );

  // Loose upper bound to catch a regression (e.g. a future change that
  // accidentally multiplies the per-chunk mesh count). Real budget should
  // be far below this; if this trips, the spec is doing its job.
  expect(stats.maxCalls).toBeLessThan(50_000);
  expect(stats.terrainMeshes).toBeGreaterThan(0);
});
