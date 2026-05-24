import { describe, expect, it } from "vitest";

import { anarchy } from "../gen/anarchy.js";
import { SnapshotBuffer, World, type PlayerId } from "../game/index.js";
import {
  applyServerMessage,
  type LocalPlayerSink,
  type WireDeps,
} from "./wire.js";
import { applyPong, type PingSink } from "./wire_ping.js";

function makeSink(): { sink: PingSink; samples: number[] } {
  const samples: number[] = [];
  return {
    samples,
    sink: {
      setRttMs(rtt) {
        samples.push(rtt);
      },
    },
  };
}

function makeDeps(now: () => number): {
  deps: WireDeps;
  samples: number[];
} {
  const world = new World();
  const buffer = new SnapshotBuffer();
  let currentLocalId: PlayerId | null = null;
  const local: LocalPlayerSink = {
    setLocalPlayerId(id) {
      currentLocalId = id;
    },
    getLocalPlayerId() {
      return currentLocalId;
    },
  };
  const { sink, samples } = makeSink();
  const deps: WireDeps = { world, buffer, local, pingSink: sink, now };
  return { deps, samples };
}

function encodePong(
  clientTimeMs: number,
  serverTimeMs = clientTimeMs,
): anarchy.v1.ServerMessage {
  const bytes = anarchy.v1.ServerMessage.encode(
    anarchy.v1.ServerMessage.create({
      seq: 1,
      pong: { clientTimeMs, serverTimeMs },
    }),
  ).finish();
  return anarchy.v1.ServerMessage.decode(bytes);
}

describe("applyPong", () => {
  it("records RTT = now - clientTimeMs", () => {
    const { sink, samples } = makeSink();
    applyPong({ clientTimeMs: 1_000, serverTimeMs: 1_010 }, sink, 1_050);
    expect(samples).toEqual([50]);
  });

  it("matches the expected sample to ~50 ms when the client stamped now-50", () => {
    const { sink, samples } = makeSink();
    const now = 10_000;
    applyPong({ clientTimeMs: now - 50 }, sink, now);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toBeGreaterThanOrEqual(45);
    expect(samples[0]).toBeLessThanOrEqual(55);
  });

  it("ignores a sample with a negative RTT (clock skew defence)", () => {
    const { sink, samples } = makeSink();
    applyPong({ clientTimeMs: 2_000 }, sink, 1_000);
    expect(samples).toEqual([]);
  });

  it("is a no-op when no sink is wired", () => {
    expect(() =>
      applyPong({ clientTimeMs: 1_000 }, undefined, 1_050),
    ).not.toThrow();
  });

  it("normalises a Long-like clientTimeMs through toNumber", () => {
    const { sink, samples } = makeSink();
    applyPong(
      { clientTimeMs: { toNumber: () => 1_000 } as never },
      sink,
      1_042,
    );
    expect(samples).toEqual([42]);
  });
});

describe("applyServerMessage — Pong", () => {
  it("routes a top-level pong envelope into the ping sink", () => {
    const { deps, samples } = makeDeps(() => 5_000);
    applyServerMessage(encodePong(4_970), deps);
    expect(samples).toEqual([30]);
  });

  it("is a no-op when no pingSink is wired", () => {
    const world = new World();
    const buffer = new SnapshotBuffer();
    const local: LocalPlayerSink = {
      setLocalPlayerId: () => undefined,
      getLocalPlayerId: () => null,
    };
    const deps: WireDeps = { world, buffer, local, now: () => 1_000 };
    expect(() => applyServerMessage(encodePong(900), deps)).not.toThrow();
  });
});
