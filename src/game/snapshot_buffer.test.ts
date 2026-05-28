import { describe, expect, it } from "vitest";

import { SnapshotBuffer } from "./snapshot_buffer.js";

describe("SnapshotBuffer", () => {
  it("returns null for unknown ids", () => {
    const buf = new SnapshotBuffer();
    expect(buf.sample(1, 100)).toBeNull();
  });

  it("returns the only sample when there's just one", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 5, 7, 1000);
    expect(buf.sample(1, 500)).toEqual({ x: 5, y: 7 });
    expect(buf.sample(1, 1000)).toEqual({ x: 5, y: 7 });
    expect(buf.sample(1, 9999)).toEqual({ x: 5, y: 7 });
  });

  it("clamps to the oldest sample for queries before the buffered range", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 1, 0, 1100);
    expect(buf.sample(1, 500)).toEqual({ x: 0, y: 0 });
  });

  it("clamps to the newest sample (no extrapolation past the latest snapshot)", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 2, 0, 1100);
    expect(buf.sample(1, 2000)).toEqual({ x: 2, y: 0 });
  });

  it("linearly interpolates between bracketing samples", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 5, 2, 1100);
    const mid = buf.sample(1, 1050);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(2.5);
    expect(mid!.y).toBeCloseTo(1);
  });

  it("walks past intermediate samples to find the right bracketing pair", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 3, 0, 1100);
    buf.push(1, 3, 3, 1200);
    buf.push(1, 6, 3, 1300);
    const between = buf.sample(1, 1250);
    expect(between!.x).toBeCloseTo(4.5);
    expect(between!.y).toBeCloseTo(3);
  });

  it("drops the oldest sample once capacity is reached", () => {
    const buf = new SnapshotBuffer(3);
    buf.push(1, 0, 0, 100);
    buf.push(1, 1, 0, 200);
    buf.push(1, 2, 0, 300);
    buf.push(1, 3, 0, 400);
    expect(buf.samplesOf(1).map((s) => s.timeMs)).toEqual([200, 300, 400]);
    // Querying before the new oldest clamps to that new oldest.
    expect(buf.sample(1, 50)).toEqual({ x: 1, y: 0 });
  });

  it("overwrites the latest sample on a duplicate / out-of-order timestamp", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 9, 9, 1000);
    expect(buf.samplesOf(1)).toHaveLength(1);
    expect(buf.sample(1, 1000)).toEqual({ x: 9, y: 9 });

    buf.push(1, 1, 1, 1100);
    buf.push(1, 7, 7, 900);
    expect(buf.samplesOf(1)).toHaveLength(2);
    expect(buf.sample(1, 1100)).toEqual({ x: 7, y: 7 });
  });

  it("snaps to the newer sample when bracketing samples are a teleport apart", () => {
    // A respawn jumps the player from far out (50,50) back to spawn (0,0)
    // between two consecutive ticks. Without snap detection the renderer
    // would lerp ~71 units across the world over the interpolation window
    // and drag the camera along with it.
    const buf = new SnapshotBuffer();
    buf.push(1, 50, 50, 1000);
    buf.push(1, 0, 0, 1050);
    const mid = buf.sample(1, 1025);
    expect(mid).toEqual({ x: 0, y: 0 });
  });

  it("still interpolates between samples that are within the teleport threshold", () => {
    // Movement at ~the snap threshold (8 units) still linearly interpolates.
    // Picking 4 units across the span keeps us comfortably under the gate.
    const buf = new SnapshotBuffer();
    buf.push(1, 0, 0, 1000);
    buf.push(1, 4, 0, 1100);
    const mid = buf.sample(1, 1050);
    expect(mid!.x).toBeCloseTo(2);
    expect(mid!.y).toBeCloseTo(0);
  });

  it("drop() removes per-id history without affecting other ids", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 1, 1, 100);
    buf.push(2, 2, 2, 100);
    buf.drop(1);
    expect(buf.sample(1, 100)).toBeNull();
    expect(buf.sample(2, 100)).toEqual({ x: 2, y: 2 });
  });

  it("clear() wipes everything", () => {
    const buf = new SnapshotBuffer();
    buf.push(1, 1, 1, 100);
    buf.push(2, 2, 2, 100);
    buf.clear();
    expect(buf.sample(1, 100)).toBeNull();
    expect(buf.sample(2, 100)).toBeNull();
  });
});
