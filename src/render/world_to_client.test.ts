import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { projectWorldToClient } from "./world_to_client.js";

/** Build a top-down perspective camera that mirrors the renderer setup
 *  (60° FOV, `up = (0, 0, -1)`, looking straight down at a focus point). */
function topDownCamera(
  focus: { x: number; y: number },
  height: number,
  aspect: number,
): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  cam.up.set(0, 0, -1);
  cam.position.set(focus.x, height, -focus.y);
  cam.lookAt(focus.x, 0, -focus.y);
  cam.updateMatrixWorld();
  return cam;
}

const RECT = { left: 0, top: 0, width: 800, height: 600 } as const;

describe("projectWorldToClient", () => {
  it("maps the focus tile to the canvas centre", () => {
    const cam = topDownCamera({ x: 5, y: 7 }, 14, RECT.width / RECT.height);
    const p = projectWorldToClient(5, 7, cam, RECT);
    expect(p.x).toBeCloseTo(400, 5);
    expect(p.y).toBeCloseTo(300, 5);
  });

  it("maps +world.x to the right and -world.x to the left", () => {
    const cam = topDownCamera({ x: 0, y: 0 }, 14, RECT.width / RECT.height);
    const right = projectWorldToClient(1, 0, cam, RECT);
    const left = projectWorldToClient(-1, 0, cam, RECT);
    expect(right.x).toBeGreaterThan(400);
    expect(left.x).toBeLessThan(400);
    expect(right.x - 400).toBeCloseTo(400 - left.x, 5);
    expect(right.y).toBeCloseTo(300, 5);
    expect(left.y).toBeCloseTo(300, 5);
  });

  it("maps +world.y (north) to the top of the canvas and -world.y to the bottom", () => {
    // Camera's `up = (0, 0, -1)` aligns world +y (= scene -z) with the
    // canvas top edge. Without that flip a regressed `tileToScene` swap
    // would surface as an inverted screen mapping.
    const cam = topDownCamera({ x: 0, y: 0 }, 14, RECT.width / RECT.height);
    const north = projectWorldToClient(0, 1, cam, RECT);
    const south = projectWorldToClient(0, -1, cam, RECT);
    expect(north.y).toBeLessThan(300);
    expect(south.y).toBeGreaterThan(300);
    expect(north.x).toBeCloseTo(400, 5);
    expect(south.x).toBeCloseTo(400, 5);
  });

  it("honours the canvas offset (rect.left / rect.top)", () => {
    const cam = topDownCamera({ x: 0, y: 0 }, 14, RECT.width / RECT.height);
    const offsetRect = { left: 50, top: 25, width: 800, height: 600 } as const;
    const p = projectWorldToClient(0, 0, cam, offsetRect);
    expect(p.x).toBeCloseTo(50 + 400, 5);
    expect(p.y).toBeCloseTo(25 + 300, 5);
  });
});
