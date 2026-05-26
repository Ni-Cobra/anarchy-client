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
 * ## Hover anchoring
 *
 * Rows live inside a `.anarchy-crafting-list` wrapper so the panel's
 * slide-in transform is decoupled from a vertical `translateY` we apply to
 * keep the currently-hovered row pinned to its viewport position across
 * inventory churn. If the hovered recipe stops being craftable, it stays
 * in the list as a disabled "orphan" until the cursor moves off, so a
 * click that lands mid-update never crafts a different recipe.
 *
 * ## Chrome stability (retuned)
 *
 * The panel itself owns only the static chrome (border, radius, padding,
 * slide-in transform). Scrolling lives one layer deeper on
 * `.anarchy-crafting-scroll`, sized to a **fixed pixel height** (task
 * 110) so the panel bounds don't reflow when the row set changes — an
 * empty list and a 10-recipe list occupy the same vertical space.
 * `scrollbar-gutter: stable` on that wrapper reserves the scrollbar lane
 * so toggling overflow doesn't shift the row strip horizontally.
 *
 * ## Hover anchor across scroll
 *
 * With internal scrolling the "row stays under cursor across inventory
 * churn" invariant becomes a scrollTop problem: when the hovered row's
 * index shifts (e.g. a higher-priority recipe enters above it), we
 * restore the captured `scrollTop` and offset it by `(newIndex -
 * oldIndex) * ROW_PITCH_PX` so the row's viewport-y is preserved. This
 * replaces the earlier translateY-on-list trick, which is incompatible
 * with a scrollable container (transformed content can be pushed
 * outside the visible bounds without the scroll machinery noticing).
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

import type { CraftableRecipe, Inventory } from "../../game/index.js";
import { recipeById } from "../../recipes.js";
import { attachTooltip, type TooltipHandle } from "../tooltip.js";
import { maxCraftCount } from "./max_craft.js";
import { makeRecipeRow } from "./row.js";
import { injectStyle, ROW_PITCH_PX } from "./style.js";
import { makeRecipeTooltip } from "./tooltip.js";

export interface CraftingUiOptions {
  /** Reads the current inventory mirror. Called on every render. */
  readonly getInventory: () => Inventory;
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
  let hoveredRecipeId: string | null = null;
  // Per-row tooltip handles; replaced wholesale on every render so each row
  // gets a fresh `attachTooltip` against its live recipe + inventory thunk.
  const tooltipHandles: TooltipHandle[] = [];
  const detachAllTooltips = (): void => {
    for (const h of tooltipHandles) h.detach();
    tooltipHandles.length = 0;
  };

  const rowChildren = (): HTMLElement[] =>
    Array.from(
      list.querySelectorAll<HTMLElement>(":scope > .anarchy-crafting-row"),
    );

  const render = (): void => {
    const natural = options.getInventory().getCraftableRecipes();
    let display: readonly CraftableRecipe[] = natural;
    let orphanId: string | null = null;
    if (
      hoveredRecipeId !== null &&
      !natural.some((r) => r.id === hoveredRecipeId)
    ) {
      orphanId = hoveredRecipeId;
      display = insertOrphan(natural, hoveredRecipeId);
    }

    // Hover anchor: capture the scroll viewport's scrollTop and the
    // hovered row's index *before* the DOM mutates. After the rebuild we
    // restore scrollTop, offset by the index delta * row pitch so the
    // hovered row's viewport-y is preserved across the churn.
    const prevScrollTop = scroll.scrollTop;
    let prevHoveredIndex = -1;
    if (hoveredRecipeId !== null) {
      prevHoveredIndex = rowChildren().findIndex(
        (r) => r.dataset.recipeId === hoveredRecipeId,
      );
    }

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
    for (const entry of display) {
      const recipe = recipeById(entry.id);
      if (!recipe) continue;
      const partialHint = entry.availability === "partial-hint";
      const row = makeRecipeRow(
        recipe,
        maxCraftCount(recipe, inventory),
        partialHint,
      );
      if (entry.id === orphanId) {
        row.classList.add("uncraftable");
        row.setAttribute("aria-disabled", "true");
      }
      const inert = partialHint || entry.id === orphanId;
      row.addEventListener("click", () => {
        if (inert) return;
        options.sendCraft(recipe.id);
      });
      // right-click → mass-craft. Same inert gate as the left-
      // click path; the bottom-of-panel `contextmenu` suppressor on the
      // panel itself still fires (it stops the browser default menu)
      // but the row's `contextmenu` listener executes first.
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (inert) return;
        options.sendCraftMax(recipe.id);
      });
      tooltipHandles.push(
        attachTooltip(row, () => makeRecipeTooltip(recipe, options.getInventory())),
      );
      list.appendChild(row);
    }

    let nextScrollTop = prevScrollTop;
    if (hoveredRecipeId !== null && prevHoveredIndex >= 0) {
      const newHoveredIndex = rowChildren().findIndex(
        (r) => r.dataset.recipeId === hoveredRecipeId,
      );
      if (newHoveredIndex >= 0 && newHoveredIndex !== prevHoveredIndex) {
        nextScrollTop += (newHoveredIndex - prevHoveredIndex) * ROW_PITCH_PX;
      }
    }
    // The browser clamps to [0, scrollHeight - clientHeight]; we just guard
    // the lower bound explicitly so the assignment is well-defined under
    // jsdom-like environments where the clamp isn't always reproduced.
    scroll.scrollTop = Math.max(0, nextScrollTop);
  };

  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    panel.classList.toggle("open", open);
  };

  const setHovered = (next: string | null): void => {
    if (next === hoveredRecipeId) return;
    hoveredRecipeId = next;
    render();
  };

  // Hover is tracked at the document level rather than via panel-scoped
  // mouseenter/leave: in headless Chromium under Playwright, leaving the
  // panel in a single `mouse.move(x, y)` step doesn't reliably dispatch
  // `mouseleave` on the panel. A document `mousemove` listener catches
  // both transitions — into and out of the panel — from the same signal.
  // `panel.contains(target)` keeps the check scoped to our own DOM.
  const onDocMouseMove = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target || !panel.contains(target)) {
      setHovered(null);
      return;
    }
    const row = target.closest<HTMLElement>(".anarchy-crafting-row");
    setHovered(row?.dataset.recipeId ?? null);
  };
  const onPanelMouseLeave = (): void => {
    setHovered(null);
  };

  const unsubscribe = options.getInventory().subscribe(render);

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
  panel.addEventListener("mouseleave", onPanelMouseLeave);
  document.addEventListener("mousemove", onDocMouseMove);

  document.body.appendChild(root);
  render();

  return {
    isOpen: () => open,
    setOpen,
    toggle: () => setOpen(!open),
    render,
    unmount: () => {
      unsubscribe();
      detachAllTooltips();
      document.removeEventListener("mousemove", onDocMouseMove);
      root.remove();
    },
  };
}

/**
 * Insert an orphan recipe id into the natural advertise list at its
 * lexically-sorted position inside the affordable tier (orphans always
 * read as "this used to be craftable" — they go above the partial-hint
 * tier so the hover anchor doesn't drop the row past the gray section).
 */
function insertOrphan(
  arr: readonly CraftableRecipe[],
  id: string,
): CraftableRecipe[] {
  const orphan: CraftableRecipe = { id, availability: "affordable" };
  const out: CraftableRecipe[] = [];
  let inserted = false;
  for (const entry of arr) {
    if (!inserted && entry.availability === "partial-hint") {
      out.push(orphan);
      inserted = true;
    } else if (
      !inserted &&
      entry.availability === "affordable" &&
      id < entry.id
    ) {
      out.push(orphan);
      inserted = true;
    }
    out.push(entry);
  }
  if (!inserted) out.push(orphan);
  return out;
}
