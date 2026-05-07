import * as THREE from "three";

import { tileCenterToScene } from "../terrain.js";

/**
 * Visual feedback (task 030) connecting an actor to the cell they are
 * acting on. Two driving signals from the wire layer:
 *
 *   - **Break:** held-break targeting state ships every tick (per-player,
 *     per-cell) — a beam tracks each live target and clears the moment the
 *     player drops out of the set (released, re-targeted, block broke).
 *   - **Place:** a one-shot block edit fires when a place lands — the beam
 *     flashes briefly so the action reads even though no held-state
 *     follows (`PLACE_FLASH_DURATION_MS`).
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

export class BeamLayer {
  private readonly group: THREE.Group;
  private readonly breakBeams = new Map<number, Beam>();
  private readonly placeFlashes: PlaceFlash[] = [];

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
  }

  /** Drop every owned material / geometry. Called by the renderer on
   * `dispose()`. */
  dispose(): void {
    for (const id of [...this.breakBeams.keys()]) this.disposeBreakBeam(id);
    while (this.placeFlashes.length > 0) {
      this.disposePlaceFlashAt(this.placeFlashes.length - 1);
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private createBeam(): Beam {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const material = new THREE.LineBasicMaterial({
      color: BEAM_COLOR,
      transparent: true,
      opacity: BEAM_OPACITY,
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
}
