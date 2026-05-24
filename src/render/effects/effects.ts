import * as THREE from "three";

import { type BlockType, paletteColorHex } from "../../game/index.js";
import { isSolidTopBlock } from "../../textures.js";
import { tileCenterToScene } from "../terrain.js";

/**
 * Per-edit / per-target events fed to [`EffectsLayer`] from the wire bridge.
 * The `BlockEditEvent` shape mirrors the server's `BlockEditEvent` (task
 * 070) — kind + cell + the *involved* top-layer block kind so the visual
 * can specialize (different shatter for trees, etc., as the renderer wants
 * to grow them). Today the layer is intentionally simple: every place
 * pulses, every break shatters, both tinted by the actor's color.
 */
export type BlockEditKind = "placed" | "broken";

export interface BlockEditEvent {
  readonly playerId: number;
  readonly kind: BlockEditKind;
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
  /** Top-layer kind involved in the edit — see `WireBlockEditEvent`. */
  readonly blockType: BlockType;
}

export interface TargetingStateEvent {
  readonly playerId: number;
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
  /** `0..=100`. */
  readonly durabilityPct: number;
  /**
   * Which terrain layer the held break is hitting.
   * `"top"` draws a unit-cube outline at the cell; `"ground"` draws a
   * flat square outline on the ground floor — so a ground-layer break
   * doesn't render a cube hanging in the air at the top layer. Omitted
   * by tests / pre-task-030 callers, in which case the layer defaults
   * to `"top"` so existing behavior is preserved.
   */
  readonly layer?: "ground" | "top";
}

/**
 * Resolve a `playerId` to a palette color index. Closure rather than a
 * direct `World` reference so the effects layer doesn't import `../game`
 * for anything beyond palette helpers (which are pure data) — and so tests
 * can pin colors without standing up a real `World`. Returns `null` if the
 * player is unknown; the layer falls back to the default palette color.
 */
export type EffectsColorLookup = (playerId: number) => number | null;

// Animation durations (ms). The pulse / shatter both auto-expire when the
// renderer's per-frame `update(nowMs)` walks past their end timestamp.
const PLACE_PULSE_DURATION_MS = 250;
const BREAK_SHATTER_DURATION_MS = 350;
// Maximum scale a place pulse reaches before fading. Mirrors the
// targeting-overlay border so the pulse reads as "fence around the new
// block" rather than competing with the block's own footprint.
const PLACE_PULSE_MAX_SCALE = 1.45;
const PLACE_PULSE_OPACITY = 0.85;
// Shatter shrinks from full-cell to nothing while fading. Tuned so the
// effect is unmistakable but doesn't linger past the next tick.
const BREAK_SHATTER_MIN_SCALE = 0.2;
const BREAK_SHATTER_OPACITY = 0.9;
// Single intensity multiplier applied to the break animation when the
// broken kind is a non-solid / walk-through top block. Scales the shatter's starting
// size *and* its lifetime so the effect reads as a subtle tap instead
// of the full-cell "crunching rock" feedback used for solids. Mirrors
// the same multiplier in `break_particles.ts`.
const SOFT_BREAK_INTENSITY = 0.45;
// Targeting frame: faint outlined cube tinted by the targeting player's
// color. Slightly inset from the cell so a stack of overlays from
// different players reads as concentric, not coincident.
const TARGETING_FRAME_SIZE = 1.05;
const TARGETING_FRAME_OPACITY = 0.85;
const TARGETING_FRAME_LIFT = 0.55;
// Ground-layer outline: flat square on the floor at
// the targeted tile, sized to match the cube outline's footprint. Lifted
// just above `TILE_TOP_Y` (and above the place-pulse plane) so it sits
// cleanly on the ground without z-fighting the grass underneath.
const TARGETING_GROUND_LIFT = 0.06;
// Durability bar — width tracks the pct, height + lift are static.
const DURABILITY_BAR_MAX_WIDTH = 0.9;
const DURABILITY_BAR_HEIGHT = 0.08;
const DURABILITY_BAR_THICKNESS = 0.04;
const DURABILITY_BAR_LIFT = 1.15;
const DURABILITY_BAR_BG_COLOR = 0x202020;
const DURABILITY_BAR_FILL_COLOR = 0xf5f5f5;

const TILE_TOP_Y = 0.04;

/**
 * Build the targeting frame for `layer`:
 * - `"top"` — outlined unit cube (`EdgesGeometry` over a box so corners
 *   stay sharp), centered at `TARGETING_FRAME_LIFT`. Existing behavior.
 * - `"ground"` — flat square outline on the ground, lifted just above
 *   the tile floor so a ground-layer break doesn't paint a cube hanging
 *   in mid-air.
 *
 * The shared `LineBasicMaterial` is owned by the caller; both flavors
 * draw with the same color / opacity / line width so a layer swap reads
 * as "geometry changed", not "highlight switched on".
 */
function buildTargetingFrame(
  layer: "ground" | "top",
  material: THREE.LineBasicMaterial,
): THREE.Line {
  if (layer === "ground") {
    const h = TARGETING_FRAME_SIZE / 2;
    const positions = new Float32Array([
      -h, 0, -h,
       h, 0, -h,
       h, 0,  h,
      -h, 0,  h,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const loop = new THREE.LineLoop(geom, material);
    loop.position.y = TARGETING_GROUND_LIFT;
    return loop;
  }
  const boxGeom = new THREE.BoxGeometry(
    TARGETING_FRAME_SIZE,
    TARGETING_FRAME_SIZE,
    TARGETING_FRAME_SIZE,
  );
  const edges = new THREE.EdgesGeometry(boxGeom);
  boxGeom.dispose();
  const segs = new THREE.LineSegments(edges, material);
  segs.position.y = TARGETING_FRAME_LIFT;
  return segs;
}

interface TimedEffect {
  readonly startMs: number;
  readonly endMs: number;
}

interface PlacePulse extends TimedEffect {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface BreakShatter extends TimedEffect {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface TargetingOverlay {
  readonly group: THREE.Group;
  /** `LineSegments` for a cube outline (`top` layer) or `LineLoop` for a
   *  flat square (`ground` layer). The common base is `THREE.Line`. */
  frame: THREE.Line;
  frameMaterial: THREE.LineBasicMaterial;
  readonly barFill: THREE.Mesh;
  readonly barFillMaterial: THREE.MeshBasicMaterial;
  readonly barBg: THREE.Mesh;
  readonly barBgMaterial: THREE.MeshBasicMaterial;
  /** Last-known durability pct so frame-rebuilds skip redundant scale work. */
  lastPct: number;
  /** Layer of the most recent target so a re-target that changes layer
   *  (top → ground or vice versa) rebuilds the frame geometry in place. */
  lastLayer: "ground" | "top";
  /** Tint captured at first paint so a frame rebuild on layer change keeps
   *  the original color without re-resolving the palette index. */
  readonly tint: number;
}

/**
 * The renderer's effects sub-layer: place pulses, break
 * shatters, and held-break targeting overlays. The layer owns its scene
 * group and a tiny per-effect lifecycle: events come in via
 * `onBlockEdit` / `applyTargets`, time advances via `update(nowMs)` from
 * the renderer's per-frame loop, expired effects dispose themselves.
 *
 * Per the task spec the layer never touches `window` / `document`, has no
 * timers, and bounds its allocation footprint by effect duration (place /
 * break) or the connected-player set (targeting). The renderer parents
 * the group; the layer's `dispose()` releases every owned material /
 * geometry on session end.
 */
export class EffectsLayer {
  private readonly group: THREE.Group;
  private readonly placePulses: PlacePulse[] = [];
  private readonly breakShatters: BreakShatter[] = [];
  // Targeting overlays are keyed by `playerId` — at most one held-break
  // target per player per tick (server enforces). A re-target replaces in
  // place; absence in `applyTargets(...)` removes the overlay.
  private readonly targetingByPlayer = new Map<number, TargetingOverlay>();

  constructor(private readonly colorLookup: EffectsColorLookup) {
    this.group = new THREE.Group();
    this.group.name = "effects";
  }

  /** Scene root the renderer adds to its main scene at construction. */
  scene(): THREE.Object3D {
    return this.group;
  }

  /**
   * Spawn a one-shot place pulse or break shatter for `event`. Tinted by
   * the player's lobby color (palette index 0 fallback if the player is
   * unknown to the local snapshot — should be rare; the wire layer lands
   * the chunk's player set in the same tick as the edit).
   */
  onBlockEdit(event: BlockEditEvent, nowMs: number): void {
    const tint = this.colorForPlayer(event.playerId);
    const center = tileCenterToScene(event.cx, event.cy, event.lx, event.ly);
    if (event.kind === "placed") {
      this.spawnPlacePulse(center.x, center.z, tint, nowMs);
    } else {
      this.spawnBreakShatter(center.x, center.z, tint, event.blockType, nowMs);
    }
  }

  /**
   * Replace the active targeting set wholesale. Entries that disappear
   * since the last call are torn down (player released / re-targeted /
   * the block broke). Entries that appear are spawned. Entries that
   * remain have their durability bar updated in place.
   */
  applyTargets(targets: readonly TargetingStateEvent[]): void {
    const live = new Set<number>();
    for (const t of targets) {
      live.add(t.playerId);
      this.upsertTargeting(t);
    }
    // Tear down any targeting overlay that didn't show up in the new set.
    const stale: number[] = [];
    for (const playerId of this.targetingByPlayer.keys()) {
      if (!live.has(playerId)) stale.push(playerId);
    }
    for (const playerId of stale) {
      this.disposeTargeting(playerId);
    }
  }

  /**
   * Per-frame update from the renderer. Walks the live pulses / shatters
   * and either advances their per-frame transform or disposes them past
   * their end. Targeting overlays don't time out — they live for as long
   * as the server keeps shipping the player's `TargetingState`.
   */
  update(nowMs: number): void {
    for (let i = this.placePulses.length - 1; i >= 0; i--) {
      const pulse = this.placePulses[i];
      const t = (nowMs - pulse.startMs) / (pulse.endMs - pulse.startMs);
      if (t >= 1) {
        this.disposePulse(pulse);
        this.placePulses.splice(i, 1);
        continue;
      }
      const scale = 1 + (PLACE_PULSE_MAX_SCALE - 1) * t;
      pulse.mesh.scale.set(scale, 1, scale);
      pulse.material.opacity = PLACE_PULSE_OPACITY * (1 - t);
    }
    for (let i = this.breakShatters.length - 1; i >= 0; i--) {
      const shatter = this.breakShatters[i];
      const t = (nowMs - shatter.startMs) / (shatter.endMs - shatter.startMs);
      if (t >= 1) {
        this.disposeShatter(shatter);
        this.breakShatters.splice(i, 1);
        continue;
      }
      const scale = 1 - (1 - BREAK_SHATTER_MIN_SCALE) * t;
      shatter.mesh.scale.setScalar(scale);
      shatter.material.opacity = BREAK_SHATTER_OPACITY * (1 - t);
    }
  }

  /** Drop every owned material / geometry. Called by the renderer on
   * `dispose()`. */
  dispose(): void {
    for (const pulse of this.placePulses) this.disposePulse(pulse);
    this.placePulses.length = 0;
    for (const shatter of this.breakShatters) this.disposeShatter(shatter);
    this.breakShatters.length = 0;
    for (const playerId of Array.from(this.targetingByPlayer.keys())) {
      this.disposeTargeting(playerId);
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private colorForPlayer(playerId: number): number {
    const idx = this.colorLookup(playerId);
    return paletteColorHex(idx ?? 0);
  }

  private spawnPlacePulse(
    sceneX: number,
    sceneZ: number,
    tint: number,
    nowMs: number,
  ): void {
    // Thin flat ring on the ground that pulses outward — implemented as
    // an overscaled flat plane with a transparent material. The plane
    // pulses up from scale 1 → PLACE_PULSE_MAX_SCALE while fading.
    const geom = new THREE.BoxGeometry(1, 0.05, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: PLACE_PULSE_OPACITY,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(sceneX, TILE_TOP_Y, sceneZ);
    this.group.add(mesh);
    this.placePulses.push({
      mesh,
      material: mat,
      startMs: nowMs,
      endMs: nowMs + PLACE_PULSE_DURATION_MS,
    });
  }

  private spawnBreakShatter(
    sceneX: number,
    sceneZ: number,
    tint: number,
    kind: BlockType,
    nowMs: number,
  ): void {
    // Cube that shrinks + fades — same world position the broken block
    // occupied, so the eye stays put. Non-solid / walk-through top kinds
    // ride a smaller starting cube and a proportionally shorter lifetime
    // so the destruction feedback reads as a tap, not a crunch.
    const soft = !isSolidTopBlock(kind);
    const size = soft ? SOFT_BREAK_INTENSITY : 1;
    const durationMs = soft
      ? BREAK_SHATTER_DURATION_MS * SOFT_BREAK_INTENSITY
      : BREAK_SHATTER_DURATION_MS;
    const geom = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: BREAK_SHATTER_OPACITY,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(sceneX, 0.55, sceneZ);
    this.group.add(mesh);
    this.breakShatters.push({
      mesh,
      material: mat,
      startMs: nowMs,
      endMs: nowMs + durationMs,
    });
  }

  private upsertTargeting(target: TargetingStateEvent): void {
    const center = tileCenterToScene(target.cx, target.cy, target.lx, target.ly);
    const layer = target.layer ?? "top";
    const existing = this.targetingByPlayer.get(target.playerId);
    if (existing) {
      existing.group.position.set(center.x, 0, center.z);
      if (existing.lastLayer !== layer) this.rebuildFrame(existing, layer);
      this.updateDurabilityBar(existing, target.durabilityPct);
      return;
    }
    const tint = this.colorForPlayer(target.playerId);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);

    const frameMat = new THREE.LineBasicMaterial({
      color: tint,
      transparent: true,
      opacity: TARGETING_FRAME_OPACITY,
      depthWrite: false,
    });
    const frame = buildTargetingFrame(layer, frameMat);
    group.add(frame);

    const barBgGeom = new THREE.BoxGeometry(
      DURABILITY_BAR_MAX_WIDTH,
      DURABILITY_BAR_HEIGHT,
      DURABILITY_BAR_THICKNESS,
    );
    const barBgMat = new THREE.MeshBasicMaterial({
      color: DURABILITY_BAR_BG_COLOR,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const barBg = new THREE.Mesh(barBgGeom, barBgMat);
    barBg.position.y = DURABILITY_BAR_LIFT;
    group.add(barBg);

    // Fill: same geometry as bg, scaled along X by `pct/100`. Re-anchored
    // at construction so the scale grows from the left edge — a center-
    // anchored scale would shrink toward the middle, which reads wrong.
    const barFillGeom = new THREE.BoxGeometry(
      DURABILITY_BAR_MAX_WIDTH,
      DURABILITY_BAR_HEIGHT,
      DURABILITY_BAR_THICKNESS,
    );
    barFillGeom.translate(DURABILITY_BAR_MAX_WIDTH / 2, 0, 0);
    const barFillMat = new THREE.MeshBasicMaterial({
      color: DURABILITY_BAR_FILL_COLOR,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });
    const barFill = new THREE.Mesh(barFillGeom, barFillMat);
    barFill.position.set(-DURABILITY_BAR_MAX_WIDTH / 2, DURABILITY_BAR_LIFT, 0);
    // Slight forward bias so the fill never z-fights with the bg.
    barFill.position.z = -DURABILITY_BAR_THICKNESS * 0.05;
    group.add(barFill);

    this.group.add(group);
    const overlay: TargetingOverlay = {
      group,
      frame,
      frameMaterial: frameMat,
      barFill,
      barFillMaterial: barFillMat,
      barBg,
      barBgMaterial: barBgMat,
      lastPct: -1,
      lastLayer: layer,
      tint,
    };
    this.updateDurabilityBar(overlay, target.durabilityPct);
    this.targetingByPlayer.set(target.playerId, overlay);
  }

  /**
   * Swap the targeting frame's geometry when the targeted layer flips
   * (top ↔ ground). The cube outline (`top`) and the flat square
   * (`ground`) use different geometry + draw modes, so we rebuild the
   * underlying [`THREE.Line`] in place rather than mutating the existing
   * one. The material is preserved so the tint stays stable across the
   * swap.
   */
  private rebuildFrame(
    overlay: TargetingOverlay,
    nextLayer: "ground" | "top",
  ): void {
    overlay.group.remove(overlay.frame);
    overlay.frame.geometry.dispose();
    const frame = buildTargetingFrame(nextLayer, overlay.frameMaterial);
    overlay.group.add(frame);
    overlay.frame = frame;
    overlay.lastLayer = nextLayer;
  }

  private updateDurabilityBar(
    overlay: TargetingOverlay,
    rawPct: number,
  ): void {
    const pct = Math.max(0, Math.min(100, rawPct));
    if (pct === overlay.lastPct) return;
    overlay.lastPct = pct;
    const fill = pct / 100;
    overlay.barFill.scale.set(fill, 1, 1);
  }

  private disposePulse(pulse: PlacePulse): void {
    this.group.remove(pulse.mesh);
    pulse.mesh.geometry.dispose();
    pulse.material.dispose();
  }

  private disposeShatter(shatter: BreakShatter): void {
    this.group.remove(shatter.mesh);
    shatter.mesh.geometry.dispose();
    shatter.material.dispose();
  }

  private disposeTargeting(playerId: number): void {
    const overlay = this.targetingByPlayer.get(playerId);
    if (!overlay) return;
    this.targetingByPlayer.delete(playerId);
    this.group.remove(overlay.group);
    overlay.frame.geometry.dispose();
    overlay.frameMaterial.dispose();
    overlay.barFill.geometry.dispose();
    overlay.barFillMaterial.dispose();
    overlay.barBg.geometry.dispose();
    overlay.barBgMaterial.dispose();
  }
}
