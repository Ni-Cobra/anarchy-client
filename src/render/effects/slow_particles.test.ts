import { describe, expect, it } from "vitest";

import { EffectKind } from "../../game/index.js";
import { SlowParticles, hasSlow } from "./slow_particles.js";

function slow() {
  return [{ kind: EffectKind.Slow, remainingTicks: 10 }] as const;
}

describe("hasSlow", () => {
  it("returns true when a Slow effect is present", () => {
    expect(hasSlow(slow())).toBe(true);
  });

  it("returns false when the list is empty", () => {
    expect(hasSlow([])).toBe(false);
  });
});

describe("SlowParticles.applyTargets", () => {
  it("starts an emitter on Slow gain and spawns particles over time", () => {
    const layer = new SlowParticles();
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 3, y: 5, effects: slow() }],
      0,
    );
    // One emission fires at t=0 from the new emitter; emitter count is 1.
    expect(layer.emitterCount()).toBe(1);
    expect(layer.particleCount()).toBe(1);

    // Re-applying at a later frame keeps the emitter and adds more particles
    // — each `EMIT_INTERVAL_MS` (80 ms) since the last emission spawns one.
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 3, y: 5, effects: slow() }],
      240,
    );
    expect(layer.emitterCount()).toBe(1);
    expect(layer.particleCount()).toBe(4); // emits at 0, 80, 160, 240
    layer.dispose();
  });

  it("stops emitting when the Slow effect drops; live particles linger then fade", () => {
    const layer = new SlowParticles();
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 0, y: 0, effects: slow() }],
      0,
    );
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 0, y: 0, effects: slow() }],
      160,
    );
    const beforeDrop = layer.particleCount();
    expect(beforeDrop).toBeGreaterThanOrEqual(2);

    // Effect drops on the next tick — emitter retires but already-spawned
    // particles continue to live until their lifetime expires.
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 0, y: 0, effects: [] }],
      200,
    );
    expect(layer.emitterCount()).toBe(0);
    expect(layer.particleCount()).toBe(beforeDrop);

    // Advance past the per-particle lifetime; the trail finishes naturally.
    layer.update(5_000);
    expect(layer.particleCount()).toBe(0);
    layer.dispose();
  });

  it("retires the emitter when the target leaves the view", () => {
    const layer = new SlowParticles();
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 0, y: 0, effects: slow() }],
      0,
    );
    expect(layer.emitterCount()).toBe(1);
    layer.applyTargets([], 16);
    expect(layer.emitterCount()).toBe(0);
    layer.dispose();
  });

  it("scales with target count — distinct emitters for players and entities sharing an id", () => {
    const layer = new SlowParticles();
    layer.applyTargets(
      [
        { kind: "player", id: 1, x: 0, y: 0, effects: slow() },
        { kind: "entity", id: 1, x: 2, y: 2, effects: slow() },
        { kind: "entity", id: 2, x: 3, y: 3, effects: slow() },
      ],
      0,
    );
    expect(layer.emitterCount()).toBe(3);
    layer.dispose();
  });

  it("update() expires particles past their lifetime", () => {
    const layer = new SlowParticles();
    layer.applyTargets(
      [{ kind: "player", id: 1, x: 0, y: 0, effects: slow() }],
      0,
    );
    expect(layer.particleCount()).toBeGreaterThan(0);
    // Lifetime is 900 ms; well past that every particle should retire.
    layer.update(10_000);
    expect(layer.particleCount()).toBe(0);
    layer.dispose();
  });
});
