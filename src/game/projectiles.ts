/**
 * Client-side mirror of the server's in-flight projectile set.
 *
 * The wire ships one `ProjectileSnapshot` per live projectile each tick
 * (see `net/wire_tick.ts`) and a one-shot `ProjectileImpactEvent` the tick
 * the dart lands. This module exposes a small store the wire layer writes
 * into and the renderer reads from each frame; mirrors the
 * `Inventory.replaceFromWire` + subscribe pattern but for projectiles.
 *
 * Network- and Three.js-free: this is the same layer as `Inventory` /
 * `Entity` — pure data and the per-frame interpolation source. The
 * renderer's `projectile_layer.ts` consumes it.
 */

export type ProjectileKind = "poison-dart";

export type ProjectileTargetKind = "player" | "entity";

export interface ProjectileTarget {
  readonly kind: ProjectileTargetKind;
  readonly id: number;
}

/**
 * One projectile-snapshot record decoded from a `TickUpdate`. Field shape
 * mirrors the wire (`ProjectileSnapshot`) — just translated to the
 * network-free TypeScript types.
 */
export interface ProjectileSnapshot {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly x: number;
  readonly y: number;
  readonly target: ProjectileTarget;
}

/**
 * The renderer-facing state carried per live projectile. Holds the
 * previous and latest snapshot positions plus the wall-clock the latest
 * snapshot landed — same `from / to / startMs` shape `entity_layer.ts`
 * uses for tile-step smoothing — so the per-frame renderer can lerp
 * between snapshots without re-reading the wire.
 */
export interface ProjectileState {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly target: ProjectileTarget;
  readonly prevX: number;
  readonly prevY: number;
  readonly x: number;
  readonly y: number;
  /** Wall-clock ms the latest snapshot was applied. */
  readonly receivedMs: number;
}

/**
 * Interpolation budget for the snapshot-to-snapshot lerp. Pinned to the
 * server's tick interval (50 ms @ 20 Hz) so the rendered dart catches up
 * to the latest snapshot the moment the next one arrives — no compounding
 * lag, no overshoot. Mirrors the shape (not the value) of
 * `ENTITY_STEP_TRANSITION_MS` for tile-bound entities.
 */
export const PROJECTILE_LERP_MS = 50;

/**
 * Per-player / per-tick mirror of every in-flight projectile inside the
 * receiver's view window. Writes come from `wire_tick.applyTickUpdate`
 * (wholesale replace each tick); reads come from the per-frame renderer.
 */
export class ProjectileStore {
  private readonly states = new Map<number, ProjectileState>();
  private readonly listeners: Array<() => void> = [];

  /**
   * Apply the current tick's full set of projectile snapshots. Tracks the
   * previous snapshot's `(x, y)` per id so the renderer has a velocity
   * vector + lerp anchor. Snapshots not present in this set are dropped
   * — the server despawns impact-landed projectiles the same tick, and
   * the wire bridge stops shipping out-of-view projectiles implicitly.
   */
  applySnapshots(snapshots: readonly ProjectileSnapshot[], nowMs: number): void {
    const seen = new Set<number>();
    for (const snap of snapshots) {
      seen.add(snap.id);
      const prev = this.states.get(snap.id);
      this.states.set(snap.id, {
        id: snap.id,
        kind: snap.kind,
        target: snap.target,
        prevX: prev ? prev.x : snap.x,
        prevY: prev ? prev.y : snap.y,
        x: snap.x,
        y: snap.y,
        receivedMs: nowMs,
      });
    }
    let changed = false;
    for (const id of [...this.states.keys()]) {
      if (!seen.has(id)) {
        this.states.delete(id);
        changed = true;
      }
    }
    if (snapshots.length > 0 || changed) this.notify();
  }

  /**
   * Drop the projectile with this id. The renderer routes
   * `ProjectileImpactEvent` here so the dart visual retires the same
   * frame the puff fires — keeps "dart vanishes one tile early" race
   * from showing up if the despawn snapshot lands after the impact event.
   */
  remove(id: number): void {
    if (this.states.delete(id)) this.notify();
  }

  get(id: number): ProjectileState | undefined {
    return this.states.get(id);
  }

  values(): IterableIterator<ProjectileState> {
    return this.states.values();
  }

  size(): number {
    return this.states.size;
  }

  /**
   * Subscribe to "store changed" events. The renderer doesn't use this
   * (it pulls every frame) but tests + future HUD chrome do. Returns an
   * unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Drop every live projectile. Called on local-player reassign. */
  clear(): void {
    if (this.states.size === 0) return;
    this.states.clear();
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/**
 * Resolve the rendered `(x, y)` of `state` at `nowMs`. Linear interpolation
 * over [`PROJECTILE_LERP_MS`] from the previous snapshot's `(x, y)` to the
 * latest — matches the dart's authoritative per-tick advance so the
 * rendered position keeps pace with the server.
 */
export function sampleProjectilePosition(
  state: ProjectileState,
  nowMs: number,
): { x: number; y: number } {
  const elapsed = nowMs - state.receivedMs;
  const t = elapsed <= 0 ? 0 : elapsed >= PROJECTILE_LERP_MS ? 1 : elapsed / PROJECTILE_LERP_MS;
  return {
    x: state.prevX + (state.x - state.prevX) * t,
    y: state.prevY + (state.y - state.prevY) * t,
  };
}

/**
 * Recover the dart's velocity vector from the prev → current snapshot
 * delta. Returns `null` when the previous snapshot is identical to the
 * current one (the dart's first tick of life) — the renderer falls back
 * to aiming at the target's current position so the brand-new mesh is
 * oriented even before any motion has been observed.
 */
export function projectileVelocity(
  state: ProjectileState,
): { dx: number; dy: number } | null {
  const dx = state.x - state.prevX;
  const dy = state.y - state.prevY;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
  return { dx, dy };
}
