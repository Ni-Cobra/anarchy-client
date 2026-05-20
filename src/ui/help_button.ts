/**
 * Bottom-right `?` button + global `H` / `F1` keybinding that toggle the
 * help dialog (task 110). Mounted once for the page lifetime — the help
 * needs to be reachable from the lobby as well as in-game, so this lives
 * above the per-session bootstrap in [`main.ts`] / [`bootstrap/index.ts`].
 *
 * Owns the open / closed state. The dialog itself is constructed lazily
 * each open via [`help_dialog.ts::showHelpDialog`]; on close the handle
 * is dropped so the next open builds a fresh modal — there is no idle
 * "hidden" dialog hanging around in the DOM.
 *
 * Keybindings dispatch in document-capture so they fire even when an
 * input-gated modal owns the bubble chain (the gate's document-bubble
 * `stopPropagation` would otherwise eat any keydown targeted inside a
 * gated subtree). The handler bails out when the active element is an
 * editable field — typing `h` in the chat input or any other `<input>` /
 * `<textarea>` / contenteditable element must produce a character, not
 * open the help.
 *
 * Pointer events on the button itself are stopped from propagating so a
 * click on the button doesn't double as a world-mousedown that the
 * bootstrap-level break / place handler would otherwise act on.
 */

import { showHelpDialog, type HelpDialogHandle } from "./help_dialog.js";

const STYLE_ID = "anarchy-help-button-style";
const ROOT_ID = "anarchy-help-button-root";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 8800;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${ROOT_ID} button {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(20, 24, 30, 0.45);
    color: rgba(240, 240, 240, 0.72);
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    line-height: 1;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  #${ROOT_ID} button:hover {
    background: rgba(40, 48, 56, 0.9);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.45);
  }
  #${ROOT_ID} button:focus { outline: none; }
`;

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function isEditableTarget(el: Element | null): boolean {
  if (el === null) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

export interface HelpHandle {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  unmount(): void;
}

export function mountHelp(): HelpHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open help");
  button.textContent = "?";
  root.appendChild(button);
  document.body.appendChild(root);

  let dialog: HelpDialogHandle | null = null;

  const open = (): void => {
    if (dialog !== null) return;
    dialog = showHelpDialog({
      onClose: () => {
        dialog = null;
      },
    });
  };

  const close = (): void => {
    dialog?.close();
  };

  const toggle = (): void => {
    if (dialog === null) open();
    else close();
  };

  button.addEventListener("click", () => toggle());

  for (const ev of ["mousedown", "mouseup", "click"] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }
  root.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  const onKeydown = (ev: KeyboardEvent): void => {
    // Match on `ev.key` (the produced character/name) the way `keybindings.ts`
    // does for letter actions, so AZERTY's physical H still triggers from
    // its produced "h" rather than a QWERTY-position `code` lookup.
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (key !== "h" && key !== "F1") return;
    if (isEditableTarget(document.activeElement)) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggle();
  };
  document.addEventListener("keydown", onKeydown, true);

  let unmounted = false;
  return {
    isOpen: () => dialog !== null,
    open,
    close,
    toggle,
    unmount: (): void => {
      if (unmounted) return;
      unmounted = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog?.close();
      root.remove();
    },
  };
}
