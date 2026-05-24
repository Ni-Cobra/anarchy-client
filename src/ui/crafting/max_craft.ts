/**
 * `maxCraftCount(recipe, ...pools)` — how many times a recipe can be crafted
 * right now given one or more inventory pools. For each
 * ingredient the helper computes `floor(have / need)` where `have` is the
 * pooled count across all passed `Inventory` instances; the recipe's craft
 * ceiling is the `min` across ingredients.
 *
 * Returns `0` for recipes whose ingredients are unmet — callers (the
 * crafting panel today) use that as the signal to hide the count entirely,
 * since an uncraftable row is already styled distinctly.
 *
 * Variadic over `Inventory` so the open-chest grid can extend
 * this to consume the chest's contents as a second input pool by adding
 * one argument at the call site — no helper change needed.
 */

import type { Inventory } from "../../game/index.js";
import type { Recipe } from "../../recipes.js";

export function maxCraftCount(
  recipe: Recipe,
  ...pools: readonly Inventory[]
): number {
  if (recipe.ingredients.length === 0) return 0;
  let min = Infinity;
  for (const ing of recipe.ingredients) {
    let have = 0;
    if (ing.kind === "one") {
      for (const pool of pools) have += pool.countOf(ing.item);
    } else {
      // AnyOf: pool counts across every listed item — any
      // combination of those items contributes to the same requirement.
      for (const item of ing.items) {
        for (const pool of pools) have += pool.countOf(item);
      }
    }
    const possible = Math.floor(have / ing.count);
    if (possible < min) min = possible;
  }
  return min === Infinity ? 0 : min;
}
