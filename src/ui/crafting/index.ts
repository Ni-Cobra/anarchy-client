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
 * ## Deterministic ordering
 *
 * Row order is a pure function of what the server advertises: it is
 * **fully deterministic** at all times (open or closed, before or after a
 * craft, regardless of click history). The same set of recipes in the same
 * affordability state always renders in the same on-screen order. Concretely:
 *
 * - Affordable rows on top, partial-hint (grayed) rows on the bottom.
 * - Within each tier, the server's advertised order is authoritative
 *   (`Inventory` sorts affordable-then-lexical before storing, so the panel
 *   just mirrors `getCraftableRecipes()`).
 *
 * A row that becomes grayed drops to the bottom block immediately; a row
 * that becomes affordable returns to its deterministic affordable slot — on
 * every recompute. There is no frozen snapshot, no click anchor, no
 * just-crafted pin: rendering is a stateless mirror of the advertise.
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

  const render = (): void => {
    // Pure mirror of the server's advertised order: affordable rows first,
    // partial-hint rows after, deterministic within each tier. `Inventory`
    // already sorts before storing, so there is nothing to reorder here.
    const display = options.getInventory().getCraftableRecipes();

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
      const partialHint = entry.availability === "partial-hint";
      const row = makeRecipeRow(
        recipe,
        partialHint ? 0 : maxCraftCount(recipe, inventory, ...chestInvs),
        partialHint,
      );
      row.addEventListener("click", () => {
        if (partialHint) return;
        options.sendCraft(recipe.id);
      });
      // Right-click → mass-craft. Same inert gate as the left-
      // click path; the bottom-of-panel `contextmenu` suppressor on the
      // panel itself still fires (it stops the browser default menu)
      // but the row's `contextmenu` listener executes first.
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (partialHint) return;
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
