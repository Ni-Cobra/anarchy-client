/**
 * Per-frame projectile render layer.
 *
 * Reads the network-free [`ProjectileStore`] each frame and reconciles a
 * Three.js mesh pool against it: one dart-shaped mesh per live projectile,
 * rotated to follow the velocity vector (current snapshot − previous
 * snapshot) and lerped between snapshots for smooth motion at the
 * server's 20 Hz tick rate. On `ProjectileImpactEvent` the renderer
 * removes the projectile from the store and the layer's next frame retires
 * the mesh — the impact puff (a brief particle burst) is owned by
 * [`ImpactPuff`] below.
 *
 * Three.js-confined: the only module-boundary owner of mesh geometry /
 * materials for the projectile feed. The wire bridge talks to
 * [`ProjectileStore`]; this layer is purely consumer of state + emitter
 * of GPU resources.
 */

import * as THREE from "three";

import {
  type ProjectileState,
  type ProjectileStore,
  projectileVelocity,
  sampleProjectilePosition,
} from "../game/index.js";

/** Vertical anchor for the dart mesh — matches the attack-beam body Y so
 *  the dart visually flies through the same horizontal slab the beam
 *  occupied during its charge phase. */
export const PROJECTILE_BODY_Y = 0.5;

/** Length of the dart sprite along its velocity axis, in tile units. */
export const DART_LENGTH_TILES = 0.4;
/** Width / height of the dart sprite perpendicular to velocity. Thin so
 *  the mesh reads as a needle, not a chunky stick. */
export const DART_THICKNESS_TILES = 0.06;

/** Dart colour (dark, slightly desaturated brown — a thrown wooden dart). */
const DART_COLOR = 0x2a1a10;

/**
 * Per-projectile target position resolver — same shape as the attack
 * beam's [`BeamPositionLookup`]. Returns the world-frame position of the
 * dart's *target*: lets the renderer aim a brand-new projectile (no
 * velocity vector yet) toward its target so the dart isn't drawn
 * axis-aligned on its first frame.
 */
export type ProjectileTargetLookup = (
  kind: "player" | "entity",
  id: number,
) => { readonly x: number; readonly y: number } | null;

/**
 * Brief impact-puff burst. One puff per `ProjectileImpactEvent` — a
 * small fountain of dark sprites that fades over [`IMPACT_PUFF_DURATION_MS`].
 * Pure visual; the dart removal itself is done by the store mutation.
 */
export const IMPACT_PUFF_DURATION_MS = 200;
const IMPACT_PUFF_PARTICLES = 6;
const IMPACT_PUFF_SIZE = 0.08;
const IMPACT_PUFF_RADIAL_SPEED = 0.9;
const IMPACT_PUFF_OPACITY = 0.9;

interface ProjectileMeshState {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface PuffParticle {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly geometry: THREE.BoxGeometry;
  readonly originX: number;
  readonly originZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Per-frame projectile layer. Owns one `THREE.Group` parented into the
 * scene at construction; per-frame [`update`] reconciles the mesh pool
 * against the store and re-aims every live dart. The store is the single
 * source of truth — this layer never mutates it.
 */
export class ProjectileLayer {
  readonly group: THREE.Group;
  private readonly states = new Map<number, ProjectileMeshState>();
  private readonly puffs: PuffParticle[] = [];
  /** Unit-length box: scale per-mesh to `(thickness, thickness, length)`
   *  so a churning projectile stream doesn't allocate per-dart geometry. */
  private readonly unitDartGeometry: THREE.BoxGeometry;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "projectiles";
    this.unitDartGeometry = new THREE.BoxGeometry(1, 1, 1);
  }

  /** Number of live dart meshes — test handle. */
  size(): number {
    return this.states.size;
  }

  /** Number of live impact-puff particles — test handle. */
  puffCount(): number {
    return this.puffs.length;
  }

  /**
   * Spawn a one-shot impact puff at world `(x, y)`. Called by the
   * renderer when a `ProjectileImpactEvent` lands. Particles fan out
   * radially at a fixed angular spacing for determinism.
   */
  spawnImpactPuff(x: number, y: number, nowMs: number): void {
    for (let i = 0; i < IMPACT_PUFF_PARTICLES; i++) {
      const angle = (i / IMPACT_PUFF_PARTICLES) * Math.PI * 2;
      const vx = Math.cos(angle) * IMPACT_PUFF_RADIAL_SPEED;
      const vz = Math.sin(angle) * IMPACT_PUFF_RADIAL_SPEED;
      const geometry = new THREE.BoxGeometry(
        IMPACT_PUFF_SIZE,
        IMPACT_PUFF_SIZE,
        IMPACT_PUFF_SIZE,
      );
      const material = new THREE.MeshBasicMaterial({
        color: DART_COLOR,
        transparent: true,
        opacity: IMPACT_PUFF_OPACITY,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const sceneX = x;
      const sceneZ = -y;
      mesh.position.set(sceneX, PROJECTILE_BODY_Y, sceneZ);
      this.group.add(mesh);
      this.puffs.push({
        mesh,
        material,
        geometry,
        originX: sceneX,
        originZ: sceneZ,
        velocityX: vx,
        velocityZ: vz,
        startMs: nowMs,
        endMs: nowMs + IMPACT_PUFF_DURATION_MS,
      });
    }
  }

  /**
   * Per-frame reconcile. Walks the store's live projectiles, syncs the
   * mesh pool, aims each dart, and advances the impact-puff lifetimes.
   * Meshes for projectiles no longer in the store are disposed.
   */
  update(
    store: ProjectileStore,
    nowMs: number,
    targetLookup: ProjectileTargetLookup,
  ): void {
    const seen = new Set<number>();
    for (const state of store.values()) {
      seen.add(state.id);
      this.syncOne(state, nowMs, targetLookup);
    }
    for (const [id, mesh] of [...this.states]) {
      if (!seen.has(id)) this.disposeDart(id, mesh);
    }
    this.tickPuffs(nowMs);
  }

  /** Drop every dart + puff. Called on local-player reassign / dispose. */
  clearAll(): void {
    for (const id of [...this.states.keys()]) {
      const state = this.states.get(id);
      if (state) this.disposeDart(id, state);
    }
    while (this.puffs.length > 0) this.disposePuffAt(this.puffs.length - 1);
  }

  dispose(): void {
    this.clearAll();
    this.unitDartGeometry.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private syncOne(
    state: ProjectileState,
    nowMs: number,
    targetLookup: ProjectileTargetLookup,
  ): void {
    let entry = this.states.get(state.id);
    if (!entry) {
      const material = new THREE.MeshBasicMaterial({ color: DART_COLOR });
      const mesh = new THREE.Mesh(this.unitDartGeometry, material);
      mesh.name = `projectile:${state.id}`;
      this.group.add(mesh);
      entry = { mesh, material };
      this.states.set(state.id, entry);
    }
    const pos = sampleProjectilePosition(state, nowMs);
    const sceneX = pos.x;
    const sceneZ = -pos.y;
    entry.mesh.position.set(sceneX, PROJECTILE_BODY_Y, sceneZ);
    entry.mesh.scale.set(
      DART_THICKNESS_TILES,
      DART_THICKNESS_TILES,
      DART_LENGTH_TILES,
    );
    aimDart(entry.mesh, state, targetLookup);
  }

  private disposeDart(id: number, state: ProjectileMeshState): void {
    this.states.delete(id);
    this.group.remove(state.mesh);
    state.material.dispose();
  }

  private tickPuffs(nowMs: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      if (nowMs >= p.endMs) {
        this.disposePuffAt(i);
        continue;
      }
      const elapsedMs = nowMs - p.startMs;
      const dtSec = elapsedMs / 1000;
      const t = elapsedMs / IMPACT_PUFF_DURATION_MS;
      p.mesh.position.set(
        p.originX + p.velocityX * dtSec,
        PROJECTILE_BODY_Y,
        p.originZ + p.velocityZ * dtSec,
      );
      p.material.opacity = IMPACT_PUFF_OPACITY * (1 - t);
    }
  }

  private disposePuffAt(idx: number): void {
    const p = this.puffs[idx];
    this.group.remove(p.mesh);
    p.material.dispose();
    p.geometry.dispose();
    this.puffs.splice(idx, 1);
  }
}

/**
 * Rotate the dart mesh in the ground plane so its long axis (local +z,
 * since `scale.z = length`) points along the velocity vector. If the
 * projectile hasn't moved yet (first tick of life), fall back to aiming
 * toward the target's current position via `targetLookup`. Exported for
 * unit tests that pin the orientation math.
 */
export function aimDart(
  mesh: THREE.Mesh,
  state: ProjectileState,
  targetLookup: ProjectileTargetLookup,
): void {
  const velocity = projectileVelocity(state);
  let dx = 0;
  let dy = 0;
  if (velocity !== null) {
    dx = velocity.dx;
    dy = velocity.dy;
  } else {
    const target = targetLookup(state.target.kind, state.target.id);
    if (target !== null) {
      dx = target.x - state.x;
      dy = target.y - state.y;
    }
  }
  const yaw = dartYawFor(dx, dy);
  mesh.rotation.set(0, yaw, 0);
}

/**
 * Yaw (rotation around scene Y, radians) that points the dart's local
 * +z axis along world `(dx, dy)` after the scene mapping
 * `(+x_world, +y_world) → (+x_scene, -z_scene)`. Pure helper so unit
 * tests can pin the math without `THREE`.
 */
export function dartYawFor(dx: number, dy: number): number {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0;
  // Scene-space direction: `(dx, -dy)`. The dart's local +z axis (after
  // we scale length along z) points at scene `(sin yaw, 0, cos yaw)` —
  // pre-rotation +z is `(0, 0, 1)` and `rotation.y = yaw` rotates the
  // XZ plane CCW from +z toward +x. So `(sin yaw, cos yaw) = (dx, -dy)`,
  // i.e. `yaw = atan2(dx, -dy)`.
  return Math.atan2(dx, -dy);
}
