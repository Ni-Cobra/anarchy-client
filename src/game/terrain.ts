/**
 * Client-side mirror of the server's `game::terrain` data model. Pure data +
 * math; no networking. The shape (block kinds, layer size, two-layer chunks
 * carrying their players, sparse `Terrain` map) tracks ADR 0002 (terrain
 * model) and ADR 0003 (chunk-centric networking — players live in chunks)
 * in the server repo, so the proto payloads ingested in `net/wire.ts` map
 * 1:1 onto these types.
 *
 * The `Terrain` map is keyed by a single packed `(cx, cy)` number
 * (`chunkKeyNum`) under the hood — ES Maps compare object keys by reference,
 * so a tuple is useless, and the previous `"cx,cy"` string form allocated a
 * fresh string on every lookup. The public API takes plain `(cx, cy)` numbers
 * and never exposes the packed key. `chunkKey` / `parseChunkKey` (string
 * form) stay around for tests and debug printing.
 */

import type { Entity, EntityId } from "./entity.js";
import type { Player, PlayerId } from "./player.js";

/**
 * Kind of a single block. Numeric values match the planned proto enum
 * (`Air = 0` is the proto3 default sentinel) so a future `BlockType` field
 * on the wire can be cast directly.
 */
export enum BlockType {
  Air = 0,
  Grass = 1,
  Wood = 2,
  Stone = 3,
  Gold = 4,
  Tree = 5,
  Sticks = 6,
  /**
   * Anti-cheat occlusion sentinel. The server emits this for any
   * cell the local player cannot see (top-layer block boxed in by four
   * full neighbors, or ground cell directly under a full top block) so the
   * underlying kind never reaches the client. Renders as a neutral
   * occluder; targeting / breaking / placing onto a `Hidden` cell is
   * rejected client-side, mirroring the server's validation. Wire-only —
   * the server never holds this kind in authoritative state.
   */
  Hidden = 7,
  /**
   * Decorative top-layer flowers. Non-solid (players walk
   * through), single-tick break, drop their matching `ItemId.Flower*`. The
   * client renders them as a low-profile decal hugging the ground similar
   * to `Sticks`, with a per-variant color accent.
   */
  FlowerRed = 8,
  FlowerYellow = 9,
  FlowerBlue = 10,
  FlowerWhite = 11,
  /**
   * Decorative top-layer bush. Non-solid; breaks in two damage
   * ticks and drops 1-2 `ItemId.Stick`s into the breaker's inventory
   * server-side.
   */
  Bush = 12,
  /**
   * ground-block-variety set. All five behave like existing solid
   * full blocks (placeable, walkable top, faster-with-pickaxe). `StoneLight`
   * and `StoneDark` are render-only sibling variants of `Stone` — same
   * gameplay, different texture.
   */
  Dirt = 13,
  Sand = 14,
  Gravel = 15,
  StoneLight = 16,
  StoneDark = 17,
  /**
   * ore set. Solid full blocks scattered into the top layer by the
   * server's ore worldgen pass. Each ore gates breaking on a minimum
   * pickaxe tier (server `BlockMeta::min_tool_tier`); the client mirror
   * lives in [`textures.ts`] so the break_place gate can refuse to send a
   * `BreakIntent` for a tier-gated block the player can't mine.
   */
  CopperOre = 18,
  IronOre = 19,
  TungstenOre = 20,
  CoalOre = 21,
  DiamondOre = 22,
  /**
   * placed-light source. Top-layer-only, non-solid (walk-through),
   * low durability. Crafted from `Stick + Coal` → 4 Torches and placed via
   * the standard right-click flow. The renderer wraps each torch in a
   * `THREE.PointLight` whose intensity scales with the night factor.
   */
  Torch = 23,
  /**
   * placeable storage. Top-layer-only, solid, axe-broken. Right-
   * clicking a chest in range opens its inventory alongside the player's
   * grid; the server tracks the open chest server-side and ships
   * `ChestUpdate` per tick the contents change.
   */
  Chest = 24,
  /**
   * disconnect-loot grave. Top-layer-only, solid,
   * axe-broken. Spawned by the server at an unregistered (anonymous)
   * player's last position when they disconnect, carrying their full
   * inventory. Right-clicking opens the same UI as a chest (same
   * `OpenChest` action). Tombstones have no place item; only the
   * disconnect path produces them.
   */
  Tombstone = 25,
  /**
   * bioluminescent mushroom. Top-layer-only, non-solid (walk-
   * through), low durability, hand-broken. Drops `ItemId.LightMushroom`.
   * Worldgen scatters them in Dense Forest and inside mountain caves; the
   * renderer attaches a per-block soft cool point light weaker than a
   * torch (see `mushroom_lights.ts`).
   */
  LightMushroom = 26,
  /**
   * placeable colored flag. Top-layer-only, solid (`is_solid_top`)
   * but not a full cube — the renderer paints a pole + cloth tinted by the
   * per-cell `colorIndex` from the parallel `Chunk.flagBlocks` map.
   * Worldgen never generates flags; they enter the world only via player
   * placement.
   */
  Flag = 27,
  /**
   * colored concrete blocks. 15 sibling variants — one per dye
   * color — gameplay-identical to `Stone` (full solid,
   * pickaxe-broken, no tier requirement). Per-variant `BlockType` keeps the
   * atlas flat; no per-cell color extra. Never generated by worldgen —
   * only ever placed by players. Crafted from `1 stone-of-any-kind → 1
   * Gray Concrete` (pooled `AnyOf` over the three stone variants) and
   * `4 any-concrete + 1 matching dye → 4 colored concrete` (re-dyeable
   * in either direction).
   */
  ConcreteGray = 28,
  ConcreteWhite = 29,
  ConcreteBlue = 30,
  ConcreteRed = 31,
  ConcreteYellow = 32,
  ConcreteBlack = 33,
  ConcretePurple = 34,
  ConcreteGreen = 35,
  ConcreteOrange = 36,
  ConcreteDarkBlue = 37,
  ConcreteDarkRed = 38,
  ConcreteDarkYellow = 39,
  ConcreteDarkGreen = 40,
  ConcreteDarkPurple = 41,
  ConcreteDarkOrange = 42,
}

/**
 * One tile. The `kind` field is the only thing carried today; future
 * metadata (variant, hp, owner, lighting, …) attaches here, mirroring the
 * server's `Block` struct rather than collapsing to a bare enum.
 */
export interface Block {
  readonly kind: BlockType;
}

/**
 * Per-kind frozen `Block` singleton table. The wire decoder and
 * {@link filledLayer} pull through {@link blockForKind} so every cell of a
 * given kind shares one frozen reference — collapses the 512-per-chunk
 * `{ kind }` POJO allocations from `blockFromWire` to zero. Since `Block`
 * is a single-field POJO today, identity-sharing is safe; future metadata
 * (per-instance hp, owner, etc.) would have to break this pattern.
 */
const BLOCK_BY_KIND: ReadonlyMap<BlockType, Block> = (() => {
  const m = new Map<BlockType, Block>();
  for (const v of Object.values(BlockType)) {
    if (typeof v === "number") {
      const kind = v as BlockType;
      m.set(kind, Object.freeze({ kind }));
    }
  }
  return m;
})();

/**
 * Return the shared frozen `Block` singleton for `kind`. Hot-path callers
 * (wire decode, `filledLayer`) should prefer this over `{ kind }` literals
 * so the per-cell allocation stays at zero.
 */
export function blockForKind(kind: BlockType): Block {
  const b = BLOCK_BY_KIND.get(kind);
  if (b === undefined) {
    throw new RangeError(`unknown BlockType: ${kind}`);
  }
  return b;
}

/** Pre-built `{ kind: Air }`. Convenient for default-filling layers. */
export const AIR_BLOCK: Block = blockForKind(BlockType.Air);

/** Tile-side length of a layer, in blocks. */
export const LAYER_SIZE = 16;

/** Number of blocks in a layer (`LAYER_SIZE * LAYER_SIZE`). */
export const LAYER_AREA = LAYER_SIZE * LAYER_SIZE;

/**
 * Tile-side length of a chunk. Equal to `LAYER_SIZE` — every chunk is one
 * `LAYER_SIZE × LAYER_SIZE` square per layer.
 */
export const CHUNK_SIZE = LAYER_SIZE;

/**
 * Spatial address of a chunk, `[chunk_x, chunk_y]`. Mirrors the server's
 * `game::ChunkCoord` (`(i32, i32)`). The proto layer in `net/wire.ts` is the
 * only place this alias is unwrapped to/from the wire `ChunkCoord` message.
 */
export type ChunkCoord = readonly [number, number];

/**
 * Map a local 2D layer coordinate to a flat-array index. The layer has
 * fixed dimensions, so out-of-range coords are a programmer error and
 * throw — mirrors the server `Layer::idx` panic.
 */
export function layerIdx(x: number, y: number): number {
  if (!Number.isInteger(x) || x < 0 || x >= LAYER_SIZE) {
    throw new RangeError(`layer x out of bounds: ${x}`);
  }
  if (!Number.isInteger(y) || y < 0 || y >= LAYER_SIZE) {
    throw new RangeError(`layer y out of bounds: ${y}`);
  }
  return y * LAYER_SIZE + x;
}

export interface Layer {
  readonly blocks: Block[];
}

export function emptyLayer(): Layer {
  const blocks = new Array<Block>(LAYER_AREA);
  for (let i = 0; i < LAYER_AREA; i++) blocks[i] = AIR_BLOCK;
  return { blocks };
}

export function filledLayer(kind: BlockType): Layer {
  const block = blockForKind(kind);
  const blocks = new Array<Block>(LAYER_AREA);
  for (let i = 0; i < LAYER_AREA; i++) blocks[i] = block;
  return { blocks };
}

export function getBlock(layer: Layer, x: number, y: number): Block {
  return layer.blocks[layerIdx(x, y)];
}

export function setBlock(layer: Layer, x: number, y: number, block: Block): void {
  layer.blocks[layerIdx(x, y)] = block;
}

/**
 * Per-cell flag state attached to a placed `BlockType.Flag` tile in a chunk
 *. One entry per flag cell — keyed by `flagCellKey(lx, ly)` —
 * carrying the color frozen at craft time. The renderer reads this to
 * tint the rendered pole + cloth.
 */
export interface FlagBlockState {
  readonly colorIndex: number;
}

/**
 * Stable packed key for a flag cell `(lx, ly)` inside a chunk. `lx` / `ly`
 * are each in `[0, LAYER_SIZE)` (u8 on the wire), so a single u16 packs the
 * pair with zero allocations — `Map<number, FlagBlockState>` lookups skip
 * the per-call string concatenation the old `"lx,ly"` form forced.
 */
export function flagCellKey(lx: number, ly: number): number {
  return (ly << 8) | lx;
}

/**
 * One chunk: walkable `ground` floor + sparse `top` standing geometry +
 * the players whose center currently falls inside the chunk + the
 * tile-bound entities hosted by the chunk + the
 * sparse per-cell flag color map. Naming mirrors the server
 * `Chunk { ground, top, players, entities, flags }`.
 */
export interface Chunk {
  readonly ground: Layer;
  readonly top: Layer;
  readonly players: ReadonlyMap<PlayerId, Player>;
  readonly entities: ReadonlyMap<EntityId, Entity>;
  /**
   * Sparse per-cell flag color, keyed by the packed `flagCellKey(lx, ly)`
   * u16. An entry exists iff the matching `top` cell holds
   * `BlockType.Flag`. Empty when no flags are placed in this chunk.
   */
  readonly flagBlocks: ReadonlyMap<number, FlagBlockState>;
}

export function emptyChunk(): Chunk {
  return {
    ground: emptyLayer(),
    top: emptyLayer(),
    players: new Map(),
    entities: new Map(),
    flagBlocks: new Map(),
  };
}

export function chunkKey(cx: number, cy: number): string {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) {
    throw new RangeError(`chunk coord must be integer: (${cx}, ${cy})`);
  }
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): ChunkCoord {
  const comma = key.indexOf(",");
  if (comma <= 0 || comma === key.length - 1) {
    throw new RangeError(`malformed chunk key: ${key}`);
  }
  const cx = Number(key.slice(0, comma));
  const cy = Number(key.slice(comma + 1));
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) {
    throw new RangeError(`malformed chunk key: ${key}`);
  }
  return [cx, cy] as const;
}

/**
 * Packing range for `chunkKeyNum` / `unpackChunkKey`. Each axis is offset
 * by `COORD_OFFSET` before encoding so the post-offset value fits in an
 * unsigned 16-bit half-word; the supported coord range per axis is therefore
 * `[-COORD_OFFSET, COORD_OFFSET)`. At `CHUNK_SIZE = 16` that's a world
 * bounded by `[-524 288, 524 288)` tiles per axis — comfortably above any
 * realistic session — and the per-tick chunk-window code throws if a coord
 * ever drifts outside the supported half-words rather than silently
 * collapsing distinct chunks onto the same packed key.
 */
const COORD_OFFSET = 32_768;
const COORD_MASK = 0xffff;

/**
 * Pack `(cx, cy)` into a single unsigned 32-bit integer suitable for use as
 * a `Map<number, …>` / `Set<number>` key. Each axis is shifted by
 * `COORD_OFFSET` so the post-offset value is non-negative and fits in
 * `0..0xffff`. The result is normalised through `>>> 0` so the bit pattern
 * is always interpreted as unsigned — two packings that compute the same
 * coord pair therefore SameValueZero-equal as Map keys regardless of the
 * sign bit landing in the high half.
 */
export function chunkKeyNum(cx: number, cy: number): number {
  return (((cx + COORD_OFFSET) << 16) | ((cy + COORD_OFFSET) & COORD_MASK)) >>> 0;
}

/** Inverse of {@link chunkKeyNum}. Pure arithmetic; cheap enough to call
 *  per Map iteration without showing up in the GC profile. */
export function unpackChunkKey(key: number): ChunkCoord {
  return [(key >>> 16) - COORD_OFFSET, (key & COORD_MASK) - COORD_OFFSET] as const;
}

/**
 * Map a continuous world position to the chunk-coord that contains it. Uses
 * `Math.floor`, not truncate-toward-zero, so negative positions land in the
 * chunk to the south-west of origin (e.g. `(-0.5, -0.5)` → `(-1, -1)`).
 * Mirrors the server's `chunk_coord_for_world_pos`.
 */
export function chunkCoordForWorldPos(x: number, y: number): ChunkCoord {
  return [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)];
}

/**
 * Authoritative collection of loaded chunks, keyed by `(chunk_x, chunk_y)`.
 * Per ADR 0003 the chunk owns the players whose center falls inside it; the
 * wire layer (`net/wire.ts`) overwrites entries when a `TickUpdate` carries
 * a chunk in `full_state_chunks`, leaves `unmodified_chunks` alone, and
 * implicitly unloads anything missing from both.
 */
export class Terrain {
  private readonly chunks = new Map<number, Chunk>();

  insert(cx: number, cy: number, chunk: Chunk): Chunk | undefined {
    const k = chunkKeyNum(cx, cy);
    const prev = this.chunks.get(k);
    this.chunks.set(k, chunk);
    return prev;
  }

  remove(cx: number, cy: number): Chunk | undefined {
    const k = chunkKeyNum(cx, cy);
    const prev = this.chunks.get(k);
    if (prev === undefined) return undefined;
    this.chunks.delete(k);
    return prev;
  }

  get(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKeyNum(cx, cy));
  }

  contains(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKeyNum(cx, cy));
  }

  size(): number {
    return this.chunks.size;
  }

  isEmpty(): boolean {
    return this.chunks.size === 0;
  }

  /** Iterate over every loaded chunk and its coord. */
  *iter(): IterableIterator<readonly [ChunkCoord, Chunk]> {
    for (const [k, chunk] of this.chunks) {
      yield [unpackChunkKey(k), chunk] as const;
    }
  }
}
