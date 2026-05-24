/**
 * Charge-beam render layer for the attack pipeline.
 *
 * The server is authoritative: an admitted `AttackIntent` flips the
 * attacker to `Charging` for 0.7 s, then resolves to `StrikeHit` /
 * `StrikeMissed` and broadcasts `AttackEvent`s on `TickUpdate`.
 * This layer owns the visual half:
 *
 *   - On `charge-started` insert a thin tinted cylinder mesh from the
 *     attacker's body to the target's body.
 *   - Each frame, re-aim the cylinder against the attacker and target's
 *     current render positions (interpolated by the same snapshot buffer
 *     the rest of the renderer reads) and shrink its radius linearly
 *     from `0.1` to `0.01` block-widths over the 0.7 s charge window.
 *   - On `strike-hit` / `strike-missed` retire the beam.
 *
 * The lerp is driven by reconstructing the start-of-charge wall-clock
 * time from the server's `started_at_tick`: at the moment the
 * `charge-started` event arrives the client knows what tick number it
 * represents and the wall-clock at which it landed, so a `(tick →
 * tickReceivedMs)` anchor lets every subsequent `started_at_tick` be
 * converted into a local wall-clock without referring to the wire frame
 * of arrival. This keeps the beam visually synchronised across observers
 * with different network latencies (per the task brief).
 */

import * as THREE from "three";

import { paletteColorHex } from "../game/index.js";

/**
 * Width of the beam mesh at charge start (tile-widths). Pinned per the
 * task brief: the beam reads as a punchy sword swing arc rather than a
 * laser, so the start is visibly thick but tapers to a sliver before
 * the strike resolves.
 */
export const BEAM_START_THICKNESS = 0.1;
/** Width of the beam at charge end. The brief pins this to 0.01. */
export const BEAM_END_THICKNESS = 0.01;
/**
 * Charge duration in milliseconds — mirrors the server's
 * `CHARGE_DURATION_SECS = 0.7`. The beam's per-frame thickness is
 * `lerp(start, end, t)` where `t = (now_server_ms - charge_start_ms) /
 * BEAM_CHARGE_DURATION_MS`, clamped to `[0, 1]`.
 */
export const BEAM_CHARGE_DURATION_MS = 700;
/**
 * Vertical anchor for both ends of the beam — matches the body sphere's
 * centre at `tileToScene` `y = 0.5` so the cylinder reads as a swing
 * connecting two players' bodies.
 */
export const BEAM_BODY_Y = 0.5;
/** Server tick rate (Hz), pinned to mirror `crate::config::TICK_RATE_HZ`. */
export const SERVER_TICK_RATE_HZ = 20;
/** ms per server tick — used to reconstruct charge-start wall-clock. */
export const MS_PER_TICK = 1000 / SERVER_TICK_RATE_HZ;

/**
 * Per-tile-target position the layer can resolve through the lookup.
 * Entities are tile-bound; the renderer hands in `(tileX + 0.5, tileY +
 * 0.5)` as the world position so the beam math is symmetric with the
 * player path. Returning `null` hides the beam without disposing it —
 * the next frame may bring the target back into view.
 */
export type BeamPositionLookup = (
  kind: "player" | "entity",
  id: number,
) => { readonly x: number; readonly y: number } | null;

/**
 * Linear interpolation from start to end thickness given a charge
 * elapsed-time `tElapsedMs`. Clamped to `[0, BEAM_CHARGE_DURATION_MS]`
 * so a `started_at_tick` that lands a hair in the future (clock skew /
 * tick boundary) doesn't push the beam to a negative thickness, and so
 * a stale event past its terminal tick stays at the end thickness for
 * the single frame between the resolution tick and the next `update`.
 *
 * Exported so unit tests can pin the math without setting up a `THREE`
 * scene.
 */
export function beamThicknessAt(tElapsedMs: number): number {
  if (!Number.isFinite(tElapsedMs) || tElapsedMs <= 0) return BEAM_START_THICKNESS;
  if (tElapsedMs >= BEAM_CHARGE_DURATION_MS) return BEAM_END_THICKNESS;
  const t = tElapsedMs / BEAM_CHARGE_DURATION_MS;
  return BEAM_START_THICKNESS + (BEAM_END_THICKNESS - BEAM_START_THICKNESS) * t;
}

/**
 * Reconstruct the wall-clock time at which the server's `startedAtTick`
 * landed, given a `(tickReceivedMs, currentTick)` anchor. Mirrors the
 * server's tick clock without ever calling `performance.now()` against
 * the local time the event reaches us — observers with different RTTs
 * compute the same `chargeStartMs` so beams stay synchronized.
 *
 * `currentTick` is what we *think* the server's tick counter is at the
 * moment `tickReceivedMs` landed locally. The wire carries
 * `startedAtTick` on every event in the attack, so the anchor can be
 * pinned from the `charge-started` event of the same attack (when
 * server-tick = the same `startedAtTick`).
 */
export function reconstructChargeStartMs(
  startedAtTick: number,
  anchorTick: number,
  anchorMs: number,
): number {
  const dtTicks = startedAtTick - anchorTick;
  return anchorMs + dtTicks * MS_PER_TICK;
}

interface BeamState {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.CylinderGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly attackerId: number;
  readonly targetKind: "player" | "entity";
  readonly targetId: number;
  /** Wall-clock ms (local) at which the charge started. */
  readonly chargeStartMs: number;
}

/**
 * Per-frame attack-beam render layer. Owns a `THREE.Group` carrying one
 * cylinder mesh per live attack. The renderer parents the group into
 * its scene; per-tick events flow through [`onCharge`] / [`onResolve`]
 * and per-frame mutations through [`update`].
 */
export class AttackBeamLayer {
  readonly group: THREE.Group;
  /**
   * One entry per live attack, keyed by `attackerId` — the server
   * pins each player to at most one active attack at a time (an
   * admitted intent flips the player to `Charging`; further intents
   * are silently rejected until the attack resolves). So keying by
   * attacker is unambiguous and matches the server's state machine.
   */
  private readonly beams = new Map<number, BeamState>();
  /** Pre-built unit cylinder so a churning attack stream doesn't
   *  allocate a new geometry per beam (the cylinder is scaled to fit
   *  the actual length / radius via `mesh.scale`). */
  private readonly unitGeometry: THREE.CylinderGeometry;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "attack-beams";
    // Unit cylinder: radius 1, height 1, default oriented along +y. We
    // scale per-beam to (radius, length, radius) and rotate to align
    // with the attacker → target vector.
    this.unitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  }

  /**
   * A `charge-started` event arrived. `chargeStartMs` is the
   * reconstructed wall-clock ms at which the charge began locally;
   * `colorIndex` is the attacker's palette index for the beam tint.
   *
   * Idempotent: a duplicate `charge-started` for the same attacker
   * (e.g. a clipped first tick re-shipped on reconnect) replaces the
   * existing beam in place so the visuals stay consistent.
   */
  onCharge(
    attackerId: number,
    targetKind: "player" | "entity",
    targetId: number,
    colorIndex: number,
    chargeStartMs: number,
  ): void {
    this.disposeAttack(attackerId);
    const material = new THREE.MeshBasicMaterial({
      color: paletteColorHex(colorIndex),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.unitGeometry, material);
    // Hidden until the first `update` lands — keeps a freshly-spawned
    // beam from drawing as a unit cylinder at the world origin.
    mesh.visible = false;
    this.group.add(mesh);
    this.beams.set(attackerId, {
      mesh,
      geometry: this.unitGeometry,
      material,
      attackerId,
      targetKind,
      targetId,
      chargeStartMs,
    });
  }

  /**
   * A `strike-hit` / `strike-missed` for `attackerId` arrived — the
   * attack is resolved, drop its beam.
   */
  onResolve(attackerId: number): void {
    this.disposeAttack(attackerId);
  }

  /**
   * Per-frame mutation. Re-aim every live beam against the latest
   * attacker / target positions and update the radius to reflect the
   * elapsed charge time. Beams whose attacker OR target the lookup
   * cannot resolve are hidden (not disposed) — the actor may re-enter
   * view next tick.
   */
  update(positions: BeamPositionLookup, nowMs: number): void {
    for (const beam of this.beams.values()) {
      const from = positions("player", beam.attackerId);
      const to = positions(beam.targetKind, beam.targetId);
      if (from === null || to === null) {
        beam.mesh.visible = false;
        continue;
      }
      const elapsed = nowMs - beam.chargeStartMs;
      const radius = beamThicknessAt(elapsed);
      aimCylinder(beam.mesh, from.x, from.y, to.x, to.y, radius);
    }
  }

  /**
   * Test handle: number of beams currently live. Drives a `vitest`
   * spec without reaching into Three.js internals.
   */
  size(): number {
    return this.beams.size;
  }

  /**
   * Test handle: read the current radius (scale.x) of the cylinder
   * mesh for `attackerId`'s active beam, or `null` if no beam exists.
   */
  beamRadius(attackerId: number): number | null {
    const beam = this.beams.get(attackerId);
    if (!beam) return null;
    return beam.mesh.scale.x;
  }

  /** Test handle: read the colour of the cylinder material as a
   *  packed 0xRRGGBB hex int, or `null` when no beam exists. */
  beamColorHex(attackerId: number): number | null {
    const beam = this.beams.get(attackerId);
    if (!beam) return null;
    return beam.material.color.getHex();
  }

  /** Drop every live beam but keep the layer's parent group alive so the
   *  scene tree stays valid (used on local-player reassign). */
  clearAll(): void {
    for (const id of [...this.beams.keys()]) this.disposeAttack(id);
  }

  dispose(): void {
    this.clearAll();
    this.unitGeometry.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private disposeAttack(attackerId: number): void {
    const beam = this.beams.get(attackerId);
    if (!beam) return;
    this.beams.delete(attackerId);
    this.group.remove(beam.mesh);
    beam.material.dispose();
    // `geometry` is the shared unit cylinder — disposed only by
    // `dispose()` once at teardown.
  }
}

/**
 * Position and orient a unit cylinder so it spans from `(ax, ay)` to
 * `(bx, by)` in world coords (server frame: `+x = east`, `+y = north`)
 * with the requested radius. Exported for unit tests that pin the
 * mesh geometry without spinning up a full layer.
 *
 * Scene mapping: world `(+x, +y) → scene (+x, -z)`; both endpoints sit
 * at `y = BEAM_BODY_Y` so the beam reads as horizontal-on-tabletop.
 */
export function aimCylinder(
  mesh: THREE.Mesh,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): void {
  const az = -ay;
  const bz = -by;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length <= 1e-6) {
    mesh.visible = false;
    return;
  }
  // Scale: cylinder is unit-height along +y locally, so length scales
  // along y; radius scales x + z.
  mesh.scale.set(radius, length, radius);
  // Place the cylinder's midpoint at the segment midpoint at y =
  // BEAM_BODY_Y.
  mesh.position.set(
    (ax + bx) / 2,
    BEAM_BODY_Y,
    (az + bz) / 2,
  );
  // Rotate the cylinder's default +y axis onto the segment direction
  // (dx, 0, dz). Reset rotation first so repeated `aimCylinder` calls
  // don't accumulate.
  mesh.rotation.set(0, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(dx, 0, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
  mesh.quaternion.copy(q);
  mesh.visible = true;
}
