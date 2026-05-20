/**
 * Chat input field (task 090).
 *
 * Bottom-left single-line `<input>` mounted alongside the chat HUD. Hidden
 * by default; the bootstrap-level `Enter` keybinding calls `open()`,
 * which reveals the field, attaches an input gate so movement / hotbar /
 * place keys don't fire while typing, and focuses the input. Inside the
 * field, `Enter` ships the trimmed body via `onSubmit` and closes;
 * `Escape` closes without sending.
 *
 * Per task 090 the client does NOT render locally — the server is the
 * source of truth and bounces the line back through `ChatMessage`. This
 * module therefore only sends; rendering still flows through `chat_hud`.
 *
 * `onOpenChange` is the seam for shifting the chat HUD up while the
 * input is visible so the lowest chat line lifts above the field.
 */

import { attachInputGate, type InputGateHandle } from "./input_gate.js";

const STYLE_ID = "anarchy-chat-input-style";
const ROOT_ID = "anarchy-chat-input-root";
const INPUT_ID = "anarchy-chat-input-field";

/**
 * Soft cap on the body length the input element accepts (mirrors the
 * server's `CHAT_BODY_MAX_LEN`). The server re-validates and silently
 * drops over-cap bodies; the client cap is just an affordance.
 */
export const CHAT_INPUT_MAX_LEN = 256;

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 8500;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${ROOT_ID}.hidden { display: none; }
  #${ROOT_ID} input {
    width: 360px;
    max-width: 50vw;
    padding: 6px 10px;
    background: rgba(10, 14, 20, 0.85);
    color: #f0f0f0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  #${ROOT_ID} input:focus {
    border-color: rgba(255, 255, 255, 0.42);
  }
`;

export interface ChatInputOptions {
  /** Called when the user submits a non-empty trimmed body. */
  onSubmit: (body: string) => void;
  /**
   * Fired whenever the input toggles between open and closed. The
   * bootstrap wires this to `chatHud.setShifted` so the overlay lifts
   * up while the field is visible.
   */
  onOpenChange?: (open: boolean) => void;
  /** Override the soft length cap (default [`CHAT_INPUT_MAX_LEN`]). */
  maxLength?: number;
}

export interface ChatInputHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Test affordance: read the field value without poking the DOM. */
  currentBody(): string;
  /** Test affordance: write the field value without simulating typing. */
  setBody(body: string): void;
  unmount(): void;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountChatInput(opts: ChatInputOptions): ChatInputHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.classList.add("hidden");

  const input = document.createElement("input");
  input.id = INPUT_ID;
  input.type = "text";
  input.maxLength = opts.maxLength ?? CHAT_INPUT_MAX_LEN;
  input.autocomplete = "off";
  input.spellcheck = false;
  root.appendChild(input);

  document.body.appendChild(root);

  let gate: InputGateHandle | null = null;
  let openFlag = false;

  const close = (): void => {
    if (!openFlag) return;
    openFlag = false;
    root.classList.add("hidden");
    input.value = "";
    input.blur();
    if (gate !== null) {
      gate.detach();
      gate = null;
    }
    opts.onOpenChange?.(false);
  };

  const submit = (): void => {
    const body = input.value.trim();
    if (body.length > 0) {
      opts.onSubmit(body);
    }
    close();
  };

  // Target-phase listener on the input element. We call
  // `stopPropagation()` for Enter / Escape so the same keydown can't
  // bubble back up to the bootstrap-level Enter handler and re-open the
  // field immediately after we close it (the input gate is detached on
  // close, so it wouldn't catch the bubble).
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.stopPropagation();
      ev.preventDefault();
      submit();
      return;
    }
    if (ev.key === "Escape") {
      ev.stopPropagation();
      ev.preventDefault();
      close();
      return;
    }
  });

  const open = (): void => {
    if (openFlag) return;
    openFlag = true;
    root.classList.remove("hidden");
    if (gate === null) {
      gate = attachInputGate(root);
    }
    input.focus();
    opts.onOpenChange?.(true);
  };

  return {
    open,
    close,
    isOpen: () => openFlag,
    currentBody: () => input.value,
    setBody: (body: string): void => {
      input.value = body;
    },
    unmount: () => {
      if (gate !== null) gate.detach();
      root.remove();
    },
  };
}
