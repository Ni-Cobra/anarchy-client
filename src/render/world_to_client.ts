/**
 * Pure projection from server world tile coords `(x, y)` to canvas-relative
 * client pixels. Mirrors `tileToScene` (`+y_world → -z_scene`, ground at
 * `y_scene = 0.5`), then runs the standard THREE NDC pipeline against the
 * live camera and maps NDC into the canvas's bounding box.
 *
 * Lives next to `tileToScene` (`sync.ts`) and `pickBlockUnderCursor`
 * (`picker.ts`) — the same world ↔ scene seam, just in the forward
 * direction. The renderer composes this for its `worldToClient` test
 * handle; isolating the math keeps the projection assertable from a
 * vitest unit without spinning up a `Renderer` against WebGL.
 */
import * as THREE from "three";

export interface ClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export function projectWorldToClient(
  worldX: number,
  worldY: number,
  camera: THREE.Camera,
  rect: ClientRect,
): ClientPoint {
  const v = new THREE.Vector3(worldX, 0.5, -worldY);
  v.project(camera);
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
  };
}
