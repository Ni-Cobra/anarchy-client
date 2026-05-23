/**
 * Client-side mirror of the server's crafting recipe table (task 090).
 *
 * The wire surface only ships *recipe ids* — stable strings like
 * `"wood-pickaxe"` — so the client can render the ingredient/output preview
 * for each currently-craftable recipe without any wire growth. This module
 * is the lookup table that turns those ids into the data the crafting panel
 * paints. Mirrors `anarchy-server/src/game/player/crafting.rs::RECIPES`
 * exactly; the two tables are the only redundant copy in the project (per
 * the charter: "Avoid redundancy *except* across the client/server
 * boundary").
 *
 * Lives at the top of `src/` (alongside `textures.ts` / `item_names.ts`)
 * because it straddles the network mirror (the `Inventory` ships recipe
 * ids that need this lookup) and the UI (`ui/crafting/` paints the rows).
 */

import { ItemId } from "./game/index.js";

/** One output stack of a recipe (or, historically, one ingredient). */
export interface RecipeStack {
  readonly item: ItemId;
  readonly count: number;
}

/**
 * One ingredient clause of a recipe (task 175). Mirrors the server's
 * `Ingredient` enum:
 *
 * - `{ kind: "one" }` — exactly `count` of one specific item from the
 *   pooled inventory + open chests. The original shape.
 * - `{ kind: "any-of" }` — satisfied when the *pooled* count across every
 *   listed item meets `count`, in any combination. Deduction walks the
 *   list in declaration order — earlier entries drain first.
 */
export type Ingredient =
  | { readonly kind: "one"; readonly item: ItemId; readonly count: number }
  | {
      readonly kind: "any-of";
      readonly items: readonly ItemId[];
      readonly count: number;
    };

/**
 * One recipe row: a stable string id, the pooled ingredients required, and
 * the single-stack output the server inserts on a successful craft. The
 * client paints the row as `[ingredients] → [output]`; clicking it ships a
 * `CraftRequest(id)` to the server, which is authoritative.
 */
export interface Recipe {
  readonly id: string;
  readonly ingredients: readonly Ingredient[];
  readonly output: RecipeStack;
}

/**
 * Recipe table. Order matches the server table so a recipe id served by
 * the server resolves cheaply via [`recipeById`]. Keep in lockstep with
 * `crafting.rs::RECIPES` — when a new recipe lands server-side, mirror it
 * here in the same iteration (the charter pins this kind of cross-boundary
 * redundancy as expected).
 */
export const RECIPES: readonly Recipe[] = [
  {
    id: "sticks",
    ingredients: [{ kind: "one", item: ItemId.Wood, count: 1 }],
    output: { item: ItemId.Stick, count: 4 },
  },
  // Task 390: trees drop `Log` items now. Logs craft into Wood blocks
  // (1:1) and into Sticks (1 Log → 4 Sticks).
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
  // Task 580: wood-tier pickaxe + shovel now take raw `Log`s rather than
  // refined `Wood` planks (the wood-axe recipe still uses planks so the
  // shape stays asymmetric).
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
  // Task 150 smelting recipes — 1 raw → 1 ingot.
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
  // Task 150 tool-tier upgrades.
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
  // Task 350 light-source recipe: 1 Stick + 1 Coal → 4 Torches.
  {
    id: "torch",
    ingredients: [
      { kind: "one", item: ItemId.Stick, count: 1 },
      { kind: "one", item: ItemId.Coal, count: 1 },
    ],
    output: { item: ItemId.Torch, count: 4 },
  },
  // Task 370 first Utility item: 1 Torch + 1 IronIngot → 1 Lantern.
  {
    id: "lantern",
    ingredients: [
      { kind: "one", item: ItemId.Torch, count: 1 },
      { kind: "one", item: ItemId.IronIngot, count: 1 },
    ],
    output: { item: ItemId.Lantern, count: 1 },
  },
  // Task 420 placeable storage: 8 Wood → 1 Chest.
  {
    id: "chest",
    ingredients: [{ kind: "one", item: ItemId.Wood, count: 8 }],
    output: { item: ItemId.Chest, count: 1 },
  },
  // Task 530 shovel ladder — mirrors the axe ladder exactly.
  // Task 580: wood-tier shovel takes raw `Log`s — see the wood-pickaxe note.
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
  // Task 050 sword ladder — mirrors the pickaxe / shovel shape exactly
  // (3 of the head material + 2 sticks → 1 sword). Wood-sword consumes
  // raw `Log`s for symmetry with the wood-pickaxe / wood-shovel path.
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
  // Task 190 — blowgun (single-tier, 3 Sticks → 1 Blowgun) and poison-dart
  // (1 VenomSack + 2 Sticks → 4 PoisonDart). The blowgun slots into the
  // dedicated combat-tool slot (mutually exclusive with the sword); the
  // dart is the ammunition for task 200's shoot mechanic.
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
  // Task 220 — woven cloth + colored flag. The flag output is stamped
  // server-side with the crafter's color via `ItemStackExtra.flag`; the
  // client doesn't see the color until the inventory mirror updates,
  // since this table just describes the recipe shape.
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
  // Task 170 — dyes. Five source recipes, three RGB combos, seven dark
  // variants. Combos / darks output 2 dyes per 1+1 inputs so the palette
  // can expand without burning ingredients at 1:1.
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
];

const RECIPES_BY_ID: ReadonlyMap<string, Recipe> = new Map(
  RECIPES.map((r) => [r.id, r]),
);

/**
 * Lookup a recipe by stable id. Returns `undefined` if the id is unknown
 * — the crafting UI ignores unknown ids defensively so a server that adds
 * a recipe ahead of a client rebuild simply hides the row instead of
 * throwing on render.
 */
export function recipeById(id: string): Recipe | undefined {
  return RECIPES_BY_ID.get(id);
}
