import { describe, it, expect } from "vitest";
import { RECIPES } from "./recipes.js";
import { CRAFT_DISPLAY_ORDER, craftDisplayRank } from "./recipe_order.js";

/**
 * `CRAFT_DISPLAY_ORDER` is a hand-maintained mirror of the recipe id set.
 * These guards fail the moment it drifts from `RECIPES` — e.g. a recipe is
 * added server-side and mirrored into `RECIPES` but not placed in the
 * display order, or an id is renamed. That keeps the panel's hand-ordering
 * exhaustive without the maintainer having to remember the second list.
 */
describe("CRAFT_DISPLAY_ORDER", () => {
  const recipeIds = RECIPES.map((r) => r.id);

  it("lists every recipe id exactly once — no missing, no stray, no dup", () => {
    const order = [...CRAFT_DISPLAY_ORDER].sort();
    const ids = [...recipeIds].sort();
    expect(order).toEqual(ids);
    expect(CRAFT_DISPLAY_ORDER).toHaveLength(new Set(CRAFT_DISPLAY_ORDER).size);
  });

  it("ranks listed ids by position and sinks unlisted ids to the end", () => {
    expect(craftDisplayRank(CRAFT_DISPLAY_ORDER[0])).toBe(0);
    expect(craftDisplayRank(CRAFT_DISPLAY_ORDER[1])).toBe(1);
    expect(craftDisplayRank("not-a-real-recipe")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
