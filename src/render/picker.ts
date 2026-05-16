import * as THREE from "three";

import {
  BlockType,
  CHUNK_SIZE,
  type Block,
  type ChunkCoord,
  type EntityId,
  type PlayerId,
  type Terrain,
  getBlock,
} from "../game/index.js";

/**
 * Cursor-driven world picker. Given a cursor in NDC (`x`, `y` ∈ [-1, 1]) and
 * a `THREE.Camera`, returns the cell currently under the cursor as
 * `{ chunkCoord, localXY, layer, block }` — `layer` is `"top"` if the
 * targeted cell holds a non-Air top-layer block, otherwise `"ground"`.
 * Returns `null` when the cursor doesn't fall on any loaded chunk (or when
 * the camera ray misses the world's `y = 0` plane entirely).
 *
 * Sits underneath the upcoming destroy + place input flow: those tasks ask
 * the picker for a target, then send proto messages from `main.ts`. The
 * picker is pure-view; it doesn't mutate `Terrain` and doesn't know about
 * the wire format.
 *
 * Picking is done by raycasting against the world's ground plane (`y = 0`)
 * rather than the per-block meshes themselves. With the top-down camera the
 * vertical-extent error at a top block's footprint is small enough to be
 * imperceptible; if a future low-angle camera or a "click on the side of a
 * top block" requirement makes that approximation visible, this is the file
 * to lift to mesh-intersection raycasting.
 *
 * `pickPlayerUnderCursor` shares the same NDC → raycaster pipeline (via
 * `raycasterFromCursor`) so block-pick and player-pick stay one cursor-side
 * concern.
 */
export type PickLayer = "top" | "ground";

export interface PickResult {
  readonly chunkCoord: ChunkCoord;
  readonly localXY: readonly [number, number];
  readonly layer: PickLayer;
  readonly block: Block;
}

function raycasterFromCursor(
  cursorNdc: { readonly x: number; readonly y: number },
  camera: THREE.Camera,
): THREE.Raycaster {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(cursorNdc.x, cursorNdc.y),
    camera,
  );
  return raycaster;
}

export function pickBlockUnderCursor(
  cursorNdc: { readonly x: number; readonly y: number },
  camera: THREE.Camera,
  terrain: Terrain,
): PickResult | null {
  const raycaster = raycasterFromCursor(cursorNdc, camera);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (hit === null) return null;

  // Inverse of `tileToScene` / `tileCenterToScene`: world `+y` becomes
  // scene `-z`, so world `y = -hit.z`.
  const wx = hit.x;
  const wy = -hit.z;
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const chunk = terrain.get(cx, cy);
  if (!chunk) return null;
  const lx = tx - cx * CHUNK_SIZE;
  const ly = ty - cy * CHUNK_SIZE;

  const top = getBlock(chunk.top, lx, ly);
  if (top.kind !== BlockType.Air) {
    return {
      chunkCoord: [cx, cy],
      localXY: [lx, ly],
      layer: "top",
      block: top,
    };
  }
  return {
    chunkCoord: [cx, cy],
    localXY: [lx, ly],
    layer: "ground",
    block: getBlock(chunk.ground, lx, ly),
  };
}

/**
 * Cursor-driven entity picker (task 070b). The server's only entities
 * today are tile-bound spiders, so we resolve the cursor's tile via the
 * same ground-plane raycast `pickBlockUnderCursor` uses, then look up
 * the entity (if any) hosted by the matching chunk on that tile. When
 * multiple entities share a tile the lowest-id one wins so a click is
 * always deterministic. Returns `null` when no entity lives on the
 * cursor's tile, or when the cursor misses the world plane entirely.
 *
 * Tile-bound resolution is intentionally cheaper than a mesh raycast:
 * a spider is a quarter-tile cube near the centre of its tile, so the
 * tile is a reasonable visual proxy. If a future kind grows much
 * smaller-than-tile this gate may need a mesh-bound refinement.
 */
export function pickEntityUnderCursor(
  cursorNdc: { readonly x: number; readonly y: number },
  camera: THREE.Camera,
  terrain: Terrain,
): EntityId | null {
  const raycaster = raycasterFromCursor(cursorNdc, camera);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (hit === null) return null;
  const wx = hit.x;
  const wy = -hit.z;
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  let best: EntityId | null = null;
  for (const [, chunk] of terrain.iter()) {
    for (const entity of chunk.entities.values()) {
      if (entity.tileX !== tx || entity.tileY !== ty) continue;
      if (best === null || entity.id < best) best = entity.id;
    }
  }
  return best;
}

/**
 * Cursor-driven player picker. Returns the `PlayerId` of the player whose
 * body mesh is currently under the cursor, or `null` if no body is hit.
 * Non-recursive intersection: only the top-level body meshes are tested,
 * so child meshes (eyes, billboard sprites) never claim a hit on their
 * parent's behalf and the result is unambiguous even when the billboard
 * is visible.
 */
export function pickPlayerUnderCursor(
  cursorNdc: { readonly x: number; readonly y: number },
  camera: THREE.Camera,
  meshes: ReadonlyMap<PlayerId, THREE.Mesh>,
): PlayerId | null {
  if (meshes.size === 0) return null;
  const raycaster = raycasterFromCursor(cursorNdc, camera);
  const candidates = [...meshes.values()];
  const hits = raycaster.intersectObjects(candidates, false);
  if (hits.length === 0) return null;
  const top = hits[0].object;
  for (const [id, mesh] of meshes) {
    if (mesh === top) return id;
  }
  return null;
}
