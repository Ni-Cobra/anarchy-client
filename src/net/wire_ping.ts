/**
 * `Pong` handler. The client emits a `Ping { client_time_ms }`
 * on `connection.ts::pingTimer` every `PING_INTERVAL_MS`; the server
 * echoes back a `Pong` carrying the same `client_time_ms`. Subtracting it
 * from the receive wall-clock yields the round-trip time, which the
 * coords HUD renders as a "ping XX ms" line.
 *
 * The handler is a thin translation step — it only forwards the latest
 * sample into the supplied sink. Bootstrap owns the holder; tests
 * substitute any sink they want.
 */
import { anarchy } from "../gen/anarchy.js";

import { toNumber } from "./wire_codec.js";

/**
 * Sink the wire bridge writes the latest measured RTT into. Bootstrap
 * mounts a mutable holder here so the coords HUD can read the current
 * sample from its per-frame loop without subscribing to wire events.
 */
export interface PingSink {
  setRttMs(rttMs: number): void;
}

export function applyPong(
  wire: anarchy.v1.IPong,
  sink: PingSink | undefined,
  nowMs: number,
): void {
  if (!sink) return;
  const clientTimeMs = toNumber(wire.clientTimeMs);
  const rtt = nowMs - clientTimeMs;
  if (rtt < 0) return;
  sink.setRttMs(rtt);
}
