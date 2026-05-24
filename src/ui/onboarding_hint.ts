/**
 * On-join onboarding overlay —.
 *
 * A transparent, centered, non-interactive hint card mounted at session
 * start that shows new players the five things they need to begin
 * playing: directional keys (laid out in their physical positions on the
 * keyboard, AZERTY-aware), a mouse pictogram, `E` for inventory,
 * `Enter` for chat, and a "Don't forget to register !" nudge.
 *
 * Lifecycle:
 * - Mount only if `localStorage["anarchy.onboarding-hint-seen"]` is unset.
 *   When the gate flag is present, [`mountOnboardingHint`] returns a
 *   no-op handle and injects no DOM.
 * - The dismissal timer starts on the *first* movement keypress
 *   ([`isMovementKey`] — WASD or arrow keys, layout-agnostic at the
 *   `KeyboardEvent.code` level). After [`DISMISS_DELAY_MS`] the card fades
 *   over [`FADE_DURATION_MS`] and unmounts itself, at which point the
 *   localStorage flag is written. A player who joins and disconnects
 *   before the timer completes still sees the overlay next session.
 * - The session bootstrap pushes [`OnboardingHintHandle.unmount`] onto
 *   its teardown stack so a lobby-return / disconnect tears the card
 *   down even if the timer hasn't fired.
 *
 * Layout detection: Chromium's `navigator.keyboard.getLayoutMap()` is
 * the authoritative source — `get("KeyQ") === "a"` ⇒ AZERTY. Firefox /
 * Safari don't implement it, so we fall back to `navigator.language`
 * (anything starting with `fr` ⇒ AZERTY). Result is cached at mount
 * time; never re-queried mid-life.
 *
 * Network-free; pure DOM. Self-injected CSS. The card is
 * `pointer-events: none` so clicks pass through to the world.
 */

import { isMovementKey } from "../input/index.js";

const STYLE_ID = "anarchy-onboarding-hint-style";
const ROOT_ID = "anarchy-onboarding-hint";
const KBD_CLASS = "anarchy-onboarding-kbd";

/**
 * localStorage key that gates re-display. Written when the dismissal
 * timer *completes* (i.e. the player actually saw the card), not on
 * mount, so a join-and-immediately-disconnect still re-shows next time.
 */
export const ONBOARDING_SEEN_STORAGE_KEY = "anarchy.onboarding-hint-seen";

/** Delay after the first movement keypress before the fade-out begins. */
export const DISMISS_DELAY_MS = 3000;

/** Duration of the opacity transition that fades the card out. */
export const FADE_DURATION_MS = 250;

/**
 * Keyboard layout the player's hardware is producing. Picked once at
 * mount time and frozen for the overlay's lifetime — the pictogram and
 * the on-screen letters are layout-derived.
 */
export type KeyboardLayout = "qwerty" | "azerty";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9100;
    pointer-events: none;
    opacity: 0.85;
    max-width: 400px;
    padding: 18px 22px;
    border-radius: 10px;
    background: rgba(12, 16, 22, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #f0f0f0;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    text-align: center;
    user-select: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    transition: opacity ${FADE_DURATION_MS}ms ease-out;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }
  #${ROOT_ID}.fading { opacity: 0; }
  #${ROOT_ID} .anarchy-onboarding-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #${ROOT_ID} .anarchy-onboarding-keypad {
    display: inline-grid;
    grid-template-columns: repeat(3, 28px);
    grid-template-rows: repeat(2, 28px);
    gap: 4px;
  }
  #${ROOT_ID} .${KBD_CLASS} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-bottom-width: 2px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    font-weight: 600;
    color: #f0f0f0;
    box-sizing: border-box;
  }
  #${ROOT_ID} .anarchy-onboarding-mouse {
    display: inline-block;
    color: #f0f0f0;
  }
  #${ROOT_ID} .anarchy-onboarding-label {
    color: #d8dde4;
  }
  #${ROOT_ID} .anarchy-onboarding-register {
    margin-top: 4px;
    font-style: italic;
    color: #ffd089;
  }
`;

/**
 * Inline SVG of an outlined computer mouse with the two click buttons
 * visible. Sized to ~32px tall so it sits comfortably alongside the
 * directional cluster on the same row.
 */
const MOUSE_SVG = `
  <svg class="anarchy-onboarding-mouse" width="22" height="32" viewBox="0 0 22 32" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <rect x="1.5" y="1.5" width="19" height="29" rx="9" ry="9" />
    <line x1="11" y1="1.5" x2="11" y2="14" />
    <line x1="1.5" y1="14" x2="20.5" y2="14" />
  </svg>
`;

export interface OnboardingHintHandle {
  /** Tear down the overlay (DOM + listener) right now. Idempotent. */
  unmount(): void;
  /**
   * Trigger the fade + unmount immediately, as if the dismissal timer
   * had fired. Sets the localStorage flag the same way auto-dismiss
   * does. Idempotent — calls after the first are no-ops.
   */
  dismissNow(): void;
}

export interface OnboardingHintOptions {
  /**
   * Window the keydown listener should attach to. Defaults to
   * [`window`]; tests pass a custom `EventTarget` so they can drive
   * keypresses deterministically.
   */
  readonly target?: EventTarget;
  /**
   * Storage backend for the "seen" flag. Defaults to
   * `window.localStorage`; tests pass an in-memory stand-in.
   */
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
  /**
   * Forced layout override. Skips detection entirely when set — used
   * by tests to pin both branches without juggling
   * `navigator.language` / `navigator.keyboard`.
   */
  readonly layout?: KeyboardLayout;
}

const NOOP_HANDLE: OnboardingHintHandle = {
  unmount: () => {},
  dismissNow: () => {},
};

/**
 * Best-effort layout detection. Synchronous fallback returns `qwerty`
 * for everything except `fr-*` locales, since the canonical async API
 * (`navigator.keyboard.getLayoutMap()`) is Chromium-only and we don't
 * want to gate the overlay's mount on a Promise.
 */
export function detectKeyboardLayoutFallback(
  language: string | undefined,
): KeyboardLayout {
  if (typeof language === "string" && language.toLowerCase().startsWith("fr")) {
    return "azerty";
  }
  return "qwerty";
}

/**
 * Read the `anarchy.onboarding-hint-seen` flag defensively. Storage
 * access can throw in private-mode browsers / when the quota is full;
 * a throw is treated as "not seen" so the player still gets the hint.
 */
function readSeenFlag(storage: Pick<Storage, "getItem"> | undefined): boolean {
  if (storage === undefined) return false;
  try {
    return storage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeenFlag(storage: Pick<Storage, "setItem"> | undefined): void {
  if (storage === undefined) return;
  try {
    storage.setItem(ONBOARDING_SEEN_STORAGE_KEY, "1");
  } catch {
    /* private-mode / quota — swallowed by design (see module docstring). */
  }
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function makeKbd(letter: string): HTMLElement {
  const el = document.createElement("span");
  el.className = KBD_CLASS;
  el.textContent = letter;
  return el;
}

/**
 * Build the directional-key pictogram. The top row holds the forward
 * key in the middle column; the bottom row holds left / back / right.
 * QWERTY ⇒ W/A/S/D; AZERTY ⇒ Z/Q/S/D.
 */
function buildKeypad(layout: KeyboardLayout): HTMLElement {
  const letters =
    layout === "azerty"
      ? { up: "Z", left: "Q", down: "S", right: "D" }
      : { up: "W", left: "A", down: "S", right: "D" };
  const pad = document.createElement("div");
  pad.className = "anarchy-onboarding-keypad";
  // Row 1: empty | up | empty.
  pad.appendChild(document.createElement("span"));
  pad.appendChild(makeKbd(letters.up));
  pad.appendChild(document.createElement("span"));
  // Row 2: left | down | right.
  pad.appendChild(makeKbd(letters.left));
  pad.appendChild(makeKbd(letters.down));
  pad.appendChild(makeKbd(letters.right));
  return pad;
}

/**
 * Mount the onboarding hint overlay if the seen-flag isn't already
 * set. Returns a [`OnboardingHintHandle`] for the caller's teardown
 * stack; the handle's methods are no-ops when the flag was set.
 */
export function mountOnboardingHint(
  options: OnboardingHintOptions = {},
): OnboardingHintHandle {
  const storage =
    options.storage ??
    (typeof window !== "undefined" ? window.localStorage : undefined);
  if (readSeenFlag(storage)) return NOOP_HANDLE;

  const target = options.target ?? window;
  const layout = options.layout ?? detectKeyboardLayoutFallback(navigator.language);

  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "presentation");
  root.setAttribute("aria-hidden", "true");

  // Row 1: directional cluster + mouse pictogram.
  const topRow = document.createElement("div");
  topRow.className = "anarchy-onboarding-row";
  topRow.appendChild(buildKeypad(layout));
  const mouseHost = document.createElement("span");
  mouseHost.innerHTML = MOUSE_SVG;
  // `innerHTML` returns the host element with a single child SVG — pull
  // it out so the host doesn't add an extra layout box.
  const svg = mouseHost.firstElementChild;
  if (svg !== null) topRow.appendChild(svg);
  root.appendChild(topRow);

  // Row 2: E + Inventory.
  const inventoryRow = document.createElement("div");
  inventoryRow.className = "anarchy-onboarding-row";
  inventoryRow.appendChild(makeKbd("E"));
  const inventoryLabel = document.createElement("span");
  inventoryLabel.className = "anarchy-onboarding-label";
  inventoryLabel.textContent = "Inventory";
  inventoryRow.appendChild(inventoryLabel);
  root.appendChild(inventoryRow);

  // Row 3: Enter + Chat.
  const chatRow = document.createElement("div");
  chatRow.className = "anarchy-onboarding-row";
  chatRow.appendChild(makeKbd("Enter"));
  const chatLabel = document.createElement("span");
  chatLabel.className = "anarchy-onboarding-label";
  chatLabel.textContent = "Chat";
  chatRow.appendChild(chatLabel);
  root.appendChild(chatRow);

  // Row 4: register nudge.
  const registerLine = document.createElement("div");
  registerLine.className = "anarchy-onboarding-register";
  registerLine.textContent = "Don't forget to register !";
  root.appendChild(registerLine);

  document.body.appendChild(root);

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let movementSeen = false;
  let disposed = false;

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener("keydown", onKeydown);
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    root.remove();
  };

  const beginFade = (): void => {
    // Mark seen *now*, when the dismissal timer fired — the player has
    // had the card on screen for the full delay window. If we crash or
    // the page unloads mid-fade, the next session correctly skips the
    // overlay.
    writeSeenFlag(storage);
    root.classList.add("fading");
    fadeTimer = setTimeout(cleanup, FADE_DURATION_MS);
  };

  function onKeydown(e: Event): void {
    if (movementSeen) return;
    const ke = e as KeyboardEvent;
    if (!isMovementKey(ke.code)) return;
    movementSeen = true;
    dismissTimer = setTimeout(beginFade, DISMISS_DELAY_MS);
  }

  target.addEventListener("keydown", onKeydown);

  return {
    unmount: cleanup,
    dismissNow: () => {
      if (disposed) return;
      if (fadeTimer !== null) return;
      if (dismissTimer !== null) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      beginFade();
    },
  };
}
