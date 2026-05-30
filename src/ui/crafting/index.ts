/**
 * Crafting overlay: a slide-in side panel that mirrors the
 * inventory panel's open/close lifecycle but anchors on the right edge of
 * the viewport. Each row in the panel is one server-advertised recipe,
 * laid out as `[ingredients] → [output]`. Clicking an affordable row
 * ships a `CraftRequest(recipe_id)` to the server; the server is
 * authoritative and the row updates on the next `InventoryUpdate`.
 *
 * Network-free: this module reads the live `Inventory` mirror through a
 * `getInventory` thunk and subscribes to its change channel so the panel
 * re-renders on every `InventoryUpdate` without a round-trip.
 *
 * ## Affordability tiering
 *
 * The server advertises recipes in two tiers — `affordable` (fully
 * craftable now) and `partial-hint` (the player has at least one of any
 * ingredient but not enough to actually craft). Affordable rows sort
 * first; partial-hint rows fall to the bottom of the panel and render
 * grayed + click-inert. Recipes the player has zero relevant ingredients
 * for stay hidden — the partial-hint tier is meant as a "you're getting
 * closer" affordance, not a recipe browser.
 *
 * ## Submodules
 *
 * - [`./style`] — CSS injection + the panel-width constants.
 * - [`./row`] — pure DOM stamp-out for one recipe row.
 *
 * ## Frozen-while-open ordering (task 110)
 *
 * Re-sorting on every `InventoryUpdate` made the row strip ripple under
 * the cursor — the tier of a row could change mid-craft, shoving
 * everything around. The new contract pins the order at panel-open time:
 *
 * - On open, snapshot `getCraftableRecipes()` into a `frozenOrder` /
 *   `frozenStatus` pair. That order is the panel's visual order for the
 *   whole open session.
 * - While open, redraws update each row's status in place (refresh the
 *   max-craft count + tooltip), never reorder. A recipe that drops out
 *   of the natural advertised list becomes `uncraftable` and grays out
 *   at its frozen index. A recipe that comes back recovers its natural
 *   status at the same index.
 * - A recipe that wasn't in the snapshot but newly appears in the
 *   advertised list inserts immediately after the row the user most
 *   recently clicked in this open session (task 180) — so a newcomer
 *   that drops in while the player is hovering the action they just
 *   crafted appears right under their gaze instead of disappearing
 *   below the partial-hint section. Multiple newcomers in one tick
 *   are spliced in advertise iteration order; the first iterated lands
 *   closest to the clicked row. If no row has been clicked yet, falls
 *   back to appending at the *end* of its tier (affordable → just
 *   before the first frozen partial-hint row; partial-hint → the very
 *   end).
 * - On close, the snapshot — including the click anchor — is discarded;
 *   the next open re-snapshots from whatever the server is advertising
 *   at that moment.
 *
 * ## Sinking freshly-grayed rows (task 450)
 *
 * Freezing the order in place has one bad corner: a row that was
 * affordable when the panel opened can go gray mid-session (you crafted
 * its last ingredient, or spent it elsewhere) yet keep its slot — leaving
 * a grayed row wedged between two still-affordable ones. After refreshing
 * statuses, `computeDisplay()` lifts the affordable block above any row
 * that has *crossed* affordable→gray, so no gray row sits between
 * affordable ones. This is a display-only reorder layered over the frozen
 * order (the frozen order is never mutated), so a row that recovers to
 * affordable snaps back to its pinned index. Two carve-outs preserve the
 * no-ripple guarantee above:
 *
 * - Rows born partial-hint never sink — they were always meant to sit at
 *   the bottom, and sinking a task-180 partial-hint newcomer would undo
 *   its clicked-row anchor.
 * - The row you just crafted holds its slot even when the craft grayed it
 *   out, so the row under the cursor never jumps. Crafting a *different*
 *   recipe drops this pin, letting the now-stale gray row sink.
 *
 * When the panel is closed the bridge between renders is simpler: there
 * is no frozen order, so each redraw mirrors the natural advertised
 * order directly. The panel is offscreen at that point — this is a
 * convenience for headless tests that probe the DOM without opening.
 *
 * ## Chrome stability
 *
 * The panel itself owns only the static chrome (border, radius, padding,
 * slide-in transform). Scrolling lives one layer deeper on
 * `.anarchy-crafting-scroll`, sized to a **fixed pixel height** so the
 * panel bounds don't reflow when the row set changes — an empty list
 * and a 10-recipe list occupy the same vertical space.
 * `scrollbar-gutter: stable` on that wrapper reserves the scrollbar lane
 * so toggling overflow doesn't shift the row strip horizontally.
 *
 * ## Wheel capture
 *
 * The bootstrap-level `wheel` listener cycles the hotbar selection
 * ([bootstrap/keybindings.ts]). Scrolling inside the crafting panel
 * must not also flip the hotbar, so the panel installs a `wheel`
 * listener that calls `stopPropagation()` unconditionally while the
 * cursor is over it. We chose "capture unconditionally" over "only when
 * the scrollable region can absorb the delta" because the simpler rule
 * matches the user's mental model — the panel ate my scroll, hotbar
 * stays put.
 */

import type { ChestState, Inventory } from "../../game/index.js";
import { recipeById } from "../../recipes.js";
import { attachTooltip, type TooltipHandle } from "../tooltip.js";
import { maxCraftCount } from "./max_craft.js";
import { makeRecipeRow } from "./row.js";
import { injectStyle } from "./style.js";
import { makeRecipeTooltip } from "./tooltip.js";

export interface CraftingUiOptions {
  /** Reads the current inventory mirror. Called on every render. */
  readonly getInventory: () => Inventory;
  /**
   * Open-chest mirror — when present, every currently-open chest's
   * inventory is pooled with the player's for the row's max-craft badge
   * and the tooltip's have-counts. Matches the server's mass-craft path
   * which resolves ingredients against the same pool, so the panel's
   * numbers don't lie when the user actually right-clicks. Optional so
   * tests can mount without standing up a chest mirror.
   */
  readonly chestState?: ChestState;
  /** Ship a `CraftRequest` for `recipeId` up to the server. */
  readonly sendCraft: (recipeId: string) => void;
  /**
   * Ship a `CraftMax` for `recipeId` — right-click on a recipe row asks
   * the server to craft as many as the pooled inventory + open chests
   * allow in one round-trip. Same silent-failure posture as `sendCraft`.
   */
  readonly sendCraftMax: (recipeId: string) => void;
}

export interface CraftingUiHandle {
  isOpen(): boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Force a re-render — exposed for tests; the live mirror notifies on its own. */
  render(): void;
  unmount(): void;
}

type DisplayStatus = "affordable" | "partial-hint" | "uncraftable";

/**
 * Mount the crafting overlay. Returns a handle whose `unmount()` removes
 * all DOM and listeners, used by `runMain`'s teardown.
 */
export function mountCraftingUi(
  options: CraftingUiOptions,
): CraftingUiHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = "anarchy-crafting-root";

  const panel = document.createElement("aside");
  panel.className = "anarchy-crafting-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Crafting");
  root.appendChild(panel);

  const scroll = document.createElement("div");
  scroll.className = "anarchy-crafting-scroll";
  panel.appendChild(scroll);

  const list = document.createElement("div");
  list.className = "anarchy-crafting-list";
  scroll.appendChild(list);

  let open = false;
  // Recipe ids in display order for the lifetime of the current open
  // session. Cleared in `setOpen(false)`. Untouched when the panel is
  // closed — render falls back to the natural advertised order then.
  const frozenOrder: string[] = [];
  // Current per-row status: `affordable` and `partial-hint` mirror the
  // server's advertise; `uncraftable` means the row was in the frozen
  // snapshot but has since dropped out of the advertised list (and so
  // grays out at its pinned index).
  const frozenStatus = new Map<string, DisplayStatus>();
  // Recipe id of the row the user most recently clicked in this open
  // session (left- or right-click, regardless of inert state). Anchors
  // task 180's newcomer-insertion rule. Cleared in `setOpen(false)`.
  let lastClickedId: string | null = null;
  // Recipe id of the row the user most recently *crafted* — a left- or
  // right-click that passed the inert gate and actually shipped a craft.
  // Pins that row in its frozen slot even if crafting it grayed it out, so
  // the row under the cursor never jumps out (task 450). Distinct from
  // `lastClickedId`, which also tracks clicks on inert rows. Cleared in
  // `setOpen(false)`.
  let lastCraftedId: string | null = null;
  // Ids that were `affordable` when they entered the frozen order (at open-
  // time snapshot or task-180 splice). Only these sink when they later go
  // gray (task 450); a row that was *born* partial-hint keeps its frozen
  // slot so the task 110/180 no-ripple guarantee holds. Cleared with the
  // frozen order.
  const bornAffordable = new Set<string>();
  // Per-row tooltip handles; replaced wholesale on every render so each row
  // gets a fresh `attachTooltip` against its live recipe + inventory thunk.
  const tooltipHandles: TooltipHandle[] = [];
  const detachAllTooltips = (): void => {
    for (const h of tooltipHandles) h.detach();
    tooltipHandles.length = 0;
  };

  const getOpenChestInventories = (): readonly Inventory[] => {
    const cs = options.chestState;
    if (cs === undefined) return [];
    const out: Inventory[] = [];
    for (const loc of cs.locations()) {
      const inv = cs.inventoryFor(loc);
      if (inv !== null) out.push(inv);
    }
    return out;
  };

  const computeDisplay = (): Array<{ id: string; status: DisplayStatus }> => {
    const natural = options.getInventory().getCraftableRecipes();
    if (!open) {
      return natural.map((e) => ({ id: e.id, status: e.availability }));
    }
    const naturalMap = new Map<string, "affordable" | "partial-hint">();
    for (const e of natural) naturalMap.set(e.id, e.availability);
    // Reclassify known frozen ids against the latest advertise.
    for (const id of frozenOrder) {
      const fresh = naturalMap.get(id);
      frozenStatus.set(id, fresh ?? "uncraftable");
    }
    // Splice unseen ids in. If the user has clicked a row this open
    // session, newcomers land directly after that row (task 180):
    // first iterated newcomer at clickedIndex+1, second at +2, etc., so
    // arrival order is preserved with the first newcomer closest to the
    // click. Otherwise fall back to the per-tier append: affordable at
    // the end of the affordable section, partial-hint at the very end.
    const clickAnchor =
      lastClickedId !== null ? frozenOrder.indexOf(lastClickedId) : -1;
    if (clickAnchor >= 0) {
      let insertAt = clickAnchor + 1;
      for (const entry of natural) {
        if (frozenStatus.has(entry.id)) continue;
        frozenOrder.splice(insertAt, 0, entry.id);
        frozenStatus.set(entry.id, entry.availability);
        if (entry.availability === "affordable") bornAffordable.add(entry.id);
        insertAt++;
      }
    } else {
      for (const entry of natural) {
        if (frozenStatus.has(entry.id)) continue;
        if (entry.availability === "affordable") {
          let insertAt = frozenOrder.length;
          for (let i = 0; i < frozenOrder.length; i++) {
            if (frozenStatus.get(frozenOrder[i]) === "partial-hint") {
              insertAt = i;
              break;
            }
          }
          frozenOrder.splice(insertAt, 0, entry.id);
          frozenStatus.set(entry.id, "affordable");
          bornAffordable.add(entry.id);
        } else {
          frozenOrder.push(entry.id);
          frozenStatus.set(entry.id, "partial-hint");
        }
      }
    }
    // Sink rows that crossed affordable→gray below the affordable block so a
    // freshly-grayed row never sits wedged between affordable ones (task
    // 450). The frozen order itself is left untouched — this is a display-
    // only reorder, so a row that recovers to affordable snaps back to its
    // pinned index. Two carve-outs keep the no-ripple guarantees intact:
    // rows born partial-hint never sink (they were always meant to sit at
    // the bottom — task 110/180), and the just-crafted row holds its slot
    // even when crafting it grayed it out, so it doesn't jump out from
    // under the cursor.
    const top: string[] = [];
    const sunk: string[] = [];
    for (const id of frozenOrder) {
      const gray = frozenStatus.get(id) !== "affordable";
      const crossed = gray && bornAffordable.has(id);
      if (crossed && id !== lastCraftedId) sunk.push(id);
      else top.push(id);
    }
    return [...top, ...sunk].map((id) => ({
      id,
      status: frozenStatus.get(id)!,
    }));
  };

  const render = (): void => {
    const display = computeDisplay();

    detachAllTooltips();
    list.replaceChildren();
    if (display.length === 0) {
      const empty = document.createElement("div");
      empty.className = "anarchy-crafting-empty";
      empty.textContent = "No craftable recipes.";
      list.appendChild(empty);
      return;
    }
    const inventory = options.getInventory();
    const chestInvs = getOpenChestInventories();
    for (const entry of display) {
      const recipe = recipeById(entry.id);
      if (!recipe) continue;
      const partialHint = entry.status === "partial-hint";
      const uncraftable = entry.status === "uncraftable";
      const inert = partialHint || uncraftable;
      const row = makeRecipeRow(
        recipe,
        inert ? 0 : maxCraftCount(recipe, inventory, ...chestInvs),
        partialHint,
      );
      if (uncraftable) {
        row.classList.add("uncraftable");
        row.setAttribute("aria-disabled", "true");
      }
      row.addEventListener("click", () => {
        lastClickedId = recipe.id;
        if (inert) return;
        lastCraftedId = recipe.id;
        options.sendCraft(recipe.id);
      });
      // Right-click → mass-craft. Same inert gate as the left-
      // click path; the bottom-of-panel `contextmenu` suppressor on the
      // panel itself still fires (it stops the browser default menu)
      // but the row's `contextmenu` listener executes first.
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        lastClickedId = recipe.id;
        if (inert) return;
        lastCraftedId = recipe.id;
        options.sendCraftMax(recipe.id);
      });
      tooltipHandles.push(
        attachTooltip(row, () =>
          makeRecipeTooltip(
            recipe,
            options.getInventory(),
            ...getOpenChestInventories(),
          ),
        ),
      );
      list.appendChild(row);
    }
  };

  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    panel.classList.toggle("open", open);
    if (open) {
      const natural = options.getInventory().getCraftableRecipes();
      frozenOrder.length = 0;
      frozenStatus.clear();
      bornAffordable.clear();
      for (const e of natural) {
        frozenOrder.push(e.id);
        frozenStatus.set(e.id, e.availability);
        if (e.availability === "affordable") bornAffordable.add(e.id);
      }
    } else {
      frozenOrder.length = 0;
      frozenStatus.clear();
      bornAffordable.clear();
      lastClickedId = null;
      lastCraftedId = null;
    }
    render();
  };

  const unsubscribe = options.getInventory().subscribe(render);
  // Chest open/close changes the pool composition. Subscribe to set
  // changes so the row max-craft + tooltip have-counts pick up newly-
  // open chests (and drop closed ones) even when the player inventory
  // didn't change in the same beat.
  const unsubscribeChests = options.chestState?.subscribeSet(render);

  // Stop pointer events from reaching `window` so the bootstrap-level
  // mousedown / contextmenu / wheel handlers don't fire destroy / place /
  // hotbar-cycle when a click or scroll lands on the crafting panel.
  // `contextmenu` also gets `preventDefault` so the browser's native
  // context menu doesn't surface over the panel. `wheel` is captured
  // unconditionally — the simpler "panel ate my scroll"
  // contract matches the user's mental model.
  for (const ev of ["mousedown", "mouseup", "click", "wheel"] as const) {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }
  panel.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  document.body.appendChild(root);
  render();

  return {
    isOpen: () => open,
    setOpen,
    toggle: () => setOpen(!open),
    render,
    unmount: () => {
      unsubscribe();
      unsubscribeChests?.();
      detachAllTooltips();
      root.remove();
    },
  };
}
