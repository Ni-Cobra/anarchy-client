/**
 * Hand-tuned crafting-panel order — THE single knob for arranging crafts.
 *
 * `CRAFT_DISPLAY_ORDER` is the canonical top-to-bottom order recipes appear
 * in the crafting panel. To reorder the panel by hand, just rearrange the
 * ids in this list. Every recipe id should appear here exactly once;
 * `recipe_order.test.ts` guards against drift from the `RECIPES` table
 * (a missing or stray id fails the suite).
 *
 * Two things this order does *not* override:
 * - Affordable rows still float above grayed (unaffordable) rows. This list
 *   sets the order *within* each of those two tiers. To drop that split and
 *   get a single flat hand-ordered list, remove the availability check in
 *   `game/inventory.ts::sortCraftable`.
 * - An id missing from this list sinks to the bottom of its tier and then
 *   sorts alphabetically — a newly added recipe is never lost, just
 *   un-prioritized until you place it here.
 *
 * Kept import-free on purpose: `ItemId` lives in `game/inventory.ts` and
 * `recipes.ts` imports it, so sourcing the display rank from here (rather
 * than from `recipes.ts`) avoids an `inventory` ↔ `recipes` module cycle.
 * The ids below are plain strings — the wire surface keys recipes by id.
 */
export const CRAFT_DISPLAY_ORDER: readonly string[] = [
  "flag",
  "tungsten-ingot",
  "tungsten-pickaxe",
  "tungsten-axe",
  "tungsten-shovel",
  "tungsten-sword",
  "iron-ingot",
  "iron-pickaxe",
  "iron-axe",
  "iron-shovel",
  "iron-sword",
  "lantern",
  "copper-ingot",
  "copper-pickaxe",
  "copper-axe",
  "copper-shovel",
  "copper-sword",
  "stone-pickaxe",
  "stone-axe",
  "stone-shovel",
  "stone-sword",
  "wood-pickaxe",
  "wood-axe",
  "wood-shovel",
  "wood-sword",
  "cloth",
  "sticks",
  "wood-from-log",
  "sticks-from-log",
  "torch",
  "chest",
  "blowgun",
  "poison-dart",
  "dye-white",
  "dye-blue",
  "dye-red",
  "dye-yellow",
  "dye-black",
  "dye-purple",
  "dye-green",
  "dye-orange",
  "dye-gray",
  "dye-dark-blue",
  "dye-dark-red",
  "dye-dark-yellow",
  "dye-dark-green",
  "dye-dark-purple",
  "dye-dark-orange",
  "dye-blue-from-dark",
  "dye-red-from-dark",
  "dye-yellow-from-dark",
  "dye-green-from-dark",
  "dye-purple-from-dark",
  "dye-orange-from-dark",
  "concrete-gray-from-stone",
  "concrete-gray",
  "concrete-white",
  "concrete-blue",
  "concrete-red",
  "concrete-yellow",
  "concrete-black",
  "concrete-purple",
  "concrete-green",
  "concrete-orange",
  "concrete-dark-blue",
  "concrete-dark-red",
  "concrete-dark-yellow",
  "concrete-dark-green",
  "concrete-dark-purple",
  "concrete-dark-orange",
];

const RANK: ReadonlyMap<string, number> = new Map(
  CRAFT_DISPLAY_ORDER.map((id, i) => [id, i]),
);

/**
 * Display rank for a recipe id — its index in [`CRAFT_DISPLAY_ORDER`].
 * Ids absent from the list rank after every listed id (callers then break
 * the tie alphabetically), so an un-placed recipe is appended, never lost.
 */
export function craftDisplayRank(id: string): number {
  return RANK.get(id) ?? Number.MAX_SAFE_INTEGER;
}
