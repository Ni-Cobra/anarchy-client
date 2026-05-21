import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BlockType } from "../../game/index.js";
import { EffectsLayer } from "./effects.js";

/**
 * Effects layer is renderer-internal but exercises a tiny lifecycle that
 * matches the task spec: events come in, time advances, expired effects
 * dispose themselves. The tests below pin those mechanics without
 * touching a real `Renderer` (a Three.js renderer needs a WebGL context).
 */
function makeLayer() {
  // No real player resolution needed for lifecycle tests — palette[0] is
  // returned via the `null` fallback inside the layer.
  return new EffectsLayer(() => null);
}

function countChildren(layer: EffectsLayer): number {
  return layer.scene().children.length;
}

describe("EffectsLayer", () => {
  it("spawns a place pulse on a placed block edit", () => {
    const layer = makeLayer();
    expect(countChildren(layer)).toBe(0);
    layer.onBlockEdit(
      { playerId: 1, kind: "placed", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Stone },
      0,
    );
    expect(countChildren(layer)).toBe(1);
  });

  it("spawns a break shatter on a broken block edit", () => {
    const layer = makeLayer();
    layer.onBlockEdit(
      { playerId: 1, kind: "broken", cx: 1, cy: 2, lx: 3, ly: 4, blockType: BlockType.Stone },
      0,
    );
    expect(countChildren(layer)).toBe(1);
  });

  it("expires a place pulse once its duration elapses", () => {
    const layer = makeLayer();
    layer.onBlockEdit(
      { playerId: 1, kind: "placed", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Stone },
      1_000,
    );
    expect(countChildren(layer)).toBe(1);
    layer.update(1_124);
    expect(countChildren(layer)).toBe(1);
    // Duration is 250ms — past the end the pulse is disposed.
    layer.update(1_500);
    expect(countChildren(layer)).toBe(0);
  });

  it("expires a break shatter once its duration elapses", () => {
    const layer = makeLayer();
    layer.onBlockEdit(
      { playerId: 1, kind: "broken", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Stone },
      0,
    );
    expect(countChildren(layer)).toBe(1);
    // Shatter duration is 350ms.
    layer.update(500);
    expect(countChildren(layer)).toBe(0);
  });

  it("creates a targeting overlay when a targeting state appears", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 5, ly: 6, durabilityPct: 75 },
    ]);
    expect(countChildren(layer)).toBe(1);
  });

  it("removes a targeting overlay when the player disappears from the set", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100 },
    ]);
    expect(countChildren(layer)).toBe(1);
    layer.applyTargets([]);
    expect(countChildren(layer)).toBe(0);
  });

  it("re-uses the targeting overlay when the same player re-targets", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100 },
    ]);
    expect(countChildren(layer)).toBe(1);
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 1, ly: 1, durabilityPct: 50 },
    ]);
    // Still one overlay — no churn on re-target.
    expect(countChildren(layer)).toBe(1);
  });

  it("supports multiple players targeting different cells simultaneously", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100 },
      { playerId: 2, cx: 0, cy: 0, lx: 5, ly: 5, durabilityPct: 50 },
    ]);
    expect(countChildren(layer)).toBe(2);
    // Drop player 2 only.
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 80 },
    ]);
    expect(countChildren(layer)).toBe(1);
  });

  it("clears all owned scene state on dispose", () => {
    const layer = makeLayer();
    layer.onBlockEdit(
      { playerId: 1, kind: "placed", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Stone },
      0,
    );
    layer.applyTargets([
      { playerId: 2, cx: 0, cy: 0, lx: 1, ly: 1, durabilityPct: 50 },
    ]);
    expect(countChildren(layer)).toBe(2);
    layer.dispose();
    expect(countChildren(layer)).toBe(0);
  });

  it("draws a cube outline (LineSegments) when the target is top-layer", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100, layer: "top" },
    ]);
    const overlay = layer.scene().children[0] as THREE.Group;
    const frame = overlay.children.find((c) => c instanceof THREE.Line);
    expect(frame).toBeInstanceOf(THREE.LineSegments);
  });

  it("draws a flat square (LineLoop) when the target is ground-layer (task 030)", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100, layer: "ground" },
    ]);
    const overlay = layer.scene().children[0] as THREE.Group;
    const frame = overlay.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    expect(frame).toBeInstanceOf(THREE.LineLoop);
    // 4 corners → 4 vertices for a closed loop.
    const positions = frame.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(positions.count).toBe(4);
    // Lifted just above the ground floor, not at cube-center height.
    expect(frame.position.y).toBeLessThan(0.2);
  });

  it("defaults to the cube outline when `layer` is omitted (back-compat)", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100 },
    ]);
    const overlay = layer.scene().children[0] as THREE.Group;
    const frame = overlay.children.find((c) => c instanceof THREE.Line);
    expect(frame).toBeInstanceOf(THREE.LineSegments);
  });

  it("rebuilds the frame in place when a re-target flips the layer (no flicker)", () => {
    const layer = makeLayer();
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 100, layer: "top" },
    ]);
    expect(countChildren(layer)).toBe(1);
    const overlayBefore = layer.scene().children[0] as THREE.Group;
    layer.applyTargets([
      { playerId: 1, cx: 0, cy: 0, lx: 0, ly: 0, durabilityPct: 80, layer: "ground" },
    ]);
    // Still one overlay — re-uses the same group, just swaps frame geom.
    expect(countChildren(layer)).toBe(1);
    const overlayAfter = layer.scene().children[0] as THREE.Group;
    expect(overlayAfter).toBe(overlayBefore);
    const frame = overlayAfter.children.find((c) => c instanceof THREE.Line);
    expect(frame).toBeInstanceOf(THREE.LineLoop);
  });

  it("uses a smaller, shorter shatter for non-solid top blocks (task 510)", () => {
    // Stone is solid-top → full-cell shatter cube + standard duration.
    const solid = makeLayer();
    solid.onBlockEdit(
      { playerId: 1, kind: "broken", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Stone },
      0,
    );
    const solidGeom = (solid.scene().children[0] as THREE.Mesh)
      .geometry as THREE.BoxGeometry;
    // Solid keeps the legacy unit-cube starting geometry.
    expect(solidGeom.parameters.width).toBeCloseTo(1, 6);

    // Sticks is non-solid → softer (smaller) cube *and* shorter
    // lifetime. A timestamp past the soft duration should expire the
    // shatter while a solid one would still be alive.
    const soft = makeLayer();
    soft.onBlockEdit(
      { playerId: 1, kind: "broken", cx: 0, cy: 0, lx: 0, ly: 0, blockType: BlockType.Sticks },
      0,
    );
    const softGeom = (soft.scene().children[0] as THREE.Mesh)
      .geometry as THREE.BoxGeometry;
    expect(softGeom.parameters.width).toBeLessThan(1);

    // Pin the duration cut: the standard shatter is 350ms; the soft
    // one should be shorter. Check that at 200ms (still mid-life for
    // solid, past-end for soft) the counts split.
    solid.update(200);
    soft.update(200);
    expect(solid.scene().children).toHaveLength(1);
    expect(soft.scene().children).toHaveLength(0);
  });
});
