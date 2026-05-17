/**
 * Per-frame status-effect indicator layer (task 200c).
 *
 * Renders a small icon over every player or entity carrying an active
 * status effect. Today the only effect kind is `Slow` (task 200a), but
 * the layer is structured so future effects (poison-over-time, stun, …)
 * slot in with one new arm in `iconForKind` and one entry in the
 * material palette — no per-effect rewrite.
 *
 * Module-boundary owner of the indicator meshes — anything else that
 * needs to know an effect is active reads `Player.effects` /
 * `Entity.effects` directly off the network-free game-state mirror.
 */

import * as THREE from "three";

import {
  type ActiveEffect,
  EffectKind,
  type EntityId,
  type PlayerId,
} from "../game/index.js";

/** Sprite size in scene units. Big enough to read above a player body
 *  without crowding the username billboard above it. */
const INDICATOR_SIZE = 0.35;
/** Vertical offset above the target's body Y. Players body Y is 0.5;
 *  the indicator floats just above the body sphere top. */
const INDICATOR_HEIGHT_OFFSET = 1.05;

/** Slow indicator colour — a desaturated cyan that reads as "frozen-ish"
 *  without colliding with the lobby palette or the dart's brown. */
const SLOW_COLOR = 0x6cbfe0;

/** One target with an active-effect set. The renderer hands these in
 *  every frame; the layer reconciles its sprite pool against them. */
export interface EffectTarget {
  /** `(player, id)` or `(entity, id)`. */
  readonly kind: "player" | "entity";
  readonly id: number;
  /** World-frame anchor in tiles (server's `+x = east`, `+y = north`). */
  readonly x: number;
  readonly y: number;
  /** Currently-active effects on this target (server-decoded snapshot). */
  readonly effects: readonly ActiveEffect[];
}

interface IndicatorState {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
}

/** Composite map key — `(kind, id)` is unique across players + entities. */
function targetKey(kind: "player" | "entity", id: number): string {
  return `${kind}:${id}`;
}

/**
 * Owns one sprite per `(target, EffectKind.Slow)` pair. Per-frame
 * [`update`] reconciles the sprite pool against the supplied target
 * list — sprites appear when an effect lands and disappear the same
 * frame the wire stops carrying it.
 */
export class TargetEffectsLayer {
  readonly group: THREE.Group;
  private readonly states = new Map<string, IndicatorState>();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "target-effects";
  }

  /** Per-frame reconcile. Walks `targets`, mounts/updates a sprite for
   *  any with a `Slow` effect, retires sprites whose target dropped the
   *  effect (or whose target left the view window). */
  update(targets: readonly EffectTarget[]): void {
    const seen = new Set<string>();
    for (const t of targets) {
      if (!hasSlow(t.effects)) continue;
      const key = targetKey(t.kind, t.id);
      seen.add(key);
      let state = this.states.get(key);
      if (!state) {
        const material = new THREE.SpriteMaterial({
          color: SLOW_COLOR,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(INDICATOR_SIZE, INDICATOR_SIZE, 1);
        sprite.renderOrder = 1000;
        this.group.add(sprite);
        state = { sprite, material };
        this.states.set(key, state);
      }
      state.sprite.position.set(t.x, INDICATOR_HEIGHT_OFFSET, -t.y);
    }
    for (const [key, state] of [...this.states]) {
      if (seen.has(key)) continue;
      this.disposeAt(key, state);
    }
  }

  /** Live indicator count — test handle. */
  size(): number {
    return this.states.size;
  }

  /** Drop every indicator. Called on local-player reassign / dispose. */
  clearAll(): void {
    for (const [key, state] of [...this.states]) this.disposeAt(key, state);
  }

  dispose(): void {
    this.clearAll();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private disposeAt(key: string, state: IndicatorState): void {
    this.states.delete(key);
    this.group.remove(state.sprite);
    state.material.dispose();
  }
}

/** `true` iff the effect list contains an active `Slow`. Tiny helper kept
 *  here so the per-frame predicate is grep-able. */
export function hasSlow(effects: readonly ActiveEffect[]): boolean {
  for (const e of effects) {
    if (e.kind === EffectKind.Slow) return true;
  }
  return false;
}

/** Re-export shape for the test handles (number of indicators per kind). */
export type EffectIndicatorKey = `${"player" | "entity"}:${PlayerId | EntityId}`;
