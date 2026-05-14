import * as THREE from "three";

import { tileCenterToScene } from "../terrain.js";

/**
 * Visual feedback (task 030) connecting an actor to the cell they are
 * acting on. Three driving signals from the wire layer:
 *
 *   - **Break:** held-break targeting state ships every tick (per-player,
 *     per-cell) — a beam tracks each live target and clears the moment the
 *     player drops out of the set (released, re-targeted, block broke).
 *   - **Place:** a one-shot block edit fires when a place lands — the beam
 *     flashes briefly so the action reads even though no held-state
 *     follows (`PLACE_FLASH_DURATION_MS`).
 *   - **Chest:** every `PlayerSnapshot` carries the chests that player has
 *     open (task 590) — a beam runs from each open-chest owner to the chest
 *     for as long as the chest stays in the set, and clears the moment it
 *     drops out (closed, evicted, broken, out of range).
 *
 * The layer doesn't know where players are — the renderer's per-frame
 * driver supplies a `BeamPositionLookup` so the beam re-aims as the
 * actor walks while still targeting / flashing.
 */
export interface BreakBeamTarget {
  readonly playerId: number;
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
}

export interface PlaceBeamEvent {
  readonly playerId: number;
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
}

/**
 * One (player, chest) pair the wire layer reports open this frame. The
 * layer keys beams by `(playerId, cx, cy, lx, ly)` so a player with
 * multiple open chests gets one beam per chest.
 */
export interface ChestBeamTarget {
  readonly playerId: number;
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
}

/**
 * Resolve a `playerId` to its current world-space position (continuous
 * coords, in the same `+x = east`, `+y = north` frame the rest of the
 * client uses). Returning `null` hides that player's beam without
 * disposing it — the next call may bring them back.
 */
export type BeamPositionLookup = (
  playerId: number,
) => { readonly x: number; readonly y: number } | null;

const BEAM_COLOR = 0xffffff;
const BEAM_OPACITY = 0.55;
// Chest beams (task 040) run continuously while the chest is open, so
// they sit at a calmer opacity than the action beams. The action beams
// flash and fade; the chest beam is a steady tether and reading several
// at once shouldn't strobe the scene.
const CHEST_BEAM_COLOR = 0xffd070;
const CHEST_BEAM_OPACITY = 0.25;
// Vertical anchor for the player end of the beam — matches the body
// sphere's center (`tileToScene` y = 0.5).
const BEAM_PLAYER_Y = 0.5;
// Vertical anchor for the block end — center of a unit cube sitting on
// the ground (matches `EffectsLayer`'s targeting frame / shatter y).
const BEAM_BLOCK_Y = 0.55;
// Brief place flash. Just long enough to read; short enough not to
// linger past the next player action.
const PLACE_FLASH_DURATION_MS = 100;

interface Beam {
  readonly line: THREE.Line;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.LineBasicMaterial;
  target: { x: number; z: number };
}

interface PlaceFlash extends Beam {
  readonly playerId: number;
  readonly endMs: number;
}

interface ChestBeam extends Beam {
  readonly playerId: number;
}

export class BeamLayer {
  private readonly group: THREE.Group;
  private readonly breakBeams = new Map<number, Beam>();
  private readonly placeFlashes: PlaceFlash[] = [];
  // Chest beams (task 040) — keyed by `playerId|cx|cy|lx|ly` so one
  // player with multiple open chests has one beam per chest, and each
  // beam tracks its specific player.
  private readonly chestBeams = new Map<string, ChestBeam>();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "beams";
  }

  /** Scene root the renderer adds to its main scene at construction. */
  scene(): THREE.Object3D {
    return this.group;
  }

  /**
   * Replace the active break-target set wholesale, mirroring the held-
   * break feed shape (`EffectsLayer.applyTargets`). Players that vanish
   * since the last call have their beam disposed; new players get a beam
   * spawned; players that remain have their target cell updated in place.
   */
  applyBreakTargets(targets: readonly BreakBeamTarget[]): void {
    const live = new Set<number>();
    for (const t of targets) {
      live.add(t.playerId);
      const center = tileCenterToScene(t.cx, t.cy, t.lx, t.ly);
      let beam = this.breakBeams.get(t.playerId);
      if (!beam) {
        beam = this.createBeam();
        this.breakBeams.set(t.playerId, beam);
      }
      beam.target.x = center.x;
      beam.target.z = center.z;
    }
    const stale: number[] = [];
    for (const id of this.breakBeams.keys()) {
      if (!live.has(id)) stale.push(id);
    }
    for (const id of stale) this.disposeBreakBeam(id);
  }

  /**
   * Replace the active chest-beam set wholesale, mirroring the
   * `applyBreakTargets` shape. Pairs `(playerId, chest cell)` that
   * vanish since the last call have their beam disposed; new pairs
   * get a beam spawned; pairs that remain are left in place (the
   * per-frame `update` re-aims them at the latest player position).
   */
  applyChestTargets(targets: readonly ChestBeamTarget[]): void {
    const live = new Set<string>();
    for (const t of targets) {
      const key = chestBeamKey(t.playerId, t.cx, t.cy, t.lx, t.ly);
      live.add(key);
      if (this.chestBeams.has(key)) continue;
      const center = tileCenterToScene(t.cx, t.cy, t.lx, t.ly);
      const beam = this.createBeam(CHEST_BEAM_COLOR, CHEST_BEAM_OPACITY);
      beam.target.x = center.x;
      beam.target.z = center.z;
      this.chestBeams.set(key, { ...beam, playerId: t.playerId });
    }
    const stale: string[] = [];
    for (const key of this.chestBeams.keys()) {
      if (!live.has(key)) stale.push(key);
    }
    for (const key of stale) this.disposeChestBeam(key);
  }

  /**
   * Spawn a place-flash beam from the actor to the placed cell. Auto-
   * expires at `nowMs + PLACE_FLASH_DURATION_MS` on the next `update`.
   */
  onPlace(event: PlaceBeamEvent, nowMs: number): void {
    const center = tileCenterToScene(event.cx, event.cy, event.lx, event.ly);
    const beam = this.createBeam();
    beam.target.x = center.x;
    beam.target.z = center.z;
    this.placeFlashes.push({
      ...beam,
      playerId: event.playerId,
      endMs: nowMs + PLACE_FLASH_DURATION_MS,
    });
  }

  /**
   * Per-frame update from the renderer. Re-aims every live beam against
   * the latest player position and expires any place flash past its end.
   * Beams whose actor is unknown to the lookup are hidden (not disposed)
   * — the actor may re-enter view next tick.
   */
  update(positions: BeamPositionLookup, nowMs: number): void {
    for (const [id, beam] of this.breakBeams) {
      this.aimBeam(beam, positions(id));
    }
    for (let i = this.placeFlashes.length - 1; i >= 0; i--) {
      const flash = this.placeFlashes[i];
      if (nowMs >= flash.endMs) {
        this.disposePlaceFlashAt(i);
        continue;
      }
      this.aimBeam(flash, positions(flash.playerId));
    }
    for (const beam of this.chestBeams.values()) {
      this.aimBeam(beam, positions(beam.playerId));
    }
  }

  /** Drop every owned material / geometry. Called by the renderer on
   * `dispose()`. */
  dispose(): void {
    for (const id of [...this.breakBeams.keys()]) this.disposeBreakBeam(id);
    while (this.placeFlashes.length > 0) {
      this.disposePlaceFlashAt(this.placeFlashes.length - 1);
    }
    for (const key of [...this.chestBeams.keys()]) this.disposeChestBeam(key);
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /**
   * Test handle (task 040): number of chest beams currently in the
   * scene. The renderer drives this from the per-tick chest-open set on
   * `PlayerSnapshot`; unit tests assert against it without poking at
   * Three.js internals.
   */
  chestBeamCount(): number {
    return this.chestBeams.size;
  }

  private createBeam(
    color = BEAM_COLOR,
    opacity = BEAM_OPACITY,
  ): Beam {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    // Hidden until the first `aimBeam` lands — keeps a freshly-spawned
    // beam from drawing a degenerate segment at the origin.
    line.visible = false;
    this.group.add(line);
    return { line, geometry, material, target: { x: 0, z: 0 } };
  }

  private aimBeam(
    beam: Beam,
    pos: { readonly x: number; readonly y: number } | null,
  ): void {
    if (!pos) {
      beam.line.visible = false;
      return;
    }
    const positions = beam.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    positions.setXYZ(0, pos.x, BEAM_PLAYER_Y, -pos.y);
    positions.setXYZ(1, beam.target.x, BEAM_BLOCK_Y, beam.target.z);
    positions.needsUpdate = true;
    beam.line.visible = true;
  }

  private disposeBreakBeam(playerId: number): void {
    const beam = this.breakBeams.get(playerId);
    if (!beam) return;
    this.breakBeams.delete(playerId);
    this.group.remove(beam.line);
    beam.geometry.dispose();
    beam.material.dispose();
  }

  private disposePlaceFlashAt(idx: number): void {
    const flash = this.placeFlashes[idx];
    this.group.remove(flash.line);
    flash.geometry.dispose();
    flash.material.dispose();
    this.placeFlashes.splice(idx, 1);
  }

  private disposeChestBeam(key: string): void {
    const beam = this.chestBeams.get(key);
    if (!beam) return;
    this.chestBeams.delete(key);
    this.group.remove(beam.line);
    beam.geometry.dispose();
    beam.material.dispose();
  }
}

function chestBeamKey(
  playerId: number,
  cx: number,
  cy: number,
  lx: number,
  ly: number,
): string {
  return `${playerId}|${cx}|${cy}|${lx}|${ly}`;
}
