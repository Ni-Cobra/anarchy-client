import { describe, expect, it } from "vitest";

import { ProjectileStore } from "../game/index.js";
import {
  IMPACT_PUFF_DURATION_MS,
  ProjectileLayer,
  dartYawFor,
} from "./projectile_layer.js";

const noLookup = () => null;

function pushSnap(
  store: ProjectileStore,
  id: number,
  x: number,
  y: number,
  nowMs: number,
): void {
  store.applySnapshots(
    [
      {
        id,
        kind: "poison-dart",
        x,
        y,
        target: { kind: "player", id: 99 },
      },
    ],
    nowMs,
  );
}

describe("ProjectileLayer.update", () => {
  it("spawns one mesh per live projectile", () => {
    const layer = new ProjectileLayer();
    const store = new ProjectileStore();
    pushSnap(store, 1, 3, 5, 1_000);
    layer.update(store, 1_000, noLookup);
    expect(layer.size()).toBe(1);
    layer.dispose();
  });

  it("retires the mesh when the projectile leaves the store", () => {
    const layer = new ProjectileLayer();
    const store = new ProjectileStore();
    pushSnap(store, 1, 3, 5, 1_000);
    layer.update(store, 1_000, noLookup);
    expect(layer.size()).toBe(1);
    store.remove(1);
    layer.update(store, 1_010, noLookup);
    expect(layer.size()).toBe(0);
    layer.dispose();
  });

  it("orients the dart along the target direction on the very first tick", () => {
    const layer = new ProjectileLayer();
    const store = new ProjectileStore();
    // Projectile at (0, 0); target sits 5 tiles east (no velocity yet).
    pushSnap(store, 1, 0, 0, 1_000);
    layer.update(store, 1_000, (kind, id) => {
      if (kind === "player" && id === 99) return { x: 5, y: 0 };
      return null;
    });
    const mesh = layer.group.children[0];
    expect(mesh).toBeDefined();
    // Target is east (+x), velocity is null → aim toward target dir
    // = (+5, 0); yaw = atan2(5, 0) = π/2.
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    layer.dispose();
  });

  it("orients the dart along its velocity vector once two snapshots arrive", () => {
    const layer = new ProjectileLayer();
    const store = new ProjectileStore();
    pushSnap(store, 1, 0, 0, 1_000);
    pushSnap(store, 1, 0.5, 0, 1_050);
    layer.update(store, 1_050, noLookup);
    const mesh = layer.group.children[0];
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    layer.dispose();
  });
});

describe("ProjectileLayer.spawnImpactPuff", () => {
  it("spawns particles that fade out by the end of the puff window", () => {
    const layer = new ProjectileLayer();
    const store = new ProjectileStore();
    layer.spawnImpactPuff(3, 5, 1_000);
    expect(layer.puffCount()).toBeGreaterThan(0);
    // Advance past the puff lifetime.
    layer.update(store, 1_000 + IMPACT_PUFF_DURATION_MS + 50, noLookup);
    expect(layer.puffCount()).toBe(0);
    layer.dispose();
  });
});

describe("dartYawFor", () => {
  it("returns 0 for a zero-length direction (defensive default)", () => {
    expect(dartYawFor(0, 0)).toBe(0);
  });

  it("points north (+y) at yaw π (since scene -z = north)", () => {
    expect(dartYawFor(0, 1)).toBeCloseTo(Math.PI);
  });

  it("points east (+x) at yaw π/2", () => {
    expect(dartYawFor(1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it("points south (-y) at yaw 0", () => {
    expect(dartYawFor(0, -1)).toBeCloseTo(0);
  });
});
