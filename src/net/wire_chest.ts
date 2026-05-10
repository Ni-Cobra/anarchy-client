/**
 * `ChestUpdate` message handler (task 420).
 *
 * The server ships a `ChestUpdate` whenever the local player opens a
 * chest, the open chest's contents mutate, or the chest closes (out of
 * range, broken, explicit `CloseChest`). The wire bridge translates the
 * frame into the client's `ChestState` mirror.
 *
 * When the `chest` field is absent the frame is a "chest closed" sentinel
 * — we clear the chest mirror so the UI hides the second grid.
 */
import { anarchy } from "../gen/anarchy.js";
import {
  type ChestState,
  INVENTORY_SIZE,
  type Slot,
} from "../game/index.js";

import { itemIdFromWire } from "./wire_inventory.js";

export interface ChestSink {
  readonly chestState: ChestState;
}

export function applyChestUpdate(
  update: anarchy.v1.IChestUpdate,
  sink: ChestSink | undefined,
): void {
  if (!sink) return;
  const location = update.chest;
  if (!location) {
    sink.chestState.replaceFromWire(null, []);
    return;
  }
  const wireSlots = update.slots ?? [];
  if (wireSlots.length !== INVENTORY_SIZE) {
    // Defensive: a misbehaving server could ship the wrong slot count.
    // Drop the frame rather than corrupt local state.
    return;
  }
  const slots: Slot[] = wireSlots.map((s): Slot => {
    const count = s.count ?? 0;
    if (count === 0) return null;
    const item = itemIdFromWire(s.item);
    if (item === null) return null;
    return { item, count };
  });
  const cx = location.chunkCoord?.cx ?? 0;
  const cy = location.chunkCoord?.cy ?? 0;
  const lx = location.localX ?? 0;
  const ly = location.localY ?? 0;
  sink.chestState.replaceFromWire({ cx, cy, lx, ly }, slots);
}
