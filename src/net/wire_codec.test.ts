import { describe, expect, it } from "vitest";

import { BlockType, ItemId } from "../game/index.js";
import { anarchy } from "../gen/anarchy.js";
import {
  blockTypeFromWire,
  itemIdFromWire,
  slotFromWire,
  tileFromWire,
} from "./wire_codec.js";

describe("blockTypeFromWire", () => {
  it("round-trips every documented BlockType variant", () => {
    const pairs: Array<[anarchy.v1.BlockType, BlockType]> = [
      [anarchy.v1.BlockType.BLOCK_TYPE_AIR, BlockType.Air],
      [anarchy.v1.BlockType.BLOCK_TYPE_GRASS, BlockType.Grass],
      [anarchy.v1.BlockType.BLOCK_TYPE_WOOD, BlockType.Wood],
      [anarchy.v1.BlockType.BLOCK_TYPE_STONE, BlockType.Stone],
      [anarchy.v1.BlockType.BLOCK_TYPE_GOLD, BlockType.Gold],
      [anarchy.v1.BlockType.BLOCK_TYPE_TREE, BlockType.Tree],
      [anarchy.v1.BlockType.BLOCK_TYPE_STICKS, BlockType.Sticks],
      [anarchy.v1.BlockType.BLOCK_TYPE_HIDDEN, BlockType.Hidden],
      [anarchy.v1.BlockType.BLOCK_TYPE_FLOWER_RED, BlockType.FlowerRed],
      [anarchy.v1.BlockType.BLOCK_TYPE_FLOWER_YELLOW, BlockType.FlowerYellow],
      [anarchy.v1.BlockType.BLOCK_TYPE_FLOWER_BLUE, BlockType.FlowerBlue],
      [anarchy.v1.BlockType.BLOCK_TYPE_FLOWER_WHITE, BlockType.FlowerWhite],
      [anarchy.v1.BlockType.BLOCK_TYPE_BUSH, BlockType.Bush],
      [anarchy.v1.BlockType.BLOCK_TYPE_DIRT, BlockType.Dirt],
      [anarchy.v1.BlockType.BLOCK_TYPE_SAND, BlockType.Sand],
      [anarchy.v1.BlockType.BLOCK_TYPE_GRAVEL, BlockType.Gravel],
      [anarchy.v1.BlockType.BLOCK_TYPE_STONE_LIGHT, BlockType.StoneLight],
      [anarchy.v1.BlockType.BLOCK_TYPE_STONE_DARK, BlockType.StoneDark],
      [anarchy.v1.BlockType.BLOCK_TYPE_COPPER_ORE, BlockType.CopperOre],
      [anarchy.v1.BlockType.BLOCK_TYPE_IRON_ORE, BlockType.IronOre],
      [anarchy.v1.BlockType.BLOCK_TYPE_TUNGSTEN_ORE, BlockType.TungstenOre],
      [anarchy.v1.BlockType.BLOCK_TYPE_COAL_ORE, BlockType.CoalOre],
      [anarchy.v1.BlockType.BLOCK_TYPE_DIAMOND_ORE, BlockType.DiamondOre],
      [anarchy.v1.BlockType.BLOCK_TYPE_TORCH, BlockType.Torch],
      [anarchy.v1.BlockType.BLOCK_TYPE_CHEST, BlockType.Chest],
      [anarchy.v1.BlockType.BLOCK_TYPE_TOMBSTONE, BlockType.Tombstone],
      [
        anarchy.v1.BlockType.BLOCK_TYPE_LIGHT_MUSHROOM,
        BlockType.LightMushroom,
      ],
    ];
    for (const [wire, kind] of pairs) {
      expect(blockTypeFromWire(wire)).toBe(kind);
    }
  });

  it("falls back to Air on unknown wire values", () => {
    expect(blockTypeFromWire(undefined)).toBe(BlockType.Air);
    expect(blockTypeFromWire(null)).toBe(BlockType.Air);
    expect(blockTypeFromWire(9999 as anarchy.v1.BlockType)).toBe(BlockType.Air);
  });
});

describe("tileFromWire", () => {
  it("unpacks chunkCoord + localX/Y into the flat shape", () => {
    expect(
      tileFromWire({
        chunkCoord: { cx: 3, cy: -4 },
        localX: 7,
        localY: 9,
      }),
    ).toEqual({ cx: 3, cy: -4, lx: 7, ly: 9 });
  });

  it("defaults missing scalar fields to 0", () => {
    expect(tileFromWire({ chunkCoord: {} })).toEqual({
      cx: 0,
      cy: 0,
      lx: 0,
      ly: 0,
    });
  });

  it("returns null when chunkCoord is absent", () => {
    expect(tileFromWire({ localX: 1, localY: 2 })).toBeNull();
    expect(tileFromWire({ chunkCoord: null, localX: 1 })).toBeNull();
    expect(tileFromWire(null)).toBeNull();
    expect(tileFromWire(undefined)).toBeNull();
  });
});

describe("slotFromWire", () => {
  it("decodes a non-empty slot into ItemStack", () => {
    expect(
      slotFromWire({ item: anarchy.v1.ItemId.ITEM_ID_STONE, count: 4 }),
    ).toEqual({ item: ItemId.Stone, count: 4 });
  });

  it("returns null for empty slots (count === 0)", () => {
    expect(
      slotFromWire({ item: anarchy.v1.ItemId.ITEM_ID_STONE, count: 0 }),
    ).toBeNull();
    expect(slotFromWire({ item: anarchy.v1.ItemId.ITEM_ID_STONE })).toBeNull();
  });

  it("returns null for unknown / unset item ids even with a positive count", () => {
    expect(slotFromWire({ count: 5 })).toBeNull();
    expect(
      slotFromWire({ item: 9999 as anarchy.v1.ItemId, count: 5 }),
    ).toBeNull();
  });
});

describe("itemIdFromWire", () => {
  it("round-trips a representative set of variants", () => {
    expect(itemIdFromWire(anarchy.v1.ItemId.ITEM_ID_STICK)).toBe(ItemId.Stick);
    expect(itemIdFromWire(anarchy.v1.ItemId.ITEM_ID_WOOD_PICKAXE)).toBe(
      ItemId.WoodPickaxe,
    );
    expect(itemIdFromWire(anarchy.v1.ItemId.ITEM_ID_FLAG)).toBe(ItemId.Flag);
  });

  it("returns null for the proto3 sentinel and unknown ids", () => {
    expect(itemIdFromWire(undefined)).toBeNull();
    expect(itemIdFromWire(null)).toBeNull();
    expect(itemIdFromWire(9999 as anarchy.v1.ItemId)).toBeNull();
  });
});
