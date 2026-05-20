/**
 * Chat overlay — task 080.
 *
 * Bottom-left transparent overlay. Each `ChatMessage` envelope appended in
 * arrival order; recent lines drift upward as new ones arrive (newest at
 * the bottom). Admin-kind lines render bold + warm tint; player-kind lines
 * render plain. No open/close gating, no fade in this task (task 090 may
 * revisit fade). No scrollback — the overlay caps the visible row count
 * and trims oldest as new ones arrive.
 *
 * Network-free; pure DOM. The wire bridge calls [`ChatHudHandle.append`]
 * for every `ChatMessage` envelope it sees.
 */

const STYLE_ID = "anarchy-chat-hud-style";
const ROOT_ID = "anarchy-chat-root";
const LIST_ID = "anarchy-chat-list";

/** Maximum lines kept in the DOM. Older lines are trimmed off the top. */
export const CHAT_HUD_MAX_LINES = 50;

/**
 * Warm tint applied to Admin-kind lines. Single constant per task brief —
 * picked to read clearly against the dark UI chrome without being neon.
 */
export const CHAT_HUD_ADMIN_COLOR = "#ffb347";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 8400;
    pointer-events: none;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
    max-width: 40vw;
    user-select: none;
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
    font-size: 13px;
    line-height: 1.3;
    word-break: break-word;
  }
  #${LIST_ID} li.anarchy-chat-admin {
    font-weight: 700;
    color: ${CHAT_HUD_ADMIN_COLOR};
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
  unmount(): void;
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

  document.body.appendChild(root);

  const append = (line: ChatLine): void => {
    const li = document.createElement("li");
    if (line.kind === "admin") {
      li.classList.add("anarchy-chat-admin");
    } else {
      li.classList.add("anarchy-chat-player");
    }
    // Render as `<sender>: <body>`. We deliberately use textContent
    // for both halves so user-supplied content can't smuggle in HTML;
    // the bold/tint styling is class-driven, not body-driven.
    const senderSpan = document.createElement("span");
    senderSpan.className = "anarchy-chat-sender";
    senderSpan.textContent = `${line.sender}: `;
    const bodySpan = document.createElement("span");
    bodySpan.className = "anarchy-chat-body";
    bodySpan.textContent = line.body;
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
    unmount: () => {
      root.remove();
    },
  };
}
