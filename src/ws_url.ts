/**
 * WebSocket endpoint resolution for the client entrypoint. Returns
 * `undefined` when no override applies, so the bootstrap falls back to its
 * own default (`ws://localhost:8080/ws`).
 *
 * Security: the URL-bar overrides (`?ws=`, `?server-port=`) are confined to
 * dev builds. In a production build a link of the form
 * `https://anarchy.example/?ws=wss://evil/ws` must not cause the bundle to
 * connect anywhere other than what the operator configured at build time
 * via `VITE_WS_URL` — otherwise the lobby would happily ship the user's
 * password to an attacker-controlled WebSocket (SECURITY-REVIEW H-1).
 *
 * `?server-port=` is gated the same way: a localhost-only port override is
 * still phishing-adjacent (a malicious local service can pose as the real
 * server on a non-default port) and production has no legitimate reason to
 * redirect to a different localhost port. The e2e Playwright spec that
 * uses `?server-port=` runs against `npm run dev`, so the gate stays open
 * there.
 *
 * No console warning when a production build drops a `?ws=` param — silent
 * is the safe default since an attacker can read the console.
 */
export function resolveWsUrl(query: URLSearchParams): string | undefined {
  if (import.meta.env.DEV) {
    const wsOverride = query.get("ws");
    if (wsOverride !== null) {
      return wsOverride;
    }
    const rawPort = query.get("server-port");
    if (rawPort !== null && /^\d+$/.test(rawPort)) {
      const port = Number.parseInt(rawPort, 10);
      if (port >= 1 && port <= 65535) {
        return `ws://localhost:${port}/ws`;
      }
    }
  }
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
