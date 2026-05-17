/**
 * Floating red "-N" damage numbers (task 150).
 *
 * One sprite per damage event spawns at the target's head and floats up
 * + fades over the configured lifetime. The renderer's `onDamageEvents`
 * hook calls `spawn(...)` for each per-tick `DamageEvent`; the per-frame
 * loop calls `tick(nowMs)` to advance lifetimes and retire expired
 * sprites.
 *
 * Implementation notes:
 *   - Each sprite is a `THREE.Sprite` with a per-amount canvas-texture.
 *     A `Map<number, THREE.CanvasTexture>` cache keys textures by integer
 *     damage value so a session with O(10) unique values rasterises
 *     each one once.
 *   - Lifetime is fixed at [`DAMAGE_NUMBER_DURATION_MS`]; deterministic
 *     horizontal jitter (seeded from spawn time) keeps overlapping
 *     numbers visually distinct without burning RNG state.
 *   - Opacity follows a quadratic-out curve so the number stays
 *     fully opaque through most of its life and fades sharply at the
 *     end.
 */
import * as THREE from "three";

/** Lifetime of a floating damage number, in milliseconds. */
export const DAMAGE_NUMBER_DURATION_MS = 800;

/** Tiles the number floats upward over its lifetime. */
export const DAMAGE_NUMBER_LIFT_TILES = 0.6;

/** Sprite width and height in scene units. */
const DAMAGE_NUMBER_WIDTH = 0.5;
const DAMAGE_NUMBER_HEIGHT = 0.25;

/** Vertical anchor above the player / entity body (matches the username billboard). */
const DAMAGE_NUMBER_HEAD_LIFT_TILES = 1.2;

/** Peak horizontal jitter, in tile-widths. */
const DAMAGE_NUMBER_JITTER_TILES = 0.15;

/** Single source-of-truth color for the floating number text. */
export const DAMAGE_NUMBER_COLOR = "#ff3030";

const TEXTURE_WIDTH = 128;
const TEXTURE_HEIGHT = 64;

/**
 * Deterministic-ish small offset from a spawn timestamp. Two events at
 * exactly the same `nowMs` would otherwise overlap; this spreads them
 * apart along world-X by `[-DAMAGE_NUMBER_JITTER_TILES,
 * +DAMAGE_NUMBER_JITTER_TILES]` while staying stable per-event so a
 * second observation of the same event produces the same offset.
 */
function jitterFor(nowMs: number, sequence: number): number {
  // Mix the spawn time and a per-layer sequence into a small range. The
  // mixing constants are arbitrary primes — they spread adjacent inputs
  // without correlating with frame-time.
  const mixed = Math.sin(nowMs * 12.9898 + sequence * 78.233) * 43758.5453;
  const t = mixed - Math.floor(mixed); // [0, 1)
  return (t * 2 - 1) * DAMAGE_NUMBER_JITTER_TILES;
}

interface SpriteState {
  readonly sprite: THREE.Sprite;
  readonly anchor: THREE.Vector3;
  readonly startMs: number;
  readonly jitter: number;
}

/**
 * Render layer for floating damage numbers. Owns a `THREE.Group` carrying
 * one sprite per active number plus a per-amount texture cache.
 */
export class DamageNumbersLayer {
  readonly group: THREE.Group;
  private readonly states = new Map<number, SpriteState>();
  /** Cache of `-N` textures, keyed by the integer amount. */
  private readonly textureCache = new Map<number, THREE.CanvasTexture>();
  private nextStateId = 0;
  private spawnSequence = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "damage-numbers";
  }

  /**
   * Spawn one floating number at `(worldX, worldY)` showing `-amount`.
   * `nowMs` anchors the lifetime; the per-frame `tick()` reads it back
   * to compute opacity / position. No-op when `amount <= 0`.
   */
  spawn(worldPos: { x: number; y: number }, amount: number, nowMs: number): void {
    if (amount <= 0) return;
    const texture = this.textureFor(amount);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(DAMAGE_NUMBER_WIDTH, DAMAGE_NUMBER_HEIGHT, 1);
    // Convert tile-space to scene-space (+y_world → -z_scene). The Y
    // anchor sits above the body's centre at HEAD_LIFT_TILES.
    const sceneX = worldPos.x;
    const sceneY = DAMAGE_NUMBER_HEAD_LIFT_TILES;
    const sceneZ = -worldPos.y;
    sprite.position.set(sceneX, sceneY, sceneZ);
    sprite.renderOrder = 100;
    this.group.add(sprite);
    const id = this.nextStateId++;
    const jitter = jitterFor(nowMs, this.spawnSequence++);
    this.states.set(id, {
      sprite,
      anchor: new THREE.Vector3(sceneX, sceneY, sceneZ),
      startMs: nowMs,
      jitter,
    });
  }

  /**
   * Per-frame advance. Walks every active number, updates its position
   * along the upward float curve and its opacity along the quadratic-out
   * fade, and retires any whose lifetime has elapsed.
   */
  tick(nowMs: number): void {
    if (this.states.size === 0) return;
    const expired: number[] = [];
    for (const [id, state] of this.states) {
      const elapsed = nowMs - state.startMs;
      if (elapsed >= DAMAGE_NUMBER_DURATION_MS) {
        expired.push(id);
        continue;
      }
      const t = elapsed <= 0 ? 0 : elapsed / DAMAGE_NUMBER_DURATION_MS;
      state.sprite.position.set(
        state.anchor.x + state.jitter,
        state.anchor.y + DAMAGE_NUMBER_LIFT_TILES * t,
        state.anchor.z,
      );
      // Quadratic-out fade: opacity = 1 - t².
      const mat = state.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, 1 - t * t);
    }
    for (const id of expired) {
      const state = this.states.get(id);
      if (!state) continue;
      this.group.remove(state.sprite);
      (state.sprite.material as THREE.SpriteMaterial).dispose();
      this.states.delete(id);
    }
  }

  /** Number of sprites currently in the layer. Test handle. */
  size(): number {
    return this.states.size;
  }

  /**
   * Drop every active number + texture cache entry. Called on local-
   * player reassign (reconnect / lobby identity change) so a stale
   * session never leaks state into a fresh one.
   */
  clearAll(): void {
    for (const state of this.states.values()) {
      this.group.remove(state.sprite);
      (state.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.states.clear();
    for (const texture of this.textureCache.values()) texture.dispose();
    this.textureCache.clear();
  }

  /**
   * Test-only accessor: the current opacity of the sprite spawned for a
   * given (test-controlled) id. Production code never references it.
   */
  opacityOfSpawnedAtIndex(index: number): number | null {
    let i = 0;
    for (const state of this.states.values()) {
      if (i === index) {
        return (state.sprite.material as THREE.SpriteMaterial).opacity;
      }
      i++;
    }
    return null;
  }

  /**
   * Test-only accessor: y-coord of the sprite at index `index` (insertion
   * order). Used by unit tests to assert "the number floated upward".
   */
  positionYOfSpawnedAtIndex(index: number): number | null {
    let i = 0;
    for (const state of this.states.values()) {
      if (i === index) return state.sprite.position.y;
      i++;
    }
    return null;
  }

  private textureFor(amount: number): THREE.CanvasTexture {
    const cached = this.textureCache.get(amount);
    if (cached) return cached;
    // Production + happy-dom tests both expose `document`. The mesh-flash
    // unit tests use the node environment which doesn't — they don't
    // exercise this layer, so we leave the path narrow.
    const canvas = document.createElement("canvas");
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
      ctx.fillStyle = DAMAGE_NUMBER_COLOR;
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 4;
      const text = `-${amount}`;
      ctx.strokeText(text, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
      ctx.fillText(text, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.textureCache.set(amount, texture);
    return texture;
  }
}
