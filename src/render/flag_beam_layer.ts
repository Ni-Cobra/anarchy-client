/**
 * Flag-interact beam render layer.
 *
 * The server emits a per-tick `FlagInteractSnapshot` for every admitted
 * `FlagInteractIntent`. The wire layer fans the list into
 * `applyFlagInteracts`, which reconciles a Three.js mesh pool against
 * it: one cylinder beam per active interact, anchored at the player's
 * body and the flag tile centre. Per the brief the gradient flows
 * `player → flag` for Deposit and `flag → player` for Steal — we encode
 * direction by orienting the cylinder's local +y axis along the
 * gradient and tinting it green for Deposit / orange for Steal, so the
 * direction reads from the colour alone at a glance.
 *
 * Mesh shape mirrors [`AttackBeamLayer`]: one cylinder per beam, scaled
 * to `(radius, length, radius)` and rotated to match the segment
 * direction. Authoritative replace each tick — absence of an entry the
 * next tick is the canonical "fade the beam" signal, matching the
 * targeting / chest-beam patterns.
 */

import * as THREE from "three";

/** Body-Y anchor for both endpoints. Mirrors the attack-beam body Y so
 *  the flag beam reads as horizontal-on-tabletop at the same slab the
 *  combat beams occupy. */
export const FLAG_BEAM_BODY_Y = 0.5;

/** Beam radius in tile-widths — chunky enough to read as an XP transfer
 *  channel, thinner than a body so it doesn't obscure the player. */
export const FLAG_BEAM_RADIUS = 0.08;

/** Per-mode tint. Deposit pours XP *into* the flag (warm green growth);
 *  Steal pulls XP *out* of the flag (siphoning orange). Direction +
 *  colour are redundant cues — the brief calls for "flowing" gradients,
 *  and the colour alone is enough to tell deposit from steal without a
 *  multi-stop shader. */
export const FLAG_BEAM_DEPOSIT_COLOR = 0x66dd66;
export const FLAG_BEAM_STEAL_COLOR = 0xff9933;

/**
 * Mode wire enum mirrored from the server's `FlagInteractMode`.
 * Stored as a string here so the layer stays free of protobuf-numeric
 * leaks and unit tests can read the value at a glance.
 */
export type FlagBeamMode = "deposit" | "steal";

/**
 * One active flag-interact this tick. Shape matches `WireFlagInteractEvent`
 * in `net/wire_tick.ts` — the bridge hands these in directly.
 */
export interface FlagBeamSpec {
  readonly playerId: number;
  readonly flagCx: number;
  readonly flagCy: number;
  readonly flagLx: number;
  readonly flagLy: number;
  readonly mode: FlagBeamMode;
}

/** Player position resolver, same shape as [`AttackBeamLayer`]'s. */
export type FlagBeamPlayerLookup = (
  playerId: number,
) => { readonly x: number; readonly y: number } | null;

interface BeamState {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly playerId: number;
  flagCx: number;
  flagCy: number;
  flagLx: number;
  flagLy: number;
  mode: FlagBeamMode;
}

/**
 * Per-frame flag-beam render layer. Owns a `THREE.Group` carrying one
 * cylinder per active interact. The renderer parents the group into its
 * scene; `applyFlagInteracts` is the wholesale-replace path (called from
 * the wire fan-out) and `update` re-aims each beam against the latest
 * player position each frame.
 *
 * Keyed by `playerId` — the server admits at most one active interact
 * per player per tick (latest-wins per the 250 spec), so an attacker
 * appearing twice in a single tick is impossible by construction.
 */
export class FlagBeamLayer {
  readonly group: THREE.Group;
  private readonly beams = new Map<number, BeamState>();
  /** Shared unit cylinder — scaled per-beam to `(radius, length, radius)`
   *  so a churning interact stream doesn't allocate per-beam geometry. */
  private readonly unitGeometry: THREE.CylinderGeometry;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "flag-beams";
    this.unitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  }

  /**
   * Wholesale replace from the latest tick's `flag_interacts`. Beams
   * present in the new spec that already exist are updated in place
   * (mode / flag coord changes flip the tint or re-aim without
   * disposing). Beams present in the old set but absent from the new
   * spec retire. The renderer's `update` call after this does the
   * per-frame re-aim against current player positions.
   */
  applyFlagInteracts(specs: readonly FlagBeamSpec[]): void {
    const seen = new Set<number>();
    for (const spec of specs) {
      seen.add(spec.playerId);
      const existing = this.beams.get(spec.playerId);
      if (existing === undefined) {
        const material = new THREE.MeshBasicMaterial({
          color: colorForMode(spec.mode),
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(this.unitGeometry, material);
        mesh.visible = false;
        this.group.add(mesh);
        this.beams.set(spec.playerId, {
          mesh,
          material,
          playerId: spec.playerId,
          flagCx: spec.flagCx,
          flagCy: spec.flagCy,
          flagLx: spec.flagLx,
          flagLy: spec.flagLy,
          mode: spec.mode,
        });
      } else {
        existing.flagCx = spec.flagCx;
        existing.flagCy = spec.flagCy;
        existing.flagLx = spec.flagLx;
        existing.flagLy = spec.flagLy;
        if (existing.mode !== spec.mode) {
          existing.mode = spec.mode;
          existing.material.color.setHex(colorForMode(spec.mode));
        }
      }
    }
    for (const id of [...this.beams.keys()]) {
      if (!seen.has(id)) this.disposeBeam(id);
    }
  }

  /**
   * Re-aim every live beam against the latest player position. The
   * server's `flag_interacts` filter scopes the snapshot to the
   * receiver's view window, so every beam's flag tile is loaded
   * locally — but the player lookup may still miss when an interactor
   * walks out of view between ticks, in which case we hide the mesh
   * (not retire) so the next tick can recover it cleanly.
   */
  update(playerLookup: FlagBeamPlayerLookup): void {
    for (const beam of this.beams.values()) {
      const player = playerLookup(beam.playerId);
      if (player === null) {
        beam.mesh.visible = false;
        continue;
      }
      const flagCentre = flagTileCentre(
        beam.flagCx,
        beam.flagCy,
        beam.flagLx,
        beam.flagLy,
      );
      // Deposit: gradient flows player → flag (segment direction).
      // Steal: gradient flows flag → player (reverse). We only encode
      // direction by ordering endpoints so a future gradient shader can
      // read it without re-deriving from `mode`; today the colour alone
      // disambiguates and the mesh orientation is symmetric.
      let ax = player.x;
      let ay = player.y;
      let bx = flagCentre.x;
      let by = flagCentre.y;
      if (beam.mode === "steal") {
        ax = flagCentre.x;
        ay = flagCentre.y;
        bx = player.x;
        by = player.y;
      }
      aimFlagBeam(beam.mesh, ax, ay, bx, by, FLAG_BEAM_RADIUS);
    }
  }

  /** Number of live beams — test handle. */
  size(): number {
    return this.beams.size;
  }

  /** Test handle: read the colour packed as `0xRRGGBB`, or `null` if the
   *  beam doesn't exist. */
  beamColorHex(playerId: number): number | null {
    return this.beams.get(playerId)?.material.color.getHex() ?? null;
  }

  /** Test handle: snapshot of the beam's stored spec — flag tile +
   *  mode — for unit tests that pin the layer's mirror against the
   *  wire shape without a player-position lookup. `null` if no beam
   *  exists for `playerId`. */
  beamSpec(playerId: number): {
    flagCx: number;
    flagCy: number;
    flagLx: number;
    flagLy: number;
    mode: FlagBeamMode;
  } | null {
    const beam = this.beams.get(playerId);
    if (beam === undefined) return null;
    return {
      flagCx: beam.flagCx,
      flagCy: beam.flagCy,
      flagLx: beam.flagLx,
      flagLy: beam.flagLy,
      mode: beam.mode,
    };
  }

  /** Test handle: per-beam mesh visibility flag — the layer hides
   *  beams whose player lookup misses but keeps them in the map so
   *  the next tick can recover them. */
  beamVisible(playerId: number): boolean | null {
    return this.beams.get(playerId)?.mesh.visible ?? null;
  }

  /** Test handle: world-space midpoint of the beam mesh, or `null` if
   *  the beam doesn't exist. Lets a vitest spec pin direction by
   *  comparing midpoint position before and after a deposit/steal
   *  flip. */
  beamMidpoint(playerId: number): { x: number; z: number } | null {
    const beam = this.beams.get(playerId);
    if (beam === undefined) return null;
    return { x: beam.mesh.position.x, z: beam.mesh.position.z };
  }

  /** Drop every beam — used on local-player reassign / dispose. */
  clearAll(): void {
    for (const id of [...this.beams.keys()]) this.disposeBeam(id);
  }

  dispose(): void {
    this.clearAll();
    this.unitGeometry.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  private disposeBeam(playerId: number): void {
    const beam = this.beams.get(playerId);
    if (beam === undefined) return;
    this.beams.delete(playerId);
    this.group.remove(beam.mesh);
    beam.material.dispose();
  }
}

/** World-frame tile centre for a chunk-local `(cx, cy, lx, ly)`. The
 *  chunk-size constant is mirrored locally so this helper stays free
 *  of a `game/` dep — flag beams care only about world coords. */
const CHUNK_SIZE = 16;
function flagTileCentre(
  cx: number,
  cy: number,
  lx: number,
  ly: number,
): { x: number; y: number } {
  return {
    x: cx * CHUNK_SIZE + lx + 0.5,
    y: cy * CHUNK_SIZE + ly + 0.5,
  };
}

/** Tint lookup. Exported so tests can pin per-mode colour without
 *  reaching into the layer. */
export function colorForMode(mode: FlagBeamMode): number {
  return mode === "deposit" ? FLAG_BEAM_DEPOSIT_COLOR : FLAG_BEAM_STEAL_COLOR;
}

/**
 * Position and orient a unit cylinder so its local +y axis spans from
 * world `(ax, ay)` to `(bx, by)` at `y = FLAG_BEAM_BODY_Y`. Mirrors
 * `aimCylinder` in `attack_beam_layer.ts` — same scene mapping
 * (`(+x_world, +y_world) → (+x_scene, -z_scene)`), same midpoint
 * placement, same unit-vector quaternion. Exported so unit tests can
 * pin the geometry without spinning up the full layer.
 */
export function aimFlagBeam(
  mesh: THREE.Mesh,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): void {
  const az = -ay;
  const bz = -by;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length <= 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.scale.set(radius, length, radius);
  mesh.position.set(
    (ax + bx) / 2,
    FLAG_BEAM_BODY_Y,
    (az + bz) / 2,
  );
  mesh.rotation.set(0, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(dx, 0, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
  mesh.quaternion.copy(q);
  mesh.visible = true;
}
