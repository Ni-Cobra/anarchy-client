import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWsUrl } from "./ws_url.js";

// Vitest stubs are scoped per test; restore after each so a left-behind
// DEV=false doesn't leak into unrelated specs (e.g. lobby tests) sharing
// this worker.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveWsUrl — dev gate (SECURITY-REVIEW H-1)", () => {
  it("ignores ?ws= override in production builds", () => {
    vi.stubEnv("DEV", false);
    expect(
      resolveWsUrl(new URLSearchParams("?ws=wss://evil/ws")),
    ).toBeUndefined();
  });

  it("honors ?ws= override in dev builds", () => {
    vi.stubEnv("DEV", true);
    expect(resolveWsUrl(new URLSearchParams("?ws=wss://x/y"))).toBe(
      "wss://x/y",
    );
  });

  // The phishing recap in task 430 covers ?ws=; ?server-port= is the same
  // class of vector (a hostile localhost service can pose as the real
  // server on a non-default port). Confine it to dev for the same reason.
  it("ignores ?server-port= in production builds", () => {
    vi.stubEnv("DEV", false);
    expect(
      resolveWsUrl(new URLSearchParams("?server-port=9090")),
    ).toBeUndefined();
  });

  it("honors ?server-port= in dev builds", () => {
    vi.stubEnv("DEV", true);
    expect(resolveWsUrl(new URLSearchParams("?server-port=9090"))).toBe(
      "ws://localhost:9090/ws",
    );
  });

  it("falls back to VITE_WS_URL when no query override applies (prod build)", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_WS_URL", "wss://operator.example/ws");
    expect(resolveWsUrl(new URLSearchParams(""))).toBe(
      "wss://operator.example/ws",
    );
  });

  it("VITE_WS_URL is also honored in dev when no query override is present", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_WS_URL", "wss://operator.example/ws");
    expect(resolveWsUrl(new URLSearchParams(""))).toBe(
      "wss://operator.example/ws",
    );
  });

  // In production, a `?ws=` param must not even shadow the operator's
  // VITE_WS_URL — the attacker would otherwise hand the user a link that
  // silently overrides the legit endpoint.
  it("?ws= in production does not shadow VITE_WS_URL", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_WS_URL", "wss://operator.example/ws");
    expect(resolveWsUrl(new URLSearchParams("?ws=wss://evil/ws"))).toBe(
      "wss://operator.example/ws",
    );
  });

  it("returns undefined when no override applies and VITE_WS_URL is unset", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_WS_URL", "");
    expect(resolveWsUrl(new URLSearchParams(""))).toBeUndefined();
  });
});
