/**
 * Client-side mirror of the server's `ITEM_REGISTRY`
 * (see `anarchy-server/src/game/item/mod.rs`). One [`ItemMeta`] entry per
 * `ItemId` carrying the fields the client UI consumes (display name,
 * texture URL, places-a-block hint). Runtime behaviour (validation, drops,
 * crafting outcomes) still asks the server — this table is purely the
 * client's render-time lookup.
 *
 * Names are display-only — wire / mirror code uses the `ItemId` enum and
 * never these strings. Keep the table in lockstep with the server registry
 * whenever an item kind lands.
 */

import { BlockType, ItemId } from "./game/index.js";

/**
 * Per-item static data the client needs at render time. Mirrors
 * `ItemMetadata` on the server — only the rendering-relevant subset is
 * carried (display string, what block the item places, and the texture URL).
 */
export interface ItemMeta {
  readonly id: ItemId;
  readonly displayName: string;
  /** Block the item places when the player right-clicks. `null` for tools. */
  readonly placesBlock: BlockType | null;
  /** URL of the 64×64 PNG icon, or `null` if there's no rendered texture. */
  readonly textureUrl: string | null;
}

const BLOCK_TEXTURES_BASE = "/textures/blocks";
const ITEM_TEXTURES_BASE = "/textures/items";

/**
 * Single source of truth for per-`ItemId` static metadata on the client.
 * Keys are the `ItemId` numeric enum; the table covers every variant. Items
 * that place a block share that block's texture; tools have their own
 * dedicated icon under `/textures/items/<material>-<tool>.png`. Adding an
 * `ItemId` variant requires a matching entry here and on the server.
 */
export const ITEM_REGISTRY: Record<ItemId, ItemMeta> = {
  [ItemId.Stick]: {
    id: ItemId.Stick,
    displayName: "Stick",
    placesBlock: BlockType.Sticks,
    textureUrl: `${BLOCK_TEXTURES_BASE}/sticks.png`,
  },
  [ItemId.Wood]: {
    id: ItemId.Wood,
    displayName: "Wood",
    placesBlock: BlockType.Wood,
    textureUrl: `${BLOCK_TEXTURES_BASE}/wood.png`,
  },
  [ItemId.Stone]: {
    id: ItemId.Stone,
    displayName: "Stone",
    placesBlock: BlockType.Stone,
    textureUrl: `${BLOCK_TEXTURES_BASE}/stone.png`,
  },
  [ItemId.Gold]: {
    id: ItemId.Gold,
    displayName: "Gold",
    placesBlock: BlockType.Gold,
    textureUrl: `${BLOCK_TEXTURES_BASE}/gold.png`,
  },
  [ItemId.WoodPickaxe]: {
    id: ItemId.WoodPickaxe,
    displayName: "Wood Pickaxe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/wood-pickaxe.png`,
  },
  [ItemId.StonePickaxe]: {
    id: ItemId.StonePickaxe,
    displayName: "Stone Pickaxe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/stone-pickaxe.png`,
  },
  [ItemId.CopperPickaxe]: {
    id: ItemId.CopperPickaxe,
    displayName: "Copper Pickaxe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/copper-pickaxe.png`,
  },
  [ItemId.IronPickaxe]: {
    id: ItemId.IronPickaxe,
    displayName: "Iron Pickaxe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/iron-pickaxe.png`,
  },
  [ItemId.TungstenPickaxe]: {
    id: ItemId.TungstenPickaxe,
    displayName: "Tungsten Pickaxe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/tungsten-pickaxe.png`,
  },
  [ItemId.WoodAxe]: {
    id: ItemId.WoodAxe,
    displayName: "Wood Axe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/wood-axe.png`,
  },
  [ItemId.StoneAxe]: {
    id: ItemId.StoneAxe,
    displayName: "Stone Axe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/stone-axe.png`,
  },
  [ItemId.CopperAxe]: {
    id: ItemId.CopperAxe,
    displayName: "Copper Axe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/copper-axe.png`,
  },
  [ItemId.IronAxe]: {
    id: ItemId.IronAxe,
    displayName: "Iron Axe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/iron-axe.png`,
  },
  [ItemId.TungstenAxe]: {
    id: ItemId.TungstenAxe,
    displayName: "Tungsten Axe",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/tungsten-axe.png`,
  },
  [ItemId.FlowerRed]: {
    id: ItemId.FlowerRed,
    displayName: "Red Flower",
    placesBlock: BlockType.FlowerRed,
    textureUrl: `${BLOCK_TEXTURES_BASE}/flower-red.png`,
  },
  [ItemId.FlowerYellow]: {
    id: ItemId.FlowerYellow,
    displayName: "Yellow Flower",
    placesBlock: BlockType.FlowerYellow,
    textureUrl: `${BLOCK_TEXTURES_BASE}/flower-yellow.png`,
  },
  [ItemId.FlowerBlue]: {
    id: ItemId.FlowerBlue,
    displayName: "Blue Flower",
    placesBlock: BlockType.FlowerBlue,
    textureUrl: `${BLOCK_TEXTURES_BASE}/flower-blue.png`,
  },
  [ItemId.FlowerWhite]: {
    id: ItemId.FlowerWhite,
    displayName: "White Flower",
    placesBlock: BlockType.FlowerWhite,
    textureUrl: `${BLOCK_TEXTURES_BASE}/flower-white.png`,
  },
  [ItemId.Bush]: {
    id: ItemId.Bush,
    displayName: "Bush",
    placesBlock: BlockType.Bush,
    textureUrl: `${BLOCK_TEXTURES_BASE}/bush.png`,
  },
  [ItemId.Dirt]: {
    id: ItemId.Dirt,
    displayName: "Dirt",
    placesBlock: BlockType.Dirt,
    textureUrl: `${BLOCK_TEXTURES_BASE}/dirt.png`,
  },
  [ItemId.Sand]: {
    id: ItemId.Sand,
    displayName: "Sand",
    placesBlock: BlockType.Sand,
    textureUrl: `${BLOCK_TEXTURES_BASE}/sand.png`,
  },
  [ItemId.Gravel]: {
    id: ItemId.Gravel,
    displayName: "Gravel",
    placesBlock: BlockType.Gravel,
    textureUrl: `${BLOCK_TEXTURES_BASE}/gravel.png`,
  },
  [ItemId.StoneLight]: {
    id: ItemId.StoneLight,
    displayName: "Light Stone",
    placesBlock: BlockType.StoneLight,
    textureUrl: `${BLOCK_TEXTURES_BASE}/stone-light.png`,
  },
  [ItemId.StoneDark]: {
    id: ItemId.StoneDark,
    displayName: "Dark Stone",
    placesBlock: BlockType.StoneDark,
    textureUrl: `${BLOCK_TEXTURES_BASE}/stone-dark.png`,
  },
  [ItemId.RawCopper]: {
    id: ItemId.RawCopper,
    displayName: "Raw Copper",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/raw-copper.png`,
  },
  [ItemId.RawIron]: {
    id: ItemId.RawIron,
    displayName: "Raw Iron",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/raw-iron.png`,
  },
  [ItemId.RawTungsten]: {
    id: ItemId.RawTungsten,
    displayName: "Raw Tungsten",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/raw-tungsten.png`,
  },
  [ItemId.Coal]: {
    id: ItemId.Coal,
    displayName: "Coal",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/coal.png`,
  },
  [ItemId.Diamond]: {
    id: ItemId.Diamond,
    displayName: "Diamond",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/diamond.png`,
  },
  [ItemId.CopperIngot]: {
    id: ItemId.CopperIngot,
    displayName: "Copper Ingot",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/copper-ingot.png`,
  },
  [ItemId.IronIngot]: {
    id: ItemId.IronIngot,
    displayName: "Iron Ingot",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/iron-ingot.png`,
  },
  [ItemId.TungstenIngot]: {
    id: ItemId.TungstenIngot,
    displayName: "Tungsten Ingot",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/tungsten-ingot.png`,
  },
  [ItemId.Torch]: {
    id: ItemId.Torch,
    displayName: "Torch",
    placesBlock: BlockType.Torch,
    textureUrl: `${BLOCK_TEXTURES_BASE}/torch.png`,
  },
  [ItemId.Lantern]: {
    id: ItemId.Lantern,
    displayName: "Lantern",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/lantern.png`,
  },
  [ItemId.Log]: {
    id: ItemId.Log,
    displayName: "Log",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/log.png`,
  },
  [ItemId.Chest]: {
    id: ItemId.Chest,
    displayName: "Chest",
    placesBlock: BlockType.Chest,
    textureUrl: `${ITEM_TEXTURES_BASE}/chest.png`,
  },
  [ItemId.WoodShovel]: {
    id: ItemId.WoodShovel,
    displayName: "Wood Shovel",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/wood-shovel.png`,
  },
  [ItemId.StoneShovel]: {
    id: ItemId.StoneShovel,
    displayName: "Stone Shovel",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/stone-shovel.png`,
  },
  [ItemId.CopperShovel]: {
    id: ItemId.CopperShovel,
    displayName: "Copper Shovel",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/copper-shovel.png`,
  },
  [ItemId.IronShovel]: {
    id: ItemId.IronShovel,
    displayName: "Iron Shovel",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/iron-shovel.png`,
  },
  [ItemId.TungstenShovel]: {
    id: ItemId.TungstenShovel,
    displayName: "Tungsten Shovel",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/tungsten-shovel.png`,
  },
  [ItemId.Grass]: {
    id: ItemId.Grass,
    displayName: "Grass",
    placesBlock: BlockType.Grass,
    textureUrl: `${BLOCK_TEXTURES_BASE}/grass.png`,
  },
  [ItemId.LightMushroom]: {
    id: ItemId.LightMushroom,
    displayName: "Light Mushroom",
    placesBlock: BlockType.LightMushroom,
    textureUrl: `${BLOCK_TEXTURES_BASE}/light-mushroom.png`,
  },
  [ItemId.WoodSword]: {
    id: ItemId.WoodSword,
    displayName: "Wood Sword",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/wood-sword.png`,
  },
  [ItemId.StoneSword]: {
    id: ItemId.StoneSword,
    displayName: "Stone Sword",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/stone-sword.png`,
  },
  [ItemId.CopperSword]: {
    id: ItemId.CopperSword,
    displayName: "Copper Sword",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/copper-sword.png`,
  },
  [ItemId.IronSword]: {
    id: ItemId.IronSword,
    displayName: "Iron Sword",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/iron-sword.png`,
  },
  [ItemId.TungstenSword]: {
    id: ItemId.TungstenSword,
    displayName: "Tungsten Sword",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/tungsten-sword.png`,
  },
  [ItemId.String]: {
    id: ItemId.String,
    displayName: "String",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/string.png`,
  },
  [ItemId.VenomSack]: {
    id: ItemId.VenomSack,
    displayName: "Venom Sack",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/venom-sack.png`,
  },
  [ItemId.Blowgun]: {
    id: ItemId.Blowgun,
    displayName: "Blowgun",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/blowgun.png`,
  },
  [ItemId.PoisonDart]: {
    id: ItemId.PoisonDart,
    displayName: "Poison Dart",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/poison-dart.png`,
  },
  [ItemId.Cloth]: {
    id: ItemId.Cloth,
    displayName: "Cloth",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/cloth.png`,
  },
  // Flag's `textureUrl` is a base grayscale PNG; the slot cell applies
  // a runtime tint sourced from `ItemStackExtra.flag.colorIndex` via a
  // multiply-blended overlay so different flag colors read distinctly.
  [ItemId.Flag]: {
    id: ItemId.Flag,
    displayName: "Flag",
    placesBlock: BlockType.Flag,
    textureUrl: `${ITEM_TEXTURES_BASE}/flag.png`,
  },
  // Task 170 dyes — inventory-only ingredients; no `placesBlock`.
  [ItemId.DyeWhite]: {
    id: ItemId.DyeWhite,
    displayName: "White Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-white.png`,
  },
  [ItemId.DyeBlue]: {
    id: ItemId.DyeBlue,
    displayName: "Blue Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-blue.png`,
  },
  [ItemId.DyeRed]: {
    id: ItemId.DyeRed,
    displayName: "Red Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-red.png`,
  },
  [ItemId.DyeYellow]: {
    id: ItemId.DyeYellow,
    displayName: "Yellow Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-yellow.png`,
  },
  [ItemId.DyeBlack]: {
    id: ItemId.DyeBlack,
    displayName: "Black Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-black.png`,
  },
  [ItemId.DyePurple]: {
    id: ItemId.DyePurple,
    displayName: "Purple Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-purple.png`,
  },
  [ItemId.DyeGreen]: {
    id: ItemId.DyeGreen,
    displayName: "Green Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-green.png`,
  },
  [ItemId.DyeOrange]: {
    id: ItemId.DyeOrange,
    displayName: "Orange Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-orange.png`,
  },
  [ItemId.DyeGray]: {
    id: ItemId.DyeGray,
    displayName: "Gray Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-gray.png`,
  },
  [ItemId.DyeDarkBlue]: {
    id: ItemId.DyeDarkBlue,
    displayName: "Dark Blue Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-blue.png`,
  },
  [ItemId.DyeDarkRed]: {
    id: ItemId.DyeDarkRed,
    displayName: "Dark Red Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-red.png`,
  },
  [ItemId.DyeDarkYellow]: {
    id: ItemId.DyeDarkYellow,
    displayName: "Dark Yellow Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-yellow.png`,
  },
  [ItemId.DyeDarkGreen]: {
    id: ItemId.DyeDarkGreen,
    displayName: "Dark Green Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-green.png`,
  },
  [ItemId.DyeDarkPurple]: {
    id: ItemId.DyeDarkPurple,
    displayName: "Dark Purple Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-purple.png`,
  },
  [ItemId.DyeDarkOrange]: {
    id: ItemId.DyeDarkOrange,
    displayName: "Dark Orange Dye",
    placesBlock: null,
    textureUrl: `${ITEM_TEXTURES_BASE}/dye-dark-orange.png`,
  },
  // Task 180 colored concrete items. Each places its matching
  // `BlockType.Concrete*` block via the standard right-click flow; the item
  // icon is the same PNG as the block texture (mirrors the `Stone` pattern).
  [ItemId.ConcreteGray]: {
    id: ItemId.ConcreteGray,
    displayName: "Gray Concrete",
    placesBlock: BlockType.ConcreteGray,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-gray.png`,
  },
  [ItemId.ConcreteWhite]: {
    id: ItemId.ConcreteWhite,
    displayName: "White Concrete",
    placesBlock: BlockType.ConcreteWhite,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-white.png`,
  },
  [ItemId.ConcreteBlue]: {
    id: ItemId.ConcreteBlue,
    displayName: "Blue Concrete",
    placesBlock: BlockType.ConcreteBlue,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-blue.png`,
  },
  [ItemId.ConcreteRed]: {
    id: ItemId.ConcreteRed,
    displayName: "Red Concrete",
    placesBlock: BlockType.ConcreteRed,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-red.png`,
  },
  [ItemId.ConcreteYellow]: {
    id: ItemId.ConcreteYellow,
    displayName: "Yellow Concrete",
    placesBlock: BlockType.ConcreteYellow,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-yellow.png`,
  },
  [ItemId.ConcreteBlack]: {
    id: ItemId.ConcreteBlack,
    displayName: "Black Concrete",
    placesBlock: BlockType.ConcreteBlack,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-black.png`,
  },
  [ItemId.ConcretePurple]: {
    id: ItemId.ConcretePurple,
    displayName: "Purple Concrete",
    placesBlock: BlockType.ConcretePurple,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-purple.png`,
  },
  [ItemId.ConcreteGreen]: {
    id: ItemId.ConcreteGreen,
    displayName: "Green Concrete",
    placesBlock: BlockType.ConcreteGreen,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-green.png`,
  },
  [ItemId.ConcreteOrange]: {
    id: ItemId.ConcreteOrange,
    displayName: "Orange Concrete",
    placesBlock: BlockType.ConcreteOrange,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-orange.png`,
  },
  [ItemId.ConcreteDarkBlue]: {
    id: ItemId.ConcreteDarkBlue,
    displayName: "Dark Blue Concrete",
    placesBlock: BlockType.ConcreteDarkBlue,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-blue.png`,
  },
  [ItemId.ConcreteDarkRed]: {
    id: ItemId.ConcreteDarkRed,
    displayName: "Dark Red Concrete",
    placesBlock: BlockType.ConcreteDarkRed,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-red.png`,
  },
  [ItemId.ConcreteDarkYellow]: {
    id: ItemId.ConcreteDarkYellow,
    displayName: "Dark Yellow Concrete",
    placesBlock: BlockType.ConcreteDarkYellow,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-yellow.png`,
  },
  [ItemId.ConcreteDarkGreen]: {
    id: ItemId.ConcreteDarkGreen,
    displayName: "Dark Green Concrete",
    placesBlock: BlockType.ConcreteDarkGreen,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-green.png`,
  },
  [ItemId.ConcreteDarkPurple]: {
    id: ItemId.ConcreteDarkPurple,
    displayName: "Dark Purple Concrete",
    placesBlock: BlockType.ConcreteDarkPurple,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-purple.png`,
  },
  [ItemId.ConcreteDarkOrange]: {
    id: ItemId.ConcreteDarkOrange,
    displayName: "Dark Orange Concrete",
    placesBlock: BlockType.ConcreteDarkOrange,
    textureUrl: `${BLOCK_TEXTURES_BASE}/concrete-dark-orange.png`,
  },
};

/**
 * Human-readable name for an `ItemId`. Falls back to a generic
 * `Unknown item` for ids not yet listed — preferable to throwing during a
 * UI render in the rare case the wire ships an item ahead of a UI rebuild.
 */
export function itemDisplayName(item: ItemId): string {
  return ITEM_REGISTRY[item]?.displayName ?? "Unknown item";
}
