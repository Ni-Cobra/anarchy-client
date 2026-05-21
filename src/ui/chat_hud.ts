/**
 * Chat overlay — task 080.
 *
 * Bottom-left transparent overlay. Each `ChatMessage` envelope appended in
 * arrival order; recent lines drift upward as new ones arrive (newest at
 * the bottom). Admin-kind lines render bold + warm tint; player-kind lines
 * render plain. Every row is prefixed with a dim-gray `HH:MM:SS` local
 * wall-clock time captured at append (arrival) so it can't drift if the
 * row is re-styled later. No open/close gating, no fade in this task
 * (task 090 may revisit fade). No scrollback — the overlay caps the
 * visible row count and trims oldest as new ones arrive.
 *
 * The root is a bottom-anchored flex column with two children: the
 * message list, then an empty input slot exposed via
 * [`ChatHudHandle.inputHost`]. `chat_input` mounts into that slot so the
 * typing field always sits directly below the last message, sharing the
 * same bottom anchor — focusing it never shifts the message stack
 * (task 010).
 *
 * Network-free; pure DOM. The wire bridge calls [`ChatHudHandle.append`]
 * for every `ChatMessage` envelope it sees.
 */

const STYLE_ID = "anarchy-chat-hud-style";
const ROOT_ID = "anarchy-chat-root";
const LIST_ID = "anarchy-chat-list";
const INPUT_HOST_ID = "anarchy-chat-input-host";

/** Maximum lines kept in the DOM. Older lines are trimmed off the top. */
export const CHAT_HUD_MAX_LINES = 50;

/**
 * Warm tint applied to Admin-kind lines. Single constant per task brief —
 * picked to read clearly against the dark UI chrome without being neon.
 */
export const CHAT_HUD_ADMIN_COLOR = "#ffb347";

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
  #${LIST_ID} .anarchy-chat-time {
    color: ${CHAT_HUD_TIME_COLOR};
    opacity: ${CHAT_HUD_TIME_OPACITY};
    font-weight: 400;
  }
`;

/**
 * Chat-line kind in client-side form. Mirrors
 * `proto.v1.ChatMessage.Kind` minus the proto3 `UNSPECIFIED = 0`
 * sentinel — the wire bridge filters that out before calling
 * [`ChatHudHandle.append`].
 */
export type ChatKind = "player" | "admin";

export interface ChatLine {
  kind: ChatKind;
  sender: string;
  body: string;
}

export interface ChatHudHandle {
  /** Append one line to the overlay. Newest line sits at the bottom. */
  append(line: ChatLine): void;
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

export function mountChatHud(): ChatHudHandle {
  injectStyle();

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

  const append = (line: ChatLine): void => {
    const li = document.createElement("li");
    if (line.kind === "admin") {
      li.classList.add("anarchy-chat-admin");
    } else {
      li.classList.add("anarchy-chat-player");
    }
    // Render as `HH:MM:SS <sender>: <body>`. Timestamp is captured at
    // append time (arrival, not render) so it doesn't drift if the row
    // is re-styled later. textContent everywhere so user-supplied
    // content can't smuggle in HTML; styling is class-driven.
    const timeSpan = document.createElement("span");
    timeSpan.className = "anarchy-chat-time";
    timeSpan.textContent = `${formatTimestamp(new Date())} `;
    const senderSpan = document.createElement("span");
    senderSpan.className = "anarchy-chat-sender";
    senderSpan.textContent = `${line.sender}: `;
    const bodySpan = document.createElement("span");
    bodySpan.className = "anarchy-chat-body";
    bodySpan.textContent = line.body;
    li.appendChild(timeSpan);
    li.appendChild(senderSpan);
    li.appendChild(bodySpan);
    list.appendChild(li);
    // Trim oldest lines off the top.
    while (list.children.length > CHAT_HUD_MAX_LINES) {
      list.removeChild(list.firstChild as ChildNode);
    }
  };

  return {
    append,
    size: () => list.children.length,
    inputHost: () => inputHost,
    unmount: () => {
      root.remove();
    },
  };
}
