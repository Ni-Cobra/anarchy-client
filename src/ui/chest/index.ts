/**
 * Chest panel UI (task 420 + 535).
 *
 * Renders the open chest's 45-slot inventory in a side-panel sibling to
 * the player's main inventory grid. Mounts only when `chestState.location()`
 * is non-null (the server tracks the open chest and ships
 * `ChestUpdate` per tick the contents mutate).
 *
 * Interaction model (task 535): the chest cells share the same drag-and-
 * drop machinery as the player grid. Each cell is registered with the
 * inventory UI's `wireChestSlot` at mount time so pointerdown / drag /
 * right-click split / click-to-withdraw all flow through the same state
 * machine and ship `MoveSlot` / `TransferItems` with the right cross-grid
 * `srcChest` / `dstChest` flags filled in.
 */
import {
  type ChestState,
  INVENTORY_SIZE,
} from "../../game/index.js";
import { itemDisplayName } from "../../item_names.js";
import { textureUrlForItem } from "../../textures.js";
import type { InventoryUiHandle } from "../inventory/index.js";

const STYLE_ID = "anarchy-chest-style";

const STYLE = `
  #anarchy-chest-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 8400;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
  }
  #anarchy-chest-root > * { pointer-events: auto; }
  .anarchy-chest-panel {
    position: absolute;
    left: 280px;
    top: 90px;
    display: none;
    grid-template-columns: repeat(9, 48px);
    gap: 4px;
    padding: 16px;
    background: rgba(20, 24, 30, 0.92);
    border: 1px solid rgba(180, 140, 80, 0.4);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .anarchy-chest-panel.open { display: grid; }
  .anarchy-chest-title {
    position: absolute;
    top: -22px;
    left: 12px;
    font-size: 12px;
    color: #d8c195;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .anarchy-chest-slot {
    width: 48px;
    height: 48px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    cursor: pointer;
    user-select: none;
    box-sizing: border-box;
  }
  .anarchy-chest-slot:hover { background: rgba(255, 255, 255, 0.10); }
  .anarchy-chest-slot img {
    width: 36px; height: 36px;
    image-rendering: pixelated;
    pointer-events: none;
  }
  .anarchy-chest-slot .count {
    position: absolute;
    bottom: 2px; right: 4px;
    font-size: 11px;
    color: #ffffff;
    text-shadow: 1px 1px 0 #000;
  }
  /* Mirror the player-grid affordances so the cross-grid drag/split
     state reads identically. */
  .anarchy-chest-slot.drag-source { opacity: 0.4; }
  .anarchy-chest-slot.split-source {
    border-color: #ffd34a;
    box-shadow: 0 0 0 2px rgba(255, 211, 74, 0.5) inset;
  }
`;

export interface ChestUiOptions {
  readonly chestState: ChestState;
  /**
   * Inventory UI handle (task 535). The chest UI registers each of its
   * cells with this handle's `wireChestSlot` so the cross-grid drag /
   * right-click split / click-to-withdraw flows route through the
   * shared dragdrop state machine.
   */
  readonly inventoryUi: InventoryUiHandle;
}

export interface ChestUiHandle {
  unmount(): void;
}

/**
 * Mount the chest grid panel. The panel toggles visible automatically as
 * `chestState.location()` changes — there's no separate `setOpen`.
 */
export function mountChestUi(options: ChestUiOptions): ChestUiHandle {
  if (!document.getElementById(STYLE_ID)) {
    const tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = STYLE;
    document.head.appendChild(tag);
  }

  const root = document.createElement("div");
  root.id = "anarchy-chest-root";

  const panel = document.createElement("div");
  panel.className = "anarchy-chest-panel";

  const title = document.createElement("div");
  title.className = "anarchy-chest-title";
  title.textContent = "Chest";
  panel.appendChild(title);

  const cells: HTMLDivElement[] = [];
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "anarchy-chest-slot";
    // Suppress the browser context menu so right-click can drive the
    // split flow without the OS overlay stealing focus. Pointerdown is
    // owned by the dragdrop state machine via `wireChestSlot`.
    cell.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    options.inventoryUi.wireChestSlot(i, cell);
    panel.appendChild(cell);
    cells.push(cell);
  }

  // Stop pointer events from reaching `window` so the bootstrap-level
  // mousedown / contextmenu handlers don't fire destroy / place when a
  // click lands on the chest panel. The dragdrop machinery still sees
  // them — it attaches at the cell level + at the document level.
  // `contextmenu` at the panel root also gets `preventDefault` so the
  // browser's native menu doesn't pop up over panel padding/gaps (cells
  // already prevent it themselves above).
  for (const ev of ["mousedown", "mouseup", "click"] as const) {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }
  panel.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  root.appendChild(panel);
  document.body.appendChild(root);

  const render = (): void => {
    const open = options.chestState.location() !== null;
    panel.classList.toggle("open", open);
    if (!open) {
      for (const cell of cells) cell.replaceChildren();
      return;
    }
    const inv = options.chestState.inventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = inv.slot(i);
      const cell = cells[i];
      cell.replaceChildren();
      cell.title = "";
      if (slot === null) continue;
      const url = textureUrlForItem(slot.item);
      if (url !== null) {
        const img = document.createElement("img");
        img.src = url;
        cell.appendChild(img);
      }
      if (slot.count > 1) {
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = String(slot.count);
        cell.appendChild(count);
      }
      const name = itemDisplayName(slot.item);
      cell.title = slot.count > 1 ? `${name} (${slot.count})` : name;
    }
  };

  const unsubscribe = options.chestState.subscribe(render);
  render();

  return {
    unmount: () => {
      unsubscribe();
      root.remove();
    },
  };
}
