import { describe, expect, it } from "vitest";

import {
  HOTBAR_SLOTS,
  INVENTORY_SIZE,
  Inventory,
  ItemId,
  MAIN_SLOTS,
  type Slot,
} from "./inventory.js";

describe("Inventory", () => {
  it("starts with every slot empty", () => {
    const inv = new Inventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      expect(inv.slot(i)).toBeNull();
    }
    expect(inv.allSlots()).toHaveLength(INVENTORY_SIZE);
  });

  it("exposes the hotbar / main split as a 9 + 36 = 45 layout", () => {
    expect(HOTBAR_SLOTS).toBe(9);
    expect(MAIN_SLOTS).toBe(36);
    expect(INVENTORY_SIZE).toBe(45);
  });

  it("returns null for out-of-range slot indices", () => {
    const inv = new Inventory();
    expect(inv.slot(-1)).toBeNull();
    expect(inv.slot(INVENTORY_SIZE)).toBeNull();
    expect(inv.slot(9999)).toBeNull();
  });

  it("counts items by kind across slots", () => {
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[0] = { item: ItemId.Gold, count: 7 };
    slots[5] = { item: ItemId.Gold, count: 3 };
    slots[10] = { item: ItemId.Stone, count: 12 };
    inv.replaceFromWire(slots);
    expect(inv.countOf(ItemId.Gold)).toBe(10);
    expect(inv.countOf(ItemId.Stone)).toBe(12);
    expect(inv.countOf(ItemId.Stick)).toBe(0);
  });

  it("replaceFromWire mirrors the supplied slot array", () => {
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[0] = { item: ItemId.Gold, count: 10 };
    inv.replaceFromWire(slots);
    expect(inv.slot(0)).toEqual({ item: ItemId.Gold, count: 10 });
    expect(inv.slot(1)).toBeNull();
  });

  it("replaceFromWire is a snapshot — later mutations to the source array don't leak", () => {
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[0] = { item: ItemId.Wood, count: 1 };
    inv.replaceFromWire(slots);
    slots[0] = { item: ItemId.Gold, count: 99 };
    expect(inv.slot(0)).toEqual({ item: ItemId.Wood, count: 1 });
  });

  it("rejects a slot array of the wrong length", () => {
    const inv = new Inventory();
    expect(() => inv.replaceFromWire([])).toThrow();
    expect(() => inv.replaceFromWire(new Array(INVENTORY_SIZE - 1).fill(null))).toThrow();
    expect(() => inv.replaceFromWire(new Array(INVENTORY_SIZE + 1).fill(null))).toThrow();
  });

  it("replaceFromWire replaces, never merges — prior non-empty slots clear when the new frame is empty", () => {
    // First frame seeds a busy mid-session state (two non-empty slots).
    const inv = new Inventory();
    const seeded: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    seeded[0] = { item: ItemId.Gold, count: 10 };
    seeded[5] = { item: ItemId.Stone, count: 20 };
    inv.replaceFromWire(seeded);
    expect(inv.slot(0)).toEqual({ item: ItemId.Gold, count: 10 });
    expect(inv.slot(5)).toEqual({ item: ItemId.Stone, count: 20 });

    // A second frame with a different layout (slot 0 empty, slot 7 carrying
    // Wood, slot 5 still missing) must wholesale replace the mirror — no
    // merge fallback that would keep the prior Gold/Stone alive.
    const next: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    next[7] = { item: ItemId.Wood, count: 3 };
    inv.replaceFromWire(next);
    expect(inv.slot(0)).toBeNull();
    expect(inv.slot(5)).toBeNull();
    expect(inv.slot(7)).toEqual({ item: ItemId.Wood, count: 3 });
    expect(inv.countOf(ItemId.Gold)).toBe(0);
    expect(inv.countOf(ItemId.Stone)).toBe(0);
  });

  it("replaceFromWire surfaces the equipped slot indices via the typed getters", () => {
    // Task 010 rework: equipment is a flag on a cell. The mirror must
    // expose the equipped slot index so the UI layer can paint the
    // colored highlight on the right cell, and `getEquipped` must derive
    // the equipped item from the cell's contents.
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[3] = { item: ItemId.IronPickaxe, count: 1 };
    slots[7] = { item: ItemId.WoodAxe, count: 1 };
    inv.replaceFromWire(slots, 3, 7);
    expect(inv.getEquippedSlot("pickaxe")).toBe(3);
    expect(inv.getEquippedSlot("axe")).toBe(7);
    expect(inv.getEquipped("pickaxe")).toBe(ItemId.IronPickaxe);
    expect(inv.getEquipped("axe")).toBe(ItemId.WoodAxe);
    expect(inv.isEquippedAt("pickaxe", 3)).toBe(true);
    expect(inv.isEquippedAt("pickaxe", 7)).toBe(false);
    expect(inv.isEquippedAt("axe", 7)).toBe(true);

    // A frame with `null` equipment pointers clears both flags.
    inv.replaceFromWire(slots);
    expect(inv.getEquippedSlot("pickaxe")).toBeNull();
    expect(inv.getEquippedSlot("axe")).toBeNull();
    expect(inv.getEquipped("pickaxe")).toBeNull();
    expect(inv.getEquipped("axe")).toBeNull();
  });

  it("replaceFromWire normalizes a stale equipped pointer to null", () => {
    // A pointer to an empty cell or a cell with the wrong tool kind is
    // defensively cleared so the UI never paints a wrong-color
    // highlight.
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[0] = { item: ItemId.Gold, count: 5 };
    // Slot 1 is empty; slot 0 holds Gold (not a tool). Both should be
    // normalized to null when used as equipped pointers.
    inv.replaceFromWire(slots, 0, 1);
    expect(inv.getEquippedSlot("pickaxe")).toBeNull();
    expect(inv.getEquippedSlot("axe")).toBeNull();
    // Out-of-range indices also clear.
    inv.replaceFromWire(slots, INVENTORY_SIZE, -1);
    expect(inv.getEquippedSlot("pickaxe")).toBeNull();
    expect(inv.getEquippedSlot("axe")).toBeNull();
  });

  it("replaceFromWire fires subscribers when only the equipment slot pointers changed", () => {
    // Equip/unequip without changing main slots still mutates the mirror —
    // the UI's cells need to re-paint, so the change channel must
    // fire even when only the equipment pointers differ.
    const inv = new Inventory();
    const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    slots[3] = { item: ItemId.IronPickaxe, count: 1 };
    slots[7] = { item: ItemId.TungstenAxe, count: 1 };
    let calls = 0;
    inv.subscribe(() => {
      calls++;
    });
    inv.replaceFromWire(slots);
    expect(calls).toBe(1);
    inv.replaceFromWire(slots, 3, null);
    expect(calls).toBe(2);
    inv.replaceFromWire(slots, 3, 7);
    expect(calls).toBe(3);
    inv.replaceFromWire(slots);
    expect(calls).toBe(4);
  });

  it("subscribe fires on every replaceFromWire and the unsubscribe stops further notifications", () => {
    const inv = new Inventory();
    let calls = 0;
    const unsubscribe = inv.subscribe(() => {
      calls++;
    });

    const empty: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    inv.replaceFromWire(empty);
    expect(calls).toBe(1);

    const seeded: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
    seeded[0] = { item: ItemId.Gold, count: 1 };
    inv.replaceFromWire(seeded);
    expect(calls).toBe(2);

    unsubscribe();
    inv.replaceFromWire(empty);
    expect(calls).toBe(2);
  });
});
