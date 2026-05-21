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

/**
 * Bottom offset (px) added to the chat overlay while the task-090 chat
 * input is open, so the active line lifts above the input field instead
 * of being covered by it.
 */
export const CHAT_HUD_INPUT_SHIFT_PX = 36;

/**
 * Bottom offset (px) for the chat overlay baseline. Sized so the
 * lowest chat row clears the bottom-center hotbar (anchored at
 * `bottom: 16px`, ~60px tall) with comfortable headroom on a typical
 * 1440×900 viewport.
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
  }
  #${ROOT_ID}.shifted { bottom: ${CHAT_HUD_BOTTOM_PX + CHAT_HUD_INPUT_SHIFT_PX}px; }
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
   * Task 090: bump the overlay's bottom anchor up by
   * [`CHAT_HUD_INPUT_SHIFT_PX`] while the chat input is open so the
   * lowest line clears the input field. Idempotent.
   */
  setShifted(shifted: boolean): void;
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
    setShifted: (shifted: boolean): void => {
      root.classList.toggle("shifted", shifted);
    },
    unmount: () => {
      root.remove();
    },
  };
}
