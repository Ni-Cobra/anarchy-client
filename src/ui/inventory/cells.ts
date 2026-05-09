/**
 * Pure DOM helpers for one inventory cell. Render-only — no state, no
 * listeners, no callbacks. The orchestration in `index.ts` calls into
 * these on every paint pass.
 *
 * Items render as 64×64 pixel-art textures sourced from `src/textures.ts`
 * — the same file that feeds the world renderer, so a slot icon and the
 * placed block share a pixel-perfect visual identity.
 * `image-rendering: pixelated` keeps the upscale crisp, mirroring the
 * `THREE.NearestFilter` intent on the renderer side.
 */

import { ItemId, type ItemStack, type Slot, type ToolKind } from "../../game/index.js";
import { textureUrlForItem } from "../../textures.js";

/**
 * Equipment kind currently flagged on a cell, or `null` for cells that
 * are not equipped to either kind. Drives the colored-background paint
 * on the inventory cell — orange for pickaxe, green for axe.
 */
export type CellEquipmentMark = ToolKind | null;

/**
 * Apply the per-item texture to a slot icon element. Items that map to a
 * `BlockType` (today: every `ItemId` — they all place blocks) reuse the
 * world-renderer texture so the inventory and the placed block share a
 * pixel-perfect visual identity. Items without a texture (future tools /
 * consumables) get a neutral gray fallback.
 */
export function applyItemIconStyle(icon: HTMLElement, slot: ItemStack): void {
  const url = textureUrlForItem(slot.item);
  if (url) {
    icon.style.backgroundImage = `url("${url}")`;
    icon.style.backgroundSize = "100% 100%";
    icon.style.backgroundRepeat = "no-repeat";
    icon.style.imageRendering = "pixelated";
  } else {
    icon.style.background = "#888";
  }
}

export function makeSlotCell(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "anarchy-inventory-slot";
  return el;
}

export function paintSlot(
  cell: HTMLDivElement,
  slot: Slot,
  selected: boolean,
  equipped: CellEquipmentMark = null,
): void {
  cell.classList.toggle("selected", selected);
  cell.classList.toggle("equipped-pickaxe", equipped === "pickaxe");
  cell.classList.toggle("equipped-axe", equipped === "axe");
  cell.replaceChildren();
  if (slot === null) return;
  const icon = document.createElement("div");
  icon.className = "anarchy-inventory-icon";
  applyItemIconStyle(icon, slot);
  cell.appendChild(icon);
  if (slot.count > 1) {
    const count = document.createElement("span");
    count.className = "anarchy-inventory-count";
    count.textContent = String(slot.count);
    cell.appendChild(count);
  }
}

/**
 * Paint one equipment-slot cell (task 100). Empty slots get a faded
 * silhouette of the wood-tier tool so the slot affordance reads as a
 * pickaxe / axe slot at a glance; populated slots paint the equipped
 * tool's full icon.
 */
export function paintEquipmentSlot(
  cell: HTMLDivElement,
  kind: ToolKind,
  item: ItemId | null,
): void {
  cell.replaceChildren();
  const icon = document.createElement("div");
  icon.className = "anarchy-inventory-icon";
  if (item !== null) {
    applyItemIconStyle(icon, { item, count: 1 });
    cell.classList.remove("empty");
  } else {
    // Wood-tier silhouette is the cheapest "this is what goes here"
    // affordance — same texture pipeline as the rest of the inventory
    // surface, just at low opacity. The CSS rule `.empty .icon` knocks
    // it down to ~30% alpha.
    const placeholder: ItemStack = {
      item: kind === "pickaxe" ? ItemId.WoodPickaxe : ItemId.WoodAxe,
      count: 1,
    };
    applyItemIconStyle(icon, placeholder);
    cell.classList.add("empty");
  }
  cell.appendChild(icon);
}
