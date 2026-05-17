/**
 * Damage-feedback mesh flash (task 150).
 *
 * Drops a transient white overlay on a player or entity body material when
 * the target takes damage, then restores the original color after the
 * configured window. Source-agnostic — the wire bridge feeds every
 * `DamageEvent` (strike hit, admin damage, future env damage) through the
 * renderer's `onDamageEvents` hook, which calls `flashMeshWhite` here.
 *
 * The player and entity mesh factories both expose their body material(s)
 * via `mesh.userData[BODY_LIT_MAT_USERDATA_KEY]` (and, on the player,
 * `BODY_UNLIT_MAT_USERDATA_KEY` — the unlit cousin the lantern swap reads
 * from). The flash mutates both so a wearer-with-lantern still flashes.
 *
 * Lifecycle:
 *   - `flashMeshWhite(mesh, nowMs)` overwrites the current material color
 *     with white and records the original hex + start time keyed by
 *     `mesh.uuid` for later restoration.
 *   - `tickMeshFlashes(nowMs)` is called once per frame; expired entries
 *     restore the original color and drop out of the side table.
 *   - `purgeMeshFlash(mesh)` is the disposal hook the mesh-removal path
 *     calls on player / entity unload so the side table doesn't leak.
 *
 * Overlapping flashes on the same mesh reset the timer — the original
 * color was already captured on the first flash and the second window
 * extends, matching `hp_bar.ts`'s `flashWhite` posture.
 */
import * as THREE from "three";

import {
  BODY_LIT_MAT_USERDATA_KEY,
  BODY_UNLIT_MAT_USERDATA_KEY,
} from "./player_mesh.js";

/**
 * Duration the white overlay stays on a damaged body. Pinned at 150 ms —
 * long enough to be readable at 60 Hz, short enough that a rapid string of
 * hits still individually registers.
 */
export const MESH_FLASH_DURATION_MS = 150;

const WHITE_HEX = 0xffffff;

interface FlashState {
  /** Materials whose color is currently overridden by the flash. */
  readonly materials: THREE.Material[];
  /** Per-material original hex captured at flash start. */
  readonly originalHexes: number[];
  startMs: number;
}

const flashes = new Map<string, FlashState>();

/**
 * Collect every body material exposed on `mesh.userData` so the flash
 * paints whichever variant `obj.material` happens to be pointing at
 * right now (lit vs. unlit Lambert swap). A mesh that exposes neither
 * key falls back to `obj.material` directly so the flash still works on
 * factories that don't follow the userData convention.
 */
function collectBodyMaterials(mesh: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  // Walk the mesh and its descendants (player meshes use a separate body
  // child mesh under the parent). We collect from any descendant exposing
  // the userData keys, then dedupe — multi-mesh hierarchies that share a
  // material would otherwise have it appear twice.
  const seen = new Set<THREE.Material>();
  const visit = (o: THREE.Object3D) => {
    const lit = o.userData[BODY_LIT_MAT_USERDATA_KEY] as
      | THREE.Material
      | undefined;
    const unlit = o.userData[BODY_UNLIT_MAT_USERDATA_KEY] as
      | THREE.Material
      | undefined;
    if (lit && !seen.has(lit)) {
      seen.add(lit);
      out.push(lit);
    }
    if (unlit && !seen.has(unlit)) {
      seen.add(unlit);
      out.push(unlit);
    }
    for (const child of o.children) visit(child);
  };
  visit(mesh);
  if (out.length > 0) return out;
  // Fallback: a mesh whose factory didn't follow the userData convention
  // (or a future test stub) — pick up the `material` field directly.
  if (mesh instanceof THREE.Mesh) {
    const m = mesh.material;
    const arr = Array.isArray(m) ? m : [m];
    for (const mat of arr) if (mat) out.push(mat);
  }
  return out;
}

/**
 * Return whichever of `material.color` is the live `THREE.Color` for
 * `MeshLambertMaterial` / `MeshBasicMaterial`. Falls through to a noop
 * for shader-driven materials that don't expose `color`.
 */
function colorOf(material: THREE.Material): THREE.Color | null {
  // Both Lambert and Basic carry a `.color` field at runtime; TypeScript
  // doesn't narrow `THREE.Material` to those subtypes here, so we just
  // poke the field defensively.
  const m = material as { color?: THREE.Color };
  return m.color ?? null;
}

/**
 * Trigger a white flash on `mesh`. Overlapping calls reset the timer —
 * the original color was captured on the first call and held for the
 * lifetime of the flash; the second call merely extends the duration.
 */
export function flashMeshWhite(
  mesh: THREE.Object3D,
  nowMs: number,
  durationMs: number = MESH_FLASH_DURATION_MS,
): void {
  void durationMs; // Future: per-call overrides. Today every call uses the same window.
  const key = mesh.uuid;
  const existing = flashes.get(key);
  if (existing) {
    existing.startMs = nowMs;
    // Re-apply white in case something else has nudged the colors back
    // (e.g. a lantern swap between the two flashes).
    for (const mat of existing.materials) {
      colorOf(mat)?.setHex(WHITE_HEX);
    }
    return;
  }
  const materials = collectBodyMaterials(mesh);
  if (materials.length === 0) return;
  const originalHexes: number[] = [];
  for (const mat of materials) {
    const c = colorOf(mat);
    originalHexes.push(c ? c.getHex() : WHITE_HEX);
  }
  for (const mat of materials) colorOf(mat)?.setHex(WHITE_HEX);
  flashes.set(key, { materials, originalHexes, startMs: nowMs });
}

/**
 * Per-frame tick. Restores the original color on any flash whose window
 * has elapsed and drops the entry. Cheap — typical state count is
 * `<= number-of-recently-hit-targets`, usually 0 or 1.
 */
export function tickMeshFlashes(nowMs: number): void {
  if (flashes.size === 0) return;
  const expired: string[] = [];
  for (const [key, state] of flashes) {
    if (nowMs - state.startMs >= MESH_FLASH_DURATION_MS) {
      for (let i = 0; i < state.materials.length; i++) {
        colorOf(state.materials[i])?.setHex(state.originalHexes[i]);
      }
      expired.push(key);
    }
  }
  for (const key of expired) flashes.delete(key);
}

/**
 * Disposal hook. Drop any flash state keyed by this mesh so the side
 * table doesn't leak when the mesh is removed from the scene (player
 * despawn, entity unload). If a flash was active, the material colors
 * are NOT restored — the mesh is gone, and the colors live on the
 * material itself which the caller is responsible for disposing.
 */
export function purgeMeshFlash(mesh: THREE.Object3D): void {
  flashes.delete(mesh.uuid);
}

/** Test handle: number of meshes currently mid-flash. */
export function meshFlashCount(): number {
  return flashes.size;
}

/**
 * Test-only: clear the entire flash table. Used by unit tests to reset
 * the module-level state between cases. Production code never calls
 * this — `tickMeshFlashes` handles natural retirement.
 */
export function clearAllMeshFlashesForTest(): void {
  flashes.clear();
}
