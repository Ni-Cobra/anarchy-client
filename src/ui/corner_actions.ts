/**
 * Top-right standalone action buttons (Disconnect + optional Register).
 * Replaces the slide-out side panel: those two actions are the only ones
 * ever mounted, so a tray with a toggle was overkill — the buttons sit in
 * the corner directly.
 *
 * Layout is horizontal so Disconnect stays anchored to the corner whether
 * or not Register is present. After `rebuild` drops the Register entry the
 * Disconnect button does not shift position.
 *
 * Click handling mirrors what the side panel used to do: `mousedown` /
 * `mouseup` / `click` / `contextmenu` are stopped from propagating to
 * `window`, so the bootstrap-level break / place handlers don't double-
 * fire when a click lands on a button. `contextmenu` is also default-
 * prevented so right-clicking a button doesn't pop the browser menu.
 */

const STYLE_ID = "anarchy-corner-actions-style";
const ROOT_ID = "anarchy-corner-actions-root";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 9000;
    display: flex;
    flex-direction: row;
    gap: 8px;
    pointer-events: none;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${ROOT_ID} > * { pointer-events: auto; }
  .anarchy-corner-action {
    padding: 10px 12px;
    background: #2a3340;
    color: #f0f0f0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: background 0.1s ease;
  }
  .anarchy-corner-action:hover { background: #3a4854; }
  .anarchy-corner-action:focus { outline: none; }
`;

/**
 * One entry rendered as a corner button. Order in the array matches the
 * left-to-right DOM order — by convention the caller puts Register before
 * Disconnect so Disconnect stays glued to the corner across rebuilds.
 */
export interface CornerAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface CornerActionsOptions {
  readonly actions: ReadonlyArray<CornerAction>;
}

export interface CornerActionsHandle {
  rebuild(actions: ReadonlyArray<CornerAction>): void;
  unmount(): void;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function renderActions(
  host: HTMLElement,
  actions: ReadonlyArray<CornerAction>,
): void {
  host.replaceChildren();
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "anarchy-corner-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => action.onClick());
    host.appendChild(btn);
  }
}

/**
 * Mount the corner action row into `document.body` and return a handle.
 * `rebuild` swaps the action list in place (used by the register flow
 * after a successful registration to drop the Register button). The
 * style block is injected once and shared across mounts.
 */
export function mountCornerActions(
  options: CornerActionsOptions,
): CornerActionsHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;

  renderActions(root, options.actions);

  for (const ev of ["mousedown", "mouseup", "click"] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }
  root.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  document.body.appendChild(root);

  return {
    rebuild: (actions) => renderActions(root, actions),
    unmount: () => {
      root.remove();
    },
  };
}
