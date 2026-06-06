/**
 * In-game help overlay. Centered modal with a 4-tab body (General /
 * Inventory / Combat / Factions). Static content — no network, no save
 * state. Opens from the corner `?` button and the `H` / `F1` keybinding
 * wired in [`help_button.ts`].
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
 * otherwise eat any Escape that targeted the body. Left/Right arrow keys
 * (document-capture, ahead of the gate) cycle tabs with wrap-around so the
 * user can flip through without reaching for the mouse. `onClose` lets the
 * owning module ([`help_button.ts`]) drop its handle reference so re-opens
 * build a fresh modal — re-opens always start on the General tab, the
 * active index is not persisted.
 */

import { attachInputGate } from "./input_gate.js";
import { attachModalContextMenuGuard } from "./modal_contextmenu.js";

const STYLE_ID = "anarchy-help-dialog-style";
const ROOT_ID = "anarchy-help-dialog-root";
const PANEL_ID = "anarchy-help-dialog-panel";
const TAB_HEADER_CLASS = "anarchy-help-tab-header";
const TAB_PANE_CLASS = "anarchy-help-tab-pane";

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
  #${PANEL_ID} .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  #${PANEL_ID} .${TAB_HEADER_CLASS} {
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: #9aa4b0;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 12px;
    cursor: pointer;
    margin-bottom: -1px;
  }
  #${PANEL_ID} .${TAB_HEADER_CLASS}:hover { color: #d8dde4; }
  #${PANEL_ID} .${TAB_HEADER_CLASS}.active {
    color: #f0f0f0;
    border-bottom-color: #ffb060;
  }
  #${PANEL_ID} .body {
    overflow-y: auto;
    padding-right: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: #d8dde4;
  }
  #${PANEL_ID} .${TAB_PANE_CLASS} { display: none; }
  #${PANEL_ID} .${TAB_PANE_CLASS}.active { display: block; }
  #${PANEL_ID} .body h3 {
    margin: 0 0 6px 0;
    font-size: 14px;
    font-weight: 600;
    color: #f0f0f0;
  }
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
    margin-top: 10px;
    padding-top: 8px;
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

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly html: string;
}

const TABS: readonly Tab[] = [
  {
    id: "general",
    label: "General",
    html: `
      <h3>General</h3>
      <ul>
        <li><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (or arrow keys) — move.</li>
        <li><kbd>1</kbd>–<kbd>9</kbd> — pick a hotbar slot. Mouse wheel cycles.</li>
        <li><b>Left-click</b> — break the block under the cursor (hold to keep breaking) or attack a target in range. If you hold a full block, you can destroy the floor to replace it with.</li>
        <li><b>Right-click</b> — place the held hotbar block, or open a chest / tombstone.</li>
        <li><kbd>E</kbd> — open / close the inventory and the crafting menu.
        <li><kbd>M</kbd> — toggle wide-angle zoom. <kbd>+</kbd> / <kbd>−</kbd> (or <kbd>Ctrl</kbd>+wheel) nudge zoom.</li>
        <li><kbd>Enter</kbd> — open chat. <kbd>Enter</kbd> sends, <kbd>Esc</kbd> cancels.</li>
        <li><kbd>H</kbd> or <kbd>F1</kbd> — open this help.</li>
      </ul>
      <p>
        The <b>equipment row</b> indicates the <b>selection</b> for your tools and utilities. Pickaxes, axes, shovels, swords and utilities can be anywhere in your inventory and <b>passively</b> used if they appear there.
      </p>
      <h4>Start by breaking a tree !</h4>
      <p class="footnote">
        Progress only survives reconnects if you register an account —
        click <em>Register</em> in the top-right corner to lock in your name.
      </p>
    `,
  },
  {
    id: "inventory",
    label: "Inventory",
    html: `
      <h3>Inventory shortcuts</h3>
      <ul>
        <li><strong>Drag-and-drop items</strong></li>
        <li><strong>Left-click an equippable item</strong> to equip it</li>
        <li><strong>Left-click in inventory</strong> to swap with current hotbar selection</li>
        <li><strong>Left-click in chest</strong> to move the item to inventory</li>
        <li><strong>Right-click a stack</strong> to select it as the split source</li>
        <li>With a split source selected, <strong>left-click and hold</strong> on another slot to drip items one-by-one.</li>
        <li>You can open several containers at once — drag between any of them.</li>
        <li>Crafting consumes ingredients pooled across your inventory and every open chest. <strong>Right-click a recipe</strong> to craft all you can in one go.</li>
      </ul>
    `,
  },
  {
    id: "combat",
    label: "Combat",
    html: `
      <h3>Combat</h3>
      <ul>
        <li>Left-click a close enemy or player to attack with the equipped sword, after a charge.</li>
        <li>A swing has a short cooldown phase (icon in equipment slot)</li>
        <li>When you die, drop your carried items into a tombstone at the death spot, tombstones work like chests.</li>
        <li>Equip the <strong>blowgun</strong> in the utility slot, right-click an enemy (within ~8 tiles) to fire <strong>poison darts</strong> stored in your inventory. Darts apply a brief <em>Slow</em> effect.</li>
      </ul>
    `,
  },
  {
    id: "factions",
    label: "Goal : Factions",
    html: `
      <h3>Goal : Factions</h3>
      <ul>
        <li>You earn XP by several actions in-game. Steal all the XP of a player by killing them.</li>
        <li>Craft a <strong>Flag</strong> (you need to kill spiders to get string then cloth) and place it to found a faction binded to that flag.</li>
        <li>Stand near a flag and <strong>Right-click + hold</strong> on it to <em>transfer</em> your XP into that faction.</li>
        <li>Stand near a flag and <strong>Left-click + hold</strong> on it to <em>steal</em> XP from that faction.</li>
        <li>Faction XP shows on the leaderboard. A faction's flag is unbreakable while its XP is above zero — drain it first to dismantle.</li>
      </ul>
      <h3>Try to have your Faction the highest on the leaderboard !</h3>
    `,
  },
];

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
  /** Test affordance: index of the currently visible tab (0..TABS.length-1). */
  activeTabIndex(): number;
}

export function showHelpDialog(options: HelpDialogOptions = {}): HelpDialogHandle {
  injectStyle();

  const tabsMarkup = TABS.map(
    (t, i) =>
      `<button class="${TAB_HEADER_CLASS}${i === 0 ? " active" : ""}" type="button" data-tab-index="${i}" data-tab-id="${t.id}">${t.label}</button>`,
  ).join("");
  const panesMarkup = TABS.map(
    (t, i) =>
      `<div class="${TAB_PANE_CLASS}${i === 0 ? " active" : ""}" data-tab-id="${t.id}">${t.html}</div>`,
  ).join("");

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <div id="${PANEL_ID}" tabindex="-1" role="dialog" aria-label="Help">
      <div class="header">
        <h2>How to play</h2>
        <button class="close" type="button" aria-label="Close help">×</button>
      </div>
      <div class="tabs" role="tablist">${tabsMarkup}</div>
      <div class="body">${panesMarkup}</div>
    </div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector<HTMLElement>(`#${PANEL_ID}`)!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".close")!;
  const tabHeaders = Array.from(
    panel.querySelectorAll<HTMLButtonElement>(`.${TAB_HEADER_CLASS}`),
  );
  const tabPanes = Array.from(
    panel.querySelectorAll<HTMLElement>(`.${TAB_PANE_CLASS}`),
  );

  let activeIndex = 0;
  const setActive = (next: number): void => {
    const clamped = ((next % TABS.length) + TABS.length) % TABS.length;
    if (clamped === activeIndex) return;
    tabHeaders[activeIndex]?.classList.remove("active");
    tabPanes[activeIndex]?.classList.remove("active");
    activeIndex = clamped;
    tabHeaders[activeIndex]?.classList.add("active");
    tabPanes[activeIndex]?.classList.add("active");
  };

  tabHeaders.forEach((header, i) => {
    header.addEventListener("click", () => setActive(i));
  });

  let closed = false;
  const gate = attachInputGate(root);
  const ctxGuard = attachModalContextMenuGuard(root);

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    ctxGuard.detach();
    gate.detach();
    root.remove();
    options.onClose?.();
  };

  // One document-capture handler for Escape (close) and Left/Right (cycle).
  // Capture so it runs before the input gate's bubble-phase stop, which
  // would otherwise swallow keys targeting the body. We don't preventDefault
  // for arrow keys so other modals stacked on top stay free to use them —
  // only the help dialog is open at this point in practice.
  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.code === "Escape") {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.code === "ArrowLeft") {
      ev.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (ev.code === "ArrowRight") {
      ev.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  closeBtn.addEventListener("click", () => close());
  root.addEventListener("click", (ev) => {
    if (ev.target === root) close();
  });

  queueMicrotask(() => panel.focus());

  return {
    close,
    panel: () => (closed ? null : panel),
    activeTabIndex: () => activeIndex,
  };
}
