// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  type FactionEntry,
  LeaderboardStore,
} from "../game/index.js";

import {
  formatFactionCoords,
  mountLeaderboardHud,
} from "./leaderboard_hud.js";

function entry(
  id: number,
  name: string,
  xp: number,
  colorIndex = 0,
  flagChunk: [number, number] = [0, 0],
  flagLocal: [number, number] = [0, 0],
): FactionEntry {
  return { id, name, xp, colorIndex, flagChunk, flagLocal };
}

function badgeRowNames(): string[] {
  return Array.from(
    document.querySelectorAll(
      "#anarchy-leaderboard-badge .anarchy-leaderboard-row .anarchy-leaderboard-name",
    ),
  ).map((el) => el.textContent ?? "");
}

function badgeRowRanks(): string[] {
  return Array.from(
    document.querySelectorAll(
      "#anarchy-leaderboard-badge .anarchy-leaderboard-row .anarchy-leaderboard-rank",
    ),
  ).map((el) => el.textContent ?? "");
}

describe("formatFactionCoords", () => {
  test("renders flag chunk + local as global tile coords", () => {
    // chunk (2, -1), local (3, 5): globalX = 2 * 16 + 3 = 35,
    // globalY = -1 * 16 + 5 = -11.
    expect(
      formatFactionCoords(entry(1, "A", 0, 0, [2, -1], [3, 5])),
    ).toBe("35, -11");
  });
});

describe("mountLeaderboardHud", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders 'No factions yet' before any data", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    const empty = document.querySelector(
      "#anarchy-leaderboard-badge .anarchy-leaderboard-empty",
    );
    expect(empty?.textContent).toBe("No factions yet");
    expect(badgeRowNames()).toEqual([]);
    handle.unmount();
  });

  test("badge shows a single row when only one faction exists", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    store.applySnapshot([entry(1, "Alpha", 0)]);
    expect(badgeRowNames()).toEqual(["Alpha"]);
    expect(badgeRowRanks()).toEqual(["1."]);
    handle.unmount();
  });

  test("badge shows top 3 sorted by xp desc when more factions exist", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    store.applySnapshot([
      entry(1, "Alpha", 0),
      entry(2, "Bravo", 10),
      entry(3, "Charlie", 5),
      entry(4, "Delta", 20),
      entry(5, "Echo", 1),
    ]);
    expect(badgeRowNames()).toEqual(["Delta", "Bravo", "Charlie"]);
    expect(badgeRowRanks()).toEqual(["1.", "2.", "3."]);
    handle.unmount();
  });

  test("badge shows two rows when exactly two factions exist", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    store.applySnapshot([entry(1, "Alpha", 3), entry(2, "Bravo", 9)]);
    expect(badgeRowNames()).toEqual(["Bravo", "Alpha"]);
    expect(badgeRowRanks()).toEqual(["1.", "2."]);
    handle.unmount();
  });

  test("dropdown is hidden by default and opens on mouseenter", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    store.applySnapshot([entry(1, "Alpha", 0), entry(2, "Bravo", 5)]);
    expect(handle.isOpen()).toBe(false);
    const root = document.getElementById("anarchy-leaderboard-hud")!;
    root.dispatchEvent(new MouseEvent("mouseenter"));
    expect(handle.isOpen()).toBe(true);
    root.dispatchEvent(new MouseEvent("mouseleave"));
    expect(handle.isOpen()).toBe(false);
    handle.unmount();
  });

  test("dropdown lists every faction sorted by xp desc", () => {
    const store = new LeaderboardStore();
    mountLeaderboardHud({ store });
    store.applySnapshot([
      entry(1, "Alpha", 0),
      entry(2, "Bravo", 10),
      entry(3, "Charlie", 5),
      entry(4, "Delta", 20),
      entry(5, "Echo", 1),
    ]);
    const rows = document.querySelectorAll(
      "#anarchy-leaderboard-dropdown tbody tr",
    );
    expect(rows.length).toBe(5);
    const names = Array.from(rows).map(
      (r) => r.children[1]?.textContent ?? "",
    );
    expect(names).toEqual(["Delta", "Bravo", "Charlie", "Echo", "Alpha"]);
  });

  test("renders updates on delta apply", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    store.applySnapshot([entry(1, "Alpha", 0)]);
    expect(badgeRowNames()).toEqual(["Alpha"]);
    store.applyDelta([], [1]);
    expect(badgeRowNames()).toEqual([]);
    expect(
      document.querySelector(
        "#anarchy-leaderboard-badge .anarchy-leaderboard-empty",
      )?.textContent,
    ).toBe("No factions yet");
    handle.unmount();
  });

  test("unmount tears down the DOM and stops responding to updates", () => {
    const store = new LeaderboardStore();
    const handle = mountLeaderboardHud({ store });
    handle.unmount();
    expect(document.getElementById("anarchy-leaderboard-hud")).toBeNull();
    // Subsequent applies must not throw.
    store.applySnapshot([entry(1, "Alpha", 0)]);
  });
});
