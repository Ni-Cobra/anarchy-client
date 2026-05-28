// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChestState,
  HOTBAR_SLOTS,
  INVENTORY_SIZE,
  Inventory,
  ItemId,
  type Slot,
} from "../../game/index.js";
import { _resetTooltipForTests } from "../tooltip.js";
import { mountCraftingUi } from "./index.js";
import { makeRecipeRow } from "./row.js";
import { SCROLL_VIEWPORT_HEIGHT_PX } from "./style.js";

const TOOLTIP_ID = "anarchy-tooltip";
const SHOW_DELAY_MS = 300;

function pointer(type: string): PointerEvent {
  return new PointerEvent(type, { clientX: 10, clientY: 10, bubbles: true });
}

function emptySlots(updates: Record<number, Slot> = {}): Slot[] {
  const slots: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
  for (const [idx, slot] of Object.entries(updates)) {
    slots[Number(idx)] = slot;
  }
  return slots;
}

describe("crafting UI", () => {
  let inventory: Inventory;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
    inventory = new Inventory();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
  });

  it("mounts a closed panel with the empty-state message when no recipes are craftable", () => {
    const ui = mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const panel = document.querySelector(".anarchy-crafting-panel")!;
    expect(panel.classList.contains("open")).toBe(false);
    expect(ui.isOpen()).toBe(false);
    expect(panel.querySelector(".anarchy-crafting-empty")?.textContent).toBe(
      "No craftable recipes.",
    );
    expect(panel.querySelectorAll(".anarchy-crafting-row")).toHaveLength(0);
  });

  it("renders one row per craftable recipe id, sorted lexicographically", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      // Order intentionally scrambled; the inventory mirror sorts internally.
      ["wood-pickaxe", "sticks", "stone-axe"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
    );
    expect(rows.map((r) => r.dataset.recipeId)).toEqual([
      "sticks",
      "stone-axe",
      "wood-pickaxe",
    ]);
  });

  it("hides unknown recipe ids defensively (server ahead of client rebuild)", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      ["sticks", "future-platinum-pickaxe"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
    );
    expect(rows.map((r) => r.dataset.recipeId)).toEqual(["sticks"]);
  });

  it("clicking a row ships the recipe id via sendCraft", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      ["sticks", "wood-pickaxe"],
    );
    const sent: string[] = [];
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: (id) => sent.push(id),
      sendCraftMax: () => {},
    });
    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".anarchy-crafting-row"),
    );
    rows[1].click();
    rows[0].click();
    expect(sent).toEqual(["wood-pickaxe", "sticks"]);
  });

  it("right-clicking a craftable row ships the recipe id via sendCraftMax (task 240)", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      ["sticks", "wood-pickaxe"],
    );
    const craftSent: string[] = [];
    const craftMaxSent: string[] = [];
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: (id) => craftSent.push(id),
      sendCraftMax: (id) => craftMaxSent.push(id),
    });
    const sticks = document.querySelector<HTMLButtonElement>(
      '.anarchy-crafting-row[data-recipe-id="sticks"]',
    )!;
    sticks.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(craftMaxSent).toEqual(["sticks"]);
    expect(craftSent).toEqual([]);
  });

  it("right-clicking a partial-hint row is inert (no sendCraftMax)", () => {
    // Player has 1 Wood — wood-pickaxe needs 3 Logs + 2 Sticks; the server
    // would advertise it as partial-hint. Pin the partial-hint tier via
    // the wire shape directly.
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      [{ id: "wood-pickaxe", availability: "partial-hint" }],
    );
    const craftMaxSent: string[] = [];
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: (id) => craftMaxSent.push(id),
    });
    const row = document.querySelector<HTMLButtonElement>(
      '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
    )!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(craftMaxSent).toEqual([]);
  });

  it("re-renders reactively when InventoryUpdate flips the craftable list", () => {
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    expect(
      document.querySelectorAll(".anarchy-crafting-row"),
    ).toHaveLength(0);

    // Now the player has wood — sticks unlocks.
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      ["sticks"],
    );
    expect(
      document.querySelectorAll(".anarchy-crafting-row"),
    ).toHaveLength(1);

    // Player gathers more — wood-pickaxe + wood-axe unlock alongside sticks.
    inventory.replaceFromWire(
      emptySlots({
        0: { item: ItemId.Wood, count: 5 },
        [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
      }),
      null,
      null,
      ["sticks", "wood-pickaxe", "wood-axe"],
    );
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
    );
    expect(rows.map((r) => r.dataset.recipeId)).toEqual([
      "sticks",
      "wood-axe",
      "wood-pickaxe",
    ]);
  });

  it("setOpen / toggle drive the .open class so the slide-in animation fires", () => {
    const ui = mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const panel = document.querySelector(".anarchy-crafting-panel")!;
    expect(panel.classList.contains("open")).toBe(false);

    ui.toggle();
    expect(ui.isOpen()).toBe(true);
    expect(panel.classList.contains("open")).toBe(true);

    ui.setOpen(false);
    expect(ui.isOpen()).toBe(false);
    expect(panel.classList.contains("open")).toBe(false);
  });

  it("unmount removes the root and stops reactive updates", () => {
    const ui = mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    expect(document.querySelector("#anarchy-crafting-root")).not.toBeNull();
    ui.unmount();
    expect(document.querySelector("#anarchy-crafting-root")).toBeNull();
    // After unmount, mutations don't throw or leak DOM back.
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      ["sticks"],
    );
    expect(document.querySelector("#anarchy-crafting-root")).toBeNull();
  });

  it("a row with a single ingredient stack lays out one ingredient + arrow + one output", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      ["sticks"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const row = document.querySelector(".anarchy-crafting-row")!;
    const left = row.querySelector(".anarchy-crafting-side.left")!;
    const right = row.querySelector(".anarchy-crafting-side.right")!;
    expect(left.querySelectorAll(".anarchy-crafting-stack")).toHaveLength(1);
    expect(right.querySelectorAll(".anarchy-crafting-stack")).toHaveLength(1);
    expect(row.querySelector(".anarchy-crafting-arrow")?.textContent).toBe("→");
  });

  it("a multi-stack ingredient row lays out N stacks on the left, all wrapped inside the left half", () => {
    // wood-pickaxe = 3 Wood + 2 Stick → 1 WoodPickaxe.
    inventory.replaceFromWire(
      emptySlots({
        0: { item: ItemId.Wood, count: 3 },
        [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 2 },
      }),
      null,
      null,
      ["wood-pickaxe"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const row = document.querySelector(".anarchy-crafting-row")!;
    const left = row.querySelector(".anarchy-crafting-side.left")!;
    const right = row.querySelector(".anarchy-crafting-side.right")!;
    expect(left.querySelectorAll(".anarchy-crafting-stack")).toHaveLength(2);
    expect(right.querySelectorAll(".anarchy-crafting-stack")).toHaveLength(1);
    // Counts: wood ×3, stick ×2 → both badges visible.
    const counts = Array.from(
      left.querySelectorAll<HTMLElement>(".anarchy-crafting-stack-count"),
    ).map((el) => el.textContent);
    expect(counts).toEqual(["3", "2"]);
    // Output count = 1 → no badge.
    expect(
      right.querySelector(".anarchy-crafting-stack-count"),
    ).toBeNull();
  });

  it("layout adapter handles 5 ingredient stacks per side without overflowing the panel width", () => {
    // Synthetic recipe id won't be in the recipe table; instead, exercise
    // the row builder directly via the adapter's flex-wrap policy. Render
    // a contrived inventory listing all real recipes; assert each row
    // keeps both halves and the arrow as direct children — the flex
    // shell is what guarantees no overflow.
    inventory.replaceFromWire(
      emptySlots({
        0: { item: ItemId.Wood, count: 64 },
        1: { item: ItemId.Stone, count: 64 },
        [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 64 },
      }),
      null,
      null,
      ["sticks", "wood-pickaxe", "wood-axe", "stone-pickaxe", "stone-axe"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      // Each row keeps the canonical [left] [arrow-cell] [right] structure
      // regardless of how many stacks the ingredient cluster carries.
      expect(row.querySelector(":scope > .anarchy-crafting-side.left")).not.toBeNull();
      expect(row.querySelector(":scope > .anarchy-crafting-arrow-cell")).not.toBeNull();
      expect(row.querySelector(":scope > .anarchy-crafting-side.right")).not.toBeNull();
      // The arrow glyph itself still lives inside the cell.
      expect(row.querySelector(".anarchy-crafting-arrow")?.textContent).toBe("→");
    }
  });

  describe("frozen-while-open ordering (task 110)", () => {
    it("opening the panel snapshots the natural advertise order as the frozen order", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["wood-pickaxe", "sticks"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      // Inventory sorts inputs into affordable-then-lex order.
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-pickaxe",
      ]);
    });

    it("crafting the last of an ingredient leaves the recipe pinned in place, grayed and inert", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const sent: string[] = [];
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: (id) => sent.push(id),
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // Player consumes all wood (another action) — sticks drops off the
      // advertise list. Frozen contract: row stays at its open-time index,
      // grays out, click-inert.
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-pickaxe",
      ]);
      const sticks = rows[0];
      expect(sticks.classList.contains("uncraftable")).toBe(true);
      expect(sticks.getAttribute("aria-disabled")).toBe("true");
      sticks.click();
      expect(sent).toEqual([]);
    });

    it("a newly craftable recipe appends at the end of the affordable tier while open", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      // Open-time order: sticks (affordable), torch (partial-hint).
      // Player picks up more wood + sticks — wood-axe and wood-pickaxe
      // unlock. The natural sort would interleave wood-axe between
      // sticks and (lex-after) torch; the frozen contract instead
      // appends both at the end of the affordable section.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "wood-axe", availability: "affordable" },
          { id: "wood-pickaxe", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      // sticks stays first (open-time), new affordables appended in the
      // order the advertise iterates them — both still above the
      // open-time partial-hint torch at the very end.
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "wood-pickaxe",
        "torch",
      ]);
    });

    it("a newly partial-hint recipe appends at the very end of the panel while open", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // A new partial-hint recipe — `chest` — appears alongside the
      // open-time set. Natural sort would place chest before torch
      // lexically; the frozen contract appends it after torch.
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "chest", availability: "partial-hint" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "torch",
        "chest",
      ]);
    });

    it("closing and reopening the panel discards the frozen order and re-sorts naturally", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // Drop sticks — it freezes as uncraftable while the panel is open.
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);
      expect(
        document.querySelectorAll(".anarchy-crafting-row"),
      ).toHaveLength(2);

      // Close + reopen. The frozen snapshot is discarded; the natural
      // (single-row) list takes over.
      ui.setOpen(false);
      ui.setOpen(true);
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual(["wood-pickaxe"]);
    });

    it("a recipe that briefly becomes uncraftable recovers its natural status at its pinned index", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // sticks drops out.
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);
      let sticks = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(sticks.classList.contains("uncraftable")).toBe(true);

      // sticks comes back — frozen index stays put, status reverts.
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-pickaxe",
      ]);
      sticks = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(sticks.classList.contains("uncraftable")).toBe(false);
    });

    it("while the panel is closed, redraws follow the natural advertised order (no freeze)", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      // Panel never opened — sticks dropping must just disappear.
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual(["wood-pickaxe"]);
    });
  });

  describe("clicked-row insertion (task 180)", () => {
    it("splices a newcomer immediately after the last clicked row", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // Click on `sticks` (index 0).
      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="sticks"]',
        )!
        .click();

      // Player picks up sticks; wood-axe newly unlocks. Natural sort
      // would interleave wood-axe between sticks and wood-pickaxe by
      // lex order — that coincidence makes this a weak signal on its
      // own, but combined with the clicked-row-stable assertion below
      // it pins the splice point.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "wood-pickaxe",
      ]);
    });

    it("falls back to tier-end append when no row has been clicked yet", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // No click. New affordable arrives — must land at the affordable
      // tier end (just before torch), matching the task 110 contract.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "wood-axe", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "torch",
      ]);
    });

    it("keeps the clicked row pinned at its index when a newcomer arrives", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      // Click wood-pickaxe (index 1). A natural-sort newcomer (`wood-axe`,
      // lex-before wood-pickaxe) must NOT shove wood-pickaxe down — the
      // clicked row stays put and wood-axe goes directly after it.
      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
        )!
        .click();
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-pickaxe",
        "wood-axe",
      ]);
    });

    it("splices multiple newcomers in advertise iteration order, first closest to the click", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="sticks"]',
        )!
        .click();

      // Two newcomers arrive at once. The first iterated (wood-axe) lands
      // at sticks+1; the second (wood-pickaxe) at sticks+2.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "wood-pickaxe",
      ]);
    });

    it("a partial-hint newcomer also lands directly after the clicked affordable row", () => {
      // Insertion is by index, not by tier — the visual affordable/partial-
      // hint grouping can be broken by the click anchor (per task 180 spec).
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "wood-pickaxe", availability: "affordable" },
        ],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="sticks"]',
        )!
        .click();
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "wood-pickaxe", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      // torch is partial-hint but slots in right after the clicked sticks
      // row, ahead of the existing affordable wood-pickaxe.
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "torch",
        "wood-pickaxe",
      ]);
    });

    it("right-clicking a row also anchors the splice point", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);

      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="sticks"]',
        )!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "wood-pickaxe",
      ]);
    });

    it("closing the panel clears the click anchor", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      document
        .querySelector<HTMLButtonElement>(
          '.anarchy-crafting-row[data-recipe-id="sticks"]',
        )!
        .click();

      // Close + reopen wipes the anchor; the snapshot resets to whatever
      // is advertised at reopen time.
      ui.setOpen(false);
      ui.setOpen(true);

      // A newcomer arrives. Without the click anchor, it lands at the
      // affordable tier end (just before torch), not adjacent to sticks.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 4 },
        }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "wood-axe", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "torch",
      ]);
    });
  });

  it("rows live inside a .anarchy-crafting-list wrapper so the slide-in transform stays separate from the row flow", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      ["sticks"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const wrapper = document.querySelector(".anarchy-crafting-list");
    expect(wrapper).not.toBeNull();
    const row = document.querySelector<HTMLElement>(".anarchy-crafting-row")!;
    expect(row.parentElement).toBe(wrapper);
  });

  it("nests the row list inside a .anarchy-crafting-scroll viewport", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      ["sticks"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const panel = document.querySelector<HTMLElement>(
      ".anarchy-crafting-panel",
    )!;
    const scroll = panel.querySelector<HTMLElement>(
      ":scope > .anarchy-crafting-scroll",
    )!;
    expect(scroll).not.toBeNull();
    const list = scroll.querySelector<HTMLElement>(
      ":scope > .anarchy-crafting-list",
    )!;
    expect(list).not.toBeNull();
  });

  it("re-rendering the row list when craftability flips does not re-mount the panel chrome", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
      null,
      null,
      ["sticks", "wood-pickaxe"],
    );
    const ui = mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    const panelBefore = document.querySelector<HTMLElement>(
      ".anarchy-crafting-panel",
    )!;
    const scrollBefore = document.querySelector<HTMLElement>(
      ".anarchy-crafting-scroll",
    )!;
    const listBefore = document.querySelector<HTMLElement>(
      ".anarchy-crafting-list",
    )!;

    // Open the panel (freezes the row order), then drop sticks — the
    // row becomes uncraftable in place. Under the old reorder model this
    // could have shifted the panel bounds; under the frozen model the
    // strip just re-paints inside the same wrapper.
    ui.setOpen(true);
    inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);

    // Chrome nodes are the exact same DOM elements after reorder; only
    // the row strip inside the list is replaced wholesale.
    expect(document.querySelector(".anarchy-crafting-panel")).toBe(panelBefore);
    expect(document.querySelector(".anarchy-crafting-scroll")).toBe(scrollBefore);
    expect(document.querySelector(".anarchy-crafting-list")).toBe(listBefore);
  });

  it("stops mousedown / contextmenu inside the panel from reaching window", () => {
    inventory.replaceFromWire(
      emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
      null,
      null,
      ["sticks"],
    );
    mountCraftingUi({
      getInventory: () => inventory,
      sendCraft: () => {},
      sendCraftMax: () => {},
    });
    let windowHits = 0;
    const onWindow = (): void => {
      windowHits++;
    };
    window.addEventListener("mousedown", onWindow);
    window.addEventListener("contextmenu", onWindow);

    const panel = document.querySelector(
      ".anarchy-crafting-panel",
    )! as HTMLElement;
    panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const ctx = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    expect(windowHits).toBe(0);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(windowHits).toBe(1);

    window.removeEventListener("mousedown", onWindow);
    window.removeEventListener("contextmenu", onWindow);
  });

  describe("max-craft-count badge", () => {
    it("renders the badge under the arrow with floor(have/need) min across ingredients", () => {
      // wood-pickaxe = 3 Log + 2 Stick → 1 WoodPickaxe.
      // 9 Log ⇒ 3 crafts on the Log side; 7 Stick ⇒ 3 crafts on the
      // Stick side. min = 3.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Log, count: 9 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 7 },
        }),
        null,
        null,
        ["wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;
      const count = row.querySelector<HTMLElement>(
        ".anarchy-crafting-arrow-count",
      );
      expect(count?.textContent).toBe("3");
    });

    it("picks the smaller side when ingredients are unbalanced", () => {
      // 6 Log ⇒ 2 crafts; 3 Stick ⇒ 1 craft. min = 1.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Log, count: 6 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 3 },
        }),
        null,
        null,
        ["wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;
      expect(
        row.querySelector(".anarchy-crafting-arrow-count")?.textContent,
      ).toBe("1");
    });

    it("hides the badge entirely when the recipe is frozen as uncraftable", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);

      const frozen = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(frozen.classList.contains("uncraftable")).toBe(true);
      expect(frozen.querySelector(".anarchy-crafting-arrow-count")).toBeNull();
    });

    it("re-renders the badge when InventoryUpdate changes the pooled counts", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        ["sticks"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      let row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(
        row.querySelector(".anarchy-crafting-arrow-count")?.textContent,
      ).toBe("1");

      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 7 } }),
        null,
        null,
        ["sticks"],
      );
      row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(
        row.querySelector(".anarchy-crafting-arrow-count")?.textContent,
      ).toBe("7");
    });
  });

  describe("recipe tooltip on hover", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function hover(row: HTMLElement): void {
      row.dispatchEvent(pointer("pointerenter"));
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    }

    it("surfaces the output name and each ingredient with required counts after the hover delay", () => {
      // wood-pickaxe = 3 Log + 2 Stick → 1 WoodPickaxe.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Log, count: 3 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 2 },
        }),
        null,
        null,
        ["wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;

      // Pre-delay: tooltip is not yet visible.
      row.dispatchEvent(pointer("pointerenter"));
      vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
      let node = document.getElementById(TOOLTIP_ID);
      expect(node === null || node.style.display === "none").toBe(true);

      vi.advanceTimersByTime(1);
      node = document.getElementById(TOOLTIP_ID)!;
      expect(node.style.display).toBe("block");
      const body = node.querySelector(".anarchy-crafting-tooltip");
      expect(body).not.toBeNull();

      const title = body!.querySelector(".anarchy-crafting-tooltip-title")!;
      expect(title.textContent).toContain("Wood Pickaxe");

      const ingredients = Array.from(
        body!.querySelectorAll<HTMLElement>(".anarchy-crafting-tooltip-ingredient"),
      );
      expect(ingredients).toHaveLength(2);
      expect(ingredients[0].textContent).toContain("3 ×");
      expect(ingredients[0].textContent).toContain("Log");
      expect(ingredients[1].textContent).toContain("2 ×");
      expect(ingredients[1].textContent).toContain("Stick");
    });

    it("annotates each ingredient row with the player's current have-count", () => {
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Log, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 2 },
        }),
        null,
        null,
        ["wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;
      hover(row);

      const haves = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-tooltip-have"),
      );
      expect(haves.map((el) => el.textContent)).toEqual([
        "(have 5)",
        "(have 2)",
      ]);
      // Both ingredients are satisfied (5 ≥ 3, 2 ≥ 2) → no `short` class.
      for (const el of haves) {
        expect(el.classList.contains("short")).toBe(false);
      }
    });

    it("pools open-chest contents into the tooltip have-count (task 240)", () => {
      // Player has 0 wood; an open chest holds 50 wood. Tooltip must
      // show "(have 50)" and stay green — the server pools both for
      // mass-craft, so the tooltip's numbers track that pool.
      inventory.replaceFromWire(
        emptySlots(),
        null,
        null,
        ["sticks"],
      );
      const chestState = new ChestState();
      chestState.replaceFromWire(
        { cx: 0, cy: 0, lx: 0, ly: 0 },
        emptySlots({ 0: { item: ItemId.Wood, count: 50 } }),
      );
      mountCraftingUi({
        getInventory: () => inventory,
        chestState,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      hover(row);
      const have = document.querySelector<HTMLElement>(
        ".anarchy-crafting-tooltip-have",
      )!;
      expect(have.textContent).toBe("(have 50)");
      expect(have.classList.contains("short")).toBe(false);
    });

    it("flags ingredients with insufficient have-count via the `short` class (frozen uncraftable row)", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      // Drop sticks — the row freezes in place as uncraftable. The
      // tooltip still resolves against the live inventory so the
      // have-count reads 0 and the `short` class kicks in.
      inventory.replaceFromWire(emptySlots(), null, null, ["wood-pickaxe"]);
      const frozen = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      hover(frozen);

      const have = document.querySelector<HTMLElement>(
        ".anarchy-crafting-tooltip-have",
      )!;
      expect(have.textContent).toBe("(have 0)");
      expect(have.classList.contains("short")).toBe(true);
    });

    it("hides the tooltip when the cursor leaves the row", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        ["sticks"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        ".anarchy-crafting-row",
      )!;
      hover(row);
      const node = document.getElementById(TOOLTIP_ID)!;
      expect(node.style.display).toBe("block");

      row.dispatchEvent(pointer("pointerleave"));
      expect(node.style.display).toBe("none");
    });

    it("re-renders the tooltip body fresh when the cursor moves to a different recipe row", () => {
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 3 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 2 },
        }),
        null,
        null,
        ["sticks", "wood-pickaxe"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const sticksRow = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      hover(sticksRow);
      expect(
        document
          .querySelector(".anarchy-crafting-tooltip-title")!
          .textContent,
      ).toContain("Stick");

      sticksRow.dispatchEvent(pointer("pointerleave"));
      const pickaxeRow = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;
      hover(pickaxeRow);
      expect(
        document
          .querySelector(".anarchy-crafting-tooltip-title")!
          .textContent,
      ).toContain("Wood Pickaxe");
    });

    it("unmount detaches every row tooltip so a fresh mount starts clean", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        ["sticks"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        ".anarchy-crafting-row",
      )!;
      hover(row);
      ui.unmount();
      const node = document.getElementById(TOOLTIP_ID);
      // Tooltip is hidden after unmount, even though the shared DOM node
      // may still exist (the primitive keeps it cached on document.body).
      expect(node === null || node.style.display === "none").toBe(true);
    });
  });

  describe("fixed-size scroll viewport", () => {
    function viewportHeight(): string {
      const scroll = document.querySelector<HTMLElement>(
        ".anarchy-crafting-scroll",
      )!;
      return getComputedStyle(scroll).height;
    }

    it("pins the scroll viewport at a fixed pixel height with zero recipes", () => {
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      expect(viewportHeight()).toBe(`${SCROLL_VIEWPORT_HEIGHT_PX}px`);
    });

    it("pins the scroll viewport at the same pixel height with one recipe", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        ["sticks"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      expect(viewportHeight()).toBe(`${SCROLL_VIEWPORT_HEIGHT_PX}px`);
    });

    it("keeps the same pixel height with more rows than the viewport reserves (overflow scrolls instead)", () => {
      // 12 recipes ≥ MAX_VISIBLE_ROWS (10) so the list overflows.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Log, count: 64 },
          1: { item: ItemId.Wood, count: 64 },
          2: { item: ItemId.Stone, count: 64 },
          3: { item: ItemId.RawCopper, count: 64 },
          4: { item: ItemId.RawIron, count: 64 },
          5: { item: ItemId.CopperIngot, count: 64 },
          6: { item: ItemId.IronIngot, count: 64 },
          7: { item: ItemId.Coal, count: 64 },
          8: { item: ItemId.Torch, count: 64 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 64 },
        }),
        null,
        null,
        [
          "sticks",
          "wood-from-log",
          "sticks-from-log",
          "wood-pickaxe",
          "wood-axe",
          "stone-pickaxe",
          "stone-axe",
          "copper-ingot",
          "iron-ingot",
          "copper-pickaxe",
          "iron-pickaxe",
          "torch",
        ],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      expect(viewportHeight()).toBe(`${SCROLL_VIEWPORT_HEIGHT_PX}px`);
      const rows = document.querySelectorAll(".anarchy-crafting-row");
      expect(rows.length).toBe(12);
    });

    it("preserves scrollTop across inventory churn (frozen order means no anchor math needed)", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 64 } }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      const ui = mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      ui.setOpen(true);
      const scroll = document.querySelector<HTMLElement>(
        ".anarchy-crafting-scroll",
      )!;
      scroll.scrollTop = 100;
      // Churn — same set, then a recipe drops, then a new one appears.
      // Under the frozen contract none of these reorder existing rows,
      // so scrollTop stays exactly where the user left it.
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 64 } }),
        null,
        null,
        ["sticks", "wood-axe", "wood-pickaxe"],
      );
      expect(scroll.scrollTop).toBe(100);
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 64 } }),
        null,
        null,
        ["sticks"],
      );
      expect(scroll.scrollTop).toBe(100);
    });
  });

  describe("wheel capture", () => {
    it("stops wheel events inside the panel from reaching window", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        ["sticks"],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      let windowHits = 0;
      const onWindow = (): void => {
        windowHits++;
      };
      window.addEventListener("wheel", onWindow);

      const panel = document.querySelector<HTMLElement>(
        ".anarchy-crafting-panel",
      )!;
      panel.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
      );
      expect(windowHits).toBe(0);

      // Wheel outside the panel still reaches window — the gate is
      // panel-scoped, not a global capture.
      document.body.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
      );
      expect(windowHits).toBe(1);

      window.removeEventListener("wheel", onWindow);
    });
  });

  describe("AnyOf ingredient rendering", () => {
    // The craft-pane row painter must handle `Ingredient::AnyOf` without
    // crashing: the count appears once, followed by every candidate item
    // icon separated by thin vertical bars. No `RECIPES` entry uses AnyOf
    // yet; exercise the painter directly.
    it("renders an AnyOf ingredient as count + N candidate icons + (N-1) separators", () => {
      const synthRecipe = {
        id: "test-any-of",
        ingredients: [
          {
            kind: "any-of" as const,
            items: [ItemId.Stone, ItemId.Wood, ItemId.Coal],
            count: 4,
          },
        ],
        output: { item: ItemId.Stick, count: 1 },
      };
      // Render the row via `makeRecipeRow` directly — bypasses the
      // recipe-id-driven advertise pipeline so we don't need to plant a
      // synthetic entry in `RECIPES`.
      const row = makeRecipeRow(synthRecipe, 0, false);
      document.body.appendChild(row);

      const anyOfCell = row.querySelector(
        ".anarchy-crafting-side.left > .anarchy-crafting-stack.any-of",
      );
      expect(anyOfCell).not.toBeNull();
      // Count badge "4×" appears once.
      const countBadge = anyOfCell!.querySelector(
        ".anarchy-crafting-any-of-count",
      );
      expect(countBadge?.textContent).toBe("4×");
      // Three icons (one per candidate).
      const icons = anyOfCell!.querySelectorAll(
        ".anarchy-crafting-stack-icon",
      );
      expect(icons).toHaveLength(3);
      // Two separators (between three icons).
      const seps = anyOfCell!.querySelectorAll(
        ".anarchy-crafting-any-of-sep",
      );
      expect(seps).toHaveLength(2);
      // The canonical row chrome is unchanged.
      expect(row.querySelector(".anarchy-crafting-arrow")?.textContent).toBe(
        "→",
      );
      expect(
        row.querySelector(".anarchy-crafting-side.right .anarchy-crafting-stack-icon"),
      ).not.toBeNull();
    });

    it("renders a single-item AnyOf without a separator", () => {
      const synthRecipe = {
        id: "test-any-of-single",
        ingredients: [
          {
            kind: "any-of" as const,
            items: [ItemId.Stone],
            count: 2,
          },
        ],
        output: { item: ItemId.Stick, count: 1 },
      };
      const row = makeRecipeRow(synthRecipe, 0, false);
      document.body.appendChild(row);
      const anyOfCell = row.querySelector(
        ".anarchy-crafting-stack.any-of",
      )!;
      expect(
        anyOfCell.querySelectorAll(".anarchy-crafting-stack-icon"),
      ).toHaveLength(1);
      expect(
        anyOfCell.querySelectorAll(".anarchy-crafting-any-of-sep"),
      ).toHaveLength(0);
    });
  });

  describe("partial-hint rows", () => {
    it("renders affordable rows above partial-hint rows, lexically within tier", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "wood-axe", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
          { id: "stone-pickaxe", availability: "partial-hint" },
          { id: "sticks", availability: "affordable" },
        ],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".anarchy-crafting-row"),
      );
      expect(rows.map((r) => r.dataset.recipeId)).toEqual([
        "sticks",
        "wood-axe",
        "stone-pickaxe",
        "torch",
      ]);
    });

    it("paints partial-hint rows with the .partial-hint class and aria-disabled", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [
          { id: "sticks", availability: "affordable" },
          { id: "torch", availability: "partial-hint" },
        ],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const torch = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="torch"]',
      )!;
      expect(torch.classList.contains("partial-hint")).toBe(true);
      expect(torch.getAttribute("aria-disabled")).toBe("true");
      const sticks = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(sticks.classList.contains("partial-hint")).toBe(false);
    });

    it("clicking a partial-hint row does not ship CraftRequest", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Stick, count: 1 } }),
        null,
        null,
        [{ id: "torch", availability: "partial-hint" }],
      );
      const sent: string[] = [];
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: (id) => sent.push(id),
        sendCraftMax: () => {},
      });
      const torch = document.querySelector<HTMLButtonElement>(
        '.anarchy-crafting-row[data-recipe-id="torch"]',
      )!;
      torch.click();
      expect(sent).toEqual([]);
    });

    it("partial-hint rows omit the max-craft badge", () => {
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 1 } }),
        null,
        null,
        [{ id: "wood-pickaxe", availability: "partial-hint" }],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-pickaxe"]',
      )!;
      expect(row.querySelector(".anarchy-crafting-arrow-count")).toBeNull();
    });

    it("max-craft badge pools open-chest contents with the player's inventory (task 240)", () => {
      // Player has zero wood; an open chest holds 50 wood. The server
      // pools both during mass-craft, so the badge must show the chest
      // contents.
      inventory.replaceFromWire(
        emptySlots(),
        null,
        null,
        ["sticks"],
      );
      const chestState = new ChestState();
      const chestSlots = emptySlots({ 0: { item: ItemId.Wood, count: 50 } });
      chestState.replaceFromWire({ cx: 0, cy: 0, lx: 0, ly: 0 }, chestSlots);
      mountCraftingUi({
        getInventory: () => inventory,
        chestState,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      const row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(
        row.querySelector(".anarchy-crafting-arrow-count")?.textContent,
      ).toBe("50");
    });

    it("re-renders when a chest opens so the badge picks up new pool contents (task 240)", () => {
      inventory.replaceFromWire(
        emptySlots(),
        null,
        null,
        ["sticks"],
      );
      const chestState = new ChestState();
      mountCraftingUi({
        getInventory: () => inventory,
        chestState,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      let row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(row.querySelector(".anarchy-crafting-arrow-count")).toBeNull();

      const chestSlots = emptySlots({ 0: { item: ItemId.Wood, count: 7 } });
      chestState.replaceFromWire({ cx: 0, cy: 0, lx: 0, ly: 0 }, chestSlots);
      row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="sticks"]',
      )!;
      expect(
        row.querySelector(".anarchy-crafting-arrow-count")?.textContent,
      ).toBe("7");
    });

    it("demoting a recipe affordable → partial-hint keeps it in the panel", () => {
      // The whole point of the tier: a recipe the player ate the last
      // ingredient of stays visible (grayed at the bottom) instead of
      // popping out of view.
      inventory.replaceFromWire(
        emptySlots({
          0: { item: ItemId.Wood, count: 5 },
          [HOTBAR_SLOTS]: { item: ItemId.Stick, count: 2 },
        }),
        null,
        null,
        [{ id: "wood-axe", availability: "affordable" }],
      );
      mountCraftingUi({
        getInventory: () => inventory,
        sendCraft: () => {},
        sendCraftMax: () => {},
      });
      let row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-axe"]',
      )!;
      expect(row.classList.contains("partial-hint")).toBe(false);

      // Player consumed all the sticks — server demotes wood-axe to
      // partial-hint instead of dropping it.
      inventory.replaceFromWire(
        emptySlots({ 0: { item: ItemId.Wood, count: 5 } }),
        null,
        null,
        [{ id: "wood-axe", availability: "partial-hint" }],
      );
      row = document.querySelector<HTMLElement>(
        '.anarchy-crafting-row[data-recipe-id="wood-axe"]',
      )!;
      expect(row.classList.contains("partial-hint")).toBe(true);
    });
  });
});
