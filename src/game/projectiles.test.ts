import { describe, expect, it } from "vitest";

import {
  PROJECTILE_LERP_MS,
  ProjectileStore,
  projectileVelocity,
  sampleProjectilePosition,
  type ProjectileSnapshot,
} from "./projectiles.js";

function snap(
  id: number,
  x: number,
  y: number,
  targetId = 99,
): ProjectileSnapshot {
  return {
    id,
    kind: "poison-dart",
    x,
    y,
    target: { kind: "player", id: targetId },
  };
}

describe("ProjectileStore.applySnapshots", () => {
  it("seeds prev = current on first appearance", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    const state = store.get(1);
    expect(state).toBeDefined();
    expect(state!.prevX).toBe(3);
    expect(state!.prevY).toBe(5);
    expect(state!.x).toBe(3);
    expect(state!.y).toBe(5);
  });

  it("captures the previous snapshot's pos when a second tick arrives", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    store.applySnapshots([snap(1, 3.5, 5)], 1_050);
    const state = store.get(1)!;
    expect(state.prevX).toBe(3);
    expect(state.prevY).toBe(5);
    expect(state.x).toBe(3.5);
    expect(state.receivedMs).toBe(1_050);
  });

  it("drops projectiles missing from the latest snapshot set", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5), snap(2, 7, 8)], 1_000);
    expect(store.size()).toBe(2);
    store.applySnapshots([snap(2, 7.5, 8)], 1_050);
    expect(store.size()).toBe(1);
    expect(store.get(1)).toBeUndefined();
  });
});

describe("ProjectileStore.remove", () => {
  it("drops the projectile so the next iter skips it", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    store.remove(1);
    expect(store.size()).toBe(0);
  });

  it("is idempotent when the id is unknown", () => {
    const store = new ProjectileStore();
    store.remove(99);
    expect(store.size()).toBe(0);
  });
});

describe("ProjectileStore.subscribe", () => {
  it("fires on apply + remove + clear", () => {
    const store = new ProjectileStore();
    let count = 0;
    const off = store.subscribe(() => {
      count += 1;
    });
    store.applySnapshots([snap(1, 1, 1)], 1_000);
    expect(count).toBe(1);
    store.remove(1);
    expect(count).toBe(2);
    store.applySnapshots([snap(2, 2, 2)], 1_010);
    expect(count).toBe(3);
    store.clear();
    expect(count).toBe(4);
    off();
    store.applySnapshots([snap(3, 3, 3)], 1_020);
    expect(count).toBe(4);
  });
});

describe("sampleProjectilePosition", () => {
  it("returns the current position with no elapsed time on a fresh snapshot", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    expect(sampleProjectilePosition(store.get(1)!, 1_000)).toEqual({
      x: 3,
      y: 5,
    });
  });

  it("lerps half-way between prev and current at t=0.5", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 0, 0)], 1_000);
    store.applySnapshots([snap(1, 2, 4)], 1_050);
    const pos = sampleProjectilePosition(
      store.get(1)!,
      1_050 + PROJECTILE_LERP_MS / 2,
    );
    expect(pos.x).toBeCloseTo(1);
    expect(pos.y).toBeCloseTo(2);
  });

  it("clamps to current at t>=1", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 0, 0)], 1_000);
    store.applySnapshots([snap(1, 2, 4)], 1_050);
    const pos = sampleProjectilePosition(
      store.get(1)!,
      1_050 + 10_000,
    );
    expect(pos.x).toBe(2);
    expect(pos.y).toBe(4);
  });
});

describe("projectileVelocity", () => {
  it("returns null on a brand-new projectile (prev = current)", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    expect(projectileVelocity(store.get(1)!)).toBeNull();
  });

  it("returns the delta vector once a second snapshot lands", () => {
    const store = new ProjectileStore();
    store.applySnapshots([snap(1, 3, 5)], 1_000);
    store.applySnapshots([snap(1, 3.5, 5.5)], 1_050);
    const v = projectileVelocity(store.get(1)!)!;
    expect(v.dx).toBeCloseTo(0.5);
    expect(v.dy).toBeCloseTo(0.5);
  });
});
