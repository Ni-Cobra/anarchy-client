/**
 * Client-wide tuning constants. One module so they're greppable, swappable,
 * and (eventually) loadable from a build-time env. Until then, these are
 * compile-time `const`s.
 *
 * What lives here: knobs that affect rendering cadence or networking
 * heartbeats — things a tuning pass might touch. What does *not* live here:
 * visual constants that belong with their owning module (mesh sizes,
 * colors, axis line lengths) and anything specific to one test.
 */

// ---- Game ----

/**
 * World units per second. Mirrors `crate::config::MAX_SPEED` on the server
 * — the two must stay equal so the snapshot-buffer interpolation cadence
 * on the client matches the authoritative tick advance. See ADR 0001
 * (movement-intent amendment).
 */
export const MAX_SPEED = 5.0;

/**
 * Maximum Euclidean distance (world units) between the local player's
 * center and the center of a tile they may interact with (today: top-layer
 * block destroy / place). Mirrors `crate::config::REACH_BLOCKS` on the
 * server. The client gates outbound break / place actions against this so
 * the UI agrees with the authoritative validator and out-of-reach clicks
 * never round-trip.
 */
export const REACH_BLOCKS = 4.0;

/**
 * Radius of a player's collision circle (the authoritative hitbox). Mirrors
 * `crate::game::player::PLAYER_RADIUS` on the server — must stay equal so
 * the client's place / interaction gates agree with the server's validator.
 * The renderer's player sphere uses the same radius so visuals and
 * authority agree on what "touching" looks like.
 */
export const PLAYER_RADIUS = 0.35;

/**
 * Maximum Euclidean distance (world units) between the local player and an
 * attack target at click time. Mirrors `combat/config.rs::ATTACK_RANGE_TILES`
 * on the server — must stay equal so the client's left-click target-pick
 * agrees with the server's admission gate. Bumped 4 → 6
 * alongside the charge-immobility lock so attackers can't close the gap
 * during the locked charge window.
 */
export const ATTACK_RANGE_TILES = 6;

/**
 * Charge window for a swung attack, in seconds. Mirrors
 * `combat/config.rs::CHARGE_DURATION_SECS` on the server. The local
 * predictor reads this to drive the charge-lock failsafe: if a
 * `CHARGE_STARTED` event never receives its matching resolution within
 * `CHARGE_DURATION_SECS + 1.0 s` the lock is forcibly released so a
 * dropped resolution packet can't strand the local player frozen.
 */
export const CHARGE_DURATION_SECS = 0.7;

/**
 * Maximum Euclidean distance (world units) between the local player and a
 * blowgun-fire target at click time. Mirrors the server's
 * `combat/config.rs::BLOWGUN_RANGE_TILES` — must stay equal so the
 * client's right-click target-pick agrees with the server's admission
 * gate. .
 */
export const BLOWGUN_RANGE_TILES = 8;

/**
 * Minimum spacing between consecutive `FireBlowgunIntent` sends, in
 * milliseconds. Mirrors the server's `BLOWGUN_COOLDOWN_TICKS = 20` at the
 * 20 Hz tick rate (1 s). The server is authoritative; this gate is a
 * bandwidth saver — it suppresses repeat sends inside the same cooldown
 * window so a rapidly clicking player doesn't pile no-op intents on the
 * wire.
 */
export const BLOWGUN_COOLDOWN_MS = 1000;

/**
 * Maximum Euclidean distance (world units) between the local player and a
 * flag block they may transfer XP to/from. Mirrors the server's
 * `combat/config.rs::FLAG_INTERACT_RANGE_TILES` — must stay equal so the
 * client's click router and the server's admission gate agree.
 */
export const FLAG_INTERACT_RANGE_TILES = 4;

/**
 * How long after the local player took damage the flag-interact gate
 * stays locked. Mirrors the server's
 * `combat/config.rs::FLAG_INTERACT_DAMAGE_GRACE_SECS` (seconds), expressed
 * in wall-clock ms so the client can compare against `Date.now()` directly.
 * Server is authoritative for the rejection; the client uses this purely
 * to surface a "In combat" cursor-anchored hint on click instead of the
 * silent server-side reject.
 */
export const FLAG_INTERACT_DAMAGE_GRACE_MS = 5_000;

// ---- Render ----

/**
 * Render-time delay applied to remote players. We draw remote players
 * ~100 ms behind real time and lerp between bracketing snapshots, so a
 * typical jitter or a single dropped tick never produces a visible jump.
 */
export const REMOTE_RENDER_DELAY_MS = 100;

/**
 * How high the top-down camera floats above the local player. Pure visual
 * choice — large enough to see neighbors, small enough to keep tiles legible.
 */
export const CAMERA_HEIGHT = 14;

/**
 * Camera height in the debug zoom-out mode (toggled with `M`). Sized so a
 * comfortable handful of `CHUNK_SIZE`-wide chunks fit on screen vertically
 * — at 60° vertical FOV this is roughly `1.155 * H` world units, so a
 * height of 80 covers ~5–6 chunks vertically and more than that
 * horizontally on widescreen aspect ratios. The renderer also paints a
 * faint chunk-border grid in this mode.
 */
export const ZOOM_OUT_CAMERA_HEIGHT = 80;

/**
 * Bounds for continuous zoom (`+` / `-` keys, `Ctrl+Wheel`). Min sits a
 * bit above `CAMERA_HEIGHT` floor (one tile is 1 world unit; the camera
 * needs enough altitude to keep the player + neighbors on screen). Max
 * goes a hair past `ZOOM_OUT_CAMERA_HEIGHT` so users who hit the M preset
 * can still nudge a touch further out before clamping.
 */
export const ZOOM_HEIGHT_MIN = 4;
export const ZOOM_HEIGHT_MAX = 100;

/**
 * Multiplicative step per `+` / `-` keypress (and per `Ctrl+Wheel` notch).
 * 1.2 means each press changes the camera height by ±20%, so a handful of
 * presses spans the full min↔max range without feeling either twitchy or
 * sluggish.
 */
export const ZOOM_STEP_FACTOR = 1.2;

/**
 * Duration of the camera-height tween between zoom levels (presets via M
 * and continuous via `+` / `-`). Ease-in-out cubic over this window — see
 * `render/zoom.ts`. A new zoom command mid-tween retargets without
 * snapping by re-anchoring the tween's start at the current sampled value.
 */
export const ZOOM_TWEEN_MS = 180;

/**
 * How long the entity-step animation takes — the renderer lerps from the
 * previous tile to the current one over this window each time the
 * server-mirrored tile changes.
 *
 * Pinned well under the server's mean step interval — a spider has a 10%
 * chance per 50 ms tick to step, so the mean gap is 500 ms — so a stepped
 * entity reaches its new tile and settles for a clear majority of the gap
 * before the next possible step. If the entity steps again mid-transition
 * the renderer just re-snapshots and restarts; no queueing.
 */
export const ENTITY_STEP_TRANSITION_MS = 150;

/**
 * Length of a full day-cycle in seconds. Mirrors the server's
 * `DAY_LENGTH_SECONDS` — must stay equal so the client's renderer phases
 * the directional sun the same way the operator's tuning intends. The
 * server ships only the raw monotonic `time_of_day_seconds` scalar; the
 * client folds it modulo this constant to derive `phase ∈ [0, 1)`.
 */
export const DAY_LENGTH_SECONDS = 600;

// ---- Input ----

/**
 * 20 Hz matches the server tick (ADR 0001). The input controller polls the
 * held key set this often and pushes intent to the sink whenever it changes.
 */
export const INPUT_TICK_INTERVAL_MS = 50;

/**
 * Resend the current intent every N ticks even when it hasn't changed, so a
 * dropped frame can't leave the server with a stale view of the player's
 * intent for more than ~N * INPUT_TICK_INTERVAL_MS. 10 ticks ≈ 500 ms.
 */
export const INPUT_HEARTBEAT_TICKS = 10;

/**
 * Held-break keep-alive cadence (ADR 0006 §10). While the player holds the
 * break action, re-send the current `BreakIntent` every N input ticks even
 * if the target hasn't changed, so a dropped frame can't strand a held
 * break with a stale server-side intent. The server's per-conn frame
 * budget (`INBOUND_FRAMES_PER_SECOND = 60`) easily absorbs this; 10 input
 * ticks ≈ 500 ms.
 */
export const BREAK_HEARTBEAT_TICKS = 10;

// ---- Network ----

/**
 * Heartbeat: send a Ping every PING_INTERVAL_MS, and close the socket if no
 * frame at all has arrived from the server within RECV_TIMEOUT_MS. The server
 * kicks idle clients on its own clock — see anarchy-server `RECV_IDLE_TIMEOUT`.
 */
export const PING_INTERVAL_MS = 5_000;
export const RECV_TIMEOUT_MS = 15_000;

// ---- External links ----

/**
 * Discord invite URL surfaced by the lobby panel and the in-game bottom-
 * right Discord button. Hard requirement (Backlog 480): live in exactly
 * one place in the codebase — both call sites import from here. Replace
 * the placeholder with the real invite link before going live.
 */
export const DISCORD_INVITE_URL = "https://discord.gg/REPLACE_ME";
