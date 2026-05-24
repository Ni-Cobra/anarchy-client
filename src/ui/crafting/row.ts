/**
 * Pure DOM helpers for one crafting recipe row. The orchestration in
 * `index.ts` builds rows from the live recipe id list; this module just
 * stamps out the DOM for `[ingredients] → [output]` without any state or
 * listeners.
 *
 * Both sides flex-wrap inside their half of the row, so a recipe with many
 * ingredient stacks (today: at most two; future tiers may grow) lays out
 * left-justified on the ingredient side and right-justified on the output
 * side, never spilling past the centered arrow.
 *
 * The arrow lives inside a `.anarchy-crafting-arrow-cell` column wrapper
 * so a max-craft-count badge can sit directly under the arrow
 * without disturbing the row's centered layout. The badge is omitted when
 * `maxCount` is `0` (the row is already styled as uncraftable, so `0`
 * would be redundant noise).
 */

import type { ItemId } from "../../game/index.js";
import { itemDisplayName } from "../../item_names.js";
import type { Ingredient, Recipe, RecipeStack } from "../../recipes.js";
import { textureUrlForItem } from "../../textures.js";

/**
 * Build the button-shaped row for `recipe`. Caller wires the `click`
 * handler — the row itself is otherwise inert (no internal state).
 *
 * `maxCount` is the number of times the recipe can currently be crafted
 * given the inventory pools the caller chose to consider; pass `0` to
 * suppress the badge entirely.
 *
 * `partialHint` toggles the grayed-bottom treatment used for
 * recipes the player has *some* of an ingredient toward but cannot yet
 * craft. Callers also gate the click handler — the styling alone is not
 * load-bearing for the no-op behavior.
 */
export function makeRecipeRow(
  recipe: Recipe,
  maxCount: number,
  partialHint = false,
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "anarchy-crafting-row";
  row.dataset.recipeId = recipe.id;
  if (partialHint) {
    row.classList.add("partial-hint");
    row.setAttribute("aria-disabled", "true");
  }
  row.setAttribute(
    "aria-label",
    recipeAriaLabel(recipe),
  );

  const left = document.createElement("div");
  left.className = "anarchy-crafting-side left";
  for (const ing of recipe.ingredients) {
    left.appendChild(makeIngredient(ing));
  }

  const arrowCell = document.createElement("div");
  arrowCell.className = "anarchy-crafting-arrow-cell";

  const arrow = document.createElement("span");
  arrow.className = "anarchy-crafting-arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");
  arrowCell.appendChild(arrow);

  if (maxCount > 0 && !partialHint) {
    const count = document.createElement("span");
    count.className = "anarchy-crafting-arrow-count";
    count.textContent = String(maxCount);
    count.setAttribute("aria-hidden", "true");
    arrowCell.appendChild(count);
  }

  const right = document.createElement("div");
  right.className = "anarchy-crafting-side right";
  right.appendChild(makeStack(recipe.output));

  row.appendChild(left);
  row.appendChild(arrowCell);
  row.appendChild(right);
  return row;
}

/**
 * One ingredient / output icon + count badge. The icon reuses
 * `textureUrlForItem` so a stack and its inventory cell share a
 * pixel-perfect identity. Counts ≥ 2 paint a small badge in the bottom-
 * right; counts of 1 stay badge-less for visual quiet.
 */
function makeStack(stack: RecipeStack): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "anarchy-crafting-stack";
  cell.appendChild(makeIconEl(stack.item));
  if (stack.count > 1) {
    const count = document.createElement("span");
    count.className = "anarchy-crafting-stack-count";
    count.textContent = String(stack.count);
    cell.appendChild(count);
  }
  return cell;
}

/**
 * Render one ingredient clause. `kind: "one"` reuses [`makeStack`].
 * `kind: "any-of"` paints the count once, then a horizontally-
 * separated list of candidate item icons divided by thin vertical bars
 * — `[N× icon(item1) | icon(item2) | icon(item3)]`.
 */
function makeIngredient(ing: Ingredient): HTMLDivElement {
  if (ing.kind === "one") {
    return makeStack({ item: ing.item, count: ing.count });
  }
  const cell = document.createElement("div");
  cell.className = "anarchy-crafting-stack any-of";
  if (ing.count > 1) {
    const count = document.createElement("span");
    count.className = "anarchy-crafting-any-of-count";
    count.textContent = `${ing.count}×`;
    cell.appendChild(count);
  }
  ing.items.forEach((item, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "anarchy-crafting-any-of-sep";
      sep.setAttribute("aria-hidden", "true");
      cell.appendChild(sep);
    }
    cell.appendChild(makeIconEl(item));
  });
  return cell;
}

function makeIconEl(item: ItemId): HTMLDivElement {
  const icon = document.createElement("div");
  icon.className = "anarchy-crafting-stack-icon";
  const url = textureUrlForItem(item);
  if (url) {
    icon.style.backgroundImage = `url("${url}")`;
    icon.style.backgroundSize = "100% 100%";
    icon.style.backgroundRepeat = "no-repeat";
    icon.style.imageRendering = "pixelated";
  } else {
    icon.style.background = "#888";
  }
  return icon;
}

function recipeAriaLabel(recipe: Recipe): string {
  const lhs = recipe.ingredients.map(ingredientAriaLabel).join(", ");
  const rhs = `${recipe.output.count} ${itemDisplayName(recipe.output.item)}`;
  return `Craft: ${lhs} to ${rhs}`;
}

function ingredientAriaLabel(ing: Ingredient): string {
  if (ing.kind === "one") {
    return `${ing.count} ${itemDisplayName(ing.item)}`;
  }
  const names = ing.items.map(itemDisplayName).join(" or ");
  return `${ing.count} of (${names})`;
}
