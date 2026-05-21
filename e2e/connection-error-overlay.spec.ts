import { test, expect } from "@playwright/test";

// Task 190 — full-screen "Connection lost" overlay covers the two
// transport-drop trigger conditions called out in the originating
// task file:
//
//   (a) WebSocket refused on initial connect: point the client at an
//       unused localhost port via the existing `?server-port=` bypass
//       (introduced for `accounts.spec.ts`). The browser fires a quick
//       error → close pair, the connection layer's `onTransportDrop`
//       hook fires, and the bootstrap mounts the overlay.
//   (b) Mid-session server-side close: connect normally to `:8080`,
//       wait for admission, then call `window.__anarchy.stop()`. The
//       Disconnect path is caller-initiated and MUST NOT trigger the
//       overlay — this is the negative half of the assertion. (Trigger
//       (b) for a real server-side close is exercised manually per the
//       task definition; running `./stopall.sh` mid-session paints the
//       overlay because the server-initiated close fires
//       `onTransportDrop`.)
//
// The lobby-bypass (`?username=`) only fires on the *first* session, so
// the boot-time case threads through the lobby path naturally.

// `:8099` has no server bound in any of the e2e configs (Playwright's
// auto-server is on `:8080`, persistence on `:8091`, accounts on
// `:8092`, accounts-fresh-spawn on `:8093`). Connection-refused on
// every browser.
const DEAD_PORT = 8099;

test("connection-refused on boot mounts the connection-lost overlay", async ({
  page,
}) => {
  await page.goto(
    `/?username=lostboy&color=0&server-port=${DEAD_PORT}`,
  );

  const overlay = page.locator("#anarchy-connection-error-overlay.visible");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await expect(overlay.locator("h2")).toHaveText("Connection lost");

  const button = page.locator("#anarchy-connection-error-reload");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Reload");
});

test("caller-initiated Disconnect does NOT mount the overlay", async ({
  page,
}) => {
  await page.goto("/?username=stayer&color=0");

  await page.waitForFunction(
    () => !!window.__anarchy && window.__anarchy.getLocalPlayerId() !== null,
    null,
    { timeout: 10_000 },
  );

  await page.evaluate(() => window.__anarchy!.stop());

  // Give the deferred close event a chance to fire; if the gate fails the
  // overlay would mount inside this window.
  await page.waitForTimeout(500);

  const overlay = page.locator("#anarchy-connection-error-overlay.visible");
  await expect(overlay).toHaveCount(0);
});
