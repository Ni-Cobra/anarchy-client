/**
 * Chat overlay — task 080 / 100.
 *
 * Bottom-left transparent overlay. The server owns the chat scrollback as
 * a 20-message rolling buffer (task 100) and re-broadcasts the full
 * snapshot every time it changes; the HUD replaces its DOM rows from
 * each snapshot via [`ChatHudHandle.replaceHistory`]. There is no
 * per-message append wire path — the snapshot is the wire shape.
 *
 * The HUD keeps a per-line "first seen" wall-clock so timestamps don't
 * jump when the server re-ships a snapshot that already contains a line
 * the HUD has rendered. Identity is `kind|sender|body` (a tuple hash —
 * collisions are inconsequential because the timestamp is display-only).
 * Lines new to a snapshot are stamped at receive time; lines that fall
 * out of the snapshot (the server evicted the oldest entry past
 * `CHAT_HISTORY_MAX = 20`) drop out of the DOM and out of the identity
 * map together.
 *
 * Admin-kind rows render bold + warm tint; player-kind rows render
 * plain. Every row is prefixed with a dim-gray `HH:MM:SS` local
 * wall-clock time captured the first time the line was observed by this
 * HUD. A late-joining client will stamp every replayed message at its
 * join time — that's acceptable because timestamps are display-only
 * (the server does not ship per-message timestamps, per task 100).
 *
 * The root is a bottom-anchored flex column with two children: the
 * message list, then an empty input slot exposed via
 * [`ChatHudHandle.inputHost`]. `chat_input` mounts into that slot so the
 * typing field always sits directly below the last message, sharing the
 * same bottom anchor — focusing it never shifts the message stack
 * (task 010).
 *
 * Network-free; pure DOM. The wire bridge calls
 * [`ChatHudHandle.replaceHistory`] for every `ChatHistory` envelope it
 * sees.
 */

import { paletteColorHex } from "../game/index.js";

const STYLE_ID = "anarchy-chat-hud-style";
const ROOT_ID = "anarchy-chat-root";
const LIST_ID = "anarchy-chat-list";
const INPUT_HOST_ID = "anarchy-chat-input-host";

/**
 * Render-side safety belt for the message list. The server caps the
 * history at 20 (task 100, `CHAT_HISTORY_MAX`), so this trim should
 * never actually fire — keep it as a defensive cap in case a future
 * server bump grows the buffer without coordinating with the client.
 */
export const CHAT_HUD_MAX_LINES = 50;

/**
 * Warm tint applied to Admin-kind lines. Single constant per task brief —
 * picked to read clearly against the dark UI chrome without being neon.
 */
export const CHAT_HUD_ADMIN_COLOR = "#ffb347";

/**
 * Task 120: neutral grey applied to System-kind lines (server lifecycle
 * events — `Player <name> joined / disconnected / registered / killed`).
 * Read against the dark UI chrome and deliberately quieter than the
 * Admin warm tint so a flurry of join/leave events doesn't drown out
 * actual chat. Combined with `font-style: italic` via the
 * `anarchy-chat-system` class.
 */
export const CHAT_HUD_SYSTEM_COLOR = "#888";

/**
 * Dim gray applied to the `HH:MM:SS` timestamp prefix on each row.
 * Combined with [`CHAT_HUD_TIME_OPACITY`] so the timestamp recedes
 * against the sender + body without dropping below legibility.
 */
export const CHAT_HUD_TIME_COLOR = "#888";
export const CHAT_HUD_TIME_OPACITY = 0.55;

/**
 * Bottom offset (px) for the chat overlay baseline. Sized so the input
 * field (last child of the root column) clears the bottom-center hotbar
 * (anchored at `bottom: 16px`, ~60px tall) with comfortable headroom on
 * a typical 1440×900 viewport.
 */
const CHAT_HUD_BOTTOM_PX = 90;

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    left: 12px;
    bottom: ${CHAT_HUD_BOTTOM_PX}px;
    z-index: 8400;
    pointer-events: none;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
    max-width: 45vw;
    user-select: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  #${ROOT_ID}.hidden { display: none; }
  #${LIST_ID} {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  #${LIST_ID} li {
    font-size: 15px;
    line-height: 1.3;
    word-break: break-word;
  }
  #${LIST_ID} li.anarchy-chat-admin {
    font-weight: 700;
    color: ${CHAT_HUD_ADMIN_COLOR};
  }
  /* Task 120: System-kind lines (server lifecycle events). Grey
     italic body, no sender prefix — the entire row reads as a
     quiet status line distinct from chat. */
  #${LIST_ID} li.anarchy-chat-system {
    color: ${CHAT_HUD_SYSTEM_COLOR};
    font-style: italic;
  }
  #${LIST_ID} .anarchy-chat-time {
    color: ${CHAT_HUD_TIME_COLOR};
    opacity: ${CHAT_HUD_TIME_OPACITY};
    font-weight: 400;
  }
  /* Task 110: italicize the sender label on player-kind lines whose
     sender was unregistered at send time (a guest). The palette also
     reuses the same dark chrome the in-world nametags sit on, so the
     palette colors are already legible without a per-color luminance
     adjustment — readability follows that precedent. */
  #${LIST_ID} li .anarchy-chat-sender-guest {
    font-style: italic;
  }
`;

/**
 * Chat-line kind in client-side form. Mirrors
 * `proto.v1.ChatMessage.Kind` minus the proto3 `UNSPECIFIED = 0`
 * sentinel — the wire bridge filters that out before passing lines to
 * the HUD. `system` covers task 120's server-generated lifecycle /
 * combat lines (`Player <name> joined / disconnected / registered /
 * killed`).
 */
export type ChatKind = "player" | "admin" | "system";

export interface ChatLine {
  kind: ChatKind;
  sender: string;
  body: string;
  /**
   * Task 110: sender's palette index at the time the line was sent
   * (`0` for admin / system lines, which the HUD styles via `kind`
   * rather than by palette color). Frozen at send time on the server.
   */
  colorIndex: number;
  /**
   * Task 110: `true` iff the sender had a registered account at send
   * time. The HUD italicizes player-kind rows whose sender is a guest
   * (unregistered). Frozen at send time on the server.
   */
  registered: boolean;
}

export interface ChatHudHandle {
  /**
   * Replace the rendered scrollback with `messages`, ordered oldest →
   * newest. Lines whose identity (`kind|sender|body`) is already in
   * the rendered set keep their first-seen timestamp; new lines are
   * stamped at the time of this call; previously-rendered lines that
   * fell out of the snapshot drop from the DOM.
   */
  replaceHistory(messages: readonly ChatLine[]): void;
  /** Test affordance: current line count. */
  size(): number;
  /**
   * Slot directly below the message list where `chat_input` mounts its
   * field. Stable across the HUD's lifetime — the input always sits
   * here so focusing it does not displace any messages.
   */
  inputHost(): HTMLElement;
  unmount(): void;
}

/**
 * Format a Date as zero-padded `HH:MM:SS` in local wall-clock time.
 * Exported for unit tests; the runtime uses `new Date()` at append time.
 */
export function formatTimestamp(d: Date): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

/**
 * Identity hash for the timestamp-stability map. Two lines that share
 * `kind|sender|body` collide deliberately — chat is display-only, the
 * worst-case is a second identical message inheriting the first one's
 * timestamp. That's preferable to running a separate monotonic
 * sequence the server doesn't ship.
 */
function lineKey(line: ChatLine): string {
  return `${line.kind}\x00${line.sender}\x00${line.body}`;
}

export function mountChatHud(deps?: {
  now?: () => Date;
}): ChatHudHandle {
  injectStyle();

  const now = deps?.now ?? (() => new Date());

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "Chat");

  const list = document.createElement("ul");
  list.id = LIST_ID;
  root.appendChild(list);

  const inputHost = document.createElement("div");
  inputHost.id = INPUT_HOST_ID;
  root.appendChild(inputHost);

  document.body.appendChild(root);

  // Per-line first-seen timestamp, keyed by `lineKey`. A line that
  // re-appears in a subsequent snapshot keeps its original timestamp;
  // a line that falls out of the snapshot is purged here too.
  const stamps = new Map<string, string>();

  function buildRow(line: ChatLine, ts: string): HTMLLIElement {
    const li = document.createElement("li");
    switch (line.kind) {
      case "admin":
        li.classList.add("anarchy-chat-admin");
        break;
      case "system":
        li.classList.add("anarchy-chat-system");
        break;
      default:
        li.classList.add("anarchy-chat-player");
        break;
    }
    // textContent everywhere so user-supplied content can't smuggle
    // in HTML; styling is class-driven.
    const timeSpan = document.createElement("span");
    timeSpan.className = "anarchy-chat-time";
    timeSpan.textContent = `${ts} `;
    li.appendChild(timeSpan);
    // Task 120: System-kind lines render `[hh:mm:ss] <body>` — no
    // `<sender>:` prefix because the line is server-authored and
    // the body already names whichever player the event is about.
    if (line.kind === "system") {
      const bodySpan = document.createElement("span");
      bodySpan.className = "anarchy-chat-body";
      bodySpan.textContent = line.body;
      li.appendChild(bodySpan);
      return li;
    }
    const senderSpan = document.createElement("span");
    senderSpan.className = "anarchy-chat-sender";
    // Task 110: per-message sender styling. Admin lines keep their
    // existing class-driven bold + warm-tint styling (`color`
    // override would clobber the warm tint, italic is reserved for
    // guest player lines), so we only touch player-kind rows here.
    if (line.kind === "player") {
      const hex = paletteColorHex(line.colorIndex);
      // `paletteColorHex` returns an integer suitable for THREE.Color;
      // stringify as `#rrggbb` for the inline CSS `color` value.
      senderSpan.style.color = `#${hex.toString(16).padStart(6, "0")}`;
      if (!line.registered) {
        senderSpan.classList.add("anarchy-chat-sender-guest");
      }
    }
    senderSpan.textContent = `${line.sender}: `;
    const bodySpan = document.createElement("span");
    bodySpan.className = "anarchy-chat-body";
    bodySpan.textContent = line.body;
    li.appendChild(senderSpan);
    li.appendChild(bodySpan);
    return li;
  }

  function replaceHistory(messages: readonly ChatLine[]): void {
    // Trim to the render cap; the server caps at 20 so this branch
    // never fires under normal operation but guards a future bump.
    const trimmed =
      messages.length > CHAT_HUD_MAX_LINES
        ? messages.slice(messages.length - CHAT_HUD_MAX_LINES)
        : messages;

    // Compute the new identity set; anything in `stamps` not in this
    // set is being evicted by the server's rolling buffer and should
    // drop from the map too so the map can't grow unbounded.
    const nextKeys = new Set<string>();
    for (const line of trimmed) nextKeys.add(lineKey(line));
    for (const k of Array.from(stamps.keys())) {
      if (!nextKeys.has(k)) stamps.delete(k);
    }

    // Build (or reuse stamps for) every row, then swap the DOM in one
    // shot. Building first means a render error on row N doesn't leave
    // the list in a torn state — though textContent-only construction
    // makes that essentially impossible.
    const nowStr = formatTimestamp(now());
    const rows: HTMLLIElement[] = [];
    for (const line of trimmed) {
      const k = lineKey(line);
      let ts = stamps.get(k);
      if (ts === undefined) {
        ts = nowStr;
        stamps.set(k, ts);
      }
      rows.push(buildRow(line, ts));
    }

    list.replaceChildren(...rows);
  }

  return {
    replaceHistory,
    size: () => list.children.length,
    inputHost: () => inputHost,
    unmount: () => {
      root.remove();
    },
  };
}
