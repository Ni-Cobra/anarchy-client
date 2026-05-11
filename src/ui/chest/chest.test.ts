// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ChestState,
  HOTBAR_SLOTS,
  INVENTORY_SIZE,
  Inventory,
  ItemId,
  type Slot,
} from "../../game/index.js";
import { mountInventoryUi, type InventoryUiHandle } from "../inventory/index.js";
import { _resetTooltipForTests } from "../tooltip.js";
import { mountChestUi } from "./index.js";

interface MoveRecord {
  src: number;
  dst: number;
  srcChest: boolean;
  dstChest: boolean;
}

interface TransferRecord extends MoveRecord {
  count: number;
}

interface MountResult {
  inventoryUi: InventoryUiHandle;
  moves: MoveRecord[];
  transfers: TransferRecord[];
  playerInv: Inventory;
  chestState: ChestState;
}

function emptySlots(): Slot[] {
  return Array.from({ length: INVENTORY_SIZE }, () => null);
}

function mountUis(
  player: Slot[] = emptySlots(),
  chest: Slot[] | null = emptySlots(),
): MountResult {
  const playerInv = new Inventory();
  playerInv.replaceFromWire(player);
  const chestState = new ChestState();
  if (chest !== null) {
    chestState.replaceFromWire({ cx: 0, cy: 0, lx: 0, ly: 0 }, chest);
  }
  const moves: MoveRecord[] = [];
  const transfers: TransferRecord[] = [];
  const inventoryUi = mountInventoryUi({
    getInventory: () => playerInv,
    getChestInventory: () =>
      chestState.location() !== null ? chestState.inventory() : null,
    sendSelect: () => {},
    sendMove: (src, dst, srcChest = false, dstChest = false) =>
      moves.push({ src, dst, srcChest, dstChest }),
    sendTransfer: (src, dst, count, srcChest = false, dstChest = false) =>
      transfers.push({ src, dst, count, srcChest, dstChest }),
    sendEquip: () => {},
    sendUnequip: () => {},
  });
  mountChestUi({ chestState, inventoryUi });
  return { inventoryUi, moves, transfers, playerInv, chestState };
}

function chestCells(): HTMLDivElement[] {
  return Array.from(
    document.querySelectorAll(".anarchy-chest-panel .anarchy-chest-slot"),
  ) as HTMLDivElement[];
}

function panelCells(): HTMLDivElement[] {
  return Array.from(
    document.querySelectorAll(".anarchy-inventory-panel .anarchy-inventory-slot"),
  ) as HTMLDivElement[];
}

function hotbarCells(): HTMLDivElement[] {
  return Array.from(
    document.querySelectorAll(".anarchy-hotbar .anarchy-inventory-slot"),
  ) as HTMLDivElement[];
}

function dragGesture(src: HTMLElement, dst: HTMLElement): void {
  const original = document.elementsFromPoint;
  document.elementsFromPoint = ((_x: number, _y: number) => [
    dst,
  ]) as typeof document.elementsFromPoint;
  src.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 10,
      clientY: 10,
      bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 200,
      clientY: 200,
      bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      button: 0,
      clientX: 200,
      clientY: 200,
      bubbles: true,
    }),
  );
  document.elementsFromPoint = original;
}

describe("chest cross-grid drag/drop + split (task 535)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
  });

  it("renders the chest panel with 45 cells when a chest is open", () => {
    mountUis();
    const cells = chestCells();
    expect(cells).toHaveLength(INVENTORY_SIZE);
    const panel = document.querySelector(".anarchy-chest-panel")!;
    expect(panel.classList.contains("open")).toBe(true);
  });

  it("hides the chest panel when no chest is open", () => {
    mountUis(emptySlots(), null);
    const panel = document.querySelector(".anarchy-chest-panel")!;
    expect(panel.classList.contains("open")).toBe(false);
  });

  it("dragging from a player panel cell onto a chest cell ships MoveSlot with dstChest=true", () => {
    const player = emptySlots();
    player[HOTBAR_SLOTS] = { item: ItemId.Gold, count: 10 };
    const { moves } = mountUis(player);

    const src = panelCells()[0];
    const dst = chestCells()[5];
    dragGesture(src, dst);

    expect(moves).toEqual([
      { src: HOTBAR_SLOTS, dst: 5, srcChest: false, dstChest: true },
    ]);
  });

  it("dragging from a chest cell onto a player panel cell ships MoveSlot with srcChest=true", () => {
    const chest = emptySlots();
    chest[3] = { item: ItemId.Gold, count: 10 };
    const { moves } = mountUis(emptySlots(), chest);

    const src = chestCells()[3];
    const dst = panelCells()[7];
    dragGesture(src, dst);

    expect(moves).toEqual([
      {
        src: 3,
        dst: HOTBAR_SLOTS + 7,
        srcChest: true,
        dstChest: false,
      },
    ]);
  });

  it("dragging from one chest cell onto another chest cell ships MoveSlot with both flags true", () => {
    const chest = emptySlots();
    chest[2] = { item: ItemId.Gold, count: 10 };
    const { moves } = mountUis(emptySlots(), chest);

    const src = chestCells()[2];
    const dst = chestCells()[8];
    dragGesture(src, dst);

    expect(moves).toEqual([
      { src: 2, dst: 8, srcChest: true, dstChest: true },
    ]);
  });

  it("dragging from an empty chest cell does not ship a MoveSlot", () => {
    const { moves } = mountUis();
    dragGesture(chestCells()[0], panelCells()[0]);
    expect(moves).toEqual([]);
  });

  it("clicking a non-empty chest cell ships MoveSlot(chest → first free main slot)", () => {
    const chest = emptySlots();
    chest[4] = { item: ItemId.Gold, count: 10 };
    const { moves } = mountUis(emptySlots(), chest);

    const cell = chestCells()[4];
    cell.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );

    expect(moves).toEqual([
      { src: 4, dst: HOTBAR_SLOTS, srcChest: true, dstChest: false },
    ]);
  });

  it("clicking an empty chest cell is a no-op", () => {
    const { moves } = mountUis();
    const cell = chestCells()[0];
    cell.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    expect(moves).toEqual([]);
  });

  it("clicking a chest cell when the player panel is full falls back to a free hotbar slot", () => {
    // Every main slot occupied → withdraw lands in the first empty
    // hotbar slot.
    const player = emptySlots();
    for (let i = HOTBAR_SLOTS; i < INVENTORY_SIZE; i++) {
      player[i] = { item: ItemId.Stone, count: 1 };
    }
    const chest = emptySlots();
    chest[0] = { item: ItemId.Gold, count: 10 };
    const { moves } = mountUis(player, chest);

    chestCells()[0].dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );

    expect(moves).toEqual([
      { src: 0, dst: 0, srcChest: true, dstChest: false },
    ]);
  });

  it("right-click on a chest cell arms the split source with a yellow border", () => {
    const chest = emptySlots();
    chest[0] = { item: ItemId.Gold, count: 10 };
    mountUis(emptySlots(), chest);

    const cell = chestCells()[0];
    cell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );
    expect(cell.classList.contains("split-source")).toBe(true);
  });

  it("right-click split from chest → player ships TransferItems with srcChest=true", () => {
    const chest = emptySlots();
    chest[0] = { item: ItemId.Gold, count: 10 };
    const { transfers } = mountUis(emptySlots(), chest);

    const sourceCell = chestCells()[0];
    const destCell = panelCells()[3];
    sourceCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );
    destCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );

    expect(transfers).toEqual([
      {
        src: 0,
        dst: HOTBAR_SLOTS + 3,
        count: 1,
        srcChest: true,
        dstChest: false,
      },
    ]);
  });

  it("right-click split from player → chest ships TransferItems with dstChest=true", () => {
    const player = emptySlots();
    player[HOTBAR_SLOTS] = { item: ItemId.Gold, count: 10 };
    const { transfers } = mountUis(player);

    const sourceCell = panelCells()[0];
    const destCell = chestCells()[7];
    sourceCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );
    destCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );

    expect(transfers).toEqual([
      {
        src: HOTBAR_SLOTS,
        dst: 7,
        count: 1,
        srcChest: false,
        dstChest: true,
      },
    ]);
  });

  it("dragging from a chest cell onto an equipment slot is rejected (no wire surface)", () => {
    const chest = emptySlots();
    chest[2] = { item: ItemId.IronPickaxe, count: 1 };
    const { moves } = mountUis(emptySlots(), chest);

    const src = chestCells()[2];
    const equipmentSlot = document.querySelector(
      ".anarchy-equipment-bar .anarchy-inventory-slot",
    ) as HTMLDivElement;
    dragGesture(src, equipmentSlot);
    expect(moves).toEqual([]);
  });

  it("dragging from an equipment slot onto a chest cell is rejected (server picks dst on unequip)", () => {
    // Equip a pickaxe at hotbar slot 3, then try to drag from the
    // equipment slot onto a chest cell. The drop is rejected because
    // unequip has no way to route to a specific chest cell.
    const player = emptySlots();
    player[3] = { item: ItemId.IronPickaxe, count: 1 };
    const playerInv = new Inventory();
    playerInv.replaceFromWire(player, 3, null);
    const chestState = new ChestState();
    chestState.replaceFromWire({ cx: 0, cy: 0, lx: 0, ly: 0 }, emptySlots());
    const moves: MoveRecord[] = [];
    let unequipCount = 0;
    const inventoryUi = mountInventoryUi({
      getInventory: () => playerInv,
      getChestInventory: () =>
        chestState.location() !== null ? chestState.inventory() : null,
      sendSelect: () => {},
      sendMove: (src, dst, srcChest = false, dstChest = false) =>
        moves.push({ src, dst, srcChest, dstChest }),
      sendEquip: () => {},
      sendUnequip: () => {
        unequipCount += 1;
      },
    });
    mountChestUi({ chestState, inventoryUi });

    const equipmentSlot = document.querySelector(
      ".anarchy-equipment-bar .anarchy-inventory-slot",
    ) as HTMLDivElement;
    const dst = chestCells()[0];
    dragGesture(equipmentSlot, dst);
    expect(moves).toEqual([]);
    expect(unequipCount).toBe(0);
  });

  it("left-click on a player cell clears a chest-armed split source", () => {
    const chest = emptySlots();
    chest[0] = { item: ItemId.Gold, count: 10 };
    mountUis(emptySlots(), chest);

    const sourceCell = chestCells()[0];
    sourceCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true }),
    );
    expect(sourceCell.classList.contains("split-source")).toBe(true);

    const playerCell = hotbarCells()[0];
    playerCell.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, bubbles: true }),
    );

    expect(sourceCell.classList.contains("split-source")).toBe(false);
  });

  it("dragging from a chest cell paints the source highlight on the chest cell", () => {
    const chest = emptySlots();
    chest[1] = { item: ItemId.Gold, count: 10 };
    mountUis(emptySlots(), chest);

    const src = chestCells()[1];
    src.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    expect(src.classList.contains("drag-source")).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(src.classList.contains("drag-source")).toBe(false);
  });
});
