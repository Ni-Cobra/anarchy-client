/**
 * In-game help overlay (task 110). Centered modal listing the controls,
 * crafting / equipment flow, combat basics, and the current faction
 * placeholder. Static content — no network, no save state. Opens from the
 * corner `?` button and the `H` / `F1` keybinding wired in [`help_button.ts`].
 *
 * Self-contained DOM + CSS injection like the rest of `src/ui/`. The modal
 * traps input via `attachInputGate` so gameplay keys (WASD, hotbar digits,
 * Enter-for-chat, mouse-driven break / place) don't fire while the help is
 * up — same pattern as `register_modal.ts` / `create_faction_dialog.ts`.
 *
 * The dialog panel is `tabindex="-1"` and receives focus on mount so the
 * gate has a focused target inside its subtree; without that, plain keydowns
 * land on `document.body` (outside the gated root) and slip through to the
 * bootstrap-level handlers. Same trick the chat input uses with its
 * `<input>` focus.
 *
 * Esc and backdrop click both close. Escape uses document-capture so it
 * fires regardless of where focus sits — the gate's bubble-phase stop would
 * otherwise eat any Escape that targeted the body. `onClose` lets the
 * owning module ([`help_button.ts`]) drop its handle reference so re-opens
 * build a fresh modal.
 */

import { attachInputGate } from "./input_gate.js";

const STYLE_ID = "anarchy-help-dialog-style";
const ROOT_ID = "anarchy-help-dialog-root";
const PANEL_ID = "anarchy-help-dialog-panel";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    inset: 0;
    background: rgba(8, 12, 16, 0.72);
    z-index: 9600;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
  }
  #${PANEL_ID} {
    background: rgba(20, 24, 30, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 22px 24px 20px 24px;
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    outline: none;
  }
  #${PANEL_ID} .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  #${PANEL_ID} h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  #${PANEL_ID} .close {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: #f0f0f0;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    padding: 0;
  }
  #${PANEL_ID} .close:hover { background: rgba(255, 255, 255, 0.08); }
  #${PANEL_ID} .body {
    overflow-y: auto;
    padding-right: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: #d8dde4;
  }
  #${PANEL_ID} .body h3 {
    margin: 14px 0 6px 0;
    font-size: 14px;
    font-weight: 600;
    color: #f0f0f0;
  }
  #${PANEL_ID} .body h3:first-child { margin-top: 0; }
  #${PANEL_ID} .body p { margin: 4px 0 6px 0; }
  #${PANEL_ID} .body ul {
    margin: 4px 0 8px 0;
    padding-left: 20px;
  }
  #${PANEL_ID} .body li { margin: 2px 0; }
  #${PANEL_ID} .body kbd {
    display: inline-block;
    padding: 1px 6px;
    background: #0d1014;
    color: #f0f0f0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
  }
  #${PANEL_ID} .footnote {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    color: #9aa4b0;
    font-style: italic;
  }
`;

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function bodyHtml(): string {
  return `
    <h3>Controls</h3>
    <ul>
      <li><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (or arrow keys) — move.</li>
      <li><kbd>1</kbd>–<kbd>9</kbd> — pick a hotbar slot. Mouse wheel cycles slots.</li>
      <li><kbd>E</kbd> — open / close the inventory and crafting panels. <kbd>Esc</kbd> also closes them.</li>
      <li><kbd>Enter</kbd> — open chat. <kbd>Enter</kbd> sends, <kbd>Esc</kbd> cancels.</li>
      <li><kbd>M</kbd> — toggle wide-angle zoom. <kbd>+</kbd> / <kbd>-</kbd> (or <kbd>Ctrl</kbd>+wheel) nudge zoom.</li>
      <li>Left-click — break the block under the cursor (hold to keep breaking) or attack a target in range.</li>
      <li>Right-click — place the held hotbar block, or open a chest.</li>
      <li><kbd>H</kbd> or <kbd>F1</kbd> — open this help. <kbd>Esc</kbd> closes it.</li>
    </ul>

    <h3>Crafting</h3>
    <p>
      Open the inventory with <kbd>E</kbd>; the crafting panel slides in
      next to it. Recipes you can afford show in colour — click one to
      craft. Inputs are consumed from anywhere in your inventory; the
      output lands in your inventory (tools auto-equip into their slot
      if the slot is empty).
    </p>

    <h3>Equipment</h3>
    <p>
      The equipment row holds a pickaxe, axe, shovel, sword, and a
      utility item (lantern or blowgun). The equipped tool decides what
      a left-click does on the world — pickaxe on stone, axe on wood,
      shovel on dirt, sword on enemies. Click a tool in your inventory
      to swap it into the matching slot; click the equipment slot to
      send the tool back to your inventory.
    </p>

    <h3>Combat</h3>
    <p>
      Left-click an enemy or another player in range to attack with
      your equipped sword. There is a short cooldown after each swing —
      the ring around the sword slot shows it ticking down. The
      blowgun's darts apply a brief slow effect. When your HP hits
      zero you die, drop your items in a tombstone at your last
      position, and respawn shortly after.
    </p>

    <h3>Factions</h3>
    <p>
      Craft and place a Flag to create a faction — you'll be asked to
      name it on placement, and it'll show up on the leaderboard. The
      flag's tile becomes your claim. Faction features beyond the
      leaderboard (territory rules, membership, scoring) are still
      placeholder in this prototype.
    </p>

    <div class="footnote">
      This is a prototype — feedback welcome.
    </div>
  `;
}

export interface HelpDialogOptions {
  /** Fired when the dialog has been removed from the DOM, for any reason
   * (backdrop click, close button, Escape). The owner uses this to drop
   * its stored handle so the next open() builds a fresh modal. */
  onClose?: () => void;
}

export interface HelpDialogHandle {
  close(): void;
  /** Test affordance: the panel element, or `null` if already closed. */
  panel(): HTMLElement | null;
}

export function showHelpDialog(options: HelpDialogOptions = {}): HelpDialogHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <div id="${PANEL_ID}" tabindex="-1" role="dialog" aria-label="Help">
      <div class="header">
        <h2>How to play</h2>
        <button class="close" type="button" aria-label="Close help">×</button>
      </div>
      <div class="body">
        ${bodyHtml()}
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector<HTMLElement>(`#${PANEL_ID}`)!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".close")!;

  let closed = false;
  const gate = attachInputGate(root);

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onEscape, true);
    gate.detach();
    root.remove();
    options.onClose?.();
  };

  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.code !== "Escape") return;
    ev.preventDefault();
    close();
  };
  document.addEventListener("keydown", onEscape, true);

  closeBtn.addEventListener("click", () => close());
  root.addEventListener("click", (ev) => {
    if (ev.target === root) close();
  });

  queueMicrotask(() => panel.focus());

  return {
    close,
    panel: () => (closed ? null : panel),
  };
}
