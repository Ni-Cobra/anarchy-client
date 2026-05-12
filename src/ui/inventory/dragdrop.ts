/**
 * Pointer state machine for inventory cells: pending click vs. promoted
 * drag, plus the drop dispatcher that routes a release to the right wire
 * action (`MoveSlot` / `EquipTool` / `UnequipTool`), AND the right-click
 * split state machine that arms a "source" cell on right-click and ramps
 * a per-tick `TransferItems(src, dst, 1)` while right-mouse is held over
 * a destination.
 *
 * Cells live in one of two grids: the player's own inventory (`chest:
 * false`) or the open chest's inventory (`chest: true`, task 535). Each
 * registered cell carries a `SlotRef` (idx + chest flag) so the state
 * machine can route `MoveSlot` / `TransferItems` with the cross-grid
 * flags filled in. Equipment sentinels are player-only and use negative
 * `idx` values with `chest: false`.
 *
 * Every cell that should participate has its pointerdown wired via
 * [`attachDragDrop`]'s returned `wireSlotPointerDown`. Document-level
 * pointermove / pointerup / keydown(Escape) listeners drive promotion +
 * drop + abort and unwind via the returned `detach`.
 *
 * Routing matrix for a completed drop (src → dst):
 * - regular → regular     : `sendMove` (`MoveSlot` with chest flags
 *                            derived from the refs — same-grid or cross-
 *                            grid)
 * - regular → equipment   : `sendEquip` if kind matches AND the source
 *                            is a player cell; chest → equipment is
 *                            rejected (no wire surface for equipping
 *                            from a chest)
 * - equipment → regular   : `sendUnequip` if dst is a player cell;
 *                            equipment → chest is rejected (server picks
 *                            the destination on unequip)
 * - equipment → equipment : silently dropped
 *
 * Right-click split (regular cells only — equipment slots ignore right-
 * click):
 * - First right-click on a non-empty cell **arms** that cell as the
 *   split source (sticky `.split-source` border). Source can be in
 *   either grid.
 * - With a source armed, right-clicking a different regular cell
 *   **starts a hold transfer** toward that cell — first frame fires
 *   immediately, then the timer ramps from a slow tick (~500 ms) to a
 *   fast tick (~100 ms) over `RAMP_END_MS`. Cross-grid transfers carry
 *   the chest flags.
 * - Right-click release stops the timer; the source stays armed.
 * - Any left-click clears the source.
 */

import {
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
 * inventory or to the open chest's inventory (task 535). Equipment
 * sentinels are player-only and use `chest: false`.
 */
export interface SlotRef {
  readonly idx: number;
  readonly chest: boolean;
}

export function slotRefEqual(a: SlotRef | null, b: SlotRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.idx === b.idx && a.chest === b.chest;
}

/**
 * Sentinel slot indices used by the drag-and-drop machinery to identify
 * the equipment slots. Outside `[0, INVENTORY_SIZE)` so the wire
 * `MoveSlot` path can never confuse them with a real slot index — the
 * UI translates the sentinels into `EquipTool` / `UnequipTool` actions
 * before sending.
 */
export const EQUIP_PICKAXE_SLOT_ID = -1;
export const EQUIP_AXE_SLOT_ID = -2;
export const EQUIP_UTILITY_SLOT_ID = -3;
export const EQUIP_SHOVEL_SLOT_ID = -4;

/**
 * Squared cursor-movement threshold (in CSS pixels) that flips a
 * pointer-down into a drag instead of a click. Below this, the gesture
 * is a click — on panel cells, that ships either an `EquipTool` /
 * `UnequipTool` toggle (when the cell holds a tool / utility) or a
 * `MoveSlot` to the selected hotbar (for non-equippable stacks); on
 * hotbar cells, the existing click handler flips selection; on chest
 * cells, the click ships a cross-grid `MoveSlot` into the first
 * available player slot.
 */
const DRAG_THRESHOLD_PX_SQ = 25;

/**
 * Right-click hold transfer pacing. The first frame fires immediately on
 * press; subsequent frames pace from `SLOW_INTERVAL_MS` down to
 * `FAST_INTERVAL_MS` over `RAMP_END_MS`. Numbers tuned for "dribble a
 * few items by tapping, dump the stack by holding".
 */
const SPLIT_SLOW_INTERVAL_MS = 500;
const SPLIT_FAST_INTERVAL_MS = 100;
const SPLIT_RAMP_END_MS = 2000;

/** Linear ramp from `SLOW` → `FAST` interval over `RAMP_END_MS`. */
function splitIntervalForElapsed(elapsedMs: number): number {
  if (elapsedMs >= SPLIT_RAMP_END_MS) return SPLIT_FAST_INTERVAL_MS;
  const t = elapsedMs / SPLIT_RAMP_END_MS;
  return Math.round(
    SPLIT_SLOW_INTERVAL_MS + (SPLIT_FAST_INTERVAL_MS - SPLIT_SLOW_INTERVAL_MS) * t,
  );
}

export function equipKindForSentinel(idx: number): ToolKind | null {
  if (idx === EQUIP_PICKAXE_SLOT_ID) return "pickaxe";
  if (idx === EQUIP_AXE_SLOT_ID) return "axe";
  if (idx === EQUIP_UTILITY_SLOT_ID) return "utility";
  if (idx === EQUIP_SHOVEL_SLOT_ID) return "shovel";
  return null;
}

export interface DragDropContext {
  /**
   * Read the player's inventory mirror. Used for the drag-preview count
   * badge when the source is in the player grid, for click-to-swap
   * (panel → selected hotbar), and for the chest-click withdraw path
   * (to pick a player destination).
   */
  getInventory: () => Inventory;
  /**
   * Read the open chest's inventory mirror, or `null` if no chest is
   * open. Used for the drag-preview count badge when the source is in
   * the chest grid.
   */
  getChestInventory: () => Inventory | null;
  /** Read the currently-highlighted hotbar slot for click-into-hand. */
  getSelectedHotbarSlot: () => number;
  /**
   * Ship a `MoveSlot` drag-drop action up to the server. Both refs carry
   * the cross-grid `chest` flag so the same wire action covers same-grid
   * and cross-grid moves uniformly.
   */
  sendMove: (src: SlotRef, dst: SlotRef) => void;
  /**
   * Ship a `TransferItems(src, dst, count)` action — the right-click
   * split flow's wire surface. The state machine here only ever calls
   * with `count = 1` per ramp tick; the server is the source of truth
   * and may reject (e.g. dst capped, mismatched kind).
   */
  sendTransfer: (src: SlotRef, dst: SlotRef, count: number) => void;
  sendEquip: (sourceSlot: number, kind: ToolKind) => void;
  sendUnequip: (kind: ToolKind) => void;
}

export interface DragDropHandle {
  /**
   * Wire pointer-down on `cell` so it opens a pending gesture for the
   * given slot ref. Promotion to a drag happens at the document level.
   * Equipment sentinels MUST use the corresponding negative `idx` with
   * `chest: false`.
   */
  wireSlotPointerDown: (ref: SlotRef, cell: HTMLDivElement) => void;
  /**
   * Reconcile the right-click split source state with the current
   * inventories: if the armed source cell is now empty (e.g. an in-
   * flight hold-transfer drained it), clear the source. Called by the
   * orchestrator after each `paintSlot` pass so the yellow border
   * doesn't linger on a now-empty cell.
   */
  refreshSplitSource: () => void;
  detach: () => void;
}

/**
 * Install the pointer state machine. Returns per-cell wiring + a `detach`
 * that removes every document-level listener registered here.
 */
export function attachDragDrop(ctx: DragDropContext): DragDropHandle {
  // Cell registry keyed by slot ref. `playerCells` carries player slots
  // (hotbar + panel) and equipment sentinels; `chestCells` carries the
  // open chest's grid. Both indexed by `idx` (sparse — equipment uses
  // negative keys in `playerCells`).
  const playerCells = new Map<number, HTMLDivElement>();
  const chestCells = new Map<number, HTMLDivElement>();
  // Reverse lookup so the document-level drop resolver can map a DOM
  // cell (from `elementsFromPoint`) back to its slot ref in O(1).
  const refByCell = new WeakMap<HTMLDivElement, SlotRef>();

  const cellAt = (ref: SlotRef): HTMLDivElement | null => {
    const map = ref.chest ? chestCells : playerCells;
    return map.get(ref.idx) ?? null;
  };

  const refFromCell = (cell: HTMLElement): SlotRef | null => {
    if (!(cell instanceof HTMLDivElement)) return null;
    return refByCell.get(cell) ?? null;
  };

  // Read the item at a slot ref. Equipment sentinels resolve via
  // `Inventory.getEquipped`; player slots via `Inventory.slot`; chest
  // slots via the chest's inventory mirror (or null if no chest is
  // open, which should not happen during an in-flight chest-grid
  // gesture since the panel hides on close).
  const itemAt = (ref: SlotRef): ItemId | null => {
    if (ref.chest) {
      const inv = ctx.getChestInventory();
      return inv?.slot(ref.idx)?.item ?? null;
    }
    const kind = equipKindForSentinel(ref.idx);
    const inv = ctx.getInventory();
    if (kind !== null) return inv.getEquipped(kind);
    return inv.slot(ref.idx)?.item ?? null;
  };

  // Pending-gesture state: pointer-down landed on `pointerSrc` at
  // `pointerStart`. While the gesture stays inside `DRAG_THRESHOLD_PX_SQ`
  // it remains a click candidate; once the cursor exceeds the threshold
  // it promotes to a drag (`dragSrc` set + floating preview). Both null
  // outside an active gesture.
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
    applyItemIconStyle(icon, { item, count: 1 });
    preview.appendChild(icon);
    // Equipment slots hold count-1 tools so we never paint a count
    // badge for a drag preview originating there. Regular cells read
    // the stack count from the matching inventory mirror.
    if (equipKindForSentinel(src.idx) === null) {
      const inv = src.chest ? ctx.getChestInventory() : ctx.getInventory();
      const slot = inv?.slot(src.idx) ?? null;
      if (slot !== null && slot.count > 1) {
        const count = document.createElement("span");
        count.className = "anarchy-inventory-count";
        count.textContent = String(slot.count);
        preview.appendChild(count);
      }
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

  // Drop resolver. See routing matrix in the module docstring.
  const handleDrop = (src: SlotRef, dst: SlotRef): void => {
    const srcKind = equipKindForSentinel(src.idx);
    const dstKind = equipKindForSentinel(dst.idx);

    if (srcKind !== null && dstKind !== null) {
      // Equipment ↔ equipment drag — no defined semantics; ignore.
      return;
    }
    if (srcKind === null && dstKind !== null) {
      // Regular → equipment. Equipment only exists in the player grid;
      // dragging a chest item directly onto an equipment slot has no
      // wire surface today.
      if (src.chest) return;
      const inv = ctx.getInventory();
      const stack = inv.slot(src.idx);
      if (stack === null) return;
      if (toolKindOf(stack.item) !== dstKind) return;
      ctx.sendEquip(src.idx, dstKind);
      return;
    }
    if (srcKind !== null && dstKind === null) {
      // Equipment → regular. The server picks the destination on
      // unequip (first empty player slot), so dropping into the chest
      // grid would not respect the user's intent — reject.
      if (dst.chest) return;
      ctx.sendUnequip(srcKind);
      return;
    }
    ctx.sendMove(src, dst);
  };

  // Right-click split state. `splitSource` is the cell armed for
  // partial transfer (yellow border); sticky until cleared by a
  // left-click. `splitTimer` is the active hold-transfer interval —
  // fires `TransferItems(src, dst, 1)` at a ramping rate while right-
  // mouse is held down on the destination.
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
   * Right-click on `ref`: arm the split source if none is set,
   * otherwise start a hold-transfer toward `ref`. Equipment slots
   * ignore right-click (their UX is left-click drag-and-drop only).
   */
  const beginSplitGesture = (ref: SlotRef): void => {
    if (equipKindForSentinel(ref.idx) !== null) return;
    if (splitSource === null) {
      // Arm only if the cell holds something — splitting from an empty
      // cell would have no transfer to make.
      if (itemAt(ref) === null) return;
      splitSource = ref;
      setSplitSourceClass(null, ref);
      return;
    }
    if (slotRefEqual(ref, splitSource)) {
      // Right-click on the armed cell itself: clear the selection so
      // the user can re-arm a different cell without a left-click
      // round-trip.
      clearSplitSource();
      return;
    }
    // Start a hold-transfer toward `ref`. First frame fires
    // immediately so the user gets feedback on press; the interval
    // handles the ramping rate from then on.
    const src = splitSource;
    stopSplitTimer();
    splitTimerDest = ref;
    splitTimerStartedAt = performance.now();
    ctx.sendTransfer(src, ref, 1);
    const tickFn = (): void => {
      // The dest can change between ticks if the user re-presses on a
      // different cell — we cancel + re-arm in the pointerdown path,
      // so the dest captured here is the live target.
      const dst = splitTimerDest;
      if (dst === null || splitSource === null) {
        stopSplitTimer();
        return;
      }
      ctx.sendTransfer(splitSource, dst, 1);
      // Reschedule with the ramped interval. We can't simply use
      // setInterval with a ramp, so the interval recomputes itself by
      // tearing itself down + setting a fresh setInterval.
      const elapsed = performance.now() - splitTimerStartedAt;
      const next = splitIntervalForElapsed(elapsed);
      if (splitTimer !== null) clearInterval(splitTimer);
      splitTimer = setInterval(tickFn, next);
    };
    splitTimer = setInterval(tickFn, splitIntervalForElapsed(0));
  };

  const wireSlotPointerDown = (ref: SlotRef, cell: HTMLDivElement): void => {
    const map = ref.chest ? chestCells : playerCells;
    map.set(ref.idx, cell);
    refByCell.set(cell, ref);
    cell.addEventListener("pointerdown", (ev) => {
      if (ev.button === 2) {
        // Right-click: split source / hold-transfer. Suppress the
        // browser contextmenu fallback locally — `contextmenu` itself
        // is also suppressed at the inventory root, but
        // `preventDefault` here is belt-and-braces for browsers that
        // fire it on pointerdown.
        ev.preventDefault();
        beginSplitGesture(ref);
        return;
      }
      if (ev.button !== 0) return;
      ev.preventDefault();
      // Any left-click clears a sticky split source — matches the
      // spec ("the source is sticky until the user clicks
      // elsewhere"). The pending-gesture / drag is independent of
      // the split flow.
      clearSplitSource();
      pointerSrc = ref;
      pointerStart = { x: ev.clientX, y: ev.clientY };
    });
  };

  // Document-level left-click pointerdown clears a sticky split source
  // when the click landed outside any inventory cell (cells handle
  // their own clear in `wireSlotPointerDown`). Matches the spec — "the
  // source is sticky until the user clicks elsewhere".
  const onDocumentPointerDownLeft = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    if (splitSource === null) return;
    // If the click landed on a wired cell (player or chest), the
    // per-cell listener already cleared (or re-armed) — nothing to
    // do here.
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
  document.addEventListener("pointerdown", onDocumentPointerDownLeft);

  // Cursor follow + drag promotion + drop resolution at document level
  // so a drag that releases outside any slot cancels cleanly. The
  // first pointermove past the threshold promotes the pending gesture
  // into a drag; once promoted (or once the source was empty),
  // `pointerSrc` clears so the click path can't double-fire on
  // pointerup.
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

  // Resolve a pointerup's coordinates to a destination cell across
  // both grids. Walks the `elementsFromPoint` stack and picks the
  // first element registered with the dragdrop (player or chest).
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

  // Click-to-withdraw destination for a chest cell: prefer the first
  // empty player slot, falling back to the hotbar so a click always
  // does something useful when the panel is full. Mirrors the v1
  // chest-click semantics that lived in `ui/chest/index.ts` before
  // task 535 unified the dragdrop machinery.
  const findPlayerWithdrawDestination = (): SlotRef | null => {
    const inv = ctx.getInventory();
    // Main grid first (rows above the hotbar) — players expect bulk
    // pickups to land off the hotbar so they don't displace held
    // tools.
    for (let i = HOTBAR_SLOTS; i < INVENTORY_SIZE; i++) {
      if (inv.slot(i) === null) return { idx: i, chest: false };
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (inv.slot(i) === null) return { idx: i, chest: false };
    }
    return null;
  };

  const onDocumentPointerUp = (ev: PointerEvent): void => {
    if (ev.button === 2) {
      // Right-mouse-up always stops an in-flight hold-transfer. The
      // split source stays armed — re-pressing on any cell resumes
      // the transfer at the slow rate.
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

    // No drag → was this a click on a slot?
    if (clickSrc === null) return;
    // Equipment-slot clicks are owned by per-cell handlers.
    if (clickSrc.idx < 0) return;

    if (clickSrc.chest) {
      // Chest-cell click → cross-grid withdraw into the player grid.
      // Routing the wire frame through `sendMove` lets the server's
      // merge-or-swap path decide the actual destination kind; here we
      // just pick "any free player slot" so an empty destination
      // produces a clean move.
      const inv = ctx.getChestInventory();
      if (inv === null || inv.slot(clickSrc.idx) === null) return;
      const dst = findPlayerWithdrawDestination();
      if (dst === null) return;
      ctx.sendMove(clickSrc, dst);
      return;
    }

    // Player-grid click. Hotbar cells own selection via their own
    // `click` listener; we only fire the click-to-equip / merge path
    // for panel cells here.
    if (clickSrc.idx < HOTBAR_SLOTS) return;
    const inv = ctx.getInventory();
    const stack = inv.slot(clickSrc.idx);
    const tool = stack !== null ? toolKindOf(stack.item) : null;
    if (tool !== null) {
      // Tool click toggles equip / unequip: if the clicked cell is
      // already flagged as the equipped slot for this kind, clear the
      // flag; otherwise point the flag at this cell (the server's
      // overwrite semantics handle the "different tool of the same
      // family is already equipped" swap).
      if (inv.getEquippedSlot(tool) === clickSrc.idx) {
        ctx.sendUnequip(tool);
      } else {
        ctx.sendEquip(clickSrc.idx, tool);
      }
      return;
    }
    // Swap-with-air: an empty endpoint on either side is still a
    // valid swap (server's `try_move_slot` runs `merge_stacks ||
    // swap_slots`, which moves the non-empty stack into the empty
    // cell). Skip the wire frame only when both ends are empty — the
    // server would NOOP.
    const dstIdx = ctx.getSelectedHotbarSlot();
    if (stack === null && inv.slot(dstIdx) === null) return;
    ctx.sendMove(clickSrc, { idx: dstIdx, chest: false });
  };
  document.addEventListener("pointerup", onDocumentPointerUp);

  // Escape during a drag (or pending click gesture) aborts cleanly —
  // no `sendMove` fires and the preview / drag-source highlight
  // clears. Also clears any armed split source. Listener is captured
  // so a game-side keydown handler can't preempt it.
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
    // Re-apply the class — `paintSlot` doesn't touch it, but a
    // defensive reapply here means a future renderer that calls
    // `replaceChildren` wouldn't accidentally wipe the affordance.
    setSplitSourceClass(null, splitSource);
  };

  return {
    wireSlotPointerDown,
    refreshSplitSource,
    detach: () => {
      document.removeEventListener("pointerdown", onDocumentPointerDownLeft);
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      document.removeEventListener("keydown", onDocumentKeydown, true);
      cancelDrag();
      clearSplitSource();
    },
  };
}
