/**
 * Top-left coordinates readout for the local player.
 *
 * Three stacked lines:
 * - integer tile coords `X, Y` (the cell the player stands on)
 * - subtile decimal pair `x.xx, y.yy`, dimmer and one step smaller
 * - latest ping sample `ping XX ms` (task 200), same dim style as the
 *   subtile line. Shown as `ping —` until the first Pong arrives.
 *
 * Driven by the bootstrap's per-frame loop: the caller pushes the latest
 * position via `update(x, y)` (or `update(null)` when there is no local
 * player yet, e.g. before admission, which hides the readout) and the
 * latest RTT via `updatePing(ms)` (or `updatePing(null)` for the dash).
 *
 * Network-free; pure DOM. Self-injects its CSS like the other overlays in
 * `src/ui/`. Sits at top-left; the corner action buttons are at top-right
 * and the inventory hotbar is at bottom-center, so nothing overlaps.
 */

const STYLE_ID = "anarchy-coords-hud-style";
const ROOT_ID = "anarchy-coords-hud";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    top: 12px;
    /* Task 170: the player-list HUD badge sits at top: 12px / left: 12px;
       shift the coords readout right so the two don't overlap. The badge
       fits a "32 / 32" label comfortably in ~80px including padding +
       icon; 100px leaves a small gap. */
    left: 100px;
    z-index: 8500;
    pointer-events: none;
    padding: 6px 10px;
    background: rgba(20, 24, 30, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
    line-height: 1.2;
    user-select: none;
  }
  #${ROOT_ID}.hidden { display: none; }
  #${ROOT_ID} .anarchy-coords-tile {
    font-size: 12px;
    font-weight: 600;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }
  #${ROOT_ID} .anarchy-coords-sub {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.7;
    margin-top: 2px;
  }
  #${ROOT_ID} .anarchy-coords-ping {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.7;
    margin-top: 2px;
  }
`;

export interface CoordsHudHandle {
  /** Push the latest local-player position. Pass `null` to hide. */
  update(pos: { readonly x: number; readonly y: number } | null): void;
  /**
   * Push the latest measured RTT (task 200). Pass `null` before the first
   * Pong arrives — the line renders as `ping —`. The bootstrap freezes
   * the last value on transport drop rather than blanking it.
   */
  updatePing(rttMs: number | null): void;
  unmount(): void;
}

/**
 * Format a continuous world position as the two HUD lines.
 *
 * The tile line uses `Math.floor` so the coords always identify the cell
 * the player physically stands on, matching the server's tile-indexing
 * convention (positive Y = north). The subtile line carries the same
 * floats with two decimals — useful when debugging movement and reach.
 */
export function formatCoords(
  x: number,
  y: number,
): { readonly tile: string; readonly sub: string } {
  const tile = `${Math.floor(x)}, ${Math.floor(y)}`;
  const sub = `${x.toFixed(2)}, ${y.toFixed(2)}`;
  return { tile, sub };
}

/**
 * Render the ping line. `null` before the first sample renders as the
 * em-dash placeholder; otherwise the value is rounded to the nearest ms
 * (RTT below 1 ms is rare on localhost but is still floored to `0 ms`
 * rather than blank).
 */
export function formatPing(rttMs: number | null): string {
  if (rttMs === null) return "ping —";
  return `ping ${Math.round(rttMs)} ms`;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountCoordsHud(): CoordsHudHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.classList.add("hidden");
  root.setAttribute("aria-label", "Player coordinates");

  const tileLine = document.createElement("div");
  tileLine.className = "anarchy-coords-tile";
  root.appendChild(tileLine);

  const subLine = document.createElement("div");
  subLine.className = "anarchy-coords-sub";
  root.appendChild(subLine);

  const pingLine = document.createElement("div");
  pingLine.className = "anarchy-coords-ping";
  pingLine.textContent = formatPing(null);
  root.appendChild(pingLine);

  document.body.appendChild(root);

  let lastTile: string | null = null;
  let lastSub: string | null = null;
  let lastPing: string | null = formatPing(null);

  return {
    update: (pos) => {
      if (pos === null) {
        root.classList.add("hidden");
        return;
      }
      const { tile, sub } = formatCoords(pos.x, pos.y);
      if (tile !== lastTile) {
        tileLine.textContent = tile;
        lastTile = tile;
      }
      if (sub !== lastSub) {
        subLine.textContent = sub;
        lastSub = sub;
      }
      root.classList.remove("hidden");
    },
    updatePing: (rttMs) => {
      const next = formatPing(rttMs);
      if (next !== lastPing) {
        pingLine.textContent = next;
        lastPing = next;
      }
    },
    unmount: () => {
      root.remove();
    },
  };
}
