import { defineConfig } from "@playwright/test";

const SERVER_URL = "http://localhost:8080";
const VITE_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: VITE_URL,
  },
  webServer: [
    {
      // Dedicated `e2e` world (not `default`) so the dev's local world stays
      // untouched. `reuseExistingServer: false` avoids inheriting stale
      // in-memory state from a leftover server. `--test-clear-spawn-region`
      // wipes the top layer of the 5×5 chunk box around origin at fresh-
      // world generation time so specs can rely on a known walkable spawn
      // anchor (the spawn finder picks tile-center `(0.5, 0.5)`); production
      // never sets this flag.
      //
      // Task 110: `--testing` puts the server in testing mode — the world
      // and the accounts registry are in-memory only, no save file is read
      // or written, and the `/admin/*` HTTP surface (teleport-player,
      // give-item, set-block) becomes reachable. The `globalSetup` wipe is
      // kept as belt-and-suspenders defense for the case where this flag
      // gets dropped.
      // `--permissive` disables the task-010 one-session-per-peer-IP gate.
      // Every Playwright spec opens multiple browser tabs / contexts against
      // 127.0.0.1, so without this flag the multi-tab specs would start
      // rejecting the second admission with `AlreadyConnectedFromIp`. The
      // production default keeps the gate on; operators (and the e2e harness)
      // opt out explicitly.
      command: "cargo run --manifest-path ../anarchy-server/Cargo.toml -- --world e2e --testing --test-clear-spawn-region --permissive",
      url: `${SERVER_URL}/hello`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort",
      url: VITE_URL,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      // Shield the e2e bundle from a developer's local `VITE_WS_URL` override
      // (Cloudflare tunnel for sharing a build, alternative TLS host, etc.).
      // The e2e suite always targets the Playwright-managed server on the
      // localhost default; without this, a stale operator URL leaks through
      // `anarchy-client/.env` and every browser-driven spec fails with the
      // in-game "Connection lost" overlay because the bundle points the
      // WebSocket at an unreachable host.
      env: { VITE_WS_URL: "" },
    },
  ],
});
