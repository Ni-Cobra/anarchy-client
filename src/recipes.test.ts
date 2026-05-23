import { describe, expect, it } from "vitest";

import { ItemId } from "./game/index.js";
import { recipeById, RECIPES } from "./recipes.js";

describe("recipes", () => {
  it("RECIPES table mirrors the server table — ids and shapes lockstep", () => {
    // Drift here is the most likely cross-boundary regression: the
    // ingredient/output integers must agree byte-for-byte with the
    // server's `RECIPES` table in `crafting.rs`. Pin every recipe so a
    // typo in either repo trips this assertion.
    expect(RECIPES).toEqual([
      {
        id: "sticks",
        ingredients: [{ kind: "one", item: ItemId.Wood, count: 1 }],
        output: { item: ItemId.Stick, count: 4 },
      },
      {
        id: "wood-from-log",
        ingredients: [{ kind: "one", item: ItemId.Log, count: 1 }],
        output: { item: ItemId.Wood, count: 1 },
      },
      {
        id: "sticks-from-log",
        ingredients: [{ kind: "one", item: ItemId.Log, count: 1 }],
        output: { item: ItemId.Stick, count: 4 },
      },
      {
        id: "wood-pickaxe",
        ingredients: [
          { kind: "one", item: ItemId.Log, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodPickaxe, count: 1 },
      },
      {
        id: "wood-axe",
        ingredients: [
          { kind: "one", item: ItemId.Wood, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodAxe, count: 1 },
      },
      {
        id: "stone-pickaxe",
        ingredients: [
          { kind: "one", item: ItemId.Stone, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StonePickaxe, count: 1 },
      },
      {
        id: "stone-axe",
        ingredients: [
          { kind: "one", item: ItemId.Stone, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneAxe, count: 1 },
      },
      {
        id: "copper-ingot",
        ingredients: [{ kind: "one", item: ItemId.RawCopper, count: 1 }],
        output: { item: ItemId.CopperIngot, count: 1 },
      },
      {
        id: "iron-ingot",
        ingredients: [{ kind: "one", item: ItemId.RawIron, count: 1 }],
        output: { item: ItemId.IronIngot, count: 1 },
      },
      {
        id: "tungsten-ingot",
        ingredients: [{ kind: "one", item: ItemId.RawTungsten, count: 1 }],
        output: { item: ItemId.TungstenIngot, count: 1 },
      },
      {
        id: "copper-pickaxe",
        ingredients: [
          { kind: "one", item: ItemId.CopperIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperPickaxe, count: 1 },
      },
      {
        id: "copper-axe",
        ingredients: [
          { kind: "one", item: ItemId.CopperIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperAxe, count: 1 },
      },
      {
        id: "iron-pickaxe",
        ingredients: [
          { kind: "one", item: ItemId.IronIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronPickaxe, count: 1 },
      },
      {
        id: "iron-axe",
        ingredients: [
          { kind: "one", item: ItemId.IronIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronAxe, count: 1 },
      },
      {
        id: "tungsten-pickaxe",
        ingredients: [
          { kind: "one", item: ItemId.TungstenIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenPickaxe, count: 1 },
      },
      {
        id: "tungsten-axe",
        ingredients: [
          { kind: "one", item: ItemId.TungstenIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenAxe, count: 1 },
      },
      {
        id: "torch",
        ingredients: [
          { kind: "one", item: ItemId.Stick, count: 1 },
          { kind: "one", item: ItemId.Coal, count: 1 },
        ],
        output: { item: ItemId.Torch, count: 4 },
      },
      {
        id: "lantern",
        ingredients: [
          { kind: "one", item: ItemId.Torch, count: 1 },
          { kind: "one", item: ItemId.IronIngot, count: 1 },
        ],
        output: { item: ItemId.Lantern, count: 1 },
      },
      {
        id: "chest",
        ingredients: [{ kind: "one", item: ItemId.Wood, count: 8 }],
        output: { item: ItemId.Chest, count: 1 },
      },
      {
        id: "wood-shovel",
        ingredients: [
          { kind: "one", item: ItemId.Log, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodShovel, count: 1 },
      },
      {
        id: "stone-shovel",
        ingredients: [
          { kind: "one", item: ItemId.Stone, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneShovel, count: 1 },
      },
      {
        id: "copper-shovel",
        ingredients: [
          { kind: "one", item: ItemId.CopperIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperShovel, count: 1 },
      },
      {
        id: "iron-shovel",
        ingredients: [
          { kind: "one", item: ItemId.IronIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronShovel, count: 1 },
      },
      {
        id: "tungsten-shovel",
        ingredients: [
          { kind: "one", item: ItemId.TungstenIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenShovel, count: 1 },
      },
      {
        id: "wood-sword",
        ingredients: [
          { kind: "one", item: ItemId.Log, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodSword, count: 1 },
      },
      {
        id: "stone-sword",
        ingredients: [
          { kind: "one", item: ItemId.Stone, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneSword, count: 1 },
      },
      {
        id: "copper-sword",
        ingredients: [
          { kind: "one", item: ItemId.CopperIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperSword, count: 1 },
      },
      {
        id: "iron-sword",
        ingredients: [
          { kind: "one", item: ItemId.IronIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronSword, count: 1 },
      },
      {
        id: "tungsten-sword",
        ingredients: [
          { kind: "one", item: ItemId.TungstenIngot, count: 3 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenSword, count: 1 },
      },
      {
        id: "blowgun",
        ingredients: [{ kind: "one", item: ItemId.Stick, count: 3 }],
        output: { item: ItemId.Blowgun, count: 1 },
      },
      {
        id: "poison-dart",
        ingredients: [
          { kind: "one", item: ItemId.VenomSack, count: 1 },
          { kind: "one", item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.PoisonDart, count: 4 },
      },
      {
        id: "cloth",
        ingredients: [{ kind: "one", item: ItemId.String, count: 6 }],
        output: { item: ItemId.Cloth, count: 1 },
      },
      {
        id: "flag",
        ingredients: [
          { kind: "one", item: ItemId.Cloth, count: 2 },
          { kind: "one", item: ItemId.Wood, count: 1 },
        ],
        output: { item: ItemId.Flag, count: 1 },
      },
      {
        id: "dye-white",
        ingredients: [{ kind: "one", item: ItemId.FlowerWhite, count: 1 }],
        output: { item: ItemId.DyeWhite, count: 1 },
      },
      {
        id: "dye-blue",
        ingredients: [{ kind: "one", item: ItemId.FlowerBlue, count: 1 }],
        output: { item: ItemId.DyeBlue, count: 1 },
      },
      {
        id: "dye-red",
        ingredients: [{ kind: "one", item: ItemId.FlowerRed, count: 1 }],
        output: { item: ItemId.DyeRed, count: 1 },
      },
      {
        id: "dye-yellow",
        ingredients: [{ kind: "one", item: ItemId.FlowerYellow, count: 1 }],
        output: { item: ItemId.DyeYellow, count: 1 },
      },
      {
        id: "dye-black",
        ingredients: [{ kind: "one", item: ItemId.Coal, count: 1 }],
        output: { item: ItemId.DyeBlack, count: 1 },
      },
      {
        id: "dye-purple",
        ingredients: [
          { kind: "one", item: ItemId.DyeBlue, count: 1 },
          { kind: "one", item: ItemId.DyeRed, count: 1 },
        ],
        output: { item: ItemId.DyePurple, count: 2 },
      },
      {
        id: "dye-green",
        ingredients: [
          { kind: "one", item: ItemId.DyeYellow, count: 1 },
          { kind: "one", item: ItemId.DyeBlue, count: 1 },
        ],
        output: { item: ItemId.DyeGreen, count: 2 },
      },
      {
        id: "dye-orange",
        ingredients: [
          { kind: "one", item: ItemId.DyeRed, count: 1 },
          { kind: "one", item: ItemId.DyeYellow, count: 1 },
        ],
        output: { item: ItemId.DyeOrange, count: 2 },
      },
      {
        id: "dye-gray",
        ingredients: [
          { kind: "one", item: ItemId.DyeWhite, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeGray, count: 2 },
      },
      {
        id: "dye-dark-blue",
        ingredients: [
          { kind: "one", item: ItemId.DyeBlue, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkBlue, count: 2 },
      },
      {
        id: "dye-dark-red",
        ingredients: [
          { kind: "one", item: ItemId.DyeRed, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkRed, count: 2 },
      },
      {
        id: "dye-dark-yellow",
        ingredients: [
          { kind: "one", item: ItemId.DyeYellow, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkYellow, count: 2 },
      },
      {
        id: "dye-dark-green",
        ingredients: [
          { kind: "one", item: ItemId.DyeGreen, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkGreen, count: 2 },
      },
      {
        id: "dye-dark-purple",
        ingredients: [
          { kind: "one", item: ItemId.DyePurple, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkPurple, count: 2 },
      },
      {
        id: "dye-dark-orange",
        ingredients: [
          { kind: "one", item: ItemId.DyeOrange, count: 1 },
          { kind: "one", item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkOrange, count: 2 },
      },
    ]);
  });

  it("recipeById resolves known ids, returns undefined for unknown ones", () => {
    expect(recipeById("sticks")?.output.item).toBe(ItemId.Stick);
    expect(recipeById("wood-pickaxe")?.output.item).toBe(ItemId.WoodPickaxe);
    expect(recipeById("future-platinum-pickaxe")).toBeUndefined();
    expect(recipeById("")).toBeUndefined();
  });
});
