/**
 * Per-frame slow-effect particle trail (task 020).
 *
 * Visualises an active `EffectKind.Slow` on a target by emitting a slow,
 * steady stream of small desaturated-cyan particles from the target's
 * foot position — "frozen wisps" rather than a UI badge. Replaces the
 * cyan disc sprite that lived in `render/effects_layer.ts` (task 200c).
 *
 * Per-target emitters appear when `applyTargets` first sees a slowed
 * target and stop emitting the tick the wire stops reporting Slow on
 * that target. Already-spawned particles finish their lifetime
 * naturally — emission halts, the visible cue tapers off.
 *
 * Three.js-confined like its sibling [`BreakParticles`]: callers feed
 * `EffectTarget`s decoded from the network-free game-state mirror and
 * an `update(nowMs)` clock; the layer owns every GPU resource it
 * allocates and disposes them on retirement.
 */

import * as THREE from "three";

import {
  type ActiveEffect,
  EffectKind,
  type EntityId,
  type PlayerId,
} from "../../game/index.js";

/** "Frozen wisps" cyan — desaturated so it reads as an atmospheric trail
 *  rather than competing with player-coloured palette accents. */
const PARTICLE_COLOR = 0x6cbfe0;

/** Time between successive particle spawns per emitter, ms. Tuned by eye
 *  to "obvious you're slowed" without spam — ~12 particles/sec each. */
const EMIT_INTERVAL_MS = 80;

/** Lifetime of a single particle, ms. Long enough that ~10 wisps trail
 *  the target at once; short enough that the cue stops within ~1 s of
 *  the Slow dropping. */
const PARTICLE_LIFETIME_MS = 900;

const PARTICLE_SIZE = 0.10;
/** Vertical spawn anchor — the target's foot. Rises with `VERTICAL_SPEED`. */
const SPAWN_Y = 0.05;
/** Outward horizontal drift, tiles/sec. */
const HORIZONTAL_SPEED = 0.25;
/** Upward drift, tiles/sec. No gravity — wisps just float up and fade. */
const VERTICAL_SPEED = 0.4;
const PARTICLE_OPACITY = 0.85;

/** Number of fixed azimuth slots particles cycle through. Each emitter's
 *  successive spawns sit at angle `(emitCount % SPAWN_ANGLES) * 2π / N`,
 *  giving a deterministic spiral that tests can pin without an RNG. */
const SPAWN_ANGLES = 8;

/** Global live-particle cap. The oldest particle drops when a churning
 *  set of slowed targets would otherwise push live count past the cap. */
const PARTICLE_CAP = 256;

/** One target with an active-effect set. The renderer hands these in
 *  every frame; the layer reconciles its emitter pool against them. */
export interface EffectTarget {
  /** `(player, id)` or `(entity, id)`. */
  readonly kind: "player" | "entity";
  readonly id: number;
  /** World-frame anchor in tiles (server's `+x = east`, `+y = north`). */
  readonly x: number;
  readonly y: number;
  /** Currently-active effects on this target (server-decoded snapshot). */
  readonly effects: readonly ActiveEffect[];
}

interface EmitterState {
  /** Last frame the target had Slow + was visible. Used both as the
   *  next-emit reference and to compute the emit-time step. */
  nextEmitMs: number;
  /** Cumulative spawn count — drives the deterministic angle slot. */
  emitCount: number;
}

interface Particle {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly geometry: THREE.BoxGeometry;
  readonly originX: number;
  readonly originZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly velocityY: number;
  readonly startMs: number;
  readonly endMs: number;
}

/** Composite map key — `(kind, id)` is unique across players + entities. */
function targetKey(kind: "player" | "entity", id: number): string {
  return `${kind}:${id}`;
}

/**
 * Owns one emitter per `(target, EffectKind.Slow)` pair plus the live
 * particle pool they feed. `applyTargets` reconciles the emitter set
 * against the supplied target list (a target gaining Slow appears, one
 * losing it drops out); `update` advances every live particle and
 * disposes any past lifetime.
 */
export class SlowParticles {
  readonly group: THREE.Group;
  private readonly emitters = new Map<string, EmitterState>();
  private readonly particles: Particle[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "slow-particles";
  }

  /** Number of targets currently emitting — test handle + the
   *  generic-effect-indicator count surfaced upstream. */
  emitterCount(): number {
    return this.emitters.size;
  }

  /** Live particle count — test handle + cap assertions. */
  particleCount(): number {
    return this.particles.length;
  }

  /**
   * Per-frame reconcile. Walks `targets`, ensures an emitter exists for
   * any with an active Slow effect, retires emitters whose target
   * dropped the effect (or left the view), and spawns due particles
   * for every still-active emitter at its world position.
   */
  applyTargets(targets: readonly EffectTarget[], nowMs: number): void {
    const seen = new Set<string>();
    for (const t of targets) {
      if (!hasSlow(t.effects)) continue;
      const key = targetKey(t.kind, t.id);
      seen.add(key);
      let emitter = this.emitters.get(key);
      if (!emitter) {
        emitter = { nextEmitMs: nowMs, emitCount: 0 };
        this.emitters.set(key, emitter);
      }
      while (emitter.nextEmitMs <= nowMs) {
        this.spawnParticle(t.x, t.y, emitter.emitCount, emitter.nextEmitMs);
        emitter.emitCount += 1;
        emitter.nextEmitMs += EMIT_INTERVAL_MS;
      }
    }
    for (const key of [...this.emitters.keys()]) {
      if (!seen.has(key)) this.emitters.delete(key);
    }
  }

  /**
   * Per-frame update. Walks live particles, integrates motion from
   * spawn time, fades opacity over lifetime, disposes expired entries.
   * Independent from `applyTargets` so a frame with no targeting change
   * still advances in-flight particles.
   */
  update(nowMs: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (nowMs >= p.endMs) {
        this.disposeAt(i);
        continue;
      }
      const elapsedMs = nowMs - p.startMs;
      const dtSec = elapsedMs / 1000;
      const t = elapsedMs / PARTICLE_LIFETIME_MS;
      p.mesh.position.set(
        p.originX + p.velocityX * dtSec,
        SPAWN_Y + p.velocityY * dtSec,
        p.originZ + p.velocityZ * dtSec,
      );
      p.material.opacity = PARTICLE_OPACITY * (1 - t);
    }
  }

  /** Drop every emitter + particle. Called on local-player reassign /
   *  dispose. */
  clearAll(): void {
    this.emitters.clear();
    while (this.particles.length > 0) {
      this.disposeAt(this.particles.length - 1);
    }
  }

  dispose(): void {
    this.clearAll();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private spawnParticle(
    worldX: number,
    worldY: number,
    emitIndex: number,
    spawnMs: number,
  ): void {
    if (this.particles.length >= PARTICLE_CAP) {
      // FIFO — index 0 is the oldest still-live particle.
      this.disposeAt(0);
    }
    const angle = ((emitIndex % SPAWN_ANGLES) / SPAWN_ANGLES) * Math.PI * 2;
    const vx = Math.cos(angle) * HORIZONTAL_SPEED;
    const vz = Math.sin(angle) * HORIZONTAL_SPEED;
    const sceneX = worldX;
    // Mirror the rest of the renderer: `+y_world → -z_scene`.
    const sceneZ = -worldY;
    const geometry = new THREE.BoxGeometry(
      PARTICLE_SIZE,
      PARTICLE_SIZE,
      PARTICLE_SIZE,
    );
    const material = new THREE.MeshBasicMaterial({
      color: PARTICLE_COLOR,
      transparent: true,
      opacity: PARTICLE_OPACITY,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(sceneX, SPAWN_Y, sceneZ);
    this.group.add(mesh);
    this.particles.push({
      mesh,
      material,
      geometry,
      originX: sceneX,
      originZ: sceneZ,
      velocityX: vx,
      velocityZ: vz,
      velocityY: VERTICAL_SPEED,
      startMs: spawnMs,
      endMs: spawnMs + PARTICLE_LIFETIME_MS,
    });
  }

  private disposeAt(idx: number): void {
    const p = this.particles[idx];
    this.group.remove(p.mesh);
    p.geometry.dispose();
    p.material.dispose();
    this.particles.splice(idx, 1);
  }
}

/** `true` iff the effect list contains an active `Slow`. Tiny helper kept
 *  here so the per-frame predicate is grep-able. */
export function hasSlow(effects: readonly ActiveEffect[]): boolean {
  for (const e of effects) {
    if (e.kind === EffectKind.Slow) return true;
  }
  return false;
}

/** Re-export shape for the test handles (number of emitters per kind). */
export type SlowEmitterKey = `${"player" | "entity"}:${PlayerId | EntityId}`;
