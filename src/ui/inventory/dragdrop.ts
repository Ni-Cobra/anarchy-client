/**
 * Pointer state machine for inventory cells: pending click vs. promoted
 * drag, plus the drop dispatcher that routes a release to a `MoveSlot`
 * (regular → regular, same- or cross-grid), AND the split state
 * machine that arms a "source" cell on right-click and ramps a per-tick
 * `TransferItems(src, dst, 1)` while left-mouse is held over a
 * destination.
 *
 * Cells live in one of two grids: the player's own inventory
 * (`kind: "player"`) or an open chest's inventory (`kind: "chest"`,
 * carrying a `chestKey` so the same machinery is ready to address N
 * panels). Each registered cell carries a `SlotRef` so the
 * state machine can route `MoveSlot` / `TransferItems` with the cross-
 * grid `chestKey` filled in.
 *
 * Equipment cells (the four tool slots) are deliberately NOT
 * wired here. They're mouse-inert: filled by the auto-equip paths and
 * the panel-cell click toggle, and never targeted by the
 * cross-grid drag pipeline. The toggle path lives in this module's
 * pointer-up handler (panel-cell click on a tool → `sendEquip` /
 * `sendUnequip`) — that's still routed through the dragdrop machinery
 * because it shares the drag-vs-click discrimination with regular cells.
 *
 * Every cell that should participate has its pointerdown wired via
 * [`attachDragDrop`]'s returned `wireSlotPointerDown`. Document-level
 * pointermove / pointerup / keydown(Escape) listeners drive promotion +
 * drop + abort and unwind via the returned `detach`.
 *
 * Split flow (task 230):
 * - **Right-click** on a non-empty cell **arms** that cell as the split
 *   source (sticky `.split-source` border). A second right-click on
 *   another non-empty cell replaces the selection. Right-click on an
 *   empty cell or anywhere outside an inventory cell **clears** the
 *   selection. Source can be in either grid.
 * - With a source armed, **left-click** on another cell starts a
 *   hold-transfer toward that cell — first frame fires immediately, then
 *   the timer ramps from `SPLIT_SLOW_INTERVAL_MS` to
 *   `SPLIT_FAST_INTERVAL_MS` over `SPLIT_RAMP_END_MS`. Cross-grid
 *   transfers carry the chest keys.
 * - Left-click release stops the timer; the source stays armed so the
 *   user can transfer to another cell next.
 * - With no source armed, left-click falls through to the existing
 *   drag-drop / click-into-hand / equip-toggle handlers — unchanged.
 */

import {
  type ChestKey,
  HOTBAR_SLOTS,
  INVENTORY_SIZE,
  type Inventory,
  ItemId,
  toolKindOf,
  type ToolKind,
} from "../../game/index.js";
import { applyItemIconStyle } from "./cells.js";

/**
 * Tag that identifies a cell as belonging to either the player's own
 * inventory or to an open chest's inventory. Equipment sentinels are player-only with negative `idx`.
 */
export type SlotRef =
  | { readonly kind: "player"; readonly idx: number }
  | { readonly kind: "chest"; readonly chestKey: ChestKey; readonly idx: number };

export function playerSlotRef(idx: number): SlotRef {
  return { kind: "player", idx };
}

export function chestSlotRef(chestKey: ChestKey, idx: number): SlotRef {
  return { kind: "chest", chestKey, idx };
}

export function slotRefEqual(a: SlotRef | null, b: SlotRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.idx !== b.idx) return false;
  if (a.kind === "chest" && b.kind === "chest") {
    return a.chestKey === b.chestKey;
  }
  return true;
}

/**
 * Squared cursor-movement threshold (in CSS pixels) that flips a
 * pointer-down into a drag instead of a click.
 */
const DRAG_THRESHOLD_PX_SQ = 25;

/**
 * Split hold-transfer pacing. The first tick fires immediately on press;
 * subsequent ticks pace via {@link splitIntervalForElapsed}, which lerps
 * from `SLOW` at press-time down to `FAST` over `RAMP_END_MS`. Constants
 * were trimmed 2.5× in task 230 so a held transfer drains a stack at a
 * snappier rate.
 */
export const SPLIT_SLOW_INTERVAL_MS = 200;
export const SPLIT_FAST_INTERVAL_MS = 40;
export const SPLIT_RAMP_END_MS = 800;

export function splitIntervalForElapsed(elapsedMs: number): number {
  if (elapsedMs >= SPLIT_RAMP_END_MS) return SPLIT_FAST_INTERVAL_MS;
  const t = elapsedMs / SPLIT_RAMP_END_MS;
  return Math.round(
    SPLIT_SLOW_INTERVAL_MS + (SPLIT_FAST_INTERVAL_MS - SPLIT_SLOW_INTERVAL_MS) * t,
  );
}

export interface DragDropContext {
  /** Player's inventory mirror. */
  getInventory: () => Inventory;
  /**
   * Open chest's inventory mirror for a given `chestKey`, or `null` if
   * no chest with that key is currently open. Used for the drag-preview
   * count badge when the source is a chest cell and for the chest-cell
   * click-to-withdraw path.
   */
  getChestInventory: (chestKey: ChestKey) => Inventory | null;
  /** Read the currently-highlighted hotbar slot for click-into-hand. */
  getSelectedHotbarSlot: () => number;
  /**
   * Ship a `MoveSlot` drag-drop action up to the server. Both refs carry
   * their cross-grid `chestKey` so the same wire action covers same-grid
   * and cross-grid moves uniformly.
   */
  sendMove: (src: SlotRef, dst: SlotRef) => void;
  /** Ship a `TransferItems(src, dst, count)` action. */
  sendTransfer: (src: SlotRef, dst: SlotRef, count: number) => void;
  sendEquip: (sourceSlot: number, kind: ToolKind) => void;
  sendUnequip: (kind: ToolKind) => void;
}

export interface DragDropHandle {
  /**
   * Wire pointer-down on `cell` so it opens a pending gesture for the
   * given slot ref. Promotion to a drag happens at the document level.
   * Equipment sentinels MUST use the corresponding negative `idx` with
   * `kind: "player"`.
   */
  wireSlotPointerDown: (ref: SlotRef, cell: HTMLDivElement) => void;
  /**
   * Drop a previously-wired chest cell from the registry. Called by the
   * chest panel manager when a panel unmounts so its DOM nodes can be
   * garbage-collected and the chestKey freed for future remounts.
   */
  unwireChestKey: (chestKey: ChestKey) => void;
  /** Reconcile split source state after a paint pass. */
  refreshSplitSource: () => void;
  /**
   * Whether a split source is currently armed. Hotbar / panel click
   * handlers consult this to skip selection / equip-toggle paths while a
   * split is active — under the task-230 gesture map, a left-click with
   * an armed source means "transfer," not "select / toggle equip."
   */
  isSplitArmed: () => boolean;
  detach: () => void;
}

/**
 * Install the pointer state machine. Returns per-cell wiring + a `detach`
 * that removes every document-level listener registered here.
 */
export function attachDragDrop(ctx: DragDropContext): DragDropHandle {
  // Cell registry. `playerCells` carries player slots (hotbar + panel)
  // and equipment sentinels (sparse, equipment uses negative keys).
  // `chestCellsByKey` carries one inner map per open chest, keyed by the
  // chest's `chestKey`. Both are unwound in `unwireChestKey` / `detach`
  // so a remount can reuse the same chestKey safely.
  const playerCells = new Map<number, HTMLDivElement>();
  const chestCellsByKey = new Map<ChestKey, Map<number, HTMLDivElement>>();
  // Reverse lookup so the document-level drop resolver can map a DOM
  // cell back to its slot ref in O(1).
  const refByCell = new WeakMap<HTMLDivElement, SlotRef>();

  const cellAt = (ref: SlotRef): HTMLDivElement | null => {
    if (ref.kind === "player") return playerCells.get(ref.idx) ?? null;
    return chestCellsByKey.get(ref.chestKey)?.get(ref.idx) ?? null;
  };

  // Read the item at a slot ref. Equipment sentinels resolve via
  // `Inventory.getEquipped`; player slots via `Inventory.slot`; chest
  // slots via the chest's inventory mirror (or null if no chest with
  // that key is currently open).
  const itemAt = (ref: SlotRef): ItemId | null => {
    if (ref.kind === "chest") {
      const inv = ctx.getChestInventory(ref.chestKey);
      return inv?.slot(ref.idx)?.item ?? null;
    }
    return ctx.getInventory().slot(ref.idx)?.item ?? null;
  };

  // Pending-gesture state: pointer-down landed on `pointerSrc` at
  // `pointerStart`. Promotion to drag happens once movement exceeds
  // threshold.
  let pointerSrc: SlotRef | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  let dragSrc: SlotRef | null = null;
  let dragPreview: HTMLDivElement | null = null;

  const beginDrag = (src: SlotRef, ev: PointerEvent): void => {
    const item = itemAt(src);
    if (item === null) return;
    dragSrc = src;
    cellAt(src)?.classList.add("drag-source");
    const preview = document.createElement("div");
    preview.className = "anarchy-inventory-drag-preview";
    const icon = document.createElement("div");
    icon.className = "anarchy-inventory-icon";
    const sourceSlot =
      src.kind === "player"
        ? ctx.getInventory().slot(src.idx)
        : ctx.getChestInventory(src.chestKey)?.slot(src.idx) ?? null;
    // Pass `extra` through so per-stack tinting (today: Flag's color)
    // survives the drag preview — without it a flag's tint would drop
    // for the duration of the gesture.
    applyItemIconStyle(icon, { item, count: 1, extra: sourceSlot?.extra });
    preview.appendChild(icon);
    if (sourceSlot !== null && sourceSlot.count > 1) {
      const count = document.createElement("span");
      count.className = "anarchy-inventory-count";
      count.textContent = String(sourceSlot.count);
      preview.appendChild(count);
    }
    preview.style.left = `${ev.clientX}px`;
    preview.style.top = `${ev.clientY}px`;
    document.body.appendChild(preview);
    dragPreview = preview;
  };

  const cancelDrag = (): void => {
    if (dragSrc !== null) {
      cellAt(dragSrc)?.classList.remove("drag-source");
    }
    dragSrc = null;
    if (dragPreview !== null) {
      dragPreview.remove();
      dragPreview = null;
    }
  };

  // Drop resolver. Equipment cells aren't wired into the registry
  // so any drag that releases over one resolves to `null`
  // and never reaches this function — the routing here only ever sees
  // regular → regular drops.
  const handleDrop = (src: SlotRef, dst: SlotRef): void => {
    ctx.sendMove(src, dst);
  };

  // Right-click split state.
  let splitSource: SlotRef | null = null;
  let splitTimer: ReturnType<typeof setInterval> | null = null;
  let splitTimerStartedAt = 0;
  let splitTimerDest: SlotRef | null = null;

  const setSplitSourceClass = (
    prev: SlotRef | null,
    next: SlotRef | null,
  ): void => {
    if (prev !== null) cellAt(prev)?.classList.remove("split-source");
    if (next !== null) cellAt(next)?.classList.add("split-source");
  };

  const stopSplitTimer = (): void => {
    if (splitTimer !== null) {
      clearInterval(splitTimer);
      splitTimer = null;
    }
    splitTimerDest = null;
  };

  const clearSplitSource = (): void => {
    stopSplitTimer();
    if (splitSource !== null) {
      setSplitSourceClass(splitSource, null);
      splitSource = null;
    }
  };

  /**
   * Right-click on `ref` — arm/replace selection or clear. Right-click
   * on an empty cell clears, mirroring the document-level "right-click
   * outside any cell" rule.
   */
  const armSplitFromRightClick = (ref: SlotRef): void => {
    if (itemAt(ref) === null) {
      clearSplitSource();
      return;
    }
    if (splitSource !== null && slotRefEqual(ref, splitSource)) {
      // Same cell — already armed, leave the timer alone (none should
      // be running anyway since the right-click no longer drives the
      // hold-transfer).
      return;
    }
    const prev = splitSource;
    splitSource = ref;
    setSplitSourceClass(prev, ref);
  };

  /**
   * Left-click on `ref` while a source is armed — start the hold-transfer
   * toward that cell. First frame fires immediately; subsequent ticks
   * pace via {@link splitIntervalForElapsed}. The source stays armed on
   * release so the user can target a new cell with the next press.
   */
  const startSplitTransfer = (ref: SlotRef): void => {
    if (splitSource === null) return;
    const src = splitSource;
    stopSplitTimer();
    splitTimerDest = ref;
    splitTimerStartedAt = performance.now();
    ctx.sendTransfer(src, ref, 1);
    const tickFn = (): void => {
      const dst = splitTimerDest;
      if (dst === null || splitSource === null) {
        stopSplitTimer();
        return;
      }
      ctx.sendTransfer(splitSource, dst, 1);
      const elapsed = performance.now() - splitTimerStartedAt;
      const next = splitIntervalForElapsed(elapsed);
      if (splitTimer !== null) clearInterval(splitTimer);
      splitTimer = setInterval(tickFn, next);
    };
    splitTimer = setInterval(tickFn, splitIntervalForElapsed(0));
  };

  const wireSlotPointerDown = (ref: SlotRef, cell: HTMLDivElement): void => {
    if (ref.kind === "player") {
      playerCells.set(ref.idx, cell);
    } else {
      let inner = chestCellsByKey.get(ref.chestKey);
      if (inner === undefined) {
        inner = new Map();
        chestCellsByKey.set(ref.chestKey, inner);
      }
      inner.set(ref.idx, cell);
    }
    refByCell.set(cell, ref);
    cell.addEventListener("pointerdown", (ev) => {
      if (ev.button === 2) {
        ev.preventDefault();
        armSplitFromRightClick(ref);
        return;
      }
      if (ev.button !== 0) return;
      ev.preventDefault();
      // With a source armed, left-click drives the hold-transfer; the
      // regular drag/click pipeline is skipped (pointerSrc stays null
      // so pointermove can't promote into a drag and pointerup can't
      // fire the click-into-hand / equip-toggle branches).
      if (splitSource !== null) {
        startSplitTransfer(ref);
        return;
      }
      pointerSrc = ref;
      pointerStart = { x: ev.clientX, y: ev.clientY };
    });
  };

  const unwireChestKey = (chestKey: ChestKey): void => {
    // If a gesture or split source is anchored to this chest, drop it
    // — the cell is about to be removed from the DOM, so the highlight
    // / preview would dangle.
    if (dragSrc !== null && dragSrc.kind === "chest" && dragSrc.chestKey === chestKey) {
      cancelDrag();
    }
    if (pointerSrc !== null && pointerSrc.kind === "chest" && pointerSrc.chestKey === chestKey) {
      pointerSrc = null;
      pointerStart = null;
    }
    if (splitSource !== null && splitSource.kind === "chest" && splitSource.chestKey === chestKey) {
      clearSplitSource();
    } else if (splitTimerDest !== null && splitTimerDest.kind === "chest" && splitTimerDest.chestKey === chestKey) {
      stopSplitTimer();
    }
    chestCellsByKey.delete(chestKey);
  };

  // Document-level right-click pointerdown clears a sticky split source
  // when the click landed outside any inventory cell. Under the task-230
  // gesture map, right-click is the "manage selection" verb; an empty-
  // space right-click is the explicit cancel.
  const onDocumentPointerDownRight = (ev: PointerEvent): void => {
    if (ev.button !== 2) return;
    if (splitSource === null) return;
    const target = ev.target;
    if (
      target instanceof HTMLElement &&
      (target.closest(".anarchy-inventory-slot") !== null ||
        target.closest(".anarchy-chest-slot") !== null)
    ) {
      return;
    }
    clearSplitSource();
  };
  document.addEventListener("pointerdown", onDocumentPointerDownRight);

  // Cursor follow + drag promotion + drop resolution at document level
  // so a drag that releases outside any slot cancels cleanly.
  const onDocumentPointerMove = (ev: PointerEvent): void => {
    if (pointerSrc !== null && dragSrc === null && pointerStart !== null) {
      const dx = ev.clientX - pointerStart.x;
      const dy = ev.clientY - pointerStart.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX_SQ) {
        beginDrag(pointerSrc, ev);
        pointerSrc = null;
        pointerStart = null;
      }
    }
    if (dragPreview === null) return;
    dragPreview.style.left = `${ev.clientX}px`;
    dragPreview.style.top = `${ev.clientY}px`;
  };
  document.addEventListener("pointermove", onDocumentPointerMove);

  const refFromCell = (cell: HTMLElement): SlotRef | null => {
    if (!(cell instanceof HTMLDivElement)) return null;
    return refByCell.get(cell) ?? null;
  };

  const resolveDestRef = (clientX: number, clientY: number): SlotRef | null => {
    const targets = document.elementsFromPoint(clientX, clientY);
    for (const t of targets) {
      if (!(t instanceof HTMLElement)) continue;
      if (
        !t.classList.contains("anarchy-inventory-slot") &&
        !t.classList.contains("anarchy-chest-slot")
      ) {
        continue;
      }
      const ref = refFromCell(t);
      if (ref !== null) return ref;
    }
    return null;
  };

  // Click-to-withdraw destination for a chest cell.
  const findPlayerWithdrawDestination = (): SlotRef | null => {
    const inv = ctx.getInventory();
    for (let i = HOTBAR_SLOTS; i < INVENTORY_SIZE; i++) {
      if (inv.slot(i) === null) return { kind: "player", idx: i };
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (inv.slot(i) === null) return { kind: "player", idx: i };
    }
    return null;
  };

  const onDocumentPointerUp = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    // Left-button release with the hold-transfer active stops the timer;
    // the source stays armed so the next press resumes against a new
    // destination. pointerSrc was never set in that branch, so the
    // drag/click pipeline below is already a no-op — short-circuit
    // anyway to keep the intent explicit.
    if (splitTimer !== null) {
      stopSplitTimer();
      return;
    }
    const clickSrc = pointerSrc;
    pointerSrc = null;
    pointerStart = null;

    if (dragSrc !== null) {
      const src = dragSrc;
      cancelDrag();
      const dst = resolveDestRef(ev.clientX, ev.clientY);
      if (dst === null || slotRefEqual(src, dst)) return;
      handleDrop(src, dst);
      return;
    }

    if (clickSrc === null) return;

    if (clickSrc.kind === "chest") {
      const inv = ctx.getChestInventory(clickSrc.chestKey);
      if (inv === null || inv.slot(clickSrc.idx) === null) return;
      const dst = findPlayerWithdrawDestination();
      if (dst === null) return;
      ctx.sendMove(clickSrc, dst);
      return;
    }

    // Player-grid click on a panel cell (hotbar owns its own click).
    if (clickSrc.idx < HOTBAR_SLOTS) return;
    const inv = ctx.getInventory();
    const stack = inv.slot(clickSrc.idx);
    const tool = stack !== null ? toolKindOf(stack.item) : null;
    if (tool !== null) {
      if (inv.getEquippedSlot(tool) === clickSrc.idx) {
        ctx.sendUnequip(tool);
      } else {
        ctx.sendEquip(clickSrc.idx, tool);
      }
      return;
    }
    const dstIdx = ctx.getSelectedHotbarSlot();
    if (stack === null && inv.slot(dstIdx) === null) return;
    ctx.sendMove(clickSrc, { kind: "player", idx: dstIdx });
  };
  document.addEventListener("pointerup", onDocumentPointerUp);

  const onDocumentKeydown = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    if (dragSrc === null && pointerSrc === null && splitSource === null) return;
    pointerSrc = null;
    pointerStart = null;
    cancelDrag();
    clearSplitSource();
  };
  document.addEventListener("keydown", onDocumentKeydown, true);

  const refreshSplitSource = (): void => {
    if (splitSource === null) return;
    if (itemAt(splitSource) === null) {
      clearSplitSource();
      return;
    }
    setSplitSourceClass(null, splitSource);
  };

  return {
    wireSlotPointerDown,
    unwireChestKey,
    refreshSplitSource,
    isSplitArmed: () => splitSource !== null,
    detach: () => {
      document.removeEventListener("pointerdown", onDocumentPointerDownRight);
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      document.removeEventListener("keydown", onDocumentKeydown, true);
      cancelDrag();
      clearSplitSource();
      playerCells.clear();
      chestCellsByKey.clear();
    },
  };
}
