/**
 * Session construction. `constructSession` builds every live object that
 * makes up a single play session — `World`, `SnapshotBuffer`, `Terrain`,
 * `Renderer`, `Connection`, `InputController`, the inventory / crafting /
 * chest / coords-HUD / corner-actions overlays, the register flow — wires
 * the callback graph among them, and returns a `Session` carrying the
 * Playwright-facing `AnarchyHandle` plus a `dispose()` for the lifecycle
 * loop in `bootstrap/index.ts`.
 *
 * Carved out of `bootstrap/index.ts:runMain` to keep that file focused
 * on the public seam (`AnarchyHandle` re-export, thin `runMain`, the
 * `runApp` lobby loop). Every captured local in the old `runMain` body
 * now lives in this module's closure; ordering between bindings is
 * load-bearing (the renderer needs the world before the connection's
 * `WireDeps` can be assembled) and is preserved verbatim.
 *
 * `dispose()` is the symmetric counterpart to construction — it triggers
 * `stop()` (which drains the teardown list in reverse, so dependencies
 * tear down before what they depend on) and awaits `stopped` so callers
 * can sequence re-entry without leaking subscriptions.
 */

import {
  BlockType,
  type ChestLocation,
  ChestState,
  chestLocationFromKey,
  Inventory,
  ItemId,
  LAYER_SIZE,
  LeaderboardStore,
  LocalAttackChargeTracker,
  EffectKind,
  ProjectileStore,
  RosterStore,
  SnapshotBuffer,
  Terrain,
  type ToolKind,
  World,
  canPlaceTopBlock,
} from "../game/index.js";
import { InputController } from "../input/index.js";
import {
  applyServerMessage,
  connect,
  type LobbyIdentity,
  type LobbyRejectReason,
  type WireAttackEvent,
  type WireBlockEditEvent,
  type WireTargetingStateEvent,
} from "../net/index.js";
import { Renderer, type GhostState } from "../render/index.js";
import {
  durationForDamage,
  magnitudeForDamage,
  type ScreenShakeOffset,
} from "../render/screen_shake.js";
import {
  mountChestUi,
  mountChatHud,
  mountChatInput,
  mountConnectionErrorOverlay,
  mountCoordsHud,
  mountCooldownRing,
  mountCraftingUi,
  mountDeathOverlay,
  mountDiscordButton,
  mountHowToPlayButton,
  mountHpBar,
  mountInventoryUi,
  mountLeaderboardHud,
  mountOnboardingHint,
  mountPlayerListHud,
  mountCornerActions,
  showCreateFactionDialog,
  mountSwordCooldownRing,
  mountXpLabel,
  type ChatHudHandle,
  type ChatInputHandle,
  type ConnectionErrorOverlayHandle,
  type CornerAction,
  type CraftingUiHandle,
  type DeathOverlayState,
  type InventoryUiHandle,
} from "../ui/index.js";
import { BLOWGUN_COOLDOWN_MS } from "../config.js";
import { createActionSenders } from "./actions.js";
import { attachBreakAndPlace } from "./break_place.js";
import { attachKeybindings } from "./keybindings.js";
import { createRegisterFlow, type RegisterFlow } from "./register_flow.js";
import { mountToastHost } from "./toast.js";

/**
 * Test handle exposed on `window.__anarchy`. Kept narrow on purpose: only
 * the seams Playwright needs to drive the app without poking internals.
 *
 * `stop()` tears down the whole session — sockets, listeners, timers,
 * Three.js resources, corner actions + inventory DOM. `stopped` resolves
 * once the teardown finishes, so the lifecycle loop in `runApp` can
 * wait for a Disconnect and re-show the lobby.
 */
export interface AnarchyHandle {
  world: World;
  terrain: Terrain;
  /**
   * Local-player inventory mirror, populated by `InventoryUpdate` frames
   * the server ships immediately after admission and on every tick the
   * inventory mutates. The hotbar / side-panel overlay subscribes to this
   * mirror and re-renders on each change. Exposed on the test handle so
   * e2e specs can pin the wire surface end-to-end.
   */
  inventory: Inventory;
  /**
   * open-chest mirror. Populated by `ChestUpdate` frames the
   * server ships when the local player opens / mutates / closes a chest.
   * `location() === null` means no chest is open.
   */
  chestState: ChestState;
  /**
   * faction-leaderboard mirror. Populated by the welcome's
   * `initial_factions` snapshot and the per-tick `factions_delta`.
   * Lets e2e specs inspect the registry without inspecting Three.js.
   */
  leaderboardStore: LeaderboardStore;
  getLocalPlayerId: () => number | null;
  sendMoveIntent: (dx: number, dy: number) => void;
  /**
   * Held-break wire surface (ADR 0006). Pass a `BreakTarget` to start /
   * retarget the held break — server damages the cell `BREAK_DAMAGE_PER_TICK`
   * per tick until durability hits zero — or `null` to release. Client-side
   * latched state owns the heartbeat resend and the on-mouseup release; tests
   * call this directly to drive the wire round-trip without simulating
   * mousedown/up.
   */
  sendBreakIntent: (
    target: { cx: number; cy: number; lx: number; ly: number } | null,
  ) => void;
  /**
   * Send a place-block action. The placed kind is now decided
   * authoritatively by the server from the player's selected hotbar slot
   * — the client no longer ships a kind on the wire.
   */
  sendPlaceBlock: (cx: number, cy: number, lx: number, ly: number) => void;
  /** Send a hotbar-selection action; bumps the local action seq. */
  sendSelectSlot: (slot: number) => void;
  /**
   * Send an inventory drag-drop action; bumps the local action seq. The
   * optional `srcChest` / `dstChest` arguments name which chest a slot
   * index lives in; pass `null` (or omit) when the
   * slot lives in the player's own grid.
   */
  sendMoveSlot: (
    src: number,
    dst: number,
    srcChest?: ChestLocation | null,
    dstChest?: ChestLocation | null,
  ) => void;
  /**
   * Send a `TransferItems(src, dst, count)` action — the BACKLOG 410
   * right-click split flow. Strict partial transfer (no swap fallback for
   * mismatched-kind destinations). Bumps the local action seq.
   */
  sendTransferItems: (
    src: number,
    dst: number,
    count: number,
    srcChest?: ChestLocation | null,
    dstChest?: ChestLocation | null,
  ) => void;
  /**
   * Ship a `CraftRequest(recipe_id)` action up to the server client wiring). The server re-validates ingredient availability and
   * inventory fit; failures are silently dropped, success surfaces in the
   * next `InventoryUpdate`.
   */
  sendCraft: (recipeId: string) => void;
  /**
   * Mass-craft: ask the server to craft `recipeId` as many times as
   * the player's pooled inventory + open chests allow in one
   * round-trip (task 240 right-click). Silent-failure posture matches
   * `sendCraft`; success surfaces in the next `InventoryUpdate`.
   */
  sendCraftMax: (recipeId: string) => void;
  /**
   * Equip the tool at `sourceSlot` into the equipment slot named by
   * `kind`. Server validates that the source slot holds a
   * tool of the matching kind and atomically swaps the source slot with
   * the equipment slot.
   */
  sendEquipTool: (sourceSlot: number, kind: ToolKind) => void;
  /**
   * Unequip the tool from the equipment slot named by `kind`. Server
   * places the tool into the first empty inventory slot, dropping
   * silently if the inventory is full.
   */
  sendUnequipTool: (kind: ToolKind) => void;
  /**
   * open the chest at `(cx, cy, lx, ly)`. The server validates
   * range and that the cell holds a chest block; failures are silently
   * dropped. Bumps the local action seq.
   */
  sendOpenChest: (cx: number, cy: number, lx: number, ly: number) => void;
  /**
   * close the chest at `(cx, cy, lx, ly)`. The server removes
   * it from the player's open-chests set and emits one final closing
   * `ChestUpdate` for it. Bumps the local action seq.
   */
  sendCloseChest: (cx: number, cy: number, lx: number, ly: number) => void;
  /** Index of the locally-mirrored selected hotbar slot. */
  getSelectedHotbarSlot: () => number;
  /** True while the inventory side panel is open (toggled with `E`). */
  isInventoryOpen: () => boolean;
  // Reach + AABB overlap + top-Air gate, mirrored from the server's
  // place-validator. Exposed for e2e specs that need to assert
  // place-visibility behavior without round-tripping a real PlaceBlock.
  canPlaceAt: (cx: number, cy: number, lx: number, ly: number) => boolean;
  /**
   * Test handle: authoritative latest set of held-break
   * targeting overlays for any player visible to this client. Mirrors
   * the wire bridge's `applyTargets` call exactly — wholesale replace
   * each tick a `TickUpdate.targets` arrives.
   */
  getActiveTargetingStates: () => readonly WireTargetingStateEvent[];
  /**
   * Test handle: total count of `BlockEdit` events observed
   * on this connection since session start. Lets a Playwright spec assert
   * "client B saw the place / break that client A initiated" without
   * inspecting renderer internals.
   */
  getObservedBlockEditCount: () => number;
  /**
   * Test handle: latest server-synced `time_of_day_seconds`
   * scalar. Returns `0` before the first `TickUpdate` lands. Lets e2e
   * specs assert the synced field is non-zero and advances across ticks
   * without parsing protobuf themselves.
   */
  getTimeOfDaySeconds: () => number;
  /**
   * Test handle: latest ghost-block preview state computed by
   * the renderer's per-frame driver, or `null` when no preview is shown
   * (held slot empty / non-placeable, or no valid target under cursor).
   */
  getGhostState: () => GhostState | null;
  /**
   * Test handle: number of player-attached lantern lights the
   * renderer is currently showing. Lets a Playwright spec assert the
   * lantern's player-attached point light lands in the scene without
   * poking at Three.js internals. Always 0 at noon (intensity scales
   * with `nightFactor`).
   */
  getLanternLightCount: () => number;
  /**
   * Test handle: number of chest beams the renderer is
   * currently showing. One per `(player, open chest)` pair, sourced
   * from `PlayerSnapshot.open_chests`. Lets a Playwright spec assert
   * beams light up on open and clear on close.
   */
  getChestBeamCount: () => number;
  /**
   * ship-on-the-wire shim: emit an `AttackIntent` against
   * `(targetKind, targetId)`. Server validates cooldown / range /
   * existence; client-side mirror is invariant-free. Bumps the local
   * action seq.
   */
  sendAttackIntent: (targetKind: "player" | "entity", targetId: number) => void;
  /**
   * ship-on-the-wire shim: emit a `FireBlowgunIntent` against
   * `(targetKind, targetId)`. Server validates blowgun-equipped +
   * dart-in-inventory + range + cooldown + not-self.
   */
  sendFireBlowgunIntent: (
    targetKind: "player" | "entity",
    targetId: number,
  ) => void;
  /**
   * Test handle: number of in-flight projectile meshes in
   * the scene. Lets a Playwright spec assert "the dart appeared in the
   * world" without inspecting Three.js internals.
   */
  getProjectileCount: () => number;
  /**
   * Test handle: number of status-effect indicators (today
   * only `Slow`) rendered above targets.
   */
  getEffectIndicatorCount: () => number;
  /** True iff the local player has an active `Slow` effect on them. */
  isLocalPlayerSlowed: () => boolean;
  /**
   * Test handle: number of attack-charge beams currently
   * live in the scene. One per attacking player (server allows at most
   * one active attack per player). Lets an e2e spec assert the beam
   * appears on `charge-started` and clears on `strike-*`.
   */
  getAttackBeamCount: () => number;
  /**
   * Test handle: number of flag-XP-interact beams currently
   * live in the scene. One per active flag interact this tick; absent
   * the next tick the beam is retired.
   */
  getFlagBeamCount: () => number;
  /**
   * Test handle: number of strike-resolution slash sprites
   * currently live in the scene. Spawned on `STRIKE_HIT` /
   * `STRIKE_MISSED_OUT_OF_REACH`; each retires after 250 ms.
   */
  getSlashCount: () => number;
  /**
   * Test handle: number of meshes currently mid-damage-flash.
   * One per recently damaged player or entity inside the local view
   * window; each entry retires after MESH_FLASH_DURATION_MS.
   */
  getMeshFlashCount: () => number;
  /**
   * Test handle: number of floating damage numbers currently
   * in the scene. Each retires after DAMAGE_NUMBER_DURATION_MS.
   */
  getDamageNumberCount: () => number;
  /**
   * Test handle: the most recent `AttackEvent` observed
   * on this connection. Drives the `e2e/attack-client.spec.ts` checks
   * for "the beam appeared", "the strike landed", etc. without
   * inspecting renderer internals.
   */
  getLastAttackEvent: () => WireAttackEvent | null;
  /**
   * Test handle: wall-clock ms at which the local
   * player's most recent `strike-*` fired, or `null` if the local
   * player has not struck. Lets e2e specs assert the cooldown badge
   * is active without inspecting the DOM.
   */
  getLocalCooldownStartedMs: () => number | null;
  /**
   * Test handle: scene-space positions of every
   * entity the renderer is currently showing, keyed by `EntityId`.
   * Lets a Playwright spec assert a spider mesh exists at a seeded
   * tile and that it moves across a wait window without inspecting
   * Three.js internals.
   */
  getRenderedEntities: () => Record<number, { x: number; z: number }>;
  /**
   * Test handle: drive the renderer's cursor NDC directly,
   * bypassing the page's mouse event plumbing. Lets a Playwright spec aim
   * the ghost preview at a known tile without computing screen-space
   * coordinates from the live camera transform. Pass `null` to clear.
   */
  setCursorNdc: (ndc: { x: number; y: number } | null) => void;
  /**
   * Test handle: project a world tile `(worldX, worldY)` to
   * the canvas's client-pixel coordinates so a Playwright spec can drive
   * `page.mouse.move(x, y)` against a tile centre without reproducing the
   * camera math externally. Returns `null` only when the canvas isn't
   * laid out yet (e.g. mounted into a hidden container).
   */
  worldToClient: (
    worldX: number,
    worldY: number,
  ) => { x: number; y: number } | null;
  /**
   * Test handle: current screen-shake offset in tile units, or
   * `(0, 0)` when no shake is active. Lets an e2e spec assert "the shake
   * fired" without inspecting the camera.
   */
  getScreenShakeOffset: () => ScreenShakeOffset;
  /**
   * Test handle: wall-clock ms of the most recent screen-shake trigger,
   * or `null` if none has fired this session. The value persists past
   * the shake's decay window, so a polling spec (task 550) can confirm
   * the shake fired without having to catch its brief amplitude envelope
   * via `getScreenShakeOffset`.
   */
  getLastScreenShakeStartedMs: () => number | null;
  /**
   * Test handle: true while the HP bar's damage-flash overlay
   * is active. Mirrors the DOM class on the bar root so the assertion is
   * a one-call read.
   */
  isHpBarFlashing: () => boolean;
  /**
   * Test handle: current respawn-overlay state. `visible`
   * is true between `trigger` and the end of the 2 s title fade;
   * `blackOpacity` / `titleOpacity` are the per-element opacities
   * being painted this frame. Lets e2e specs assert the overlay's
   * lifecycle without DOM scraping.
   */
  getDeathOverlayState: () => DeathOverlayState;
  /**
   * Test handle: per-frame WebGL stats + terrain / scene mesh counts.
   * Sampled after at least one rAF, so values reflect a real
   * rendered frame. Exposed for the BACKLOG 350 terrain-meshing
   * draw-call investigation so a Playwright spec can measure cost
   * without inspecting Three.js internals.
   */
  getRenderStats: () => {
    calls: number;
    triangles: number;
    frameCounter: number;
    terrainMeshes: number;
    sceneMeshes: number;
  };
  stop: () => void;
  readonly stopped: Promise<void>;
  /**
   * Resolves with a `LobbyRejectReason` if the server rejected the
   * lobby Hello (today: only the reconnect-flagged path can produce a
   * reject), or `null` if the session ended normally / via `stop()` /
   * via socket close. The lifecycle loop in `runApp` waits on this to
   * decide whether to re-show the lobby with a server-side error
   * message above the form.
   */
  readonly lobbyReject: Promise<LobbyRejectReason | null>;
}

/**
 * Inputs to `constructSession`. Today the renderer mounts onto
 * `document.body` directly; if a future task needs a different mount
 * point it can be threaded through here without touching the factory's
 * internals.
 */
export interface SessionDeps {
  identity: LobbyIdentity;
  wsUrl: string;
}

/**
 * The live-session bundle returned by `constructSession`. `handle` is
 * the public Playwright seam (also published on `window.__anarchy` by
 * `runApp`). `dispose()` is the symmetric teardown — it triggers
 * `stop()` if not already stopping and awaits `stopped`, so the
 * lifecycle loop can sequence re-entry without leaking subscriptions.
 */
export interface Session {
  handle: AnarchyHandle;
  dispose: () => Promise<void>;
}

export function constructSession(deps: SessionDeps): Session {
  const { identity, wsUrl } = deps;
  // Every owned resource (listener, interval, rAF, WS, mesh, DOM node)
  // pushes a teardown into this list at construction time. `stop()`
  // drains the list in reverse so dependencies are torn down before what
  // they depend on. Keeping this list co-located with the construction
  // is what guarantees a clean Disconnect — leaks here surface as
  // duplicated input/network behavior on the next session.
  const teardowns: Array<() => void> = [];
  let stopping = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((r) => {
    resolveStopped = r;
  });
  let resolveLobbyReject!: (reason: LobbyRejectReason | null) => void;
  const lobbyReject = new Promise<LobbyRejectReason | null>((r) => {
    resolveLobbyReject = r;
  });
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    while (teardowns.length > 0) {
      const fn = teardowns.pop()!;
      try {
        fn();
      } catch (err) {
        console.error("[disconnect] teardown failed", err);
      }
    }
    // If the server never sent a LobbyReject the promise has nothing to
    // carry — resolve with null so the lifecycle loop knows the
    // disconnect was a normal one.
    resolveLobbyReject(null);
    resolveStopped();
  };

  const world = new World();
  const buffer = new SnapshotBuffer();
  const terrain = new Terrain();
  const inventory = new Inventory();
  const chestState = new ChestState();
  const rosterStore = new RosterStore();
  const leaderboardStore = new LeaderboardStore();
  // per-tick projectile mirror, written by the wire layer
  // and read by the renderer.
  const projectiles = new ProjectileStore();
  // tracks whether the local player is mid attack-charge so
  // the input controller can suppress outbound `MoveIntent` frames the
  // server is going to ignore anyway. Fed by the wire layer's per-tick
  // `attack_events` fan-out below.
  const localAttackChargeTracker = new LocalAttackChargeTracker();
  // Forward-declared so the renderer's per-frame ghost driver can read the
  // currently-selected hotbar slot. The UI is mounted later in this
  // function (it depends on `sendSelectSlot` / `sendMoveSlot`, which in
  // turn need `conn`); the renderer's animation loop only runs after the
  // current synchronous tick finishes, by which time `inventoryUi` is set.
  let inventoryUi!: InventoryUiHandle;
  let craftingUi!: CraftingUiHandle;
  // Forward-declared for the same reason — the chat HUD mounts alongside
  // the other DOM chrome later in this function, but the wire callback
  // built inside `connect()` below needs a sink to route `ChatMessage`
  // envelopes into. The callback reads `chatHud` at call time (the first
  // message can't arrive before the synchronous construction finishes).
  let chatHud!: ChatHudHandle;
  // chat input. Mounted alongside chat HUD; keybindings.ts
  // opens it on Enter; on submit it routes through `sendChat`. Forward-
  // declared so `attachKeybindings` and the action senders can read it
  // at construction time even though the actual mount happens after
  // `sendChat` is bound.
  let chatInput!: ChatInputHandle;
  const renderer = new Renderer(
    world,
    buffer,
    document.body,
    {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
    },
    terrain,
    undefined,
    undefined,
    inventory,
    () => inventoryUi.selectedHotbarSlot(),
    projectiles,
  );
  teardowns.push(() => renderer.dispose());

  const onResize = (): void => {
    renderer.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);
  teardowns.push(() => window.removeEventListener("resize", onResize));

  let localPlayerId: number | null = null;

  // Damage-feedback detection state. The `pumpCoords` rAF loop
  // (defined below) mirrors the local player's HP across frames; whenever
  // it drops it fires `renderer.triggerScreenShake` + `hpBar.flashWhite`.
  // Declared up here so the local-player reassign callback in the wire
  // bridge can reset it without a forward-reference.
  let lastSeenLocalHp: number | null = null;

  // Test-handle observability for the effects feed. The
  // renderer-visible effects layer is internal; these mirrors give
  // Playwright (and unit tests for the bootstrap wire) a way to assert
  // that the new wire surface is being delivered end-to-end.
  let observedBlockEditCount = 0;
  let activeTargets: readonly WireTargetingStateEvent[] = [];
  // Latest server-authoritative `time_of_day_seconds` — the
  // wire layer plumbs this through the daylight sink and we mirror it
  // for the test handle so e2e specs can pin the synced scalar without
  // reaching into Three.js.
  let lastTimeOfDaySeconds = 0;
  // latest observed attack event (any outcome) for the test
  // handle. The renderer captures cooldown / dash state internally; this
  // mirror only exists so e2e specs can pin the wire shape end-to-end.
  let lastAttackEvent: WireAttackEvent | null = null;
  // latest measured round-trip-time. `null` before the first
  // Pong arrives — the coords HUD renders that as `ping —`. The wire
  // bridge writes here on every Pong; the per-frame coords loop reads
  // it. On transport drop the renderer keeps painting whatever sample
  // landed last (the value naturally freezes since no Pong will arrive
  // after the socket is gone) — the connection-error overlay covers the
  // canvas anyway.
  let lastRttMs: number | null = null;

  // Forward-declared like `inventoryUi` above. The connection's
  // `onRegisterResult` hook needs to dispatch into the flow, but the
  // flow itself depends on the action senders (which depend on `conn`)
  // and on the corner-actions rebuild closure. The closure-resolves-at-call-
  // time pattern lets us define everything in dependency order.
  let registerFlow!: RegisterFlow;

  // respawn overlay — same forward-declare shape as `inventoryUi`
  // / `registerFlow`. The wire bridge's death-event sink (below) calls
  // `deathOverlay.trigger`, but the overlay is mounted later in this
  // function alongside the other DOM chrome (HP bar + coords HUD). The
  // sink reads the binding at call time — by the time a TickUpdate
  // arrives over the socket, the synchronous construction phase has
  // finished and the binding is set.
  let deathOverlay!: ReturnType<typeof mountDeathOverlay>;

  // connection-lost overlay. Mounted up front so the
  // `onTransportDrop` hook on the connection below has something to
  // dispatch into for the boot-time case where the WebSocket is
  // refused before any other UI has had a chance to mount.
  const connectionErrorOverlay: ConnectionErrorOverlayHandle =
    mountConnectionErrorOverlay();
  teardowns.push(() => connectionErrorOverlay.unmount());

  const conn = connect(
    wsUrl,
    identity,
    (msg) => {
      applyServerMessage(msg, {
        world,
        buffer,
        terrain,
        terrainSink: {
          onChunkLoaded: (cx, cy) => renderer.applyChunkLoaded(cx, cy),
          onChunkUnloaded: (cx, cy) => renderer.applyChunkUnloaded(cx, cy),
        },
        effectsSink: {
          onBlockEdit: (events: readonly WireBlockEditEvent[]) => {
            observedBlockEditCount += events.length;
            for (const event of events) renderer.onBlockEdit(event);
          },
          applyTargets: (targets: readonly WireTargetingStateEvent[]) => {
            activeTargets = targets;
            renderer.applyTargetingStates(targets);
          },
          onAttackEvents: (events, tickReceivedMs) => {
            if (events.length > 0) {
              lastAttackEvent = events[events.length - 1];
            }
            for (const ev of events) {
              localAttackChargeTracker.onAttackEvent(ev, localPlayerId);
            }
            renderer.onAttackEvents(events, tickReceivedMs);
          },
          onDamageEvents: (events, tickReceivedMs) => {
            renderer.onDamageEvents(events, tickReceivedMs);
          },
          onDeathEvents: (events) => {
            // Server scopes the feed per-receiver, so any event we see
            // here is for the local player by construction. Defensive
            // `playerId === localPlayerId` keeps the trigger safe even
            // if a future schema relaxes the filter (kill feed widens
            // scope to view-window — that task will need to add its
            // own renderer hook anyway).
            for (const ev of events) {
              if (ev.playerId !== localPlayerId) continue;
              deathOverlay.trigger(performance.now());
              // A charge-started beam targeting the local player may
              // still be live if the kill landed before the charge
              // resolved — clear it now so it doesn't re-aim to the
              // respawn position when the new chunk loads.
              renderer.clearCombatEffects();
            }
          },
          applyProjectiles: (snapshots, tickReceivedMs) => {
            projectiles.applySnapshots(snapshots, tickReceivedMs);
          },
          onProjectileImpacts: (events, tickReceivedMs) => {
            renderer.onProjectileImpacts(events, tickReceivedMs);
          },
          applyFlagInteracts: (events) => {
            renderer.applyFlagInteracts(events);
          },
        },
        daylightSink: {
          onTimeOfDay: (seconds) => {
            lastTimeOfDaySeconds = seconds;
            renderer.setTimeOfDaySeconds(seconds);
          },
        },
        inventory,
        chestSink: { chestState },
        rosterStore,
        leaderboardStore,
        // Read `chatHud` at call time — the closure outlives the
        // synchronous construction phase, but the wire callback can't
        // fire until at least one frame has crossed the socket, by
        // which time `chatHud` has been assigned.
        chatSink: {
          replaceHistory: (messages) => chatHud.replaceHistory(messages),
        },
        pingSink: {
          setRttMs: (rtt) => {
            lastRttMs = rtt;
          },
        },
        local: {
          setLocalPlayerId: (id) => {
            localPlayerId = id;
            renderer.setLocalPlayerId(id);
            // A local-player reassign means a fresh session — drop any
            // in-flight charge lock so the previous session can't leak
            // a frozen input state into the new one.
            localAttackChargeTracker.reset();
            // Also drop the damage-feedback HP mirror so the first HP
            // we observe on the new player never spuriously fires
            // shake/flash against a stale previous-session value.
            lastSeenLocalHp = null;
            // drop the blowgun fire timestamp so the new
            // local player isn't gated by the previous session's fire.
            lastBlowgunFireMs = null;
            // a local id reassign means a new life — hide any
            // previous overlay synchronously so the stale "You died"
            // from the prior session doesn't bleed over the new spawn.
            deathOverlay.cancel();
          },
          getLocalPlayerId: () => localPlayerId,
        },
      });
    },
    {
      onLobbyReject: (reason) => {
        // Server rejected the Hello. Surface the reason to the lifecycle
        // loop *before* the teardown swallows it as a generic stop, then
        // fall through to `stop()` so the socket / listeners unwind.
        resolveLobbyReject(reason);
        stop();
      },
      onRegisterResult: (status) => registerFlow.onResult(status),
      onTransportDrop: () => {
        // the WebSocket dropped for a non-lobby-reject, non-
        // caller-initiated reason (boot-time refusal, mid-session server
        // close, heartbeat timeout). Show the full-screen "Connection
        // lost" overlay; the input gate it attaches keeps the canvas
        // dormant until the player hits Reload.
        connectionErrorOverlay.show();
      },
    },
  );
  teardowns.push(() => conn.close());

  const {
    sendMoveIntent,
    sendBreakIntent,
    sendPlaceBlock,
    sendSelectSlot,
    sendMoveSlot,
    sendTransferItems,
    sendCraft,
    sendCraftMax,
    sendEquipTool,
    sendUnequipTool,
    sendRegisterAccount,
    sendOpenChest,
    sendCloseChest,
    sendAttackIntent,
    sendFireBlowgunIntent,
    sendCreateFactionIntent,
    sendFlagInteractIntent,
    sendChat,
  } = createActionSenders(conn);

  const input = new InputController(
    { sendMoveIntent },
    undefined,
    localAttackChargeTracker,
  );
  const stopInput = input.start(window);
  teardowns.push(stopInput);

  const canPlaceAt = (cx: number, cy: number, lx: number, ly: number): boolean =>
    canPlaceTopBlock(world, terrain, localPlayerId, cx, cy, lx, ly);

  // Inventory overlay: hotbar always visible, side panel toggled with `E`.
  // Mounted before the keydown handler so the listener can drive
  // `inventoryUi.toggle()` and `inventoryUi.selectHotbarSlot()` without a
  // forward reference. The UI ships authority-bound actions (SelectSlot,
  // MoveSlot) up via `sendSelectSlot` / `sendMoveSlot`; the server's
  // next `InventoryUpdate` is the canonical state.
  //
  // the inventory UI now ships the chest source / destination
  // as a `chestKey` per cell. Bootstrap turns it back into the wire
  // `ChestLocation` via `chestLocationFromKey`. The client-side mirror is
  // still singleton today, so the matching `getChestInventory(key)`
  // returns the mirror only when the key resolves to the open chest;
  // promotes the mirror to N panels.
  const sendMoveSlotUi = (
    src: number,
    dst: number,
    srcChestKey: string | null = null,
    dstChestKey: string | null = null,
  ): void => {
    sendMoveSlot(
      src,
      dst,
      srcChestKey ? chestLocationFromKey(srcChestKey) : null,
      dstChestKey ? chestLocationFromKey(dstChestKey) : null,
    );
  };
  const sendTransferItemsUi = (
    src: number,
    dst: number,
    count: number,
    srcChestKey: string | null = null,
    dstChestKey: string | null = null,
  ): void => {
    sendTransferItems(
      src,
      dst,
      count,
      srcChestKey ? chestLocationFromKey(srcChestKey) : null,
      dstChestKey ? chestLocationFromKey(dstChestKey) : null,
    );
  };
  const inventoryUiInner = mountInventoryUi({
    getInventory: () => inventory,
    getChestInventory: (chestKey) => chestState.inventoryForKey(chestKey),
    sendSelect: sendSelectSlot,
    sendMove: sendMoveSlotUi,
    sendTransfer: sendTransferItemsUi,
    sendEquip: sendEquipTool,
    sendUnequip: sendUnequipTool,
  });
  teardowns.push(() => inventoryUiInner.unmount());

  // Crafting panel slides in alongside the inventory side panel — same
  // open/close lifecycle, mirrored on the right edge. Server snapshots
  // (`InventoryUpdate.craftable_recipe_ids`) drive the row list; clicking
  // a row ships a `CraftRequest`.
  craftingUi = mountCraftingUi({
    getInventory: () => inventory,
    chestState,
    sendCraft,
    sendCraftMax,
  });
  teardowns.push(() => craftingUi.unmount());

  // chest panel — opens automatically when `ChestUpdate` lands
  // with a non-null `chest` and closes when the server ships a closed
  // sentinel (range loss / explicit close / chest broken). Drag/drop,
  // right-click split, and click-to-withdraw go through the inventory
  // UI's shared dragdrop state machine — the chest UI registers its
  // cells through `inventoryUiInner.wireChestSlot`. Header chrome
  // (title + X button + drag-to-move) sits on top; the X button ships
  // a `CloseChest` via `sendCloseChest`.
  const chestUi = mountChestUi({
    chestState,
    inventoryUi: inventoryUiInner,
    sendCloseChest,
    panelTitleFor: (loc) => {
      const chunk = terrain.get(loc.cx, loc.cy);
      if (chunk === undefined) return "Chest";
      const kind = chunk.top.blocks[loc.ly * LAYER_SIZE + loc.lx]?.kind;
      return kind === BlockType.Tombstone ? "Tombstone" : "Chest";
    },
  });
  teardowns.push(() => chestUi.unmount());

  // ESC closes every open chest. Bound at window-level so it works
  // whether the inventory panel is open or not; falls through to other
  // handlers if no chest is open. With multi-open ESC fans
  // out a `CloseChest` per panel — the server retires each chest and
  // ships a closed `ChestUpdate` per chest.
  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    const locs = chestState.locations();
    if (locs.length === 0) return;
    for (const loc of locs) sendCloseChest(loc);
  };
  window.addEventListener("keydown", onEscape);
  teardowns.push(() => window.removeEventListener("keydown", onEscape));

  // Wrap the inventory handle so every open/close path also drives the
  // crafting panel. Both panels carry the same `open` state — the
  // crafting panel is a sibling widget, not a child.
  inventoryUi = {
    isOpen: () => inventoryUiInner.isOpen(),
    setOpen: (open) => {
      inventoryUiInner.setOpen(open);
      craftingUi.setOpen(open);
    },
    toggle: () => {
      const next = !inventoryUiInner.isOpen();
      inventoryUiInner.setOpen(next);
      craftingUi.setOpen(next);
    },
    selectedHotbarSlot: () => inventoryUiInner.selectedHotbarSlot(),
    selectHotbarSlot: (slot) => inventoryUiInner.selectHotbarSlot(slot),
    wireChestSlot: (chestKey, idx, cell) =>
      inventoryUiInner.wireChestSlot(chestKey, idx, cell),
    unwireChestKey: (chestKey) => inventoryUiInner.unwireChestKey(chestKey),
    render: () => inventoryUiInner.render(),
    unmount: () => inventoryUiInner.unmount(),
  };

  // last wall-clock the local player dispatched a blowgun-fire
  // intent — drives the blowgun-slot cooldown ring on the hotbar.
  let lastBlowgunFireMs: number | null = null;

  // Top-left coordinates readout. Pumped from a dedicated rAF loop that
  // reads the latest authoritative `World` snapshot — independent of the
  // renderer's animation loop so the readout keeps refreshing even if the
  // canvas is occluded (rAF still fires when the tab is focused).
  const playerListHud = mountPlayerListHud({
    store: rosterStore,
    getLocalPlayerId: () => localPlayerId,
  });
  // bottom-left chat overlay. The wire bridge above routes every
  // `ChatMessage` envelope into `chatHud.append`; nothing else writes here
  // (player typing lands).
  chatHud = mountChatHud();
  chatInput = mountChatInput({
    onSubmit: (body) => sendChat(body),
    host: chatHud.inputHost(),
  });
  const leaderboardHud = mountLeaderboardHud({ store: leaderboardStore });
  const coordsHud = mountCoordsHud();
  const hpBar = mountHpBar();
  const xpLabel = mountXpLabel();
  // replace the corner `?` with a labeled "How to play" pill
  // centered above the XP bar while in-game. The corner is restored on
  // session teardown (back to lobby).
  const howToPlayButton = mountHowToPlayButton();
  // transparent centered tutorial card. Self-gates on a
  // localStorage flag so it only appears the very first time a given
  // browser enters the world; auto-fades 3s after the player's first
  // movement keypress. Strictly session-mount — the lobby has its
  // own onboarding.
  const onboardingHint = mountOnboardingHint();
  deathOverlay = mountDeathOverlay();
  // cooldown affordance — driven from the same rAF loop. The
  // renderer captures the latest strike timestamp; the ring reads it and
  // draws a depleting arc over the sword equipment slot. The equipment
  // bar is mounted once for the lifetime of the session (cells are
  // stable across inventory re-renders — see `cells.ts` / `mountInventoryUi`),
  // so a single mount on the sword slot survives every paintSlot tick.
  const swordSlotEl = document.querySelector<HTMLElement>(
    ".anarchy-equipment-slot-sword",
  );
  if (swordSlotEl === null) {
    throw new Error(
      "sword equipment slot not found — inventory UI did not mount as expected",
    );
  }
  const swordCooldownRing = mountSwordCooldownRing(swordSlotEl);
  // blowgun cooldown ring — mirrors the sword ring on the
  // blowgun equipment slot. Same handle contract.
  const blowgunSlotEl = document.querySelector<HTMLElement>(
    ".anarchy-equipment-slot-blowgun",
  );
  const blowgunCooldownRing =
    blowgunSlotEl !== null
      ? mountCooldownRing(blowgunSlotEl, BLOWGUN_COOLDOWN_MS)
      : null;
  let coordsRaf = 0;
  const pumpCoords = (): void => {
    const id = localPlayerId;
    const me = id === null ? null : world.getPlayer(id);
    coordsHud.update(me ? { x: me.x, y: me.y } : null);
    coordsHud.updatePing(lastRttMs);
    const currentHp = me ? me.health : null;
    if (currentHp === null) {
      // No admitted local player (yet) — drop the mirror so the first HP
      // we observe after admission never spuriously fires feedback.
      lastSeenLocalHp = null;
    } else if (lastSeenLocalHp !== null && currentHp < lastSeenLocalHp) {
      // HP went down. Respawn ships `MAX_PLAYER_HEALTH` post-death so it
      // never trips this branch; admin-damage / attack hits do. Compute
      // the delta and fire both feedback effects.
      const damage = lastSeenLocalHp - currentHp;
      renderer.triggerScreenShake(
        magnitudeForDamage(damage),
        durationForDamage(damage),
      );
      hpBar.flashWhite();
    }
    if (currentHp !== null) lastSeenLocalHp = currentHp;
    hpBar.update(currentHp);
    xpLabel.update(me ? me.xp : null);
    const strikeMs = id === null ? null : renderer.getStrikeStartedMs(id);
    // `getStrikeStartedMs` is wall-clock (`Date.now`) — pass the same
    // time base so the elapsed delta stays meaningful. `performance.now`
    // is a monotonic-since-page-load clock and would skew by ~1e12 ms.
    swordCooldownRing.update(Date.now(), strikeMs);
    blowgunCooldownRing?.update(Date.now(), lastBlowgunFireMs);
    deathOverlay.tick(performance.now());
    coordsRaf = window.requestAnimationFrame(pumpCoords);
  };
  coordsRaf = window.requestAnimationFrame(pumpCoords);
  teardowns.push(() => {
    window.cancelAnimationFrame(coordsRaf);
    playerListHud.unmount();
    chatInput.unmount();
    chatHud.unmount();
    leaderboardHud.unmount();
    coordsHud.unmount();
    hpBar.unmount();
    xpLabel.unmount();
    howToPlayButton.unmount();
    onboardingHint.unmount();
    swordCooldownRing.unmount();
    blowgunCooldownRing?.unmount();
    deathOverlay.unmount();
  });

  teardowns.push(attachKeybindings(window, { inventoryUi, renderer, chatInput }));
  teardowns.push(
    attachBreakAndPlace(window, {
      world,
      renderer,
      getLocalPlayerId: () => localPlayerId,
      getInventory: () => inventory,
      sendBreakIntent,
      sendPlaceBlock,
      sendOpenChest,
      sendAttackIntent,
      sendFireBlowgunIntent,
      sendFlagInteractIntent,
      getFactionXpAt: (cx, cy, lx, ly) => {
        // scan the leaderboard mirror for a faction bound to
        // this flag cell. `null` means unclaimed; `0` means drained.
        // The break_place click router uses both as "fall through to
        // the break path" — the flag's drain-to-destroy invariant.
        for (const fac of leaderboardStore.current().values()) {
          if (
            fac.flagChunk[0] === cx &&
            fac.flagChunk[1] === cy &&
            fac.flagLocal[0] === lx &&
            fac.flagLocal[1] === ly
          ) {
            return fac.xp;
          }
        }
        return null;
      },
      onPlaceDispatched: (cx, cy, lx, ly) => {
        // opening the create-faction dialog is part of the
        // place-block flow when the selected item is a Flag. Server
        // validates ownership + un-claimed on the eventual
        // `CreateFactionIntent`, so we open optimistically as soon as
        // the place is dispatched without waiting for a server echo.
        const slot = inventoryUi.selectedHotbarSlot();
        const stack = inventory.slot(slot);
        if (stack === null) return;
        if (stack.item !== ItemId.Flag) return;
        showCreateFactionDialog({
          onSubmit: (name) =>
            sendCreateFactionIntent(cx, cy, lx, ly, name),
        });
      },
      onBlowgunFireDispatched: (t) => {
        lastBlowgunFireMs = t;
      },
      getAttackTargetPosition: (kind, id) => {
        if (kind === "player") {
          const p = world.getPlayer(id);
          return p ? { x: p.x, y: p.y } : null;
        }
        // entity — tile-bound, position is tile centre
        for (const [, chunk] of terrain.iter()) {
          const e = chunk.entities.get(id);
          if (e !== undefined) return { x: e.tileX + 0.5, y: e.tileY + 0.5 };
        }
        return null;
      },
      // feed the same wall-clock strike timestamp the sword-
      // slot cooldown ring reads. break_place uses it to gate attack
      // clicks against the local cooldown and surface a transient
      // "Attack on cooldown" hint when the swing would be silently
      // dropped server-side.
      getLocalStrikeStartedMs: () =>
        localPlayerId === null ? null : renderer.getStrikeStartedMs(localPlayerId),
    }),
  );

  const toast = mountToastHost();
  teardowns.push(() => toast.unmount());

  // Corner actions + register flow are mutually referential: `buildCornerActions`
  // reads `registerFlow.isRegistered()` synchronously at mount time, and the
  // register flow calls `rebuildCornerActions` after a successful registration
  // to drop the Register button. Construct in dependency order — register flow
  // first (with `rebuildCornerActions` as a closure capturing the still-unset
  // `cornerActions`), then mount the corner row. `rebuildCornerActions` only
  // fires post-registration, by which point `cornerActions` is bound.
  let cornerActions!: ReturnType<typeof mountCornerActions>;

  // Register sits left of Disconnect so Disconnect stays glued to the
  // corner across rebuilds — removing Register after registration doesn't
  // shift Disconnect's position.
  function buildCornerActions(): ReadonlyArray<CornerAction> {
    const actions: CornerAction[] = [];
    if (!registerFlow.isRegistered()) {
      actions.push({
        label: "Register",
        onClick: () => registerFlow.open(),
      });
    }
    actions.push({ label: "Disconnect", onClick: () => stop() });
    return actions;
  }

  function rebuildCornerActions(): void {
    cornerActions.rebuild(buildCornerActions());
  }

  registerFlow = createRegisterFlow({
    world,
    identity,
    toast,
    getLocalPlayerId: () => localPlayerId,
    sendRegisterAccount,
    onRegisteredChanged: rebuildCornerActions,
  });
  teardowns.push(() => registerFlow.unmount());

  cornerActions = mountCornerActions({ actions: buildCornerActions() });
  teardowns.push(() => cornerActions.unmount());

  const discordButton = mountDiscordButton();
  teardowns.push(() => discordButton.unmount());

  const handle: AnarchyHandle = {
    world,
    terrain,
    inventory,
    chestState,
    leaderboardStore,
    getLocalPlayerId: () => localPlayerId,
    sendMoveIntent,
    sendBreakIntent,
    sendPlaceBlock,
    sendSelectSlot,
    sendMoveSlot,
    sendTransferItems,
    sendCraft,
    sendCraftMax,
    sendEquipTool,
    sendUnequipTool,
    sendOpenChest,
    sendCloseChest: (cx, cy, lx, ly) =>
      sendCloseChest({ cx, cy, lx, ly }),
    getSelectedHotbarSlot: () => inventoryUi.selectedHotbarSlot(),
    isInventoryOpen: () => inventoryUi.isOpen(),
    canPlaceAt,
    getActiveTargetingStates: () => activeTargets,
    getObservedBlockEditCount: () => observedBlockEditCount,
    getTimeOfDaySeconds: () => lastTimeOfDaySeconds,
    getGhostState: () => renderer.getGhostState(),
    getLanternLightCount: () => renderer.getLanternLightCount(),
    getChestBeamCount: () => renderer.getChestBeamCount(),
    getRenderedEntities: () => renderer.getRenderedEntities(),
    setCursorNdc: (ndc) => renderer.setCursorNdc(ndc),
    worldToClient: (worldX, worldY) => renderer.worldToClient(worldX, worldY),
    getScreenShakeOffset: () => renderer.getScreenShakeOffset(),
    getLastScreenShakeStartedMs: () => renderer.getLastScreenShakeStartedMs(),
    isHpBarFlashing: () => hpBar.isFlashing(),
    getDeathOverlayState: () => deathOverlay.state(),
    getRenderStats: () => renderer.getRenderStats(),
    sendAttackIntent,
    sendFireBlowgunIntent,
    getProjectileCount: () => renderer.getProjectileCount(),
    getEffectIndicatorCount: () => renderer.getEffectIndicatorCount(),
    isLocalPlayerSlowed: () => {
      if (localPlayerId === null) return false;
      const p = world.getPlayer(localPlayerId);
      if (p === undefined) return false;
      for (const e of p.effects) {
        if (e.kind === EffectKind.Slow) return true;
      }
      return false;
    },
    getAttackBeamCount: () => renderer.getAttackBeamCount(),
    getFlagBeamCount: () => renderer.getFlagBeamCount(),
    getSlashCount: () => renderer.getSlashCount(),
    getMeshFlashCount: () => renderer.getMeshFlashCount(),
    getDamageNumberCount: () => renderer.getDamageNumberCount(),
    getLastAttackEvent: () => lastAttackEvent,
    getLocalCooldownStartedMs: () =>
      localPlayerId === null ? null : renderer.getStrikeStartedMs(localPlayerId),
    stop,
    stopped,
    lobbyReject,
  };

  const dispose = async (): Promise<void> => {
    stop();
    await stopped;
  };

  return { handle, dispose };
}
