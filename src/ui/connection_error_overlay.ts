/**
 * Full-screen "connection lost" overlay — task 190.
 *
 * Fires from `bootstrap/session.ts` when the WebSocket transport drops
 * for a reason that isn't a structured lobby reject and isn't a caller-
 * initiated disconnect: a connection-refused at boot, a server-side
 * close mid-session, or the heartbeat-timeout path. The overlay paints
 * a full-screen semi-opaque backdrop with a centered card and a single
 * Reload button; the button calls `window.location.reload()` so the
 * player drops back through the lobby like any fresh connect. There is
 * deliberately no auto-retry — the task's source conversation decided a
 * manual, predictable reload was preferable to silent reconnect plumbing.
 *
 * Input is suppressed while the overlay is mounted: the caller wraps the
 * overlay root in `attachInputGate` so keys, mouse, wheel, and context
 * events targeted at the overlay never bubble out to the bootstrap
 * `window` listeners that drive movement / hotbar / break / place.
 */

import { attachInputGate, type InputGateHandle } from "./input_gate.js";

const STYLE_ID = "anarchy-connection-error-overlay-style";
const ROOT_ID = "anarchy-connection-error-overlay";
const BUTTON_ID = "anarchy-connection-error-reload";

/** Title rendered above the body copy. */
export const CONNECTION_ERROR_TITLE = "Connection lost";
/** Body copy below the title. */
export const CONNECTION_ERROR_BODY =
  "The server is unreachable. Reload to return to the lobby.";
/** Label on the single primary button. */
export const CONNECTION_ERROR_RELOAD_LABEL = "Reload";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    inset: 0;
    z-index: 9995;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(8, 12, 16, 0.78);
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
  }
  #${ROOT_ID}.visible { display: flex; }
  #${ROOT_ID} .panel {
    background: rgba(20, 24, 30, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 28px 32px;
    min-width: 320px;
    max-width: 90vw;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    text-align: center;
  }
  #${ROOT_ID} h2 {
    margin: 0 0 12px 0;
    font-size: 22px;
    font-weight: 700;
    color: #ff6060;
    letter-spacing: 0.5px;
  }
  #${ROOT_ID} .body {
    font-size: 14px;
    color: #c8d0d8;
    margin: 0 0 20px 0;
    line-height: 1.45;
  }
  #${ROOT_ID} button {
    padding: 10px 22px;
    border: none;
    border-radius: 5px;
    background: #4a8fee;
    color: white;
    font-weight: 600;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
  }
  #${ROOT_ID} button:hover { background: #5aa0ff; }
  #${ROOT_ID} button:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
  }
`;

export interface ConnectionErrorOverlayHandle {
  /**
   * Mount the overlay into the DOM. Idempotent — repeated calls re-show
   * the same overlay without re-attaching listeners. The transport-drop
   * source fires once per connection, but a defensive idempotent show
   * keeps us safe if any future caller re-triggers.
   */
  show(): void;
  /** True iff the overlay is currently visible. Exposed for tests. */
  isVisible(): boolean;
  /** Tear down DOM + listeners. Called from the session teardown list. */
  unmount(): void;
}

/**
 * Optional dependency seam. The reload action defaults to
 * `window.location.reload()`; tests inject a spy.
 */
export interface ConnectionErrorOverlayOptions {
  onReload?: () => void;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountConnectionErrorOverlay(
  options: ConnectionErrorOverlayOptions = {},
): ConnectionErrorOverlayHandle {
  injectStyle();

  const onReload = options.onReload ?? (() => window.location.reload());

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", CONNECTION_ERROR_TITLE);

  const panel = document.createElement("div");
  panel.className = "panel";

  const title = document.createElement("h2");
  title.textContent = CONNECTION_ERROR_TITLE;
  panel.appendChild(title);

  const body = document.createElement("p");
  body.className = "body";
  body.textContent = CONNECTION_ERROR_BODY;
  panel.appendChild(body);

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = CONNECTION_ERROR_RELOAD_LABEL;
  button.addEventListener("click", () => onReload());
  panel.appendChild(button);

  root.appendChild(panel);
  document.body.appendChild(root);

  let gate: InputGateHandle | null = null;
  let unmounted = false;

  return {
    show: () => {
      if (unmounted) return;
      if (root.classList.contains("visible")) return;
      root.classList.add("visible");
      gate = attachInputGate(root);
      queueMicrotask(() => button.focus());
    },
    isVisible: () => root.classList.contains("visible"),
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      gate?.detach();
      gate = null;
      root.remove();
    },
  };
}
