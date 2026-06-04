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
        <li>Left-click — break the block under the cursor (hold to keep breaking) or attack a target in range.</li>
        <li>Right-click — place the held hotbar block, or open a chest / tombstone.</li>
        <li><kbd>E</kbd> — open / close the inventory. <kbd>Esc</kbd> also closes it.</li>
        <li><kbd>M</kbd> — toggle wide-angle zoom. <kbd>+</kbd> / <kbd>−</kbd> (or <kbd>Ctrl</kbd>+wheel) nudge zoom.</li>
        <li><kbd>Enter</kbd> — open chat. <kbd>Enter</kbd> sends, <kbd>Esc</kbd> cancels.</li>
        <li><kbd>H</kbd> or <kbd>F1</kbd> — open this help.</li>
      </ul>
      <p>
        The equipment row holds a pickaxe, axe, shovel, sword, and a
        utility slot (lantern or blowgun). The equipped tool decides
        what left-click does in the world — pickaxe on stone / ores,
        axe on wood, shovel on dirt, sword on enemies.
      </p>
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
        <li><strong>Drag a slot onto another</strong> — swap or merge two stacks, across hotbar, main grid, chests, and equipment.</li>
        <li><strong>Right-click a stack</strong> to arm it as the split source (sticky border). Right-click another stack to switch sources; right-click empty space to cancel.</li>
        <li>With a source armed, <strong>left-click and hold</strong> on another slot to drip items one-by-one — the rate ramps up the longer you hold.</li>
        <li><strong>Left-click</strong> a tool in your inventory to move it into its equipment slot; click the equipment slot to send it back.</li>
        <li>You can open several chests at once — drag between any of them.</li>
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
        <li>Left-click an enemy or player within ~6 tiles to attack with the equipped sword. Bare-handed works but hits weaker.</li>
        <li>A swing has a short charge phase, then resolves. After a strike the sword is locked for 5 s — the ring around the sword slot shows the cooldown ticking down.</li>
        <li>Your HP bar sits with the player HUD. At zero HP you die, drop your carried items into a tombstone at the death spot, and respawn shortly after. Open the tombstone with right-click to recover the items.</li>
        <li>Equip the <strong>blowgun</strong> in the utility slot, load <strong>poison darts</strong>, and right-click an enemy (within ~8 tiles) to fire. Darts deal small damage and apply a brief <em>Slow</em> effect.</li>
      </ul>
    `,
  },
  {
    id: "factions",
    label: "Factions",
    html: `
      <h3>Factions</h3>
      <ul>
        <li>You earn XP by breaking blocks and from PvP kills (a kill transfers the victim's whole XP pool to you).</li>
        <li>Craft and place a <strong>Flag</strong> to found a faction — you'll name it on placement. The flag's tile is the faction's claim.</li>
        <li>Stand within ~4 tiles of a claimed flag and <strong>right-click + hold</strong> on it to <em>deposit</em> XP from your pool into that faction.</li>
        <li>Stand within ~4 tiles of a rival flag and <strong>left-click + hold</strong> on it to <em>steal</em> XP from that faction into your pool.</li>
        <li>XP transfers at ~10 per second while held, and stops when either pool runs dry or you walk out of range.</li>
        <li>Faction XP shows on the leaderboard. A faction's flag is unbreakable while its XP is above zero — drain it first to dismantle.</li>
      </ul>
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
        <h2>How to play and goal</h2>
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
