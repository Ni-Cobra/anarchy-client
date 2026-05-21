// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatCoords, formatPing, mountCoordsHud } from "./coords_hud.js";

const ROOT_ID = "anarchy-coords-hud";

describe("formatCoords", () => {
  it("renders integer tile and 2-decimal subtile pair", () => {
    expect(formatCoords(0.5, 0.5)).toEqual({ tile: "0, 0", sub: "0.50, 0.50" });
    expect(formatCoords(12.42, -3.18)).toEqual({
      tile: "12, -4",
      sub: "12.42, -3.18",
    });
  });

  it("uses floor for the tile line so cell identity is stable across the cell", () => {
    // A player anywhere within tile (3, 5) reports (3, 5), regardless of the
    // subtile fraction. Negative coords floor *down* (server's convention).
    expect(formatCoords(3.0, 5.0).tile).toBe("3, 5");
    expect(formatCoords(3.99, 5.99).tile).toBe("3, 5");
    expect(formatCoords(-0.01, -0.01).tile).toBe("-1, -1");
  });

  it("rounds the subtile pair to two decimals", () => {
    expect(formatCoords(1.234, 5.678).sub).toBe("1.23, 5.68");
  });
});

describe("mountCoordsHud", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("starts hidden and shows only after the first non-null update", () => {
    const hud = mountCoordsHud();
    const root = document.getElementById(ROOT_ID)!;
    expect(root.classList.contains("hidden")).toBe(true);

    hud.update({ x: 4.25, y: -1.75 });
    expect(root.classList.contains("hidden")).toBe(false);
    expect(root.querySelector(".anarchy-coords-tile")?.textContent).toBe("4, -2");
    expect(root.querySelector(".anarchy-coords-sub")?.textContent).toBe(
      "4.25, -1.75",
    );

    hud.unmount();
  });

  it("hides again when update is called with null", () => {
    const hud = mountCoordsHud();
    hud.update({ x: 0, y: 0 });
    const root = document.getElementById(ROOT_ID)!;
    expect(root.classList.contains("hidden")).toBe(false);

    hud.update(null);
    expect(root.classList.contains("hidden")).toBe(true);

    hud.unmount();
  });

  it("unmount removes the root from the DOM", () => {
    const hud = mountCoordsHud();
    expect(document.getElementById(ROOT_ID)).not.toBeNull();
    hud.unmount();
    expect(document.getElementById(ROOT_ID)).toBeNull();
  });

  it("renders the ping line as '—' before the first sample, then updates it", () => {
    const hud = mountCoordsHud();
    const root = document.getElementById(ROOT_ID)!;
    const pingLine = root.querySelector(".anarchy-coords-ping")!;
    expect(pingLine.textContent).toBe("ping —");

    hud.updatePing(50);
    expect(pingLine.textContent).toBe("ping 50 ms");

    hud.updatePing(127.4);
    expect(pingLine.textContent).toBe("ping 127 ms");

    hud.updatePing(null);
    expect(pingLine.textContent).toBe("ping —");

    hud.unmount();
  });

  it("keeps painting the ping line independent of update(null) hide", () => {
    // The connection-error overlay (task 190) covers the canvas on a
    // transport drop, but the rAF loop still ticks until teardown. Make
    // sure that hiding the coords readout doesn't blank the ping line —
    // the line lives inside the same root and only the root's `hidden`
    // class toggles. The text content is preserved.
    const hud = mountCoordsHud();
    hud.update({ x: 0, y: 0 });
    hud.updatePing(42);
    const root = document.getElementById(ROOT_ID)!;
    const pingLine = root.querySelector(".anarchy-coords-ping")!;
    expect(pingLine.textContent).toBe("ping 42 ms");

    hud.update(null);
    expect(root.classList.contains("hidden")).toBe(true);
    expect(pingLine.textContent).toBe("ping 42 ms");

    hud.unmount();
  });
});

describe("formatPing", () => {
  it("renders 'ping —' for null", () => {
    expect(formatPing(null)).toBe("ping —");
  });

  it("rounds to the nearest ms", () => {
    expect(formatPing(0)).toBe("ping 0 ms");
    expect(formatPing(0.4)).toBe("ping 0 ms");
    expect(formatPing(0.6)).toBe("ping 1 ms");
    expect(formatPing(49.6)).toBe("ping 50 ms");
    expect(formatPing(1500)).toBe("ping 1500 ms");
  });
});
