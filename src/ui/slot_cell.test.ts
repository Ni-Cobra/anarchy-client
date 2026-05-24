// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { ItemId } from "../game/index.js";
import { paletteColorCss } from "../game/palette.js";
import { applyItemIconStyle, paintSlot } from "./slot_cell.js";

describe("applyItemIconStyle — Flag per-stack tint ()", () => {
  it("paints the grayscale flag PNG without tint when extra is missing", () => {
    const icon = document.createElement("div");
    applyItemIconStyle(icon, { item: ItemId.Flag, count: 1 });
    expect(icon.style.backgroundImage).toContain("/textures/items/flag.png");
    expect(icon.style.backgroundColor).toBe("");
    expect(icon.style.backgroundBlendMode).toBe("");
  });

  it("multiplies the icon by the palette color when extra.flag is set", () => {
    const icon = document.createElement("div");
    applyItemIconStyle(icon, {
      item: ItemId.Flag,
      count: 1,
      extra: { kind: "flag", colorIndex: 4 },
    });
    expect(icon.style.backgroundImage).toContain("/textures/items/flag.png");
    expect(icon.style.backgroundColor).toBe(paletteColorCss(4));
    expect(icon.style.backgroundBlendMode).toBe("multiply");
  });

  it("different color indices produce different background colors", () => {
    const seen = new Set<string>();
    for (let idx = 0; idx < 8; idx++) {
      const icon = document.createElement("div");
      applyItemIconStyle(icon, {
        item: ItemId.Flag,
        count: 1,
        extra: { kind: "flag", colorIndex: idx },
      });
      expect(icon.style.backgroundColor).not.toBe("");
      seen.add(icon.style.backgroundColor);
    }
    expect(seen.size).toBe(8);
  });

  it("clears stale tint when the icon is re-painted with a non-tinted stack", () => {
    const icon = document.createElement("div");
    applyItemIconStyle(icon, {
      item: ItemId.Flag,
      count: 1,
      extra: { kind: "flag", colorIndex: 2 },
    });
    expect(icon.style.backgroundBlendMode).toBe("multiply");
    applyItemIconStyle(icon, { item: ItemId.Stick, count: 3 });
    expect(icon.style.backgroundColor).toBe("");
    expect(icon.style.backgroundBlendMode).toBe("");
  });

  it("non-flag items never receive a per-stack tint", () => {
    for (const item of [ItemId.Stick, ItemId.Cloth, ItemId.PoisonDart, ItemId.Blowgun, ItemId.VenomSack]) {
      const icon = document.createElement("div");
      applyItemIconStyle(icon, { item, count: 1 });
      expect(icon.style.backgroundColor).toBe("");
      expect(icon.style.backgroundBlendMode).toBe("");
    }
  });
});

describe("paintSlot — Flag tint reaches the inventory cell icon", () => {
  it("applies the tint via the inner .anarchy-inventory-icon element", () => {
    const cell = document.createElement("div");
    cell.className = "anarchy-inventory-slot";
    paintSlot(
      cell,
      { item: ItemId.Flag, count: 1, extra: { kind: "flag", colorIndex: 1 } },
      false,
      null,
    );
    const icon = cell.querySelector<HTMLDivElement>(".anarchy-inventory-icon");
    expect(icon).not.toBeNull();
    expect(icon!.style.backgroundBlendMode).toBe("multiply");
    expect(icon!.style.backgroundColor).toBe(paletteColorCss(1));
  });
});
