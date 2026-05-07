/**
 * Block-texture path map. Single source of truth for which file each
 * `BlockType` is rendered as — both the world renderer and the inventory
 * UI consume this. Lives at the top of `src/` (alongside `lobby.ts`,
 * `config.ts`) precisely because it straddles `render/` and `ui/`: keeping
 * the path strings out of `render/` means UI code can import them without
 * pulling `three` into its bundle.
 *
 * Texture bytes are produced by `anarchy-server/dev_utils textures` and
 * checked into `public/textures/blocks/<kind>.png`. Vite serves the
 * `public/` tree at the URL paths returned here.
 */

import { BlockType, ItemId } from "./game/index.js";

/**
 * URL of the 16×16 PNG for each visible block kind. `Air` deliberately has
 * no entry — there's no texture for "no block", and the renderer's per-kind
 * branches all guard against `Air` before reaching the texture lookup.
 */
export const BLOCK_TEXTURE_URLS: Partial<Record<BlockType, string>> = {
  [BlockType.Grass]: "/textures/blocks/grass.png",
  [BlockType.Stone]: "/textures/blocks/stone.png",
  [BlockType.Wood]: "/textures/blocks/wood.png",
  [BlockType.Gold]: "/textures/blocks/gold.png",
  [BlockType.Tree]: "/textures/blocks/tree.png",
  [BlockType.Sticks]: "/textures/blocks/sticks.png",
};

/**
 * Texture URL for a `BlockType`, or `null` if the kind has no rendered
 * texture (today: only `Air`).
 */
export function textureUrlForBlock(kind: BlockType): string | null {
  return BLOCK_TEXTURE_URLS[kind] ?? null;
}

/**
 * Texture URL for an inventory `ItemId`. Items that place a block share
 * that block's texture; future tool / consumable items will return their
 * own paths or `null`. Mirrors the `places_block` mapping in the server's
 * item registry — keep in lockstep when adding items.
 */
export function textureUrlForItem(item: ItemId): string | null {
  switch (item) {
    case ItemId.Stick:
      return BLOCK_TEXTURE_URLS[BlockType.Sticks] ?? null;
    case ItemId.Wood:
      return BLOCK_TEXTURE_URLS[BlockType.Wood] ?? null;
    case ItemId.Stone:
      return BLOCK_TEXTURE_URLS[BlockType.Stone] ?? null;
    case ItemId.Gold:
      return BLOCK_TEXTURE_URLS[BlockType.Gold] ?? null;
  }
  return null;
}
