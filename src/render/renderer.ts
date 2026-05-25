/**
 * What happens each frame. The `Renderer` orchestrates the per-frame
 * update pipeline: it reads from the snapshot buffer, composes player
 * entities, syncs meshes, advances effects, samples daylight, updates
 * light pools, and finally renders. The persistent scene graph it paints
 * into lives in `SceneGraph` — this class never creates GPU resources
 * itself, only drives the ones the graph owns.
 *
 * The renderer is networking- and DOM-agnostic: the caller supplies a
 * container element, an initial `Viewport`, and is responsible for
 * forwarding window resizes via `resize()`. The wire layer feeds `World`
 * / `SnapshotBuffer` / `Terrain` and tells us who we are with
 * `setLocalPlayerId`.
 */

import * as THREE from "three";

import {
  CAMERA_HEIGHT,
  ZOOM_OUT_CAMERA_HEIGHT,
  ZOOM_STEP_FACTOR,
  ZOOM_TWEEN_MS,
} from "../config.js";
import {
  BlockType,
  getBlock,
  type ActiveEffect,
  type Inventory,
  type ItemId,
  type PlayerId,
  type ProjectileStore,
  type SnapshotBuffer,
  type Terrain,
  type World,
} from "../game/index.js";
import { composePlayerEntities } from "./compose.js";
import {
  disposePlayerMesh,
  syncPlayerMeshes,
  tileToScene,
  type PlayerMeshFactory,
  type RenderableEntity,
} from "./sync.js";
import {
  pickBlockUnderCursor,
  pickEntityUnderCursor,
  pickPlayerUnderCursor,
  type PickResult,
} from "./picker.js";
import { mushroomEmissiveAt, tileCenterToScene } from "./terrain.js";
import { sampleDaylight } from "./daylight.js";
import {
  type BlockEditEvent,
  type ChestBeamTarget,
  type TargetingStateEvent,
} from "./effects/index.js";
import { MS_PER_TICK, reconstructChargeStartMs } from "./attack_beam_layer.js";
import {
  flashMeshWhite,
  meshFlashCount,
  tickMeshFlashes,
} from "./mesh_flash.js";
import { computeGhostState, type GhostState } from "./ghost.js";
import {
  applyHoverBillboards,
  applyLanternBodyUnlit,
  defaultPlayerMeshFactory,
} from "./player_mesh.js";
import { SceneGraph, type Viewport } from "./scene_graph.js";
import { ScreenShake, type ScreenShakeOffset } from "./screen_shake.js";
import {
  ATTACKER_SHAKE_DURATION_MS,
  ATTACKER_SHAKE_TILES,
  shouldSpawnSlashFor,
  shouldTriggerAttackerShake,
} from "./slash_layer.js";
import { projectWorldToClient } from "./world_to_client.js";
import { ZoomController, clampZoomHeight } from "./zoom.js";

export type { Viewport } from "./scene_graph.js";

// Day-cycle sun-position radius (mirrors `scene_graph.ts`). The per-frame
// daylight sample places the directional sun at this offset from the
// local-player focus so its world-space angle reads correctly from any
// viewpoint while keeping the shadow camera frustum bounded.
const SUN_DISTANCE = 60;

/**
 * Duration of the strike-dash render-side animation. The
 * server teleports the attacker instantaneously when the charge
 * resolves; the renderer lerps the visible position over this window
 * so the dash reads as a deliberate motion instead of a snap. Pinned
 * shorter than `REMOTE_RENDER_DELAY_MS` so the lerp finishes before the
 * standard interpolation lag would deliver the new pos through compose.
 */
export const DASH_DURATION_MS = 150;

/**
 * Cooldown affordance window. Mirrors the server's
 * `COOLDOWN_DURATION_SECS = 5.0`. The local player's HUD reads the
 * latest strike-time and renders a depleting badge for this long.
 */
export const COOLDOWN_DURATION_MS = 5000;

/**
 * Per-frame scratch for the local-player focus. `updateCamera` and
 * `updateDaylight` both project the local player's tile position into
 * scene space the same way; they're called back-to-back in `frame()`
 * and neither stashes the reference, so a single mutable instance is
 * safe to share. Hoisted to module scope so the hot loop never
 * allocates a `Vector3` for this. Never read its previous-frame
 * value — both writers always set all three components first.
 */
const FOCUS_SCRATCH = new THREE.Vector3();

/**
 * Mutable backing record for the slow-particles effect-target pool.
 * Structurally compatible with the public-readonly `EffectTarget`, so the
 * pool can be handed to `slowParticles.applyTargets` as
 * `readonly EffectTarget[]` without a copy. Lives at module scope only so
 * the type isn't conflated with the public one.
 */
interface MutableEffectTarget {
  kind: "player" | "entity";
  id: number;
  x: number;
  y: number;
  effects: readonly ActiveEffect[];
}

/**
 * Shared sentinel for newly-acquired pool entries so a fresh slot doesn't
 * allocate a throwaway empty array. The caller always overwrites
 * `effects` with the player/entity's own array before the entry is read.
 */
const EMPTY_EFFECTS: readonly ActiveEffect[] = [];

/**
 * Owns the Three.js render loop. Per ADR 0003 every player — local and
 * remote — renders from `SnapshotBuffer` with the same
 * `REMOTE_RENDER_DELAY_MS` interpolation delay; `LocalPredictor` was
 * retired with the chunk-centric refactor. Local input now feels the
 * server tick, which is the known regression until a future task
 * reintroduces prediction.
 */
export class Renderer {
  private readonly graph: SceneGraph;
  private readonly meshes = new Map<PlayerId, THREE.Mesh>();
  private readonly factory: PlayerMeshFactory;
  private readonly now: () => number;
  private localPlayerId: PlayerId | null = null;
  private terrain: Terrain | null;
  private readonly inventory: Inventory | null;
  private readonly getSelectedHotbarSlot: () => number;
  private readonly projectiles: ProjectileStore | null;
  // Latest synced `time_of_day_seconds` from the wire layer. The renderer
  // reads this every frame to compute the current sample. Initialised to
  // `0` (sunrise) so the very first frame, before any TickUpdate has
  // landed, has a sane envelope rather than a random uninitialized number.
  private timeOfDaySeconds = 0;
  // Camera-height tween (see `render/zoom.ts`). Holds the source-of-truth
  // for both the M preset toggle and the continuous +/- / Ctrl+Wheel
  // bindings. Sampled once per frame in `updateCamera`. `zoomedOut` is
  // kept around as a separate flag because it also gates the chunk-border
  // grid (debug-only overlay), which is independent of the camera height.
  private readonly zoom: ZoomController;
  private zoomedOut = false;
  // Wall-clock timestamp of the last `frame()` call. `null` until the first
  // frame so we can flag the initial sync as "no smoothing" (an unknown
  // previous yaw makes the lerp meaningless until we have a real delta).
  private lastFrameMs: number | null = null;
  // Last NDC the input layer reported. `null` means the cursor is not over
  // the canvas (or hasn't moved yet) — no player is considered hovered.
  // Re-evaluated every frame against current mesh positions so a player
  // walking under a stationary cursor still triggers the hover-billboard.
  private cursorNdc: { x: number; y: number } | null = null;
  // Last rendered position per player. Updated once per frame (after the
  // dash override resolves `entities`) so any consumer reads the
  // most-recently-drawn pos: lookups inside the same frame act as
  // `positionByPlayer`, and wire callbacks (`onAttackEvents`) firing
  // between frames see the previous frame's snapshot — which is the
  // anchor the dash-on-strike animation lerps from.
  //
  // Entries are pooled across frames and tagged with `frame` so stale
  // players can be evicted without a per-frame allocation set: any entry
  // whose tag doesn't match the current frame counter is deleted. Cleared
  // on local-player reassign.
  private renderedPosFrame = 0;
  private readonly lastRenderedPos = new Map<
    PlayerId,
    { x: number; y: number; frame: number }
  >();
  // Pool + per-frame view for the slow-particles effect targets. The pool
  // owns the mutable `MutableEffectTarget` records and grows monotonically;
  // the view is reset (length=0) then refilled with references back into
  // the pool each frame, so after warmup neither array allocates. Passed
  // to `slowParticles.applyTargets` as `readonly EffectTarget[]` — the
  // layer iterates once and never stores entries past the call.
  private readonly effectTargetsPool: MutableEffectTarget[] = [];
  private readonly effectTargetsView: MutableEffectTarget[] = [];
  // Per-attacker dash override. On a strike resolution we
  // capture the attacker's last rendered position, the wall-clock at
  // which the strike landed, and lerp the rendered position toward the
  // authoritative world position over `DASH_DURATION_MS`. Overrides the
  // standard compose path for the attacker's frame only — every other
  // player continues to read from `SnapshotBuffer` as usual.
  private readonly activeDashes = new Map<PlayerId, {
    fromX: number;
    fromY: number;
    startMs: number;
  }>();
  // Reconstruction anchor for the server tick clock. The
  // first `charge-started` of an attack carries a `started_at_tick`
  // equal to the server's current tick, so the moment the event
  // arrives locally we can pin `(tick → wall-clock ms)` for the whole
  // attack. Every subsequent strike event for the same attack uses the
  // same anchor so the shrinking-beam phase stays sync'd across
  // observers regardless of network latency.
  private readonly tickAnchorByAttacker = new Map<PlayerId, {
    anchorTick: number;
    anchorMs: number;
  }>();
  /**
   * Latest `strike-*` time per attacker (wall-clock ms). Drives the
   * cooldown affordance for the local player; remote attackers' values
   * exist for symmetry but the UI only reads the local entry.
   */
  private readonly cooldownStartMsByAttacker = new Map<PlayerId, number>();
  /**
   * Damage-feedback shake. Source-agnostic — the session calls
   * `triggerScreenShake(...)` on a local-HP drop; wires the
   * attacker's own strike-shake through the same surface. Sampled in
   * `updateCamera` so the offset perturbs both `camera.position` and the
   * look-at target by the same vector, producing a pure visual translation
   * without rotating the view.
   */
  private readonly screenShake = new ScreenShake();

  // Hoisted lookup closures handed to per-frame layer updates. Bound to
  // `this.lastRenderedPos` and the entity-position helpers so the layer
  // sees the same data that was just drawn this frame. Stored as
  // instance arrows so the per-frame `frame()` body doesn't allocate a
  // fresh closure per layer per frame.
  private readonly lookupPlayerPosition = (
    id: number,
  ): { readonly x: number; readonly y: number } | null => {
    return this.lastRenderedPos.get(id) ?? null;
  };
  private readonly lookupAttackBeamTarget = (
    kind: "player" | "entity",
    id: number,
  ): { readonly x: number; readonly y: number } | null => {
    if (kind === "player") return this.lastRenderedPos.get(id) ?? null;
    return this.resolveEntityRenderedWorldPos(id) ?? this.entityTileCentre(id);
  };

  constructor(
    private readonly world: World,
    private readonly buffer: SnapshotBuffer,
    container: HTMLElement,
    viewport: Viewport,
    terrain: Terrain | null = null,
    factory: PlayerMeshFactory = defaultPlayerMeshFactory,
    now: () => number = () => Date.now(),
    inventory: Inventory | null = null,
    getSelectedHotbarSlot: () => number = () => 0,
    /**
     * Per-tick projectile mirror. Optional — tests that don't
     * exercise the blowgun feed leave it `null` and the projectile layer
     * simply has nothing to render.
     */
    projectiles: ProjectileStore | null = null,
  ) {
    this.terrain = terrain;
    this.factory = factory;
    this.now = now;
    this.inventory = inventory;
    this.getSelectedHotbarSlot = getSelectedHotbarSlot;
    this.projectiles = projectiles;

    this.graph = new SceneGraph(container, viewport, terrain, (id) => {
      const player = this.world.getPlayer(id);
      return player ? player.colorIndex : null;
    });

    this.zoom = new ZoomController(CAMERA_HEIGHT, ZOOM_TWEEN_MS, this.now());

    this.graph.webgl.setAnimationLoop(this.frame);
  }

  /**
   * Wire-layer hook. The latest `time_of_day_seconds` scalar
   * shipped on the most recent `TickUpdate`. Each frame `updateDaylight`
   * reads this and resamples sun direction / colour / ambient tint. The
   * scalar is monotonic per server (advances with each tick), so the
   * client just stores it verbatim — no easing or smoothing here; the
   * server-side advance is already a tick-rate-derivative scalar.
   */
  setTimeOfDaySeconds(seconds: number): void {
    this.timeOfDaySeconds = seconds;
  }

  setLocalPlayerId(id: PlayerId | null): void {
    if (this.localPlayerId === id) return;
    const affected = [this.localPlayerId, id].filter(
      (x): x is PlayerId => x !== null,
    );
    for (const pid of affected) {
      const mesh = this.meshes.get(pid);
      if (!mesh) continue;
      disposePlayerMesh(mesh, this.graph.playerGroup);
      this.meshes.delete(pid);
    }
    this.localPlayerId = id;
    // A local-player reassign means we just reconnected or the lobby
    // identity changed — drop every per-player carry-over so a fresh
    // session never inherits a dash, cooldown badge, or attack beam
    // from the previous one.
    this.lastRenderedPos.clear();
    this.activeDashes.clear();
    this.tickAnchorByAttacker.clear();
    this.cooldownStartMsByAttacker.clear();
    this.screenShake.reset();
    this.graph.attackBeams.clearAll();
    this.graph.flagBeams.clearAll();
    this.graph.slashes.clearAll();
    this.graph.damageNumbers.clearAll();
    this.graph.projectiles.clearAll();
    this.graph.slowParticles.clearAll();
    this.projectiles?.clear();
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
  }

  /**
   * Debug zoom-out toggle (bound to `M` in `bootstrap.ts`). When on, the
   * top-down camera retargets to `ZOOM_OUT_CAMERA_HEIGHT` and the chunk-
   * border grid is shown; off retargets back to `CAMERA_HEIGHT` and hides
   * the grid. The retarget eases via `ZoomController` so the camera
   * doesn't snap; the grid still toggles instantly because it's a debug
   * overlay where fade-ins would just look fussy.
   */
  setZoomedOut(on: boolean): void {
    if (this.zoomedOut === on) return;
    this.zoomedOut = on;
    this.graph.setChunkBorderVisible(on);
    this.zoom.setTarget(
      on ? ZOOM_OUT_CAMERA_HEIGHT : CAMERA_HEIGHT,
      this.now(),
    );
  }

  /**
   * Continuous zoom step (`+` / `-` / `Ctrl+Wheel`). `direction` is +1 to
   * zoom in (camera lower) or -1 to zoom out (camera higher). The new
   * target is `current_target * ZOOM_STEP_FACTOR^(-direction)`, clamped
   * to `[ZOOM_HEIGHT_MIN, ZOOM_HEIGHT_MAX]`. Mid-tween retargets stay
   * continuous — see `ZoomController.setTarget`.
   */
  nudgeZoom(direction: 1 | -1): void {
    const factor = direction > 0 ? 1 / ZOOM_STEP_FACTOR : ZOOM_STEP_FACTOR;
    const next = clampZoomHeight(this.zoom.target() * factor);
    this.zoom.setTarget(next, this.now());
  }

  /**
   * Cursor-driven world pick. `cursorNdc` is normalized device coords
   * (`x`, `y` ∈ [-1, 1]); the renderer owns the camera, so this method
   * keeps callers out of `three`. Returns `null` if no terrain is loaded
   * or the cursor falls outside any loaded chunk — see `picker.ts`.
   */
  pickAtCursor(
    cursorNdc: { readonly x: number; readonly y: number },
  ): PickResult | null {
    if (!this.terrain) return null;
    return pickBlockUnderCursor(cursorNdc, this.graph.camera, this.terrain);
  }

  /**
   * Cursor-driven attack-target pick. Returns the first
   * player-or-entity whose render hit the cursor, or `null` when no
   * target is under the cursor. Players take precedence over entities
   * sharing the same tile so a body-occluded spider doesn't steal the
   * click. The local player is filtered out — a click that hits the
   * caller's own body cannot be an attack.
   */
  pickAttackTargetAtCursor(
    cursorNdc: { readonly x: number; readonly y: number },
  ): { kind: "player"; id: PlayerId } | { kind: "entity"; id: number } | null {
    const playerHit = pickPlayerUnderCursor(cursorNdc, this.graph.camera, this.meshes);
    if (playerHit !== null && playerHit !== this.localPlayerId) {
      return { kind: "player", id: playerHit };
    }
    if (this.terrain === null) return null;
    const entityHit = pickEntityUnderCursor(
      cursorNdc,
      this.graph.camera,
      this.terrain,
    );
    if (entityHit !== null) return { kind: "entity", id: entityHit };
    return null;
  }

  /**
   * Tell the renderer where the cursor currently is in NDC, or `null` to
   * clear (cursor left the canvas). Drives hover-only username billboards:
   * the per-frame loop re-runs `pickPlayerUnderCursor` against this NDC and
   * toggles each player's billboard sprite.
   */
  setCursorNdc(
    cursorNdc: { readonly x: number; readonly y: number } | null,
  ): void {
    this.cursorNdc = cursorNdc === null ? null : { x: cursorNdc.x, y: cursorNdc.y };
  }

  /**
   * Test handle: project a world tile `(x, y)` to the canvas's
   * client-pixel coordinates. Lets a Playwright spec drive a real
   * `page.mouse.move(x, y)` against a tile centre without reproducing the
   * camera math externally. Reads the live camera matrices, so the
   * result tracks the local-player camera as it follows the player.
   *
   * Returns `null` only when the underlying canvas isn't laid out yet
   * (zero-sized rect) — production always yields a finite point. The
   * map is straight projection: off-screen tiles return coordinates
   * outside the canvas bounds rather than `null`.
   */
  worldToClient(
    worldX: number,
    worldY: number,
  ): { x: number; y: number } | null {
    const rect = this.graph.webgl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return projectWorldToClient(worldX, worldY, this.graph.camera, rect);
  }

  /**
   * Latest ghost-preview state computed by the per-frame driver, or `null`
   * when nothing is being previewed (no held block, no valid target). Read
   * by Playwright via `__anarchy.getGhostState()` to assert visibility
   * end-to-end without inspecting Three.js internals.
   */
  getGhostState(): GhostState | null {
    return this.graph.ghost.getState();
  }

  /**
   * Test handle: number of player-attached lantern lights
   * currently visible in the scene. Visible means `nightFactor > 0` AND
   * the player is wearing a lantern; a daylight scene with lantern-
   * wearers reports `0`. Lets a Playwright spec assert "the lantern
   * light is in the scene at night" without poking at Three.js
   * internals.
   */
  getLanternLightCount(): number {
    return this.graph.lanternLights.visibleCount();
  }

  /**
   * The wire layer just observed a per-tick block-edit (place / break)
   * attributed to a player. Spawns a one-shot effect at the cell tinted
   * by the actor's color. See `EffectsLayer.onBlockEdit`.
   */
  onBlockEdit(event: BlockEditEvent): void {
    const nowMs = this.now();
    this.graph.effects.onBlockEdit(event, nowMs);
    if (event.kind === "placed") {
      this.graph.beams.onPlace(event, nowMs);
    } else {
      const center = tileCenterToScene(event.cx, event.cy, event.lx, event.ly);
      this.graph.breakParticles.spawn(center.x, center.z, event.blockType, nowMs);
    }
  }

  /**
   * The wire layer just observed this tick's full set of held-break
   * targeting states. Replaces the live targeting overlays wholesale.
   *
   * Each target is enriched with its targeted layer (`top` if the cell's
   * top kind is non-Air, else `ground`) so the effects layer can draw a
   * flat square outline on the ground for a ground-layer break instead
   * of a cube hanging in the air at the top layer.
   * The beam layer ignores the extra field (structural typing).
   */
  applyTargetingStates(targets: readonly TargetingStateEvent[]): void {
    const enriched = targets.map((t) => ({ ...t, layer: this.deriveTargetLayer(t) }));
    this.graph.effects.applyTargets(enriched);
    this.graph.beams.applyBreakTargets(enriched);
  }

  /**
   * Resolve the layer a held-break targeting state is hitting by reading
   * the local terrain mirror. Top-kind `Air` means the player is mining
   * the ground layer (break-via-replace); anything else is a top-layer
   * break. Defaults to `"top"` when terrain isn't available so legacy
   * behavior is preserved.
   */
  private deriveTargetLayer(
    target: { cx: number; cy: number; lx: number; ly: number },
  ): "ground" | "top" {
    if (!this.terrain) return "top";
    const chunk = this.terrain.get(target.cx, target.cy);
    if (!chunk) return "top";
    const top = getBlock(chunk.top, target.lx, target.ly);
    return top.kind === BlockType.Air ? "ground" : "top";
  }

  /**
   * The wire layer observed `TickUpdate.attack_events`.
   * Routes each event into the beam layer, captures dash anchors for
   * the dash render-side animation, and pins the cooldown timestamp
   * for the local player's HUD affordance.
   *
   * `tickReceivedMs` is the wall-clock at which the tick frame landed
   * locally — used as the anchor for converting the server's
   * `started_at_tick` into a charge-start wall-clock that all observers
   * agree on (modulo their own clock skew on the inbound frame).
   */
  onAttackEvents(
    events: ReadonlyArray<{
      readonly attackerPlayerId: number;
      readonly targetKind: "player" | "entity";
      readonly targetId: number;
      readonly outcome: "charge-started" | "strike-hit" | "strike-missed";
      readonly startedAtTick: number;
    }>,
    tickReceivedMs: number,
  ): void {
    for (const ev of events) {
      if (ev.outcome === "charge-started") {
        // Pin a fresh `(tick, wall-clock)` anchor for this attack so
        // the beam-shrink phase is reconstructed from server time.
        this.tickAnchorByAttacker.set(ev.attackerPlayerId, {
          anchorTick: ev.startedAtTick,
          anchorMs: tickReceivedMs,
        });
        const colorIndex =
          this.world.getPlayer(ev.attackerPlayerId)?.colorIndex ?? 0;
        const chargeStartMs = reconstructChargeStartMs(
          ev.startedAtTick,
          ev.startedAtTick,
          tickReceivedMs,
        );
        this.graph.attackBeams.onCharge(
          ev.attackerPlayerId,
          ev.targetKind,
          ev.targetId,
          colorIndex,
          chargeStartMs,
        );
      } else {
        // STRIKE_HIT or STRIKE_MISSED. Retire the beam, capture the
        // current rendered position as the dash "from", pin the
        // cooldown start, spawn the slash flash, and (for the local
        // player only) trigger the attacker-shake.
        this.graph.attackBeams.onResolve(ev.attackerPlayerId);
        const nowMs = this.now();
        const from = this.lastRenderedPos.get(ev.attackerPlayerId);
        if (from !== undefined) {
          this.activeDashes.set(ev.attackerPlayerId, {
            fromX: from.x,
            fromY: from.y,
            startMs: nowMs,
          });
        }
        // Server's resolution tick = startedAtTick + CHARGE_TICKS, but
        // we don't need to reconstruct it here — the dash just lerps
        // from "last rendered" to "current server pos" over a fixed
        // 150 ms window starting now.
        this.cooldownStartMsByAttacker.set(ev.attackerPlayerId, nowMs);
        // The anchor is no longer needed once the strike has fired —
        // drop it so reconnect-style state never leaks.
        this.tickAnchorByAttacker.delete(ev.attackerPlayerId);
        // Slash anchor: target tile centre on hit, attacker landing
        // position on miss. Direction: attacker → target on hit, or
        // attacker pre→post-dash on miss with no surviving target.
        if (shouldSpawnSlashFor(ev.outcome)) {
          const attackerPos = this.world.getPlayer(ev.attackerPlayerId);
          const targetPos =
            ev.outcome === "strike-hit"
              ? this.resolveTargetPos(ev.targetKind, ev.targetId)
              : null;
          const anchor =
            targetPos !== null
              ? targetPos
              : attackerPos !== undefined
                ? { x: attackerPos.x, y: attackerPos.y }
                : null;
          if (anchor !== null) {
            let dx = 0;
            let dy = 0;
            if (attackerPos !== undefined && targetPos !== null) {
              dx = targetPos.x - attackerPos.x;
              dy = targetPos.y - attackerPos.y;
            } else if (attackerPos !== undefined && from !== undefined) {
              dx = attackerPos.x - from.x;
              dy = attackerPos.y - from.y;
            }
            const colorIndex = attackerPos?.colorIndex ?? 0;
            this.graph.slashes.spawn({
              attackerPlayerId: ev.attackerPlayerId,
              attackerColorIndex: colorIndex,
              anchor,
              direction: { x: dx, y: dy },
              nowMs,
            });
          }
        }
        if (
          shouldTriggerAttackerShake(
            ev.outcome,
            ev.attackerPlayerId,
            this.localPlayerId,
          )
        ) {
          this.screenShake.trigger(
            ATTACKER_SHAKE_TILES,
            ATTACKER_SHAKE_DURATION_MS,
            nowMs,
          );
        }
      }
    }
    // Mirror `tickReceivedMs` for the `MS_PER_TICK` debug aid the
    // unit tests reference — the variable is intentionally re-imported
    // even when unused at runtime so the constant stays explicit.
    void MS_PER_TICK;
  }

  /**
   * The wire layer observed `TickUpdate.damage_events`. Drops
   * a white flash on the target mesh and spawns a floating `-N` red
   * number at the target's head. Source-agnostic — every HP-reducing
   * event (strike hit, admin damage, future env damage) routes here.
   *
   * `tickReceivedMs` anchors the flash + number lifetimes to the
   * renderer's animation clock. A target that despawned in the same
   * tick (killing blow) falls back to its last-known mesh position;
   * a target whose mesh never existed (race) drops silently.
   */
  onDamageEvents(
    events: ReadonlyArray<{
      readonly targetKind: "player" | "entity";
      readonly targetId: number;
      readonly amount: number;
      readonly attackerPlayerId: number;
      readonly happenedAtTick: number;
    }>,
    tickReceivedMs: number,
  ): void {
    for (const ev of events) {
      const mesh = this.resolveTargetMesh(ev.targetKind, ev.targetId);
      const worldPos = this.resolveTargetWorldPos(ev.targetKind, ev.targetId);
      if (mesh !== null) flashMeshWhite(mesh, tickReceivedMs);
      if (worldPos !== null) {
        this.graph.damageNumbers.spawn(worldPos, ev.amount, tickReceivedMs);
      }
    }
  }

  /**
   * The wire layer observed `TickUpdate.flag_interacts` —
   * the per-tick set of admitted flag-XP transfers. Wholesale-replace
   * into the beam layer: a player in the list keeps / updates their
   * beam, a player no longer in the list retires theirs. Absent
   * `flag_interacts` means "nothing transferring this tick" — the
   * common case — and clears the layer.
   */
  applyFlagInteracts(
    specs: ReadonlyArray<{
      readonly playerId: number;
      readonly flagCx: number;
      readonly flagCy: number;
      readonly flagLx: number;
      readonly flagLy: number;
      readonly mode: "deposit" | "steal";
    }>,
  ): void {
    this.graph.flagBeams.applyFlagInteracts(specs);
  }

  /** Test handle: live flag-beam count. */
  getFlagBeamCount(): number {
    return this.graph.flagBeams.size();
  }

  /**
   * The wire layer observed `TickUpdate.projectile_impacts`.
   * Spawns a small puff at each impact's world position and drops the
   * projectile from the store so the dart mesh retires the same frame.
   */
  onProjectileImpacts(
    events: ReadonlyArray<{
      readonly projectileId: number;
      readonly x: number;
      readonly y: number;
    }>,
    tickReceivedMs: number,
  ): void {
    for (const ev of events) {
      this.graph.projectiles.spawnImpactPuff(ev.x, ev.y, tickReceivedMs);
      this.projectiles?.remove(ev.projectileId);
    }
  }

  /** Test handle: live projectile mesh count. */
  getProjectileCount(): number {
    return this.graph.projectiles.size();
  }

  /** Test handle ( lineage): number of targets currently
   *  visualising an active Slow effect. The cyan-disc indicator was
   *  retired for a particle trail; this handle now returns
   *  the live emitter count, which is stable while Slow is active. */
  getEffectIndicatorCount(): number {
    return this.graph.slowParticles.emitterCount();
  }

  /** Test handle: live impact-puff particle count. */
  getProjectilePuffCount(): number {
    return this.graph.projectiles.puffCount();
  }

  /**
   * Resolve the renderer-side mesh for a damage target. Players come
   * from the per-id mesh map (built by `syncPlayerMeshes`); entities
   * come from the entity-layer state map.
   */
  private resolveTargetMesh(
    kind: "player" | "entity",
    id: number,
  ): THREE.Object3D | null {
    if (kind === "player") {
      return this.meshes.get(id) ?? null;
    }
    return this.graph.entities.getMesh(id);
  }

  /**
   * Resolve the *world* position for a damage target's head anchor.
   * Players use the authoritative position from `World`; entities use
   * the (interpolated) tile-centre derived from the game-state mirror.
   * Falls back to the renderer-side last-rendered position if both
   * lookups miss (target despawned same tick).
   */
  private resolveTargetWorldPos(
    kind: "player" | "entity",
    id: number,
  ): { x: number; y: number } | null {
    if (kind === "player") {
      const p = this.world.getPlayer(id);
      if (p) return { x: p.x, y: p.y };
      const last = this.lastRenderedPos.get(id);
      return last ?? null;
    }
    const terrain = this.terrain;
    if (terrain !== null) {
      for (const [, chunk] of terrain.iter()) {
        const e = chunk.entities.get(id);
        if (e !== undefined) return { x: e.tileX + 0.5, y: e.tileY + 0.5 };
      }
    }
    return null;
  }

  /**
   * Resolve the *rendered* world position for an entity, picking up the
   * mesh-layer's mid-step interpolation so beam / projectile / status-
   * effect overlays track the spider as it visibly walks rather than
   * snapping to its tile centre. Returns `null` when no mesh exists yet
   * (first-frame appearance) so callers can fall back to the tile centre.
   */
  private resolveEntityRenderedWorldPos(
    id: number,
  ): { x: number; y: number } | null {
    return this.graph.entities.getRenderedWorldPosition(id);
  }

  /**
   * Tile-centre fallback used when no entity mesh exists yet (the wire
   * mirror has the entity but the layer hasn't built the mesh on this
   * frame). Scans loaded chunks; returns `null` if the entity is gone
   * from the mirror too.
   */
  private entityTileCentre(id: number): { x: number; y: number } | null {
    const terrain = this.terrain;
    if (terrain === null) return null;
    for (const [, chunk] of terrain.iter()) {
      const e = chunk.entities.get(id);
      if (e !== undefined) return { x: e.tileX + 0.5, y: e.tileY + 0.5 };
    }
    return null;
  }

  /**
   * Test handle: number of meshes currently mid-flash.
   * Mirrors `getAttackBeamCount` / `getSlashCount` for e2e assertions.
   */
  getMeshFlashCount(): number {
    return meshFlashCount();
  }

  /**
   * Test handle: number of floating damage numbers
   * currently in the scene.
   */
  getDamageNumberCount(): number {
    return this.graph.damageNumbers.size();
  }

  /**
   * Test handle / cooldown read-out. Returns the wall-clock
   * ms at which `playerId`'s most recent strike fired, or `null` if the
   * player has not struck this session. The HUD cooldown affordance
   * subscribes to this for the local player; e2e specs can poll it to
   * assert the strike landed without inspecting the renderer scene.
   */
  getStrikeStartedMs(playerId: PlayerId): number | null {
    return this.cooldownStartMsByAttacker.get(playerId) ?? null;
  }

  /**
   * Test handle: scene-graph count of live attack beams.
   * Mirrors `EntityLayer.size()` shape.
   */
  getAttackBeamCount(): number {
    return this.graph.attackBeams.size();
  }

  /**
   * Test handle: scene-graph count of live slash sprites.
   * Spawns are one-per-strike (hit or miss); each retires after 250 ms.
   */
  getSlashCount(): number {
    return this.graph.slashes.size();
  }

  /**
   * Per-frame WebGL render stats plus terrain / scene mesh counts.
   * `calls` and `triangles` come from `WebGLRenderer.info.render` and
   * reset per frame, so callers should poll after at least one
   * `requestAnimationFrame` has fired on a steady-state scene. Used by
   * the terrain-meshing investigation in BACKLOG 350 — exposed on the
   * test handle so a Playwright spec can measure draw-call cost without
   * reaching into Three.js internals.
   */
  getRenderStats(): {
    calls: number;
    triangles: number;
    frameCounter: number;
    terrainMeshes: number;
    sceneMeshes: number;
  } {
    const info = this.graph.webgl.info.render;
    let terrainMeshes = 0;
    const terrainGroup = this.graph.terrainGroup;
    if (terrainGroup) {
      terrainGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) terrainMeshes++;
      });
    }
    let sceneMeshes = 0;
    this.graph.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) sceneMeshes++;
    });
    return {
      calls: info.calls,
      triangles: info.triangles,
      frameCounter: info.frame,
      terrainMeshes,
      sceneMeshes,
    };
  }

  /**
   * Resolve a strike target's tile-centre world position from game state.
   * Players are looked up in `World`; entities are scanned out of the
   * loaded terrain chunks. Returns `null` if the target is no longer
   * present (e.g. an entity died this tick or a player left the view).
   */
  private resolveTargetPos(
    kind: "player" | "entity",
    id: number,
  ): { x: number; y: number } | null {
    if (kind === "player") {
      const p = this.world.getPlayer(id);
      return p ? { x: p.x, y: p.y } : null;
    }
    const terrain = this.terrain;
    if (terrain === null) return null;
    for (const [, chunk] of terrain.iter()) {
      const e = chunk.entities.get(id);
      if (e === undefined) continue;
      return { x: e.tileX + 0.5, y: e.tileY + 0.5 };
    }
    return null;
  }

  /**
   * Damage-feedback hook. Caller (today: the bootstrap session
   * on a local-HP drop) supplies a peak magnitude (tiles) and a duration
   * (ms); the renderer applies the resulting offset to the camera each
   * frame. Magnitude is clamped inside `ScreenShake` so an absurd input
   * cannot eject the camera. The trigger surface is source-agnostic — task
   * 130 wires the attacker's own strike-shake here as well.
   */
  triggerScreenShake(magnitudeTiles: number, durationMs: number): void {
    this.screenShake.trigger(magnitudeTiles, durationMs, this.now());
  }

  /**
   * Test handle: current shake offset in tile units, or
   * `(0, 0)` when no shake is active. Lets e2e + bootstrap unit tests
   * pin the shake state end-to-end without inspecting the camera.
   */
  getScreenShakeOffset(): ScreenShakeOffset {
    return this.screenShake.offsetAt(this.now());
  }

  /**
   * Test handle: wall-clock ms of the most recent screen-shake trigger,
   * or `null` if none has fired since the local player was last set.
   * Persists past the shake's decay window — `attack-slash.spec.ts`'s
   * "real-click hit" assertion (task 550) reads this rather than the live
   * offset because the 120 ms attacker-shake is shorter than the slash's
   * 250 ms lifetime and Playwright's polling sweep can land between the
   * "shake started" and "shake still amplitude > 0" frames.
   */
  getLastScreenShakeStartedMs(): number | null {
    return this.screenShake.lastTriggerStartedMs();
  }

  /**
   * The wire layer just inserted or replaced the chunk at `(cx, cy)`.
   * Replace just that chunk's sub-group inside the terrain mesh, leaving
   * neighbors untouched.
   */
  applyChunkLoaded(cx: number, cy: number): void {
    if (!this.terrain) return;
    this.graph.replaceChunk(cx, cy, this.terrain);
  }

  /**
   * The wire layer just removed the chunk at `(cx, cy)`. Drop its
   * sub-group from the terrain mesh.
   */
  applyChunkUnloaded(cx: number, cy: number): void {
    this.graph.removeChunk(cx, cy);
  }

  resize(width: number, height: number): void {
    this.graph.resize(width, height);
  }

  dispose(): void {
    this.graph.webgl.setAnimationLoop(null);
    for (const mesh of this.meshes.values()) {
      disposePlayerMesh(mesh, this.graph.playerGroup);
    }
    this.meshes.clear();
    this.graph.dispose();
  }

  private frame = () => {
    const nowMs = this.now();
    const dtMs = this.lastFrameMs === null ? Infinity : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    const composed = composePlayerEntities(this.world, this.buffer, nowMs);
    // any attacker mid-dash overrides the composed position
    // with a fast lerp from their pre-strike rendered position to the
    // authoritative world position. After `DASH_DURATION_MS` the
    // entry retires and the standard compose path resumes — by then
    // the snapshot-buffer interpolation has caught up. `composed` is a
    // fresh array each frame, so mutating its entries in place (when
    // dashes are active) is safe and avoids spread-copies; when no dash
    // is active we reuse `composed` directly to skip the `.map` alloc.
    if (this.activeDashes.size > 0) {
      for (let i = 0; i < composed.length; i++) {
        const e = composed[i];
        const dash = this.activeDashes.get(e.id);
        if (dash === undefined) continue;
        const elapsed = nowMs - dash.startMs;
        if (elapsed >= DASH_DURATION_MS) {
          this.activeDashes.delete(e.id);
          continue;
        }
        const t = elapsed <= 0 ? 0 : elapsed / DASH_DURATION_MS;
        const authoritative = this.world.getPlayer(e.id);
        const targetX = authoritative ? authoritative.x : e.x;
        const targetY = authoritative ? authoritative.y : e.y;
        const mut = e as { x: number; y: number };
        mut.x = dash.fromX + (targetX - dash.fromX) * t;
        mut.y = dash.fromY + (targetY - dash.fromY) * t;
      }
    }
    const entities: readonly RenderableEntity[] = composed;
    // Refresh the rendered-position pool now (after dash override) so
    // every downstream read this frame — beams, attack beams, flag beams,
    // projectiles — and every wire callback firing between this frame
    // and the next sees the actually-drawn positions. Also resolves the
    // local-player entity in the same single pass so `updateCamera` /
    // `updateDaylight` don't each do an O(N) `.find`.
    const localEntity = this.refreshRenderedPositions(entities);
    syncPlayerMeshes(
      entities,
      this.localPlayerId,
      this.meshes,
      this.graph.playerGroup,
      this.factory,
      dtMs,
    );
    this.updateCamera(localEntity);
    this.updateDaylight(entities, localEntity);
    applyLanternBodyUnlit(this.meshes, entities);
    this.refreshHoverBillboards();
    this.refreshGhostPreview();
    this.graph.effects.update(nowMs);
    this.graph.breakParticles.update(nowMs);
    // Entities. Reads the
    // game-state entity mirror — populated by the wire bridge into
    // `Chunk.entities` — and smoothes mesh positions between tile
    // teleports.
    this.graph.entities.update(this.terrain, nowMs);
    // Chest beams — refresh from the open-chest set carried
    // on every player snapshot so a beam exists for every (player,
    // chest) the server says is currently open. The world is rebuilt
    // each tick, so this re-pulls fresh.
    this.refreshChestBeams();
    // Beams aim at the same interpolated player positions that
    // `syncPlayerMeshes` just consumed so a beam stays glued to its
    // actor's body across remote-render delay.
    this.graph.beams.update(this.lookupPlayerPosition, nowMs);
    // the charge beam connects the attacker's body to the
    // target's body (player or entity), and aims at whichever position
    // is rendered this frame so a moving target keeps the beam glued
    // on. Entities are tile-bound server-side but the entity layer
    // smooth-lerps the mesh between tiles, so we read the layer's
    // rendered world position rather than snapping to tile centre.
    // Fallback to tile centre covers the first-frame-appearance case
    // (no mesh yet).
    this.graph.attackBeams.update(this.lookupAttackBeamTarget, nowMs);
    // re-aim every active flag-interact beam against the
    // latest player position. Beams whose interactor walked out of
    // view this frame are hidden (not retired) — the next tick may
    // bring the player back in via the chunk window.
    this.graph.flagBeams.update(this.lookupPlayerPosition);
    // status-effect indicators above each effected target,
    // then projectile-layer reconcile against the per-tick store.
    this.rebuildEffectTargets();
    this.graph.slowParticles.applyTargets(this.effectTargetsView, nowMs);
    this.graph.slowParticles.update(nowMs);
    if (this.projectiles !== null) {
      this.graph.projectiles.update(
        this.projectiles,
        nowMs,
        this.lookupAttackBeamTarget,
      );
    }
    // advance slash lifetimes (fade + expand) and retire
    // expired sprites. Position / rotation are fixed at spawn — the
    // slash anchor never moves, so no per-frame re-aim is needed.
    this.graph.slashes.tick(nowMs);
    // advance damage-feedback layers. The flash module restores
    // body colour after the configured window; the damage-numbers layer
    // advances each floating sprite's float + fade and retires expired ones.
    tickMeshFlashes(nowMs);
    this.graph.damageNumbers.tick(nowMs);
    this.graph.webgl.render(this.graph.scene, this.graph.camera);
  };

  /**
   * Update `lastRenderedPos` in place for `entities`, evicting any pooled
   * entry that didn't get a fresh write this frame. Returns the local-
   * player's entity (or `undefined`) found in the same pass so the
   * camera / daylight passes don't each re-walk `entities`.
   */
  private refreshRenderedPositions(
    entities: readonly RenderableEntity[],
  ): RenderableEntity | undefined {
    this.renderedPosFrame++;
    const frame = this.renderedPosFrame;
    const localId = this.localPlayerId;
    let local: RenderableEntity | undefined = undefined;
    for (const e of entities) {
      if (localId !== null && e.id === localId) local = e;
      const entry = this.lastRenderedPos.get(e.id);
      if (entry === undefined) {
        this.lastRenderedPos.set(e.id, { x: e.x, y: e.y, frame });
      } else {
        entry.x = e.x;
        entry.y = e.y;
        entry.frame = frame;
      }
    }
    for (const [id, entry] of this.lastRenderedPos) {
      if (entry.frame !== frame) this.lastRenderedPos.delete(id);
    }
    return local;
  }

  /**
   * Refill `effectTargetsView` from the world's players + loaded-chunk
   * entities. Pool entries are mutated in place so neither the pool nor
   * the view allocates after warmup; the view's `length` is reset to `0`
   * and re-grown each frame, which V8 keeps backing-buffer-stable.
   */
  private rebuildEffectTargets(): void {
    this.effectTargetsView.length = 0;
    for (const p of this.world.players()) {
      if (p.effects.length === 0) continue;
      const entry = this.acquireEffectTarget();
      entry.kind = "player";
      entry.id = p.id;
      entry.x = p.x;
      entry.y = p.y;
      entry.effects = p.effects;
    }
    if (this.terrain !== null) {
      for (const [, chunk] of this.terrain.iter()) {
        for (const e of chunk.entities.values()) {
          if (e.effects.length === 0) continue;
          const pos = this.resolveEntityRenderedWorldPos(e.id);
          const entry = this.acquireEffectTarget();
          entry.kind = "entity";
          entry.id = e.id;
          entry.x = pos !== null ? pos.x : e.tileX + 0.5;
          entry.y = pos !== null ? pos.y : e.tileY + 0.5;
          entry.effects = e.effects;
        }
      }
    }
  }

  private acquireEffectTarget(): MutableEffectTarget {
    const i = this.effectTargetsView.length;
    let entry: MutableEffectTarget;
    if (i < this.effectTargetsPool.length) {
      entry = this.effectTargetsPool[i];
    } else {
      entry = { kind: "player", id: 0, x: 0, y: 0, effects: EMPTY_EFFECTS };
      this.effectTargetsPool.push(entry);
    }
    this.effectTargetsView.push(entry);
    return entry;
  }

  private refreshGhostPreview(): void {
    if (this.inventory === null || this.terrain === null) {
      this.graph.ghost.apply(null);
      return;
    }
    const slot = this.inventory.slot(this.getSelectedHotbarSlot());
    const pick =
      this.cursorNdc === null
        ? null
        : pickBlockUnderCursor(this.cursorNdc, this.graph.camera, this.terrain);
    const state = computeGhostState({
      slot,
      pick,
      world: this.world,
      terrain: this.terrain,
      localPlayerId: this.localPlayerId,
    });
    this.graph.ghost.apply(state);
  }

  /**
   * Chest-beam refresh. Walks every player the world knows
   * about and collects one `ChestBeamTarget` per `(player, open chest)`
   * pair, then hands the union to the beam layer for a wholesale replace.
   * The set arrives via `PlayerSnapshot.open_chests` on every tick so
   * the renderer never has to track open/close transitions itself.
   */
  private refreshChestBeams(): void {
    const targets: ChestBeamTarget[] = [];
    for (const p of this.world.players()) {
      for (const c of p.openChests) {
        targets.push({
          playerId: p.id,
          cx: c.cx,
          cy: c.cy,
          lx: c.lx,
          ly: c.ly,
        });
      }
    }
    this.graph.beams.applyChestTargets(targets);
  }

  /**
   * Test handle: number of chest beams currently in the
   * scene. Lets a Playwright spec assert "one beam per open chest"
   * without poking at Three.js internals.
   */
  getChestBeamCount(): number {
    return this.graph.beams.chestBeamCount();
  }

  /**
   * Test handle: scene-space `(x, z)` of every
   * entity mesh the renderer is currently showing, keyed by `EntityId`.
   * Lets an e2e spec pin "a spider appeared at the seeded tile" and "the
   * mesh has moved across the wait window" without inspecting Three.js
   * internals. The local `y` (height above ground) is omitted — it's
   * constant per kind and not load-bearing for the assertions.
   */
  getRenderedEntities(): Record<number, { x: number; z: number }> {
    const out: Record<number, { x: number; z: number }> = {};
    for (const r of this.graph.entities.iterRendered()) {
      out[r.id] = { x: r.x, z: r.z };
    }
    return out;
  }

  private refreshHoverBillboards(): void {
    // The picker uses `Raycaster.intersectObjects` which respects camera
    // matrices computed during the previous render — `updateCamera` has
    // already run this frame, so the picker sees the current view.
    const hoveredId =
      this.cursorNdc === null
        ? null
        : pickPlayerUnderCursor(this.cursorNdc, this.graph.camera, this.meshes);
    applyHoverBillboards(this.meshes, hoveredId);
  }

  /**
   * Sample the day cycle at the latest synced `time_of_day_seconds` and
   * push the result into the directional sun + ambient + sky background.
   * Anchors the sun and its shadow camera at the local player's focus
   * point so the shadow frustum stays glued to where the camera is
   * looking — chunks well outside the visible window aren't paying
   * shadow-render cost.
   */
  private updateDaylight(
    entities: readonly {
      id: PlayerId;
      x: number;
      y: number;
      equippedUtility: ItemId | null;
    }[],
    local: RenderableEntity | undefined,
  ): void {
    const sample = sampleDaylight(this.timeOfDaySeconds);
    this.graph.ambient.color.setHex(sample.ambientColor);
    this.graph.ambient.intensity = sample.ambientIntensity;
    this.graph.sun.color.setHex(sample.sunColor);
    this.graph.sun.intensity = sample.sunIntensity;
    this.graph.moon.color.setHex(sample.moonColor);
    this.graph.moon.intensity = sample.moonIntensity;
    (this.graph.scene.background as THREE.Color).setHex(sample.skyColor);

    if (local) {
      tileToScene(local.x, local.y, FOCUS_SCRATCH);
    } else {
      FOCUS_SCRATCH.set(0, 0, 0);
    }
    const focus = FOCUS_SCRATCH;
    this.graph.sun.target.position.copy(focus);
    this.graph.sun.target.updateMatrixWorld();
    this.graph.sun.position.set(
      focus.x + sample.sunDir.x * SUN_DISTANCE,
      focus.y + sample.sunDir.y * SUN_DISTANCE,
      focus.z + sample.sunDir.z * SUN_DISTANCE,
    );
    // The shadow map is computed in the sun's local frame, which derives
    // from `sun.position` + `sun.target.position`. Telling Three.js to
    // refresh the shadow camera matrix every frame is cheap (one matrix
    // multiply) and avoids ghost-shadows from a stale frustum.
    this.graph.sun.shadow.camera.updateProjectionMatrix();
    // Moon: same focus-anchored sphere placement, but no shadow
    // pass — it only contributes diffuse fill so up-facing surfaces are
    // legible after dusk. `moonDir` is the antipode of `sunDir`, so this
    // automatically lands above the horizon whenever the sun is below.
    this.graph.moon.target.position.copy(focus);
    this.graph.moon.target.updateMatrixWorld();
    this.graph.moon.position.set(
      focus.x + sample.moonDir.x * SUN_DISTANCE,
      focus.y + sample.moonDir.y * SUN_DISTANCE,
      focus.z + sample.moonDir.z * SUN_DISTANCE,
    );
    // Torches: light-pool driven by the same daylight sample
    // and the same focus point as the sun. Pinning the focus to the local
    // player keeps the "32 nearest torches" pick stable as the world
    // streams in around them.
    this.graph.torchLights.update({ x: focus.x, z: focus.z }, sample.nightFactor);
    // Mushrooms: cool-glow companion pool to the torch one,
    // same nearest-N pick around the focus, weaker radius/intensity so
    // they read as atmosphere rather than navigable light.
    this.graph.mushroomLights.update({ x: focus.x, z: focus.z }, sample.nightFactor);
    // drive the mushroom sprite emissive in lockstep with the
    // light pool. At noon (`nightFactor == 0`) emissive is 0 and the
    // sprite renders as plain lit decor; at midnight it brightens by the
    // peak so the mushroom reads as the source of the surrounding glow.
    this.graph.mushroomMaterial.emissiveIntensity = mushroomEmissiveAt(
      sample.nightFactor,
    );
    // Lanterns: one light per player wearing one. Driven by
    // the same `nightFactor` so the day cycle reads consistent across
    // every warm light source.
    this.graph.lanternLights.update(entities, sample.nightFactor);
  }

  private updateCamera(local: RenderableEntity | undefined) {
    // Follow the local player's interpolated position. With prediction
    // removed (ADR 0003 §7) this advances at the snapshot cadence — local
    // input feels the server tick.
    if (local) {
      tileToScene(local.x, local.y, FOCUS_SCRATCH);
    } else {
      FOCUS_SCRATCH.set(0, 0, 0);
    }
    const focus = FOCUS_SCRATCH;
    const height = this.zoom.sample(this.now());
    // Damage-feedback shake. Tile-space `(dx, dy)` from the
    // shake module maps to scene-space `(dx, 0, -dy)` (mirrors `tileToScene`),
    // then we perturb both the camera position and the look-at by the same
    // vector so the view translates without rotating. Applied as the very
    // last camera adjustment — the offset must not feed back into snapshot
    // reconciliation or the dash override.
    const shake = this.screenShake.offsetAt(this.now());
    const shakeDx = shake.dx;
    const shakeDz = -shake.dy;
    this.graph.camera.position.set(focus.x + shakeDx, height, focus.z + shakeDz);
    this.graph.camera.lookAt(focus.x + shakeDx, focus.y, focus.z + shakeDz);
  }
}
