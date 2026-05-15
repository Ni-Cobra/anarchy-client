import { test, expect } from "./test-shared";
import protobuf from "protobufjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Task 310 — server-authoritative time-of-day. Every `TickUpdate` carries
// a `time_of_day_seconds` scalar that the client folds into a day cycle.
// This spec pins:
//   1. The wire field is present and finite.
//   2. The value advances monotonically across ticks (the server adds
//      `TICK_DT_SECONDS = 0.05` per tick, so the gap between two ticks
//      separated by ~250 ms should be ≥ 0.2 s in steady state).

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(__dirname, "../proto/anarchy/v1/anarchy.proto");

const root = await protobuf.load(PROTO_PATH);
const ClientMessage = root.lookupType("anarchy.v1.ClientMessage");
const ServerMessage = root.lookupType("anarchy.v1.ServerMessage");

const WS_URL = "ws://localhost:8080/ws";

type Frame = { kind: "open" } | { kind: "msg"; data: Uint8Array } | { kind: "close"; code: number };

interface Socket {
  ws: WebSocket;
  frames: Frame[];
  next: (predicate: (f: Frame) => boolean, timeout?: number) => Promise<Frame>;
}

async function openSocket(timeoutMs = 5_000): Promise<Socket> {
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  const frames: Frame[] = [];
  const waiters: Array<{ predicate: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  const push = (f: Frame) => {
    frames.push(f);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(f)) {
        waiters[i].resolve(f);
        waiters.splice(i, 1);
      }
    }
  };

  ws.addEventListener("open", () => push({ kind: "open" }));
  ws.addEventListener("message", (ev) => {
    if (ev.data instanceof ArrayBuffer) push({ kind: "msg", data: new Uint8Array(ev.data) });
  });
  ws.addEventListener("close", (ev) => push({ kind: "close", code: ev.code }));

  function next(predicate: (f: Frame) => boolean, timeout = timeoutMs): Promise<Frame> {
    const existing = frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for frame")), timeout);
      waiters.push({
        predicate: (f) => {
          if (predicate(f)) {
            clearTimeout(timer);
            return true;
          }
          return false;
        },
        resolve,
      });
    });
  }

  await next((f) => f.kind === "open");
  return { ws, frames, next };
}

let helloSeq = 8000;
async function sendHello(s: Socket): Promise<void> {
  const bytes = ClientMessage.encode(
    ClientMessage.create({
      seq: helloSeq++,
      hello: {
        clientVersion: "anarchy-e2e",
        username: `clock-${helloSeq}`,
        colorIndex: 0,
        reconnect: false,
      },
    }),
  ).finish();
  s.ws.send(bytes);
}

function readTimeOfDay(frame: Extract<Frame, { kind: "msg" }>): number | null {
  const msg = ServerMessage.decode(frame.data).toJSON() as {
    tickUpdate?: { timeOfDaySeconds?: number };
  };
  if (!msg.tickUpdate) return null;
  const raw = msg.tickUpdate.timeOfDaySeconds;
  return typeof raw === "number" ? raw : null;
}

test("TickUpdate carries a finite time_of_day_seconds and it advances across ticks", async () => {
  test.setTimeout(10_000);

  const a = await openSocket();
  await sendHello(a);

  // Wait for the first TickUpdate (will land right after the welcome).
  const first = (await a.next((f) => {
    if (f.kind !== "msg") return false;
    return readTimeOfDay(f) !== null;
  })) as Extract<Frame, { kind: "msg" }>;
  const t0 = readTimeOfDay(first);
  expect(t0).not.toBeNull();
  expect(Number.isFinite(t0!)).toBe(true);

  // Wait at least 250 ms of real time, then look for a tick whose value
  // is strictly greater than the first sample. With TICK_DT_SECONDS =
  // 0.05 s and a 20 Hz tick, ~5 ticks land in 250 ms, so the gap should
  // comfortably exceed 0.2 s.
  await new Promise((r) => setTimeout(r, 300));
  const later = (await a.next((f) => {
    if (f.kind !== "msg") return false;
    const t = readTimeOfDay(f);
    return t !== null && t > t0! + 0.2;
  })) as Extract<Frame, { kind: "msg" }>;
  const t1 = readTimeOfDay(later);
  expect(t1).not.toBeNull();
  expect(t1! > t0!).toBe(true);
  // Sanity-check the gap is in the expected ballpark — between the two
  // samples a few hundred ms apart, the server should have advanced the
  // clock by at least 0.2 s and at most a few seconds (the ws / runner
  // can be slow but never *that* slow).
  expect(t1! - t0!).toBeGreaterThanOrEqual(0.2);
  expect(t1! - t0!).toBeLessThan(5);

  a.ws.close();
});
