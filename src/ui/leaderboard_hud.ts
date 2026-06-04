/**
 * Faction-leaderboard HUD — ADR 0008.
 *
 * Top-of-screen badge: a compact 1-to-3-row table of the highest-xp
 * factions (rank · chip · name · xp · flag coords). Empty state shows
 * "No factions yet" in italic. Hover expands a dropdown listing every
 * faction by `xp` descending (id-ascending tiebreak); the badge's top
 * 3 are repeated at the top of the dropdown so users can scan a single
 * sorted list.
 *
 * Driven by `LeaderboardStore`. Subscribes once on mount and
 * re-renders on each update (including in-place while the dropdown
 * is open so a tick-rate update doesn't flicker the panel).
 *
 * Network-free; pure DOM. The HUD does not currently mark the local
 * player's own faction — the wire shape doesn't carry "is this
 * mine?" today. Future polish can layer that on top.
 */

import { CHUNK_SIZE } from "../game/terrain.js";
import {
  type FactionEntry,
  type LeaderboardStore,
  paletteColorCss,
  sortedByXpDesc,
} from "../game/index.js";
import { mountHudScaffold } from "./hud_scaffold.js";

const STYLE_ID = "anarchy-leaderboard-hud-style";
const ROOT_ID = "anarchy-leaderboard-hud";
const BADGE_ID = "anarchy-leaderboard-badge";
const DROPDOWN_ID = "anarchy-leaderboard-dropdown";

const BADGE_TOP_N = 3;

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8600;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f0f0f0;
    user-select: none;
  }
  #${ROOT_ID}.hidden { display: none; }
  #${BADGE_ID} {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(20, 24, 30, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    cursor: default;
    max-width: 520px;
  }
  #${BADGE_ID} .anarchy-leaderboard-icon {
    font-size: 14px;
    line-height: 1;
    flex: 0 0 auto;
  }
  #${BADGE_ID} .anarchy-leaderboard-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  #${BADGE_ID} .anarchy-leaderboard-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  #${BADGE_ID} .anarchy-leaderboard-rank {
    color: #c0c0c0;
    font-weight: 600;
    min-width: 14px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  #${BADGE_ID} .anarchy-leaderboard-chip,
  #${DROPDOWN_ID} .anarchy-leaderboard-chip {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.25);
    flex: 0 0 auto;
  }
  #${BADGE_ID} .anarchy-leaderboard-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  #${BADGE_ID} .anarchy-leaderboard-xp,
  #${BADGE_ID} .anarchy-leaderboard-coord,
  #${DROPDOWN_ID} .anarchy-leaderboard-coord {
    color: #a0a0a0;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  #${BADGE_ID} .anarchy-leaderboard-xp { color: #d0d0d0; }
  #${BADGE_ID} .anarchy-leaderboard-empty,
  #${ROOT_ID} .anarchy-leaderboard-empty {
    color: #c0c0c0;
    font-style: italic;
    font-weight: 500;
  }
  #${DROPDOWN_ID} {
    display: none;
    margin: 4px auto 0;
    padding: 8px 12px;
    background: rgba(20, 24, 30, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    min-width: 240px;
    max-width: 480px;
    max-height: 60vh;
    overflow-y: auto;
  }
  #${ROOT_ID}.open #${DROPDOWN_ID} { display: block; }
  #${DROPDOWN_ID} table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  #${DROPDOWN_ID} th {
    text-align: left;
    padding: 2px 6px;
    color: #c0c0c0;
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  #${DROPDOWN_ID} td {
    padding: 2px 6px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    white-space: nowrap;
  }
  #${DROPDOWN_ID} .anarchy-leaderboard-chip-cell {
    width: 14px;
  }
`;

/** Render a faction's flag coords as `globalX, globalY` for the HUD. */
export function formatFactionCoords(entry: FactionEntry): string {
  const [cx, cy] = entry.flagChunk;
  const [lx, ly] = entry.flagLocal;
  return `${cx * CHUNK_SIZE + lx}, ${cy * CHUNK_SIZE + ly}`;
}

export interface LeaderboardHudHandle {
  render(): void;
  isOpen(): boolean;
  unmount(): void;
}

export interface LeaderboardHudOptions {
  store: LeaderboardStore;
}

function buildBadgeRow(rank: number, entry: FactionEntry): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "anarchy-leaderboard-row";
  const rankCell = document.createElement("span");
  rankCell.className = "anarchy-leaderboard-rank";
  rankCell.textContent = `${rank}.`;
  row.appendChild(rankCell);
  const chip = document.createElement("span");
  chip.className = "anarchy-leaderboard-chip";
  chip.style.background = paletteColorCss(entry.colorIndex);
  row.appendChild(chip);
  const name = document.createElement("span");
  name.className = "anarchy-leaderboard-name";
  name.textContent = entry.name;
  row.appendChild(name);
  const xp = document.createElement("span");
  xp.className = "anarchy-leaderboard-xp";
  xp.textContent = entry.xp.toString();
  row.appendChild(xp);
  const coord = document.createElement("span");
  coord.className = "anarchy-leaderboard-coord";
  coord.textContent = formatFactionCoords(entry);
  row.appendChild(coord);
  return row;
}

export function mountLeaderboardHud(
  opts: LeaderboardHudOptions,
): LeaderboardHudHandle {
  const { root } = mountHudScaffold({
    styleId: STYLE_ID,
    styleContent: STYLE,
    rootId: ROOT_ID,
  });
  root.setAttribute("aria-label", "Faction leaderboard");

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  const icon = document.createElement("span");
  icon.className = "anarchy-leaderboard-icon";
  icon.textContent = "\u{1F3F3} [Factions]"; // 🏳
  badge.appendChild(icon);
  const rows = document.createElement("div");
  rows.className = "anarchy-leaderboard-rows";
  badge.appendChild(rows);
  root.appendChild(badge);

  const dropdown = document.createElement("div");
  dropdown.id = DROPDOWN_ID;
  root.appendChild(dropdown);

  const render = (): void => {
    const map = opts.store.current();
    rows.innerHTML = "";
    if (map.size === 0) {
      const empty = document.createElement("div");
      empty.className = "anarchy-leaderboard-empty";
      empty.textContent = "No factions yet";
      rows.appendChild(empty);
      dropdown.innerHTML = "";
      return;
    }
    const sorted = sortedByXpDesc(map);
    const topN = sorted.slice(0, BADGE_TOP_N);
    topN.forEach((entry, i) => {
      rows.appendChild(buildBadgeRow(i + 1, entry));
    });
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const heading of ["", "Faction", "XP", "Flag"]) {
      const th = document.createElement("th");
      th.textContent = heading;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    for (const entry of sorted) {
      const tr = document.createElement("tr");
      const chipCell = document.createElement("td");
      chipCell.className = "anarchy-leaderboard-chip-cell";
      const rowChip = document.createElement("span");
      rowChip.className = "anarchy-leaderboard-chip";
      rowChip.style.background = paletteColorCss(entry.colorIndex);
      chipCell.appendChild(rowChip);
      tr.appendChild(chipCell);
      const nameCell = document.createElement("td");
      nameCell.textContent = entry.name;
      tr.appendChild(nameCell);
      const xpCell = document.createElement("td");
      xpCell.textContent = entry.xp.toString();
      tr.appendChild(xpCell);
      const coordCell = document.createElement("td");
      coordCell.className = "anarchy-leaderboard-coord";
      coordCell.textContent = formatFactionCoords(entry);
      tr.appendChild(coordCell);
      body.appendChild(tr);
    }
    table.appendChild(body);
    dropdown.innerHTML = "";
    dropdown.appendChild(table);
  };

  const onEnter = (): void => {
    root.classList.add("open");
  };
  const onLeave = (): void => {
    root.classList.remove("open");
  };
  root.addEventListener("mouseenter", onEnter);
  root.addEventListener("mouseleave", onLeave);

  const unsubscribe = opts.store.subscribe(() => render());
  render();

  return {
    render,
    isOpen: () => root.classList.contains("open"),
    unmount: () => {
      unsubscribe();
      root.removeEventListener("mouseenter", onEnter);
      root.removeEventListener("mouseleave", onLeave);
      root.remove();
    },
  };
}
