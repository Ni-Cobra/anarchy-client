# anarchy-client — architecture

This document is a human onboarding guide. If you have never seen the
client codebase before and want to ship your first change, this is the
file to read. The companion files have different audiences: `CLAUDE.md`
is agent-shaped operating instructions, and the load-bearing decisions
behind what you see here live as ADRs in the sibling repo
(`anarchy-server/docs/decisions/`). Wherever this file would otherwise
duplicate one of those, it links to it instead.

## 1. Mission and invariants

`anarchy-client` is the browser frontend for **Project Anarchy** — a
top-view 2D Minecraft-flavored real-time multiplayer game. The sibling
repo `anarchy-server` (Rust + tokio + axum) is the authority for every
byte that matters: positions, inventories, block state, combat
outcomes, time-of-day. The client renders, interpolates, and submits
*intent*; it never owns authoritative state.

Stack: TypeScript (strict), Three.js (WebGL), Vite (dev server +
bundler), protobufjs (wire codec), Playwright + vitest (tests). One
single-page bundle; no server-side rendering.

The invariants below are not negotiable. If a change appears to require
breaking one, that is the moment to stop and write a `BLOCKERS.md`
entry.

- **The server is always right.** The client never advances
  authoritative state. Movement keys produce *intent* (a unit-vector
  push); breaks and places and attacks and crafts ship as `*Intent` /
  `*Request` frames; the server's next `TickUpdate` /
  `InventoryUpdate` / `ChestUpdate` is the canonical result. A
  misbehaving client can lie about intent but cannot teleport.
- **Module boundaries are load-bearing.** `game/` is network-free
  (no `three`, no `../net/`, no `../gen/`). `net/` is the only place
  WebSockets *and* protobuf types are touched. `render/` is the only
  place `three` is imported. `input/` is free of both. The bootstrap
  layer (`main.ts` + `bootstrap/` + `lobby.ts` + `dev/terrain_stub.ts`)
  is the only place `window` / `document` are touched directly. The
  rationale is wire-format / rendering portability and unit
  testability; preserve it.
- **Prediction is currently disabled (ADR 0003 §7).** Local and remote
  players both render from `SnapshotBuffer` with the same
  `REMOTE_RENDER_DELAY_MS` (100 ms) interpolation lag. Local input
  feels the server tick; this is the known regression until prediction
  is reintroduced.
- **Lobby vs. in-game split.** The page goes through two distinct
  lifecycles: `lobby.ts` collects identity, `bootstrap/index.ts`
  constructs a session, the session runs until `stop()` (Disconnect
  button, transport drop, lobby reject), then the lifecycle loop
  returns to the lobby. Keep these layers separated — bootstrap should
  not know how the lobby is rendered, and vice versa.
- **Proto schema is canonical in the server repo.** The client
  consumes a mirror. Never edit `anarchy-client/proto/` directly — see
  §7.

## 2. The 30-second map

```
                        index.html
                            │
                            ▼
                  ┌───────────────────────┐
                  │       main.ts         │
                  │  parse query string   │
                  │  pick lobby bypass    │
                  │  resolveWsUrl(...)    │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ bootstrap/runApp loop │
                  │ ┌───────────────────┐ │
                  │ │   lobby.showLobby │◄┼─── on Disconnect / reject
                  │ │  (or query bypass)│ │
                  │ └─────────┬─────────┘ │
                  │           ▼           │
                  │  constructSession({   │
                  │    identity, wsUrl }) │
                  └───────────┬───────────┘
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
   ┌─────────┐         ┌─────────────┐           ┌──────────────┐
   │  net/   │◄────────│   game/     │──────────►│   render/    │
   │ connect │ writes  │  World      │ reads     │  Renderer    │
   │ wire    │  ──►    │  Terrain    │ ──►       │  SceneGraph  │
   │ codec   │         │  Snapshot   │           │  effects     │
   └────┬────┘         │  Inventory  │           │  daylight    │
        │              │  RosterStore│           │  lights      │
        │              │  ChestState │           └──────┬───────┘
        │              │  Leaderboard│                  │
        │              │  Projectile │                  │
        │              └─────────────┘                  ▼
        │                     ▲                  Three.js canvas
        │              ┌──────┴──────┐                  ▲
        │              │   input/    │                  │
        │              │ controller  │                  │
        │              │ keymap      │                  │
        │              └─────────────┘                  │
        │                     ▲                         │
        │              ┌──────┴──────┐           ┌──────┴───────┐
        │              │  bootstrap/ │           │     ui/      │
        │              │ keybindings │           │ inventory,   │
        │              │ break_place ├──────────►│ crafting,    │
        │              │ actions     │   actions │ chest, chat, │
        │              │ register    │   from UI │ HUDs, overlay│
        │              │ session     │           └──────────────┘
        │              └──────┬──────┘
        │                     │
        ▼                     ▼
   ws://server:8080/ws    window listeners
   (protobuf binary)      (DOM events)
```

A live frame, top to bottom:

1. The WebSocket receives a binary `ServerMessage`. `net/connection.ts`
   decodes it and dispatches into `net/wire.ts:applyServerMessage`
   (`anarchy-client/src/net/wire.ts:152`).
2. `applyServerMessage` routes per message kind: `welcome` clears
   state, `tickUpdate` flows through `wire_tick.ts` (chunk fan-out +
   per-tick effects), `inventoryUpdate` through `wire_inventory.ts`,
   etc.
3. The handlers write into the in-memory game stores: `World`,
   `Terrain`, `SnapshotBuffer`, `Inventory`, `RosterStore`,
   `LeaderboardStore`, `ChestState`, `ProjectileStore`.
4. `Renderer.frame` (driven by Three.js' animation loop) reads those
   stores, composes interpolated positions
   (`render/compose.ts:composePlayerEntities`), syncs / dashes /
   shakes / draws.
5. DOM overlays (HUDs, inventory, crafting, chat, leaderboard) read
   the same stores via the per-overlay `mount*` handles, refreshed
   from the bootstrap-owned rAF pump (`bootstrap/session.ts:pumpCoords`)
   or per-message subscriptions.
6. User input flows the other way: the `InputController`
   (`src/input/controller.ts`) emits `MoveIntent` via the action
   senders; mouse + keyboard handlers in `bootstrap/break_place.ts` /
   `bootstrap/keybindings.ts` ship break / place / attack / hotbar /
   chest / register actions; the UI overlays ship inventory + crafting
   actions through the same senders.

## 3. Layering rules and the boundary audit

The directory layout under `src/` is not cosmetic. Each top-level
directory is a layer with an enforced import boundary. The rules
landed in repeated boundary audits (see `DONE_ARCHIVE.md` for
precedent, but don't read it cold — it's huge); the high-level shape:

| Layer            | May import                            | Must NOT import                      |
| ---------------- | ------------------------------------- | ------------------------------------ |
| `src/game/`      | own files; `config.ts`                | `three`, `../net/`, `../render/`, `../gen/` |
| `src/net/`       | `../game/`, `../gen/` (proto), `config.ts` | `three`, `../render/`, `../ui/`, DOM |
| `src/render/`    | `../game/`, `three`, `config.ts`      | `../net/`, `../gen/`, `window`/`document` |
| `src/input/`     | `../game/` types, `config.ts`         | `three`, `../net/`, `../gen/`, `../render/` |
| `src/ui/`        | `../game/` (types/helpers), `config.ts`, `document` | `three`, `../net/`, `../gen/` |
| `src/bootstrap/` | every layer above + `window`/`document` | nothing — bootstrap is the integrator |
| `src/main.ts`    | `bootstrap`, `lobby`, `ws_url`, `game` validators | game/wire/render internals |

`index.ts` files re-export only what is consumed *outside* the
directory. Intra-module helpers import from the file directly. Tests
sit next to source as `*.test.ts` (vitest) or in `e2e/` (Playwright).

Why this matters in practice:

- The `three`-confined-to-render rule means a future port to a
  different renderer (or a headless test mode) is a localized change.
- The protobuf-confined-to-net rule means everything below `net/`
  works on plain TypeScript shapes (`Player`, `Chunk`, `ItemStack`
  etc.) — easy to unit-test and easy to mutate in fixtures.
- The DOM-confined-to-bootstrap rule means the renderer takes a
  `container: HTMLElement` + `Viewport` and exposes a `resize(w, h)`
  hook; the page-level listeners that drive it live in
  `bootstrap/session.ts:523` so the renderer stays portable across
  embedding strategies.

When in doubt about a leak, look at the precedent in `DONE.md` (the
short, current one — not the archive) and prefer adding a sink
interface over widening an import.

## 4. Module map

### `src/main.ts` — page entry

`src/main.ts:40` parses the URL search params, decides whether to
short-circuit to `dev/terrain_stub.ts` (`?stub-terrain=1`), mounts the
help dialog, and calls `bootstrap.runApp(...)`. It builds a
`LobbyIdentity` from `?username=&color=` for Playwright bypass, and
calls `ws_url.resolveWsUrl(params)` to pick the WebSocket endpoint.

The lobby-bypass query is the seam Playwright uses to drive a real
session without scripting the lobby form (see `client-app.spec.ts`).
The `?server-port=NNNN` query string lets the accounts e2e spec point
the bundle at its own server instance.

### `src/ws_url.ts` — security-gated endpoint resolver

`src/ws_url.ts:23` resolves the WebSocket URL with a precedence chain:

1. `?ws=<full-url>` — full override (dev builds only).
2. `?server-port=NNNN` — `ws://localhost:NNNN/ws` (dev builds only).
3. `import.meta.env.VITE_WS_URL` (operator-configured at build/dev
   time via `anarchy-client/.env`).
4. Fall through to the bootstrap default (`ws://localhost:8080/ws`).

The URL-bar overrides are gated on `import.meta.env.DEV` because they
would otherwise let an attacker craft
`https://anarchy.example/?ws=wss://evil/ws` and exfiltrate the user's
password during lobby submit. The gate is documented in the file's
header and pinned by `ws_url.test.ts`. Don't relax it.

### `src/lobby.ts`, `lobby_dom.ts`, `lobby_style.ts`

Two-mode form (ADR 0007). The "New player" tab collects username +
color (anonymous fresh-Hello path); the "Returning player" tab
collects username + password (reconnect-with-optional-password path).
The chosen identity is shipped as the first `ClientHello` frame and
gates server-side admission.

`lobby.ts:showLobby` resolves with the validated `LobbyIdentity` once
the user submits. The DOM is removed *before* the promise resolves so
the renderer canvas takes over a clean body. On `LobbyReject` the
lifecycle loop in `bootstrap/index.ts:64` re-shows the lobby with the
prior inputs pre-filled and `lobbyRejectMessage(reason)` rendered above
the form.

`lobby_dom.ts` owns the static scaffold; `lobby_style.ts` injects the
CSS once. The split exists so `lobby.ts` reads as state-machine logic
rather than `document.createElement` noise.

### `src/platform.ts`, `mobile_unsupported.ts`

Mobile UA gate. `lobby.ts:56` calls `isMobileUserAgent()` and, on
match, renders an apologetic "desktop only" page and returns a
never-resolving promise that parks the lifecycle loop. Project Anarchy
has no mobile controls today; the gate is a guard, not a feature flag.

### `src/bootstrap/` — the integrator

This is the only layer allowed to know about every other layer at the
same time. New code should land in the narrowest sibling so `index.ts`
stays focused on the public seam (`runApp` loop, `runMain` thin
wrapper, `AnarchyHandle` re-export).

- **`bootstrap/index.ts`** — the lifecycle loop. `runApp(initial,
  wsUrl)` loops: show lobby (unless we have an identity from query
  bypass), construct a session, await its `stopped`, decide whether
  the disconnect was a reject and re-prefill the lobby accordingly,
  repeat (`bootstrap/index.ts:64`). `window.__anarchy` always points
  at the current live session — set on each spawn, cleared on
  disconnect.
- **`bootstrap/session.ts`** — `constructSession({ identity, wsUrl })`.
  This is the construction graph for one session: it builds `World`,
  `SnapshotBuffer`, `Terrain`, `Inventory`, `ChestState`,
  `RosterStore`, `LeaderboardStore`, `ProjectileStore`, the local
  attack-charge tracker; constructs the `Renderer` against
  `document.body`; opens the WebSocket via `net.connect` with every
  callback wired into the right sink; mounts every HUD / overlay /
  cooldown ring / corner-action / help dialog; binds the input
  controller, the keybindings, and the break-and-place handlers;
  finally assembles the Playwright-facing `AnarchyHandle`. Every
  owned resource pushes a teardown into a list; `stop()` drains the
  list in reverse so dependencies tear down before what they depend on
  (`bootstrap/session.ts:443`). Ordering between bindings is
  load-bearing — see the comments at every forward-declare.
- **`bootstrap/keybindings.ts`** — `keydown` and `wheel` listeners:
  `E` inventory toggle, `M` zoom-out toggle, `+`/`-`/numpad zoom,
  `Digit1..9` hotbar select, mouse wheel hotbar cycle, `Ctrl+Wheel`
  zoom, `Enter` opens chat. Letter keys match on `event.key` for
  AZERTY/QWERTY portability; non-letter keys match on `event.code`.
  Owns the local `zoomedOut` flag and an `attachedAt` timestamp that
  rejects the lobby's Enter keystroke from leaking into the
  freshly-mounted session via a microtask race.
- **`bootstrap/break_place.ts`** — mouse-driven action wiring (ADR
  0006): cursor-NDC mirror into `renderer.setCursorNdc`, left-mouse-
  down → start held break with heartbeat resend every
  `BREAK_HEARTBEAT_TICKS`, mousemove → retarget, mouseup → release,
  right-mouse-down → place block / open chest / start
  attack / fire blowgun / flag-XP interact (the click router picks the
  right action by inspecting the picked target, the held hotbar item,
  and the player's reach + cooldown state). `contextmenu` is
  suppressed so right-click doesn't pop the browser menu.
- **`bootstrap/actions.ts`** — wire-frame senders for every player
  action (`sendMoveIntent`, `sendBreakIntent`, `sendPlaceBlock`,
  `sendSelectSlot`, `sendMoveSlot`, `sendTransferItems`, `sendCraft`,
  `sendCraftMax`, `sendEquipTool`, `sendUnequipTool`, `sendOpenChest`,
  `sendCloseChest`, `sendAttackIntent`, `sendFireBlowgunIntent`,
  `sendCreateFactionIntent`, `sendFlagInteractIntent`,
  `sendRegisterAccount`, `sendChat`). Owns the per-session monotonic
  `actionSeq` counter — every sequenced send is gated by
  `++actionSeq` even though prediction is currently retired (the
  server still expects a strictly-increasing counter).
- **`bootstrap/register_flow.ts`** — in-game `RegisterAccount` flow
  (ADR 0007). Owns the modal handle, the pending
  `RegisterAccountResult` callback, and the `registered` latch. The
  corner-actions panel rebuilds itself when the latch flips, dropping
  the Register button.
- **`bootstrap/toast.ts`** — tiny in-session toast banner used by the
  register flow (~3s fade).
- **`bootstrap/cursor_hint.ts`** — transient bottom-of-screen chip
  used by `break_place` to surface "Attack on cooldown",
  "Need iron pickaxe", etc. without a blocking dialog.

### `src/net/` — WebSocket + wire bridge

Only place protobuf (`../gen/anarchy.js`) is touched. Only place
WebSockets are constructed.

- **`net/connection.ts`** — `connect(url, identity, onMessage, hooks)`.
  Opens the WebSocket; sends `ClientHello` on `open` carrying the
  identity (`net/connection.ts:119`); starts a heartbeat that pings
  every `PING_INTERVAL_MS` and closes the socket after
  `RECV_TIMEOUT_MS` of silence; routes `LobbyReject` /
  `RegisterAccountResult` to caller hooks before passing other
  messages to `onMessage`; surfaces non-reject, non-caller-initiated
  drops via `onTransportDrop` (drives the "Connection lost"
  overlay). Owns the per-connection `seq` counter that every outbound
  envelope carries.
- **`net/wire.ts`** — top-level `applyServerMessage` dispatcher
  (`net/wire.ts:152`). Routes `welcome` / `tickUpdate` /
  `inventoryUpdate` / `chestUpdate` / `connectedPlayersList` /
  `chatHistory` / `pong` to the per-handler module. Owns the
  `WireDeps` and `LocalPlayerSink` interfaces — the shape of every
  store + sink the handlers may touch.
- **`net/wire_tick.ts`** — the workhorse. Per ADR 0003 each tick the
  server ships a per-client `TickUpdate` carrying:
  - `full_state_chunks`: chunks newly entering view *or* dirtied this
    tick. The handler overwrites the matching `Terrain` entry and
    pushes one snapshot-buffer sample per player in the chunk.
  - `unmodified_chunks`: still-in-view, unchanged — receivers leave
    them alone.
  - Implicit unload: any chunk in the receiver's last-known view that
    appears in neither list is dropped.

  Then the `World` player set is rebuilt from the union of players
  across the post-tick terrain (`net/wire_tick.ts:345`), and the
  per-tick effects feed (`edits`, `targets`, `attackEvents`,
  `damageEvents`, `deathEvents`, `projectiles`, `projectileImpacts`,
  `flagInteracts`, plus the synced `time_of_day_seconds` scalar) fans
  out through `EffectsSink` / `DaylightSink`. ADR 0003 §2 amendment
  (2026-05-26): a chunk shipped without `ground`/`top` layers means
  "players-only dirty" — we merge the fresh players / entities /
  flag-blocks onto the existing local terrain copy and the chunk
  decoder asserts the layers are present for *new* chunks
  (`net/wire_tick.ts:666`).
- **`net/wire_inventory.ts`** — `InventoryUpdate` ingest. Defensive
  slot-count check + `Inventory.replaceFromWire`. Per-player only —
  the server never ships another player's inventory.
- **`net/wire_chest.ts`** — `ChestUpdate` ingest. `chest === null`
  means "close this chest" (range loss / explicit close / chest
  broken); otherwise the open-chest mirror replaces.
- **`net/wire_chat.ts`** — full chat-history replace. The server is
  the source of truth for the rolling history; the HUD always paints
  whatever the latest envelope carries.
- **`net/wire_ping.ts`** — `Pong` → RTT sample. The coords HUD reads
  the latest sample each frame.
- **`net/wire_roster.ts`, `net/wire_leaderboard.ts`** — connected-
  players list and faction-leaderboard delta/snapshot. Both stores
  are mutated in place and re-read by the corresponding HUD on every
  tick.
- **`net/wire_codec.ts`** — shared decode primitives
  (`blockTypeFromWire`, `facingFromWire`, `tileFromWire`, `coordKey`,
  `toNumber`). Side-effect-free.

If you're adding a new server message: extend the proto schema in the
server repo, run `scripts/sync-proto.sh`, regenerate the TS bindings
(`npm run proto:gen`), add a `wire_<kind>.ts` sibling, and route it
from `applyServerMessage`. Don't grow `wire.ts` itself.

### `src/game/` — authoritative-state mirror, network-free

The shape of every game-domain type tracks the server's
`crate::game::*` modules so the proto payloads ingested in
`net/wire_tick.ts` map 1:1.

- **`game/world.ts`** — `World`. Map of `PlayerId → Player`, replaced
  wholesale by `applySnapshot(players)` each tick. The wire layer
  rebuilds it from the union of players across loaded chunks.
- **`game/snapshot_buffer.ts`** — per-player ring of recent positions
  for render-time interpolation. `sample(t)` interpolates between
  bracketing observations; per ADR 0001 it clamps to the newest
  sample rather than extrapolating (no client-side prediction).
- **`game/terrain.ts`** — `BlockType` (50+ variants covering grass,
  ores, decorative content, chests, flags, tombstones, lanterns…),
  `Block`, `Layer` (16×16 flat array), `Chunk` (named `ground`/`top`
  layers plus per-chunk players / entities / flag-blocks), `Terrain`
  (the map). The `Terrain` is keyed by a single packed
  `(cx, cy)` 32-bit number (`chunkKeyNum`) rather than a string —
  earlier code used `"cx,cy"` keys and allocated a fresh string on
  every lookup. The `Hidden` block-type variant is the server's
  anti-cheat occlusion sentinel — render it as a neutral occluder and
  refuse targeting; the server never holds it in authoritative state.
- **`game/player.ts`** — `Player`, `PlayerId`, `Direction8`,
  `DEFAULT_FACING`, `EffectKind`, `MAX_PLAYER_HEALTH`,
  `OpenChestRef`. `PlayerId` is `number` here vs. `u64` on the server
  — that's the only acceptable shape divergence.
- **`game/entity.ts`** — tile-bound entities (today: `Spider`).
  Mirror of the server `EntityComponent`.
- **`game/inventory.ts`** — fixed-size `Inventory` (`INVENTORY_SIZE`),
  `HOTBAR_SLOTS`, `ItemId` enum, `ItemStack`, `ToolKind`, the recipe
  shape (`CraftableRecipe` / `RecipeAvailability`). Mutations come
  exclusively through `replaceFromWire` — never mutate a slot in
  response to a local click; the server is authoritative.
- **`game/chest_state.ts`, `chest_key.ts`** — open-chest mirror.
  Today singleton, structured for multi-chest (`chestKey` is the
  packed `(cx, cy, lx, ly)` identifier).
- **`game/projectiles.ts`** — per-tick projectile store written by
  the wire layer and read by the projectile render layer.
- **`game/roster.ts`, `leaderboard.ts`** — backing stores for the
  player-list HUD and faction-leaderboard HUD.
- **`game/palette.ts`** — color palette + username validator,
  shared between lobby and renderer mesh colorization.
- **`game/local_attack_charge_tracker.ts`** — tracks whether the
  local player is mid attack-charge. The input controller asks
  before every flush whether to suppress outbound `MoveIntent`
  (the server is going to ignore them while charging).
- **`game/place_validation.ts`** — client-side mirror of the
  server's place-validator: reach + AABB overlap + top-Air gate.
  Lets the right-click handler refuse visibly out-of-reach actions
  before they hit the wire.
- **`game/faction_name.ts`** — name validator for the create-faction
  dialog.

### `src/render/` — Three.js view

The only place `three` is imported. Network- and DOM-agnostic.

- **`render/renderer.ts`** — `Renderer`. Owns the Three.js render
  loop. `frame()` runs each animation frame:
  `compose` → dash override → `syncPlayerMeshes` →
  `updateCamera` → `updateDaylight` → lantern body unlit →
  hover billboards → ghost preview → effects update →
  break particles → entity layer update → chest beams →
  beams / attack-beams / flag-beams → slow-particles →
  projectiles → slashes → mesh-flash + damage numbers →
  WebGL render. The cadence is whatever rAF gives us; the wire
  cadence (server ticks) is independent.
- **`render/scene_graph.ts`** — `SceneGraph`. Owns every persistent
  GPU resource: the scene root, camera, ambient + sun + moon lights,
  the terrain group, the player group, the entities group, and the
  effects sublayers (`beams`, `attackBeams`, `flagBeams`, `slashes`,
  `damageNumbers`, `projectiles`, `slowParticles`,
  `lanternLights`, `torchLights`, `mushroomLights`,
  `breakParticles`, `ghost`, `effects`). The renderer never
  constructs GPU resources directly; it only drives the ones the
  graph owns.
- **`render/compose.ts`** — `composePlayerEntities(world, buffer,
  nowMs)` reads the snapshot buffer with `REMOTE_RENDER_DELAY_MS`
  lag and produces the per-frame `RenderableEntity[]` the renderer
  syncs into meshes.
- **`render/terrain.ts`** — chunk meshing. The renderer rebuilds a
  chunk's sub-group on every `applyChunkLoaded` (a chunk arrived or
  was replaced) and drops it on `applyChunkUnloaded`. Neighbour
  chunks are queried for the hidden-AO pass — this is why the
  wire-tick handler inserts every full-state chunk into `terrain`
  before fanning out `onChunkLoaded` (`net/wire_tick.ts:341`).
- **`render/player_mesh.ts`, `entity_layer.ts`** — per-player /
  per-entity mesh construction and reconciliation. Player meshes
  carry hover billboards (username on cursor-hover), lantern body
  unlit treatment, and color tint from `palette`.
- **`render/picker.ts`** — `pickBlockUnderCursor`,
  `pickPlayerUnderCursor`, `pickEntityUnderCursor`. NDC-driven
  raycasts that keep callers out of `three`.
- **`render/ghost.ts`, `ghost_mesh.ts`** — the translucent "where
  the next place would land" preview, computed every frame from
  `(held hotbar item, picked cell, world, terrain, localPlayer)`.
- **`render/effects/`** — `EffectsLayer` (block-edit particles,
  target outlines), `beam.ts` (place beams + chest beams + held-
  break target outlines), `break_particles.ts`,
  `slow_particles.ts`. Each sublayer owns its own pool.
- **`render/attack_beam_layer.ts`, `slash_layer.ts`,
  `flag_beam_layer.ts`, `projectile_layer.ts`,
  `damage_numbers_layer.ts`, `mesh_flash.ts`** — combat /
  interaction effect overlays. Each is driven by the
  matching `EffectsSink` fan-out from the wire layer.
- **`render/lantern_lights.ts`, `torch_lights.ts`,
  `mushroom_lights.ts`** — light-pool management. Each pool picks
  the N nearest sources around the local-player focus and scales
  intensity by the day-cycle's `nightFactor`. Light pools are
  load-bearing for performance — don't grow them past the
  configured pool size without measuring.
- **`render/daylight.ts`** — `sampleDaylight(timeOfDaySeconds)`
  returns the day-cycle envelope (sun direction + color, moon, ambient
  tint, sky background, night factor). The wire layer plumbs the
  server-authoritative `time_of_day_seconds` scalar in every
  `TickUpdate`; the renderer samples it each frame.
- **`render/zoom.ts`, `screen_shake.ts`** — camera transforms.
  `ZoomController` owns the smoothed camera height (M-key preset
  + `+`/`-`/`Ctrl+Wheel` continuous). `ScreenShake` is the damage-
  feedback shake; the offset perturbs both `camera.position` and the
  look-at by the same vector so the view translates without rotating.
- **`render/world_to_client.ts`** — `projectWorldToClient`. Exposed on
  the test handle so Playwright can drive `page.mouse.move(x, y)`
  against a tile centre without reproducing the camera math.

### `src/input/` — keyboard → MoveIntent

- **`input/keymap.ts`** — `keyToDirection(code)` maps WASD + arrows
  to unit-direction tuples. `SCROLL_KEY_CODES` is the set of keys
  whose default browser behavior should be preempted.
- **`input/controller.ts`** — `InputController`. Tracks held keys,
  computes a normalized intent each `INPUT_TICK_INTERVAL_MS`, and
  emits `sendMoveIntent(dx, dy)` *only* when the intent changes or
  every `INPUT_HEARTBEAT_TICKS` (so a dropped packet can't strand the
  server with a stale view). Robust against OS auto-repeat (the
  `held` set is refilled idempotently on every `keydown`, including
  `event.repeat`) and against the attack-charge gate
  (`MoveIntentGate` lets the controller suppress sends while the
  server is ignoring intent anyway; the first post-charge intent is
  force-sent). `clampIntent` mirrors the server's `Intent::clamped`
  (NaN/∞ → 0, magnitude > 1 → unit) — strictly defense-in-depth
  since the server is authoritative.

### `src/ui/` — DOM overlays

Each overlay is self-contained: it injects its own CSS, mounts its own
DOM, exposes an `unmount`. Bootstrap composes the set; UI components
don't know about each other.

- **`ui/inventory/`** — hotbar (always visible) + side panel (toggled
  with `E`). The panel mounts the player grid; chest panels register
  their cells via `inventoryUiInner.wireChestSlot(chestKey, idx, cell)`
  so the shared `dragdrop.ts` state machine handles cross-grid drag,
  right-click split, and click-to-withdraw uniformly. Server
  snapshots are the source of truth; the UI never optimistically
  mutates a slot.
- **`ui/crafting/`** — recipe list sliding in alongside the
  inventory side panel. Rows are driven by
  `InventoryUpdate.craftable_recipe_ids`. Left-click on a row →
  `sendCraft`; right-click → `sendCraftMax` (task 240 mass-craft).
  The freeze-order behavior (clicked row inserts after the click
  position so the next click stays on the same row) lives in
  `crafting/row.ts`.
- **`ui/chest/`** — chest panel. Opens automatically when
  `ChestUpdate` lands with a non-null `chest`; closes when the
  server ships a closed sentinel. With multi-chest open the panel
  manager (`chest/panel_manager.ts`) stacks per-location panels;
  the X-button ships `sendCloseChest`.
- **`ui/coords_hud.ts`, `hp_bar.ts`, `xp_label.ts`,
  `sword_cooldown_ring.ts`, `death_overlay.ts`, `chat_hud.ts`,
  `chat_input.ts`, `player_list_hud.ts`, `leaderboard_hud.ts`,
  `corner_actions.ts`, `discord_button.ts`, `help_button.ts`,
  `help_dialog.ts`, `register_modal.ts`, `create_faction_dialog.ts`,
  `connection_error_overlay.ts`, `onboarding_hint.ts`,
  `tooltip.ts`, `slot_cell.ts`, `panel_palette.ts`,
  `hud_scaffold.ts`, `input_gate.ts`, `modal_contextmenu.ts`** —
  the rest of the HUD chrome. Each `mount*` returns a handle with
  `update(...)` / `unmount()` and lives or dies with the session.
- **`ui/connection_error_overlay.ts`** — full-screen "Connection
  lost" overlay shown by the `onTransportDrop` hook on the
  connection. It attaches an input gate to dim the canvas until
  the player hits Reload.

### `src/dev/terrain_stub.ts`

Dev-only entrypoint. `?stub-terrain=1` skips the WebSocket connection
and renders a hand-built `Terrain` so the terrain renderer can be
exercised without a server. Useful when you're iterating on chunk
meshing or texture work.

### `src/config.ts`

Operator-tunable constants: speeds, intervals, reconciliation
distance, render delays, ranges, cooldowns, zoom limits, the
heartbeat / receive-timeout pair, blowgun cooldown, etc. Values that
must agree with the server are mirrored from `anarchy-server/src/config.rs`
— notably `MAX_SPEED`. If you change one of those, update both.

Visual constants that don't need operator tuning (mesh sizes, axis-line
colors, render-internal magic numbers) stay co-located with the
render module that owns them.

### `src/textures.ts`, `recipes.ts`, `tool_tier.ts`, `item_names.ts`

Shared catalogs that don't fit cleanly under any one layer:

- `textures.ts` — `BLOCK_REGISTRY` (per-`BlockType` texture handle,
  break tier, drop kind, render hints). Mirror of the server's
  `BlockMeta::min_tool_tier` for the client-side mining gate.
- `recipes.ts` — recipe display metadata for the crafting panel.
- `tool_tier.ts` — `ToolTier` enum + display names. Used by the
  break_place reach gate to surface "Need iron pickaxe" hints.
- `item_names.ts` — the human-readable names per `ItemId`.

These could live under `game/` but are pure presentation; keeping them
at the root avoids `game/` importing from itself for display strings.

### `src/gen/`

Generated by `npm run proto:gen` from `proto/`. Never edited by hand.
Imported only inside `src/net/`.

## 5. State model

What the client stores locally vs. what comes from the server:

| Store                   | Owner            | Source                                | Update path                            |
| ----------------------- | ---------------- | ------------------------------------- | -------------------------------------- |
| `World` (players)       | `game/world.ts`  | server `TickUpdate`                   | `applySnapshot([players])` each tick   |
| `SnapshotBuffer`        | `game/snapshot_buffer.ts` | per-player positions from each tick | `push(id, x, y, timeMs)` on every chunk apply |
| `Terrain`               | `game/terrain.ts` | server full-state chunks            | `insert(cx, cy, chunk)`, implicit unload |
| `Inventory`             | `game/inventory.ts` | server `InventoryUpdate`            | `replaceFromWire(...)`                  |
| `ChestState`            | `game/chest_state.ts` | server `ChestUpdate`                | full replace                            |
| `RosterStore`           | `game/roster.ts` | server `ConnectedPlayersList` + welcome initial | full replace                |
| `LeaderboardStore`      | `game/leaderboard.ts` | welcome initial + per-tick `factions_delta` | merge / apply delta             |
| `ProjectileStore`       | `game/projectiles.ts` | per-tick `TickUpdate.projectiles` | wholesale replace                     |
| `LocalAttackChargeTracker` | `game/local_attack_charge_tracker.ts` | derived from per-tick attack events | tracks own state                |
| Local action counter    | `bootstrap/actions.ts` | local                              | `++actionSeq` per sequenced send       |
| Per-frame interpolated entity list | `render/compose.ts` | `World` + `SnapshotBuffer` per frame | recomputed each `frame()`     |
| Per-session UI state    | `ui/*` handles   | local user input                      | DOM-internal                            |

Everything authoritative is server-driven. The wire bridge writes; the
game stores hold; the renderer and UI overlays read. There is no
optimistic mutation path on success — even right-click-to-craft waits
for the next `InventoryUpdate` before the slot changes.

The chunk-centric delivery model (ADR 0003) is the key one to
internalize:

- Each tick the server picks the per-client view window.
- Chunks newly in view *or* dirtied this tick arrive as `full_state`.
- Still-in-view, unchanged chunks arrive in `unmodified_chunks` (just
  the coord — bandwidth saving).
- Anything previously known and missing from both is implicitly
  unloaded.
- A chunk shipped *without* `ground`/`top` (the 2026-05-26 amendment)
  means "players-only dirty" — keep the existing local terrain copy
  and merge fresh players / entities / flag-blocks on top. The first
  time the client sees a chunk the layers must be present.

## 6. Rendering — what gets composed each frame

The renderer pipeline:

1. **Compose.** `composePlayerEntities(world, buffer, nowMs)` reads
   the per-id snapshot ring and interpolates with
   `REMOTE_RENDER_DELAY_MS = 100` ms lag. Local and remote players
   take the same path (ADR 0003 §7).
2. **Dash override.** Active dashes (on a strike resolution) override
   the composed position with a fast lerp from "last rendered" to
   "current authoritative" over `DASH_DURATION_MS = 150` ms.
3. **Mesh sync.** `syncPlayerMeshes` adds / updates / disposes
   meshes per the composed list. The local-player mesh is hidden
   in first-person framing (the camera tracks it).
4. **Camera + shake.** `updateCamera` follows the local player's
   focus; the screen-shake offset (driven by HP drops in the
   bootstrap rAF pump, or by attacker-shake from a successful strike)
   perturbs `camera.position` + the look-at by the same vector.
5. **Daylight.** `updateDaylight` resamples sun/moon/ambient/sky from
   the latest `time_of_day_seconds`, drives the light pools
   (torches / mushrooms / lanterns), and updates mushroom emissive
   so the sprite reads as the light source after dusk.
6. **Hover + ghost.** `pickPlayerUnderCursor` against the current
   meshes drives username billboards; `computeGhostState` against
   the held hotbar item + picked cell drives the translucent
   place preview.
7. **Effects layers.** Each per-tick effect feed (block edits, target
   outlines, attack beams, flag beams, projectiles, projectile
   impacts, slash flashes, mesh flashes, damage numbers, slow
   particles) advances its own lifetime / fade / retire pass.
8. **Chunk meshing.** `applyChunkLoaded` rebuilds the affected
   chunk's sub-group; `applyChunkUnloaded` drops it. Neighbour
   chunks read each other for the hidden-AO pass — the wire layer
   inserts every full-state chunk into `terrain` before fanning out
   `onChunkLoaded` so siblings arriving in the same tick are visible
   to each other.
9. **Final render.** `WebGLRenderer.render(scene, camera)`.

Lighting tuning history that doesn't show in the code: torch and
lantern intensities have been retuned multiple times; the
`nightFactor`-scaled intensity envelope is the right knob, not the
hard-coded peak. Mushroom emissive is tied to `nightFactor` so the
glow reads only when the surrounding scene is dark.

## 7. Proto mirror workflow

The canonical schema lives at
`anarchy-server/proto/anarchy/v1/anarchy.proto`. The mirror in
`anarchy-client/proto/` is produced by the server's
`scripts/sync-proto.sh` and consumed by `npm run proto:gen`, which
writes `src/gen/anarchy.{js,d.ts}`. The generator runs automatically
on `predev` / `prebuild`.

**Never edit `anarchy-client/proto/` by hand.** The workflow for any
schema change:

1. Edit the schema in the server repo
   (`anarchy-server/proto/anarchy/v1/anarchy.proto`).
2. `cargo build` in the server repo — `build.rs` regenerates the
   Rust bindings via the vendored `protoc-bin-vendored`.
3. Run `anarchy-server/scripts/sync-proto.sh` to mirror to the client.
4. In the client, `npm run proto:gen` regenerates the TS bindings
   (also fires automatically via `predev` / `prebuild`).
5. Add a `wire_<kind>.ts` if the message is new (don't grow
   `wire.ts`).
6. Commit per repo with matching subject lines (per the project
   charter's commit policy).

`protoc` is **not** installed system-wide. The server uses
`protoc-bin-vendored` (Rust crate dep); the client uses
`protobufjs-cli` (npm dep). Don't add a system-protoc dep.

## 8. Build, test, and dev loop

| Task                       | Command                       |
| -------------------------- | ----------------------------- |
| Install deps               | `npm install`                 |
| Dev server (HMR, port 5173)| `npm run dev`                 |
| Production build           | `npm run build`               |
| Preview built bundle       | `npm run preview`             |
| Unit tests                 | `npm test`                    |
| Watch unit tests           | `npm run test:watch`          |
| E2E tests                  | `npm run test:e2e`            |
| E2E (project root)         | `../run-e2e.sh`               |
| Regenerate proto bindings  | `npm run proto:gen`           |

Node is via nvm — non-interactive bash must `source ~/.nvm/nvm.sh`
first. The project-root `run-*.sh` scripts handle this.

Tests split:

- **vitest** (`*.test.ts` next to source) — pure logic. `World`,
  `SnapshotBuffer`, `Inventory`, wire decoders, render
  helpers (`compose`, `world_to_client`, `zoom`, daylight sampler,
  picker math), config invariants. Fast, no browser, no server.
- **Playwright** (`e2e/*.spec.ts`) — real browser, real server.
  Playwright auto-starts the Rust server (`cargo run`) and the Vite
  dev server. Browser system deps must be present; see
  `BLOCKERS.md` history if Chromium fails to launch. The e2e suite
  has historically been flaky on WSL2 — see DONE task 140 for the
  most recent stabilisation.

Cross-cutting changes (networking, snapshot wiring, wire format,
chunk delivery) require `./run-e2e.sh` to pass before commit per the
project charter's Definition of Done.

## 9. Where to start — recipes

A few concrete entry points for common tasks:

**"I want to add a new block sprite."**

1. Add the variant to the proto enum
   (`anarchy-server/proto/anarchy/v1/anarchy.proto`), sync, regen.
2. Add it to `game/terrain.ts:BlockType`. If the server adds a
   `BlockMeta::min_tool_tier`, mirror it in `textures.ts:BLOCK_REGISTRY`.
3. Add the sprite/texture in `dev_utils/` if procedurally generated,
   or drop the PNG into `public/textures/`. Wire it through
   `textures.ts` and `render/texture_loader.ts`.
4. Touch the chunk-meshing layer (`render/terrain.ts`) only if the
   new block needs special geometry (non-cube, tinted, animated).

**"I want to add a new HUD widget."**

1. Create `src/ui/<widget>.ts` with a `mount<Widget>()` factory
   returning a handle.
2. Inject CSS via a co-located helper, mount the DOM, expose
   `update(...)` and `unmount()`.
3. Re-export from `src/ui/index.ts`.
4. In `bootstrap/session.ts`, call `mount<Widget>(...)` near the
   other HUD mounts and push the unmount into the teardown list.
5. If the widget reflects a store, subscribe (or read in the rAF
   pump at `bootstrap/session.ts:pumpCoords` if it needs per-frame
   refresh).
6. Add a vitest spec next to the source pinning the DOM behavior.

**"I want to add a new server message."**

1. Extend the proto in the server repo, sync, regen.
2. Add a `src/net/wire_<kind>.ts` sibling. Decode side-effect-free
   primitives go in `wire_codec.ts`.
3. Route it from `src/net/wire.ts:applyServerMessage`.
4. Add the sink to `WireDeps` and have `bootstrap/session.ts`
   provide it.
5. Add a vitest spec for the decoder under `net/`.

**"I want to add a new player action."**

1. Add the `*Intent` / `*Request` message to the proto, sync, regen.
2. Add a sender to `src/bootstrap/actions.ts`; it should bump the
   `actionSeq` counter if the server treats it as sequenced.
3. Bind the input source (`break_place.ts` for mouse,
   `keybindings.ts` for keys, a UI overlay for clicks) through the
   sender.
4. Expose the sender on the `AnarchyHandle` if Playwright needs it
   to drive the action without simulating input.

## 10. Counter-intuitive bits worth knowing

- **The renderer never touches `window` / `document`.** It takes a
  container + viewport and exposes `resize(w, h)`; bootstrap pumps
  the page-level `resize` listener (`bootstrap/session.ts:523`).
- **`window.__anarchy` is the Playwright test handle.** Set on each
  session spawn, cleared on disconnect. Look at
  `bootstrap/session.ts:AnarchyHandle` for the available test seams
  — most read-only counters and event mirrors exist solely so e2e
  specs can assert end-to-end behavior without poking Three.js.
- **The lobby's Enter key can leak into the in-game session.** The
  lobby resolves its submit promise synchronously inside its
  `keydown`; the `await` continuation that mounts the session can
  run as a microtask between event-listener invocations, so the
  same keystroke can bubble up to a freshly-attached `window`
  listener. `bootstrap/keybindings.ts` rejects keydowns whose
  `ev.timeStamp` predates the listener attachment for the same
  reason `lobby.ts` `preventDefault`s + `stopPropagation`s on Enter.
- **URL-bar overrides are dev-build-only by design.** See `ws_url.ts`
  — production must never honor `?ws=` / `?server-port=` or it
  becomes a credential phishing vector. The gate is `import.meta.env.DEV`.
- **Mobile gets bounced.** `lobby.ts:56` calls `isMobileUserAgent()`
  and renders the "desktop only" page. If you change the gate,
  also change the mobile redirect because there are no mobile
  controls.
- **Frozen empty `ReadonlyMap`s and packed numeric keys.** The wire
  decoder reuses shared empty maps for chunks with no players /
  entities / flag-blocks (`net/wire_tick.ts:652`), and the terrain
  uses packed numeric chunk keys (`game/terrain.ts:chunkKeyNum`).
  Both are bandwidth/alloc-budget choices made under load — don't
  regress them without measuring.
- **Held-break heartbeats.** Break intent isn't fire-and-forget; the
  client resends every `BREAK_HEARTBEAT_TICKS` so a dropped frame
  can't strand the server with a stale held target
  (`bootstrap/break_place.ts`).
- **Mass / username matter on the server.** Mass is derived from the
  *assigned* username (post-ADR-0005 disambiguation: "Bob" already
  taken → admitted as "Bob2"); two simultaneous "Bob"s get distinct
  masses. The client doesn't see mass — but if you're debugging why
  collision feels different across sessions, that's the server-side
  reason.
- **Time-of-day is server-authoritative.** The `time_of_day_seconds`
  scalar arrives on every `TickUpdate`. Don't sample wall-clock for
  the day cycle.
- **Prediction is off, on purpose, today.** Local input feels the
  server tick. If your fix introduces local position writes outside
  the snapshot path, that's a regression of ADR 0003 §7 — flag it
  rather than shipping it.

## 11. When in doubt

- About an architectural change (snapshot model, prediction strategy,
  layering, chunking) — write to `BLOCKERS.md` and stop. Don't
  quietly change the policy.
- About a module boundary leak — re-read §3 and look at recent
  audits in `DONE.md` for precedent.
- About a discovered follow-up — add a new file to
  `/home/hamon/Project-Anarchy/Backlog/` (numeric prefix higher than
  every existing task, in steps of 10) rather than expanding the
  current task.
- About something that *looks* wrong but isn't obviously broken —
  flag in `BLOCKERS.md` rather than papering over.
