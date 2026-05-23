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
        ingredients: [{ item: ItemId.Wood, count: 1 }],
        output: { item: ItemId.Stick, count: 4 },
      },
      {
        id: "wood-from-log",
        ingredients: [{ item: ItemId.Log, count: 1 }],
        output: { item: ItemId.Wood, count: 1 },
      },
      {
        id: "sticks-from-log",
        ingredients: [{ item: ItemId.Log, count: 1 }],
        output: { item: ItemId.Stick, count: 4 },
      },
      {
        id: "wood-pickaxe",
        ingredients: [
          { item: ItemId.Log, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodPickaxe, count: 1 },
      },
      {
        id: "wood-axe",
        ingredients: [
          { item: ItemId.Wood, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodAxe, count: 1 },
      },
      {
        id: "stone-pickaxe",
        ingredients: [
          { item: ItemId.Stone, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StonePickaxe, count: 1 },
      },
      {
        id: "stone-axe",
        ingredients: [
          { item: ItemId.Stone, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneAxe, count: 1 },
      },
      {
        id: "copper-ingot",
        ingredients: [{ item: ItemId.RawCopper, count: 1 }],
        output: { item: ItemId.CopperIngot, count: 1 },
      },
      {
        id: "iron-ingot",
        ingredients: [{ item: ItemId.RawIron, count: 1 }],
        output: { item: ItemId.IronIngot, count: 1 },
      },
      {
        id: "tungsten-ingot",
        ingredients: [{ item: ItemId.RawTungsten, count: 1 }],
        output: { item: ItemId.TungstenIngot, count: 1 },
      },
      {
        id: "copper-pickaxe",
        ingredients: [
          { item: ItemId.CopperIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperPickaxe, count: 1 },
      },
      {
        id: "copper-axe",
        ingredients: [
          { item: ItemId.CopperIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperAxe, count: 1 },
      },
      {
        id: "iron-pickaxe",
        ingredients: [
          { item: ItemId.IronIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronPickaxe, count: 1 },
      },
      {
        id: "iron-axe",
        ingredients: [
          { item: ItemId.IronIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronAxe, count: 1 },
      },
      {
        id: "tungsten-pickaxe",
        ingredients: [
          { item: ItemId.TungstenIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenPickaxe, count: 1 },
      },
      {
        id: "tungsten-axe",
        ingredients: [
          { item: ItemId.TungstenIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenAxe, count: 1 },
      },
      {
        id: "torch",
        ingredients: [
          { item: ItemId.Stick, count: 1 },
          { item: ItemId.Coal, count: 1 },
        ],
        output: { item: ItemId.Torch, count: 4 },
      },
      {
        id: "lantern",
        ingredients: [
          { item: ItemId.Torch, count: 1 },
          { item: ItemId.IronIngot, count: 1 },
        ],
        output: { item: ItemId.Lantern, count: 1 },
      },
      {
        id: "chest",
        ingredients: [{ item: ItemId.Wood, count: 8 }],
        output: { item: ItemId.Chest, count: 1 },
      },
      {
        id: "wood-shovel",
        ingredients: [
          { item: ItemId.Log, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodShovel, count: 1 },
      },
      {
        id: "stone-shovel",
        ingredients: [
          { item: ItemId.Stone, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneShovel, count: 1 },
      },
      {
        id: "copper-shovel",
        ingredients: [
          { item: ItemId.CopperIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperShovel, count: 1 },
      },
      {
        id: "iron-shovel",
        ingredients: [
          { item: ItemId.IronIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronShovel, count: 1 },
      },
      {
        id: "tungsten-shovel",
        ingredients: [
          { item: ItemId.TungstenIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenShovel, count: 1 },
      },
      {
        id: "wood-sword",
        ingredients: [
          { item: ItemId.Log, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.WoodSword, count: 1 },
      },
      {
        id: "stone-sword",
        ingredients: [
          { item: ItemId.Stone, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.StoneSword, count: 1 },
      },
      {
        id: "copper-sword",
        ingredients: [
          { item: ItemId.CopperIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.CopperSword, count: 1 },
      },
      {
        id: "iron-sword",
        ingredients: [
          { item: ItemId.IronIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.IronSword, count: 1 },
      },
      {
        id: "tungsten-sword",
        ingredients: [
          { item: ItemId.TungstenIngot, count: 3 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.TungstenSword, count: 1 },
      },
      {
        id: "blowgun",
        ingredients: [{ item: ItemId.Stick, count: 3 }],
        output: { item: ItemId.Blowgun, count: 1 },
      },
      {
        id: "poison-dart",
        ingredients: [
          { item: ItemId.VenomSack, count: 1 },
          { item: ItemId.Stick, count: 2 },
        ],
        output: { item: ItemId.PoisonDart, count: 4 },
      },
      {
        id: "cloth",
        ingredients: [{ item: ItemId.String, count: 6 }],
        output: { item: ItemId.Cloth, count: 1 },
      },
      {
        id: "flag",
        ingredients: [
          { item: ItemId.Cloth, count: 2 },
          { item: ItemId.Wood, count: 1 },
        ],
        output: { item: ItemId.Flag, count: 1 },
      },
      {
        id: "dye-white",
        ingredients: [{ item: ItemId.FlowerWhite, count: 1 }],
        output: { item: ItemId.DyeWhite, count: 1 },
      },
      {
        id: "dye-blue",
        ingredients: [{ item: ItemId.FlowerBlue, count: 1 }],
        output: { item: ItemId.DyeBlue, count: 1 },
      },
      {
        id: "dye-red",
        ingredients: [{ item: ItemId.FlowerRed, count: 1 }],
        output: { item: ItemId.DyeRed, count: 1 },
      },
      {
        id: "dye-yellow",
        ingredients: [{ item: ItemId.FlowerYellow, count: 1 }],
        output: { item: ItemId.DyeYellow, count: 1 },
      },
      {
        id: "dye-black",
        ingredients: [{ item: ItemId.Coal, count: 1 }],
        output: { item: ItemId.DyeBlack, count: 1 },
      },
      {
        id: "dye-purple",
        ingredients: [
          { item: ItemId.DyeBlue, count: 1 },
          { item: ItemId.DyeRed, count: 1 },
        ],
        output: { item: ItemId.DyePurple, count: 2 },
      },
      {
        id: "dye-green",
        ingredients: [
          { item: ItemId.DyeYellow, count: 1 },
          { item: ItemId.DyeBlue, count: 1 },
        ],
        output: { item: ItemId.DyeGreen, count: 2 },
      },
      {
        id: "dye-orange",
        ingredients: [
          { item: ItemId.DyeRed, count: 1 },
          { item: ItemId.DyeYellow, count: 1 },
        ],
        output: { item: ItemId.DyeOrange, count: 2 },
      },
      {
        id: "dye-gray",
        ingredients: [
          { item: ItemId.DyeWhite, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeGray, count: 2 },
      },
      {
        id: "dye-dark-blue",
        ingredients: [
          { item: ItemId.DyeBlue, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkBlue, count: 2 },
      },
      {
        id: "dye-dark-red",
        ingredients: [
          { item: ItemId.DyeRed, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkRed, count: 2 },
      },
      {
        id: "dye-dark-yellow",
        ingredients: [
          { item: ItemId.DyeYellow, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkYellow, count: 2 },
      },
      {
        id: "dye-dark-green",
        ingredients: [
          { item: ItemId.DyeGreen, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkGreen, count: 2 },
      },
      {
        id: "dye-dark-purple",
        ingredients: [
          { item: ItemId.DyePurple, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
        ],
        output: { item: ItemId.DyeDarkPurple, count: 2 },
      },
      {
        id: "dye-dark-orange",
        ingredients: [
          { item: ItemId.DyeOrange, count: 1 },
          { item: ItemId.DyeBlack, count: 1 },
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
