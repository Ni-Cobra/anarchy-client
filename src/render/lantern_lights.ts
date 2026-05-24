/**
 * Per-player lantern lights. Each player whose `equippedUtility`
 * is [`ItemId.Lantern`] gets a warm point light pinned at head height that
 * tracks their position. Intensity scales with the night factor sampled
 * from `daylight.ts`, mirroring the placed-torch behavior.
 *
 * Sized by visible-player count rather than capped — a session with a few
 * dozen players has roughly that many active lights at most, well under
 * the WebGL limit. The torch pool's nearest-N cap doesn't apply because
 * the lantern's audience is "every player wearing one in your view
 * window", not "every torch in the world".
 *
 * Reuses `createTorchLight()` from `torch_lights.ts` so the lantern shares
 * the torch's warm tint + decay; the lantern bumps `distance` slightly
 *
 * and keeps the same peak intensity so the night-factor scale reads
 * consistent across both light kinds.
 */

import * as THREE from "three";

import { ItemId, type PlayerId } from "../game/index.js";
import { createTorchLight } from "./torch_lights.js";
import { tileToScene } from "./sync.js";

/** Y offset where the lantern light sits. Lifted to 1.8 so the
 *  emitter clears top-layer geometry (tree canopy top is ~1.1 scene units)
 *  and the cone reaches the tops of nearby blocks rather than being
 *  shadowed by them. Shared with the torch and mushroom pools so all three
 *  emitters appear at the same height relative to a block. */
const LANTERN_LIGHT_Y = 1.8;

/** Lantern peak intensity at midnight. Lifted to 4.5 in lockstep
 *  with the torch so a player carrying one still reads as
 *  brighter-than-a-torch (via the larger radius), and so the day-night
 *  fade stays consistent across both warm light sources. */
const LANTERN_PEAK_INTENSITY = 4.5;

/** Distance multiplier on the shared torch falloff. The lantern lights
 *  ~7-8 tiles vs. the torch's ~5-6, matching "slightly larger radius
 *  than a torch — it's the upgrade". The number is the
 *  raw `THREE.PointLight.distance`, not a scaling factor — it replaces
 *  whatever `createTorchLight()` set. Bumped from 13.0 alongside the
 *  intensity lift so the brighter source spreads to a
 *  proportionally larger pool. */
const LANTERN_LIGHT_DISTANCE = 16.0;

/** Per-frame scratch for the `tileToScene` projection inside `update`.
 *  Hoisted to module scope so the per-entity loop never allocates a
 *  fresh `Vector3` per lantern-bearer per frame. */
const POSITION_SCRATCH = new THREE.Vector3();

/** One renderable entity with the fields this layer consumes. Subset of
 *  `RenderableEntity` so unit tests can build a minimal struct without
 *  pulling in the full mesh-sync entity shape. */
export interface LanternEntity {
  readonly id: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly equippedUtility: ItemId | null;
}

/**
 * Pool of `THREE.PointLight` instances keyed by `PlayerId`. The renderer
 * calls `update()` each frame with the current entity list + night
 * factor; the pool inserts a new light for any player who started
 * wearing a lantern, removes lights for any who stopped, and pins
 * positions + intensity for the rest.
 */
export class LanternLights {
  private readonly group: THREE.Group;
  private readonly lights = new Map<PlayerId, THREE.PointLight>();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "lantern-lights";
  }

  /** The Three.js group the renderer adds to its scene. */
  scene(): THREE.Group {
    return this.group;
  }

  /**
   * Reconcile the pool against the current entity list and night factor.
   * Players wearing a lantern get a light (created on first sight,
   * repositioned on subsequent frames); players without one have their
   * light retired. At noon (`nightFactor == 0`) every light hides without
   * being torn down so a transient day → dusk → night cycle doesn't
   * thrash the scene graph.
   */
  update(
    entities: Iterable<LanternEntity>,
    nightFactor: number,
  ): void {
    const clamped = nightFactor < 0 ? 0 : nightFactor > 1 ? 1 : nightFactor;
    const intensity = LANTERN_PEAK_INTENSITY * clamped;
    const seen = new Set<PlayerId>();
    for (const e of entities) {
      if (e.equippedUtility !== ItemId.Lantern) continue;
      seen.add(e.id);
      let light = this.lights.get(e.id);
      if (!light) {
        light = createTorchLight();
        light.distance = LANTERN_LIGHT_DISTANCE;
        this.lights.set(e.id, light);
        this.group.add(light);
      }
      tileToScene(e.x, e.y, POSITION_SCRATCH);
      light.position.set(POSITION_SCRATCH.x, LANTERN_LIGHT_Y, POSITION_SCRATCH.z);
      light.intensity = intensity;
      light.visible = clamped > 0;
    }
    // Drop lights for players who stopped wearing a lantern (or whose
    // chunk left the view).
    for (const id of [...this.lights.keys()]) {
      if (seen.has(id)) continue;
      const light = this.lights.get(id)!;
      this.group.remove(light);
      this.lights.delete(id);
    }
  }

  /** Detach and forget every pooled light. Three.js point lights have no
   *  GPU resources beyond their parent reference, so this is enough to
   *  tear the layer down cleanly. */
  dispose(): void {
    for (const light of this.lights.values()) this.group.remove(light);
    this.lights.clear();
  }

  /** Test-only: number of lit, visible lights this pool currently shows. */
  visibleCount(): number {
    let n = 0;
    for (const light of this.lights.values()) {
      if (light.visible) n++;
    }
    return n;
  }

  /** Test-only: peak per-light intensity at the supplied night factor. */
  static intensityAt(nightFactor: number): number {
    const clamped = nightFactor < 0 ? 0 : nightFactor > 1 ? 1 : nightFactor;
    return LANTERN_PEAK_INTENSITY * clamped;
  }

  /** Test-only: the per-light vertical lift in scene space. Pinned so the
   *  emitter stays above the top-layer block plane. */
  static attachmentY(): number {
    return LANTERN_LIGHT_Y;
  }
}
