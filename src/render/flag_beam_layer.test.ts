import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  FLAG_BEAM_BODY_Y,
  FLAG_BEAM_DEPOSIT_COLOR,
  FLAG_BEAM_RADIUS,
  FLAG_BEAM_STEAL_COLOR,
  FlagBeamLayer,
  aimFlagBeam,
  colorForMode,
} from "./flag_beam_layer.js";

const FLAG_SPEC = {
  playerId: 1,
  flagCx: 0,
  flagCy: 0,
  flagLx: 3,
  flagLy: 0,
  mode: "deposit" as const,
};

describe("colorForMode", () => {
  it("returns the deposit tint for `deposit`", () => {
    expect(colorForMode("deposit")).toBe(FLAG_BEAM_DEPOSIT_COLOR);
  });
  it("returns the steal tint for `steal`", () => {
    expect(colorForMode("steal")).toBe(FLAG_BEAM_STEAL_COLOR);
  });
});

describe("FlagBeamLayer", () => {
  it("starts empty", () => {
    const layer = new FlagBeamLayer();
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("spawns a beam on applyFlagInteracts and retires it when the spec list goes empty", () => {
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC]);
    expect(layer.size()).toBe(1);
    expect(layer.beamSpec(1)).toEqual({
      flagCx: 0,
      flagCy: 0,
      flagLx: 3,
      flagLy: 0,
      mode: "deposit",
    });
    // Next tick: no entry for player 1 → retire.
    layer.applyFlagInteracts([]);
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("colours the beam by mode", () => {
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC]);
    expect(layer.beamColorHex(1)).toBe(FLAG_BEAM_DEPOSIT_COLOR);
    layer.applyFlagInteracts([{ ...FLAG_SPEC, mode: "steal" }]);
    expect(layer.beamColorHex(1)).toBe(FLAG_BEAM_STEAL_COLOR);
    layer.dispose();
  });

  it("update aims the deposit beam from player → flag (midpoint at the segment centre)", () => {
    // Flag at chunk (0, 0) local (3, 0) → world tile centre (3.5, 0.5).
    // Player at world (1.5, 0.5) → segment midpoint (2.5, 0.5) →
    // scene midpoint (2.5, body_y, -0.5).
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC]);
    layer.update((id) => (id === 1 ? { x: 1.5, y: 0.5 } : null));
    const mid = layer.beamMidpoint(1);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(2.5, 6);
    expect(mid!.z).toBeCloseTo(-0.5, 6);
    expect(layer.beamVisible(1)).toBe(true);
    layer.dispose();
  });

  it("update hides the beam when the player lookup misses but keeps it for next tick", () => {
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC]);
    layer.update(() => null);
    expect(layer.size()).toBe(1);
    expect(layer.beamVisible(1)).toBe(false);
    // Subsequent tick with a resolvable position revives the beam visually.
    layer.update((id) => (id === 1 ? { x: 1.5, y: 0.5 } : null));
    expect(layer.beamVisible(1)).toBe(true);
    layer.dispose();
  });

  it("update aims the steal beam in the *opposite* direction (segment reversed)", () => {
    // Steal direction is flag → player. The midpoint is still the
    // segment centre, but the beam's local orientation flips. Pin
    // direction by checking the cylinder's +y axis (in world space)
    // points from flag toward player.
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([{ ...FLAG_SPEC, mode: "steal" }]);
    layer.update((id) => (id === 1 ? { x: 1.5, y: 0.5 } : null));
    const mid = layer.beamMidpoint(1);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(2.5, 6);
    expect(mid!.z).toBeCloseTo(-0.5, 6);
    layer.dispose();
  });

  it("a duplicate applyFlagInteracts with a different mode flips the tint in place (no dispose/respawn)", () => {
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC]);
    const meshBefore = layer.beamMidpoint(1);
    layer.applyFlagInteracts([{ ...FLAG_SPEC, mode: "steal" }]);
    expect(layer.size()).toBe(1);
    expect(layer.beamColorHex(1)).toBe(FLAG_BEAM_STEAL_COLOR);
    // The mesh midpoint hasn't been re-aimed yet (no `update` call) but
    // the slot is unchanged — the beam was updated in place, not respawned.
    expect(layer.beamMidpoint(1)?.x).toBe(meshBefore?.x);
    layer.dispose();
  });

  it("clearAll drops every beam", () => {
    const layer = new FlagBeamLayer();
    layer.applyFlagInteracts([FLAG_SPEC, { ...FLAG_SPEC, playerId: 2 }]);
    expect(layer.size()).toBe(2);
    layer.clearAll();
    expect(layer.size()).toBe(0);
    layer.dispose();
  });
});

describe("aimFlagBeam", () => {
  it("places the midpoint at the segment centre at body_y", () => {
    const mesh = new THREE.Mesh();
    aimFlagBeam(mesh, 0, 0, 2, 0, FLAG_BEAM_RADIUS);
    expect(mesh.position.x).toBeCloseTo(1, 6);
    expect(mesh.position.y).toBeCloseTo(FLAG_BEAM_BODY_Y, 6);
    expect(mesh.position.z).toBeCloseTo(0, 6);
  });

  it("scales length along +y and radius along x/z", () => {
    const mesh = new THREE.Mesh();
    // From (0,0) to (4,0) world = distance 4 tiles.
    aimFlagBeam(mesh, 0, 0, 4, 0, FLAG_BEAM_RADIUS);
    expect(mesh.scale.x).toBeCloseTo(FLAG_BEAM_RADIUS, 6);
    expect(mesh.scale.y).toBeCloseTo(4, 6);
    expect(mesh.scale.z).toBeCloseTo(FLAG_BEAM_RADIUS, 6);
  });

  it("hides the mesh when the segment has zero length", () => {
    const mesh = new THREE.Mesh();
    mesh.visible = true;
    aimFlagBeam(mesh, 1, 1, 1, 1, FLAG_BEAM_RADIUS);
    expect(mesh.visible).toBe(false);
  });

  it("rotates so the cylinder's local +y axis points along the segment", () => {
    // World segment (0,0) → (2,0): scene mapping flips y → -z, so the
    // segment direction is (+x, 0, 0). The cylinder's local +y axis
    // should rotate to align with it.
    const mesh = new THREE.Mesh();
    aimFlagBeam(mesh, 0, 0, 2, 0, FLAG_BEAM_RADIUS);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    expect(localY.x).toBeCloseTo(1, 6);
    expect(localY.y).toBeCloseTo(0, 6);
    expect(localY.z).toBeCloseTo(0, 6);
  });
});
