/**
 * `InventoryUpdate` message handler.
 *
 * The server ships the local player's inventory whenever its slots,
 * equipped tools, or craftable-recipe set changes. This module owns the
 * wire → `Inventory` translation: it shape-checks the slot count
 * defensively (a misbehaving server could drop the frame), decodes the
 * `Slot[]` and equipment pointers, and applies the result via
 * `Inventory.replaceFromWire`. Only the local player's inventory ever
 * crosses the wire — there is no "another player's inventory" path.
 */
import { anarchy } from "../gen/anarchy.js";
import {
  INVENTORY_SIZE,
  type CraftableRecipe,
  type ItemStackExtra,
  type RecipeAvailability,
  type Slot,
} from "../game/index.js";

import type { WireDeps } from "./wire.js";
import { slotFromWire } from "./wire_codec.js";

export function applyInventoryUpdate(
  update: anarchy.v1.IInventoryUpdate,
  deps: WireDeps,
): void {
  if (!deps.inventory) return;
  const wireSlots = update.slots ?? [];
  if (wireSlots.length !== INVENTORY_SIZE) {
    // Defensive: a misbehaving server could ship the wrong slot count.
    // Drop the frame rather than corrupt local state.
    return;
  }
  const slots: Slot[] = wireSlots.map((s): Slot => {
    const slot = slotFromWire(s);
    if (slot === null) return null;
    const extra = itemStackExtraFromWire(s);
    return extra === undefined ? slot : { ...slot, extra };
  });
  // Equipment slot pointers. `-1` (or any out-of-range
  // value) means "nothing equipped"; otherwise the index of the cell in
  // `slots` that holds the equipped tool. The Inventory mirror clamps
  // stale or non-tool indices to `null` defensively.
  const equippedPickaxeSlot = equippedSlotFromWire(update.equippedPickaxeSlot);
  const equippedAxeSlot = equippedSlotFromWire(update.equippedAxeSlot);
  const equippedUtilitySlot = equippedSlotFromWire(update.equippedUtilitySlot);
  const equippedShovelSlot = equippedSlotFromWire(update.equippedShovelSlot);
  const equippedSwordSlot = equippedSlotFromWire(update.equippedSwordSlot);
  const craftableRecipes = (update.craftableRecipes ?? [])
    .map(craftableRecipeFromWire)
    .filter((r): r is CraftableRecipe => r !== null);
  deps.inventory.replaceFromWire(
    slots,
    equippedPickaxeSlot,
    equippedAxeSlot,
    craftableRecipes,
    equippedUtilitySlot,
    equippedShovelSlot,
    equippedSwordSlot,
  );
}

function craftableRecipeFromWire(
  entry: anarchy.v1.IRecipeEntry,
): CraftableRecipe | null {
  const id = entry.recipeId ?? "";
  if (id.length === 0) return null;
  return { id, availability: recipeAvailabilityFromWire(entry.availability) };
}

function recipeAvailabilityFromWire(
  a: anarchy.v1.RecipeAvailability | null | undefined,
): RecipeAvailability {
  // Treat the proto3 default and any unknown value as `affordable` — the
  // server's `AFFORDABLE = 0` makes it the natural identity, and an
  // older client should not silently flip a fully-craftable recipe into
  // the partial-hint tier.
  return a === anarchy.v1.RecipeAvailability.RECIPE_AVAILABILITY_PARTIAL_HINT
    ? "partial-hint"
    : "affordable";
}

function equippedSlotFromWire(slot: number | null | undefined): number | null {
  if (slot === null || slot === undefined) return null;
  if (slot < 0) return null;
  if (slot >= INVENTORY_SIZE) return null;
  return slot;
}

/**
 * Translate a wire `ItemSlot.extra` oneof into the client's
 * `ItemStackExtra`. Returns `undefined` when no extra is set
 * — the common case for every non-flag stack — so the call site can
 * decide whether to omit the field on the resulting `ItemStack` rather
 * than emitting `extra: undefined`.
 */
function itemStackExtraFromWire(
  slot: anarchy.v1.IItemSlot,
): ItemStackExtra | undefined {
  const flag = slot.flag;
  if (flag !== null && flag !== undefined) {
    return { kind: "flag", colorIndex: flag.colorIndex ?? 0 };
  }
  return undefined;
}
