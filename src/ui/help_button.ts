/**
 * Help affordances + global `H` / `F1` keybinding that toggle the help
 * dialog. Two visual variants share one dialog + one keydown handler:
 *
 * - **Corner `?`** — small round button anchored bottom-right. Mounted
 *   once at page load by [`main.ts`] via [`mountHelp`], visible in the
 *   lobby and any other "no live session" state.
 * - **"How to play" pill** — labeled button centered above the XP bar.
 *   Mounted per-session by [`bootstrap/session.ts`] via
 *   [`mountHowToPlayButton`]. While it is mounted the corner `?` is
 *   hidden, so the player never sees both at once.
 *
 * The dialog itself is constructed lazily on each open via
 * [`help_dialog.ts::showHelpDialog`]; on close the handle is dropped so
 * the next open builds a fresh modal — there is no idle "hidden" dialog
 * hanging around in the DOM.
 *
 * Keybindings dispatch in document-capture so they fire even when an
 * input-gated modal owns the bubble chain. The handler bails when the
 * active element is editable (typing `h` in the chat input must produce
 * a character, not open the help). The handler is attached **once** by
 * `mountHelp`; the above-XP button piggybacks on the same toggle, so
 * `H` / `F1` always fires exactly once regardless of which (or both)
 * buttons are mounted.
 *
 * Pointer events on either button are stopped from propagating so a
 * click doesn't double as a world-mousedown that the bootstrap-level
 * break / place handler would otherwise act on.
 */

import { showHelpDialog, type HelpDialogHandle } from "./help_dialog.js";
import { BOTTOM_OFFSET_PX as XP_LABEL_BOTTOM_OFFSET_PX } from "./xp_label.js";

const STYLE_ID = "anarchy-help-button-style";
const ROOT_ID = "anarchy-help-button-root";
const HOWTO_ROOT_ID = "anarchy-howto-button-root";
const CORNER_HIDDEN_CLASS = "hidden";

/**
 * Bottom offset (px) of the "How to play" button. Anchored above the XP
 * label (`XP_LABEL_BOTTOM_OFFSET_PX` = 104) with enough headroom that the
 * `+N` XP floater — which spawns just above the label text and rises a
 * further 12 px during its fade — never visually collides with the
 * button. The 48 px gap leaves ~20 px clearance above the floater's
 * peak even with the chunkier hotbar font metrics.
 */
const HOWTO_GAP_ABOVE_XP_PX = 48;
const HOWTO_BOTTOM_PX = XP_LABEL_BOTTOM_OFFSET_PX + HOWTO_GAP_ABOVE_XP_PX;

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 8800;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${ROOT_ID}.${CORNER_HIDDEN_CLASS} { display: none; }
  #${ROOT_ID} button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(20, 24, 30, 0.45);
    color: rgba(240, 240, 240, 0.72);
    cursor: pointer;
    font-size: 20px;
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

  #${HOWTO_ROOT_ID} {
    position: fixed;
    left: 50%;
    bottom: ${HOWTO_BOTTOM_PX}px;
    transform: translateX(-50%);
    z-index: 8800;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${HOWTO_ROOT_ID} button {
    height: 34px;
    padding: 0 18px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(20, 24, 30, 0.62);
    color: rgba(240, 240, 240, 0.92);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  #${HOWTO_ROOT_ID} button:hover {
    background: rgba(40, 48, 56, 0.95);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.5);
  }
  #${HOWTO_ROOT_ID} button:focus { outline: none; }
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

/**
 * Stop the click / mousedown / mouseup / contextmenu events on the
 * button's root from bubbling to the world so the bootstrap-level
 * break / place handlers don't act on a help-button press.
 */
function suppressWorldEvents(root: HTMLElement): void {
  for (const ev of ["mousedown", "mouseup", "click"] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }
  root.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
}

export interface HelpHandle {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  unmount(): void;
}

export interface HowToPlayButtonHandle {
  unmount(): void;
}

/**
 * Module-level singleton. `mountHelp` populates it; `mountHowToPlayButton`
 * reads it to share the toggle + corner-button reference. Cleared on
 * `unmount`. Asserts ensure the corner is mounted before the above-XP
 * variant tries to use the shared toggle.
 */
interface ActiveHelp {
  toggle: () => void;
  cornerRoot: HTMLElement;
}
let active: ActiveHelp | null = null;

export function mountHelp(): HelpHandle {
  if (active !== null) {
    throw new Error("mountHelp called twice without unmount");
  }
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
  suppressWorldEvents(root);

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

  active = { toggle, cornerRoot: root };

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
      active = null;
    },
  };
}

/**
 * Mount the in-game "How to play" button anchored above the XP bar and
 * hide the corner `?` for the lifetime of the returned handle. Requires
 * `mountHelp` to have been called first; clicking the button reuses that
 * call's `toggle` so the dialog state is shared (and the keydown handler
 * remains the single page-level instance).
 */
export function mountHowToPlayButton(): HowToPlayButtonHandle {
  if (active === null) {
    throw new Error("mountHowToPlayButton called before mountHelp");
  }
  injectStyle();

  const { toggle, cornerRoot } = active;
  cornerRoot.classList.add(CORNER_HIDDEN_CLASS);

  const root = document.createElement("div");
  root.id = HOWTO_ROOT_ID;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "How to play and goal");
  button.textContent = "How to play and goal";
  root.appendChild(button);
  document.body.appendChild(root);

  button.addEventListener("click", () => toggle());
  suppressWorldEvents(root);

  let unmounted = false;
  return {
    unmount: (): void => {
      if (unmounted) return;
      unmounted = true;
      root.remove();
      // Only restore the corner if the help system is still mounted —
      // teardown ordering on page-level unmount could otherwise hit a
      // stale reference. `cornerRoot` is captured at mount time and
      // remains a valid DOM node either way (it's just no longer in the
      // document if the corner was unmounted first).
      if (active !== null) {
        active.cornerRoot.classList.remove(CORNER_HIDDEN_CLASS);
      }
    },
  };
}
