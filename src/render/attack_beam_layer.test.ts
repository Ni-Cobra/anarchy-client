import { describe, expect, it } from "vitest";

import {
  AttackBeamLayer,
  BEAM_CHARGE_DURATION_MS,
  BEAM_END_THICKNESS,
  BEAM_START_THICKNESS,
  MS_PER_TICK,
  beamThicknessAt,
  reconstructChargeStartMs,
} from "./attack_beam_layer.js";
import { paletteColorHex } from "../game/palette.js";

describe("beamThicknessAt", () => {
  it("returns the start thickness at t = 0", () => {
    expect(beamThicknessAt(0)).toBe(BEAM_START_THICKNESS);
  });

  it("returns the end thickness at t = BEAM_CHARGE_DURATION_MS", () => {
    expect(beamThicknessAt(BEAM_CHARGE_DURATION_MS)).toBe(BEAM_END_THICKNESS);
  });

  it("clamps negative elapsed to the start thickness", () => {
    expect(beamThicknessAt(-50)).toBe(BEAM_START_THICKNESS);
  });

  it("clamps elapsed past the charge window to the end thickness", () => {
    expect(beamThicknessAt(BEAM_CHARGE_DURATION_MS + 500)).toBe(
      BEAM_END_THICKNESS,
    );
  });

  it("lerps linearly between start and end thickness", () => {
    // Halfway through the charge window: midpoint thickness.
    const half = beamThicknessAt(BEAM_CHARGE_DURATION_MS / 2);
    const expected = (BEAM_START_THICKNESS + BEAM_END_THICKNESS) / 2;
    expect(Math.abs(half - expected)).toBeLessThan(1e-9);
  });

  it("is monotonically non-increasing across the charge window", () => {
    let prev = beamThicknessAt(0);
    for (let i = 1; i <= 10; i++) {
      const t = (i / 10) * BEAM_CHARGE_DURATION_MS;
      const cur = beamThicknessAt(t);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe("reconstructChargeStartMs", () => {
  it("returns the anchor wall-clock when the tick matches the anchor", () => {
    expect(reconstructChargeStartMs(100, 100, 1_000)).toBe(1_000);
  });

  it("walks back tick offsets at MS_PER_TICK granularity", () => {
    // anchor at tick 100 / wall 1000; startedAtTick = 95 → started 5 ticks
    // ago → 5 * MS_PER_TICK ms before the anchor.
    const ms = reconstructChargeStartMs(95, 100, 1_000);
    expect(ms).toBeCloseTo(1_000 - 5 * MS_PER_TICK, 6);
  });

  it("walks forward for ticks after the anchor", () => {
    const ms = reconstructChargeStartMs(105, 100, 1_000);
    expect(ms).toBeCloseTo(1_000 + 5 * MS_PER_TICK, 6);
  });
});

describe("AttackBeamLayer", () => {
  it("starts empty", () => {
    const layer = new AttackBeamLayer();
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("spawns a beam on charge-started and retires it on strike", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "player", 2, 0, 1_000);
    expect(layer.size()).toBe(1);
    layer.onResolve(1);
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("colours the beam by the attacker's palette index", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(7, "player", 8, 3, 1_000);
    // Palette index 3 is the cyan entry.
    expect(layer.beamColorHex(7)).toBe(paletteColorHex(3));
    layer.dispose();
  });

  it("shrinks the beam radius over the charge window when updated", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "player", 2, 0, 1_000);
    const positions = (kind: "player" | "entity", id: number) => {
      if (kind === "player" && id === 1) return { x: 0, y: 0 };
      if (kind === "player" && id === 2) return { x: 4, y: 0 };
      return null;
    };
    layer.update(positions, 1_000);
    const r0 = layer.beamRadius(1);
    layer.update(positions, 1_000 + BEAM_CHARGE_DURATION_MS / 2);
    const rHalf = layer.beamRadius(1);
    layer.update(positions, 1_000 + BEAM_CHARGE_DURATION_MS);
    const rEnd = layer.beamRadius(1);
    expect(r0).toBeCloseTo(BEAM_START_THICKNESS, 6);
    expect(rEnd).toBeCloseTo(BEAM_END_THICKNESS, 6);
    expect(rHalf).toBeLessThan(r0!);
    expect(rHalf).toBeGreaterThan(rEnd!);
    layer.dispose();
  });

  it("hides the beam mesh when either endpoint goes missing", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "entity", 99, 0, 1_000);
    layer.update(
      (kind, id) => {
        if (kind === "player" && id === 1) return { x: 0, y: 0 };
        // entity 99 missing
        return null;
      },
      1_000,
    );
    // Mesh exists but is not visible (positions lookup returned null for
    // target). We expose visibility indirectly through `beamRadius` —
    // the layer scales the mesh on `aimCylinder`; with target null the
    // mesh stays at its default scale of (1,1,1).
    // The important behaviour is that the beam is still present (not
    // disposed) and a subsequent successful update re-aims it.
    expect(layer.size()).toBe(1);
    layer.update(
      (kind, id) => {
        if (kind === "player" && id === 1) return { x: 0, y: 0 };
        if (kind === "entity" && id === 99) return { x: 2, y: 0 };
        return null;
      },
      1_000,
    );
    expect(layer.beamRadius(1)).toBeCloseTo(BEAM_START_THICKNESS, 6);
    layer.dispose();
  });

  it("a duplicate charge-started replaces the previous beam in place", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "player", 2, 0, 1_000);
    expect(layer.beamColorHex(1)).toBe(paletteColorHex(0));
    // Same attacker, different colour — simulates an unexpected re-emit.
    layer.onCharge(1, "player", 2, 4, 1_000);
    expect(layer.size()).toBe(1);
    expect(layer.beamColorHex(1)).toBe(paletteColorHex(4));
    layer.dispose();
  });

  it("clearAll drops every beam without breaking subsequent inserts", () => {
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "player", 2, 0, 1_000);
    layer.onCharge(3, "player", 4, 1, 1_000);
    expect(layer.size()).toBe(2);
    layer.clearAll();
    expect(layer.size()).toBe(0);
    layer.onCharge(5, "player", 6, 2, 2_000);
    expect(layer.size()).toBe(1);
    layer.dispose();
  });

  it("clearAll removes a mid-charge beam when the target dies before strike resolves", () => {
    // Scenario: attacker 1 has a charge-started beam targeting local player 2.
    // Player 2 dies from a different hit before attacker 1's strike resolves,
    // so onResolve is never called for this beam. Without clearAll() on the
    // death event, the beam would re-aim to player 2's respawn position.
    const layer = new AttackBeamLayer();
    layer.onCharge(1, "player", 2, 0, 1_000);
    expect(layer.size()).toBe(1);
    layer.clearAll(); // fired by the local-player death handler
    expect(layer.size()).toBe(0);
    layer.dispose();
  });
});
