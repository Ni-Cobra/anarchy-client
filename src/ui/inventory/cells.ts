/**
 * Inventory-specific cell helpers. The shared inventory/chest cell
 * primitives (`makeSlotCell`, `paintSlot`, `applyItemIconStyle`) live in
 * `../slot_cell.ts` and are re-exported here so the existing inventory
 * import surface stays intact. The equipment-slot painter is
 * inventory-only and stays local.
 */

import { type ItemId, type ToolKind } from "../../game/index.js";
import { applyItemIconStyle } from "../slot_cell.js";

export {
  type CellEquipmentMark,
  applyItemIconStyle,
  makeSlotCell,
  paintSlot,
} from "../slot_cell.js";

const SLOT_PLACEHOLDER_BASE = "/textures/slots";

/**
 * URL of the outline-glyph SVG painted on an empty equipment cell, per
 * `ToolKind`. Each glyph is a thin line-art hint at the slot's purpose —
 * pickaxe head, axe head, shovel head, sword, cog — drawn as stroke-only
 * SVG so the icon stays crisp at any DPR. The same `.empty .icon` CSS
 * rule that faded the old wood-tier silhouette still knocks the opacity
 * down to ~30%, so the glyph reads as an affordance rather than a
 * populated item.
 *
 * Exported so vitest can pin the per-kind URL choice (task 050).
 */
export const EMPTY_SLOT_PLACEHOLDER_URLS: Record<ToolKind, string> = {
  pickaxe: `${SLOT_PLACEHOLDER_BASE}/pickaxe.svg`,
  axe: `${SLOT_PLACEHOLDER_BASE}/axe.svg`,
  shovel: `${SLOT_PLACEHOLDER_BASE}/shovel.svg`,
  sword: `${SLOT_PLACEHOLDER_BASE}/sword.svg`,
  utility: `${SLOT_PLACEHOLDER_BASE}/cog.svg`,
};

/**
 * Paint one equipment-slot cell (task 100). Empty slots get a bespoke
 * outline glyph hinting at the slot's purpose (task 050) — pickaxe head,
 * axe head, shovel head, sword, cog — instead of the old wood-tier
 * silhouette. Populated slots paint the equipped tool's full icon.
 *
 * Manages just the `.anarchy-inventory-icon` child in place — other
 * children (notably the sword-slot cooldown ring added by task 140)
 * are preserved across renders so external overlays don't get wiped
 * on every `InventoryUpdate`.
 */
export function paintEquipmentSlot(
  cell: HTMLDivElement,
  kind: ToolKind,
  item: ItemId | null,
): void {
  let icon = cell.querySelector<HTMLDivElement>(":scope > .anarchy-inventory-icon");
  if (icon === null) {
    icon = document.createElement("div");
    icon.className = "anarchy-inventory-icon";
    cell.appendChild(icon);
  } else {
    // Clear any stale background-* styles before re-applying — switching
    // from a populated slot back to the empty branch must drop the
    // previous icon's texture (and switching kinds within empty must
    // drop the previous outline).
    icon.removeAttribute("style");
  }
  if (item !== null) {
    applyItemIconStyle(icon, { item, count: 1 });
    cell.classList.remove("empty");
  } else {
    const url = EMPTY_SLOT_PLACEHOLDER_URLS[kind];
    icon.style.backgroundImage = `url("${url}")`;
    icon.style.backgroundSize = "100% 100%";
    icon.style.backgroundRepeat = "no-repeat";
    cell.classList.add("empty");
  }
}
