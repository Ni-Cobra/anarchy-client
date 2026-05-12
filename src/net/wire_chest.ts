/**
 * `ChestUpdate` message handler (task 420 / 590).
 *
 * Each `ChestUpdate` covers exactly one chest (server may emit several
 * per tick for a multi-chest open). The frame either opens / refreshes
 * a chest (`closed = false`, `slots` carries the full inventory) or
 * retires it (`closed = true`, `slots` empty). The wire bridge routes
 * the frame into the client's `ChestState` mirror — today a singleton
 * that displays at most one chest, which swaps over when the wire
 * delivers an update for a different chest. Task 591/592 will replace
 * the singleton with a multi-panel manager.
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
    // Defensive: every well-formed update under the task 590 shape
    // carries a chest location. Drop a malformed frame.
    return;
  }
  const cx = location.chunkCoord?.cx ?? 0;
  const cy = location.chunkCoord?.cy ?? 0;
  const lx = location.localX ?? 0;
  const ly = location.localY ?? 0;
  const closed = update.closed === true;

  if (closed) {
    // Retire this chest's mirror. The singleton only tracks one chest,
    // so we clear it iff the retired chest matches the currently-shown
    // one (a closed update for a different chest leaves the singleton
    // pointing at the live one).
    const current = sink.chestState.location();
    if (
      current !== null &&
      current.cx === cx &&
      current.cy === cy &&
      current.lx === lx &&
      current.ly === ly
    ) {
      sink.chestState.replaceFromWire(null, []);
    }
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
  // Singleton swap: any open / contents update routes to the single
  // mirror, which now points at this chest. (591 replaces this with a
  // per-chest dict.)
  sink.chestState.replaceFromWire({ cx, cy, lx, ly }, slots);
}
