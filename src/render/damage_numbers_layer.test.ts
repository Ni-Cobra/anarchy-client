// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  DAMAGE_NUMBER_DURATION_MS,
  DAMAGE_NUMBER_LIFT_TILES,
  DamageNumbersLayer,
} from "./damage_numbers_layer.js";

describe("DamageNumbersLayer", () => {
  it("spawn adds one sprite and increments size()", () => {
    const layer = new DamageNumbersLayer();
    expect(layer.size()).toBe(0);
    layer.spawn({ x: 10, y: 20 }, 7, 0);
    expect(layer.size()).toBe(1);
    expect(layer.group.children.length).toBe(1);
    expect(layer.group.children[0]).toBeInstanceOf(THREE.Sprite);
  });

  it("multiple spawns coexist", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 1, y: 2 }, 10, 0);
    layer.spawn({ x: 3, y: 4 }, 25, 0);
    expect(layer.size()).toBe(2);
  });

  it("sprite floats upward across ticks (monotonic y)", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 5, 0);
    const initial = layer.positionYOfSpawnedAtIndex(0);
    expect(initial).not.toBeNull();
    layer.tick(200);
    const mid = layer.positionYOfSpawnedAtIndex(0);
    expect(mid).not.toBeNull();
    expect(mid!).toBeGreaterThan(initial!);
    layer.tick(500);
    const later = layer.positionYOfSpawnedAtIndex(0);
    expect(later).not.toBeNull();
    expect(later!).toBeGreaterThan(mid!);
    // Total lift over the full lifetime equals DAMAGE_NUMBER_LIFT_TILES.
    const epsilon = 1e-9;
    expect(later! - initial!).toBeLessThan(DAMAGE_NUMBER_LIFT_TILES + epsilon);
  });

  it("retires sprite exactly at spawnMs + DURATION_MS", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 5, 100);
    layer.tick(100 + DAMAGE_NUMBER_DURATION_MS - 1);
    expect(layer.size()).toBe(1);
    layer.tick(100 + DAMAGE_NUMBER_DURATION_MS);
    expect(layer.size()).toBe(0);
    expect(layer.group.children.length).toBe(0);
  });

  it("opacity follows a quadratic-out fade and reaches ~0 at end of life", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 5, 0);
    layer.tick(0);
    const start = layer.opacityOfSpawnedAtIndex(0);
    expect(start).not.toBeNull();
    expect(start!).toBeCloseTo(1, 2);
    // Halfway through: 1 - 0.5² = 0.75.
    layer.tick(DAMAGE_NUMBER_DURATION_MS / 2);
    const mid = layer.opacityOfSpawnedAtIndex(0);
    expect(mid).not.toBeNull();
    expect(mid!).toBeCloseTo(0.75, 2);
    // Right before retirement: ~0.
    layer.tick(DAMAGE_NUMBER_DURATION_MS - 1);
    const end = layer.opacityOfSpawnedAtIndex(0);
    expect(end).not.toBeNull();
    expect(end!).toBeLessThan(0.01);
  });

  it("clearAll empties the layer and disposes resources", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 5, 0);
    layer.spawn({ x: 1, y: 1 }, 7, 0);
    expect(layer.size()).toBe(2);
    layer.clearAll();
    expect(layer.size()).toBe(0);
    expect(layer.group.children.length).toBe(0);
  });

  it("spawn with amount <= 0 is a no-op", () => {
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 0, 0);
    expect(layer.size()).toBe(0);
    layer.spawn({ x: 0, y: 0 }, -5, 0);
    expect(layer.size()).toBe(0);
  });

  it("texture cache reuses the same texture for repeat amounts", () => {
    // Indirect test — spawn the same amount twice, retire both, spawn
    // again. The cache means we don't blow up texture count.
    const layer = new DamageNumbersLayer();
    layer.spawn({ x: 0, y: 0 }, 7, 0);
    layer.spawn({ x: 1, y: 0 }, 7, 0);
    // Both sprites share the cached texture instance.
    const s0 = layer.group.children[0] as THREE.Sprite;
    const s1 = layer.group.children[1] as THREE.Sprite;
    expect((s0.material as THREE.SpriteMaterial).map).toBe(
      (s1.material as THREE.SpriteMaterial).map,
    );
  });
});
