// Shared Playwright `test` for specs that use the auto-launched `:8080`
// server. Adds an auto-fixture that wipes the top layer of the 5×5 chunk
// spawn-protection region (chunks `(-2..=2, -2..=2)`) before every test.
//
// Why: the Playwright config launches one server for the whole run and
// every shared-server spec hits it. Anonymous disconnects spawn a
// tombstone at the disconnecting player's last cell (task 010-tombstone),
// and many specs disconnect anonymous "tester" / "anarchy-e2e" sockets
// without an explicit cleanup. Without this fixture, tombstones pile up
// at the spawn region across the run; the spawn finder skips them and
// later specs that pin `me.x === 0.5 && me.y === 0.5` fail because their
// player landed on ring 1+ instead of `(0, 0)`. Clearing the region
// before every test makes the assumption "fresh spawn is `(0.5, 0.5)`"
// reliable regardless of prior specs.
//
// Specs that drive their own server (own port: `accounts*.spec.ts`,
// `persistence.spec.ts`) should keep importing from `@playwright/test`
// directly — pointing the fixture at `:8080` would be a no-op against
// their server and would do nothing useful (or worse, race with the
// shared server's own state).

import { test as base } from "@playwright/test";

const SERVER_URL = "http://localhost:8080";

async function clearSpawnRegion(): Promise<void> {
  const r = await fetch(`${SERVER_URL}/debug/clear-top-region/-2/-2/2/2`, {
    method: "POST",
  });
  if (!r.ok) {
    throw new Error(
      `clear-top-region failed: ${r.status} ${r.statusText}`,
    );
  }
}

export const test = base.extend<{ _resetSpawnRegion: void }>({
  _resetSpawnRegion: [
    async ({}, use) => {
      await clearSpawnRegion();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
