/**
 * Tooltip body for one crafting recipe. Shown when the cursor
 * hovers a recipe row in the crafting panel; communicates the recipe's
 * output, its required ingredient stacks, and (cheaply) the player's
 * current have-count for each ingredient so the player can see at a
 * glance what the craft takes.
 *
 * Built as a plain DOM tree and passed to `attachTooltip` via the
 * `TooltipContent` HTMLElement branch. Built fresh on every show / move
 * — the recipe table is tiny so the per-event allocations are
 * negligible, and reading the live inventory keeps have-counts current
 * as the player gathers ingredients without leaving the panel.
 */

import type { Inventory, ItemId } from "../../game/index.js";
import { itemDisplayName } from "../../item_names.js";
import type { Ingredient, Recipe } from "../../recipes.js";
import { textureUrlForItem } from "../../textures.js";

export function makeRecipeTooltip(
  recipe: Recipe,
  inventory: Inventory,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "anarchy-crafting-tooltip";

  const title = document.createElement("div");
  title.className = "anarchy-crafting-tooltip-title";
  title.appendChild(makeIcon(recipe.output.item));
  const titleName = document.createElement("span");
  titleName.className = "anarchy-crafting-tooltip-name";
  titleName.textContent =
    recipe.output.count > 1
      ? `${itemDisplayName(recipe.output.item)} × ${recipe.output.count}`
      : itemDisplayName(recipe.output.item);
  title.appendChild(titleName);
  root.appendChild(title);

  const list = document.createElement("div");
  list.className = "anarchy-crafting-tooltip-ingredients";
  for (const ing of recipe.ingredients) {
    list.appendChild(makeIngredientRow(ing, inventory));
  }
  root.appendChild(list);
  return root;
}

function makeIngredientRow(
  ing: Ingredient,
  inventory: Inventory,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "anarchy-crafting-tooltip-ingredient";

  const need = document.createElement("span");
  need.className = "anarchy-crafting-tooltip-need";
  need.textContent = `${ing.count} ×`;
  row.appendChild(need);

  if (ing.kind === "one") {
    row.appendChild(makeIcon(ing.item));
    const name = document.createElement("span");
    name.className = "anarchy-crafting-tooltip-name";
    name.textContent = itemDisplayName(ing.item);
    row.appendChild(name);

    const have = inventory.countOf(ing.item);
    const haveEl = document.createElement("span");
    haveEl.className = "anarchy-crafting-tooltip-have";
    if (have < ing.count) haveEl.classList.add("short");
    haveEl.textContent = `(have ${have})`;
    row.appendChild(haveEl);
  } else {
    // AnyOf: render every candidate icon inline, joined by "or" gaps in
    // the readable name, with the have-count being the pooled sum.
    ing.items.forEach((item, idx) => {
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.className = "anarchy-crafting-tooltip-any-of-sep";
        sep.setAttribute("aria-hidden", "true");
        row.appendChild(sep);
      }
      row.appendChild(makeIcon(item));
    });
    const name = document.createElement("span");
    name.className = "anarchy-crafting-tooltip-name";
    name.textContent = ing.items.map(itemDisplayName).join(" or ");
    row.appendChild(name);

    let pooled = 0;
    for (const item of ing.items) pooled += inventory.countOf(item);
    const haveEl = document.createElement("span");
    haveEl.className = "anarchy-crafting-tooltip-have";
    if (pooled < ing.count) haveEl.classList.add("short");
    haveEl.textContent = `(have ${pooled})`;
    row.appendChild(haveEl);
  }

  return row;
}

function makeIcon(item: ItemId): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "anarchy-crafting-tooltip-icon";
  const url = textureUrlForItem(item);
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = "100% 100%";
    el.style.backgroundRepeat = "no-repeat";
    el.style.imageRendering = "pixelated";
  } else {
    el.style.background = "#888";
  }
  return el;
}
