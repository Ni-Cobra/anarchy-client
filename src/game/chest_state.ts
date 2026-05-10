/**
 * Open-chest mirror (task 420). Tracks (a) the world location of the chest
 * the local player currently has open and (b) its 45-slot inventory.
 * Network-free: the wire bridge in `../net/wire.ts` decodes `ChestUpdate`
 * frames and writes the resulting state here.
 *
 * The shape mirrors the server's per-player open-chest tracking:
 * - `location === null` means no chest is open. The chest UI is hidden.
 * - `location !== null` means the chest at that cell is open and its
 *   contents (in `inventory`) should be rendered alongside the player's
 *   grid.
 *
 * Subscribers are notified on every state change (open / close / contents
 * update). UI mirrors register a single listener and re-render reactively.
 */

import { Inventory, INVENTORY_SIZE, type Slot } from "./inventory.js";

/** Location of the currently-open chest. */
export interface ChestLocation {
  readonly cx: number;
  readonly cy: number;
  readonly lx: number;
  readonly ly: number;
}

export class ChestState {
  private _location: ChestLocation | null = null;
  private _inventory: Inventory = new Inventory();
  private listeners: Array<() => void> = [];

  /** Currently-open chest location or `null` if no chest is open. */
  location(): ChestLocation | null {
    return this._location;
  }

  /**
   * Chest's inventory mirror. Only meaningful when `location() !== null`;
   * returns the underlying `Inventory` always so callers can subscribe to
   * its own change feed if desired (though `subscribe()` here covers both
   * the location and contents changes uniformly).
   */
  inventory(): Inventory {
    return this._inventory;
  }

  /** True iff a chest is currently open. */
  isOpen(): boolean {
    return this._location !== null;
  }

  /**
   * Update the open-chest state from a decoded `ChestUpdate` frame. Pass
   * `location = null` and `slots = []` for a "chest closed" sentinel; pass
   * `location` + full slot array (length `INVENTORY_SIZE`) otherwise. The
   * wire bridge validates lengths.
   */
  replaceFromWire(location: ChestLocation | null, slots: readonly Slot[]): void {
    if (location === null) {
      this._location = null;
      // Clear the inventory mirror so a stale chest's contents don't leak
      // into the UI on the next open. The `Inventory.replaceFromWire` API
      // requires exactly INVENTORY_SIZE slots, so we hand it a fresh empty
      // array.
      const empty: Slot[] = Array.from({ length: INVENTORY_SIZE }, () => null);
      this._inventory.replaceFromWire(empty);
    } else {
      this._location = location;
      this._inventory.replaceFromWire(slots);
    }
    for (const listener of this.listeners) listener();
  }

  /**
   * Register a change listener. Returns an unsubscribe function. The
   * chest UI uses this to re-render when a `ChestUpdate` arrives.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}
