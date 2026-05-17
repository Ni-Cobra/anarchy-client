import { describe, expect, it } from "vitest";

import { EffectKind } from "../game/index.js";
import { TargetEffectsLayer, hasSlow } from "./effects_layer.js";

describe("hasSlow", () => {
  it("returns true when a Slow effect is present", () => {
    expect(hasSlow([{ kind: EffectKind.Slow, remainingTicks: 10 }])).toBe(true);
  });

  it("returns false when the list is empty", () => {
    expect(hasSlow([])).toBe(false);
  });
});

describe("TargetEffectsLayer.update", () => {
  it("mounts a sprite for a target carrying an active Slow", () => {
    const layer = new TargetEffectsLayer();
    layer.update([
      {
        kind: "player",
        id: 1,
        x: 3,
        y: 5,
        effects: [{ kind: EffectKind.Slow, remainingTicks: 10 }],
      },
    ]);
    expect(layer.size()).toBe(1);
    layer.dispose();
  });

  it("retires the sprite when the slow effect disappears the next tick", () => {
    const layer = new TargetEffectsLayer();
    layer.update([
      {
        kind: "player",
        id: 1,
        x: 3,
        y: 5,
        effects: [{ kind: EffectKind.Slow, remainingTicks: 10 }],
      },
    ]);
    expect(layer.size()).toBe(1);
    layer.update([
      { kind: "player", id: 1, x: 3, y: 5, effects: [] },
    ]);
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("retires the sprite when the target leaves the view", () => {
    const layer = new TargetEffectsLayer();
    layer.update([
      {
        kind: "player",
        id: 1,
        x: 3,
        y: 5,
        effects: [{ kind: EffectKind.Slow, remainingTicks: 10 }],
      },
    ]);
    expect(layer.size()).toBe(1);
    layer.update([]);
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("renders independent sprites for players and entities even with the same id", () => {
    const layer = new TargetEffectsLayer();
    layer.update([
      {
        kind: "player",
        id: 1,
        x: 0,
        y: 0,
        effects: [{ kind: EffectKind.Slow, remainingTicks: 10 }],
      },
      {
        kind: "entity",
        id: 1,
        x: 2,
        y: 2,
        effects: [{ kind: EffectKind.Slow, remainingTicks: 10 }],
      },
    ]);
    expect(layer.size()).toBe(2);
    layer.dispose();
  });
});
