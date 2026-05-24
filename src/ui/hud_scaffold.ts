/**
 * Shared mount prelude for HUD overlays.
 *
 * Every HUD module under `src/ui/` opens its `mount*` function with the
 * same three-step ritual:
 *   1. Inject a `<style id={styleId}>` block into `<head>` exactly once.
 *   2. Create the root element (`<div id={rootId}>` by default).
 *   3. Attach the root to `document.body` (or a passed parent).
 * `mountHudScaffold` hoists those three steps into one call so each HUD
 * module owns only its body logic. The style block and the root are both
 * idempotent — calling the helper a second time without `unmount` reuses
 * the existing nodes rather than duplicating them.
 *
 * Intentionally tiny: no event wiring, no theming, no observers. This is
 * a one-shot mount prelude, not a HUD framework. If a future HUD needs
 * fancier scaffolding, fold it in only when the pattern recurs verbatim.
 */

export interface HudScaffold {
  root: HTMLElement;
}

export interface HudScaffoldOptions {
  styleId: string;
  styleContent: string;
  rootId: string;
  rootTag?: keyof HTMLElementTagNameMap;
  parent?: HTMLElement;
}

export function mountHudScaffold(opts: HudScaffoldOptions): HudScaffold {
  if (!document.getElementById(opts.styleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = opts.styleId;
    styleEl.textContent = opts.styleContent;
    document.head.appendChild(styleEl);
  }

  const existing = document.getElementById(opts.rootId);
  if (existing !== null) {
    return { root: existing };
  }

  const root = document.createElement(opts.rootTag ?? "div");
  root.id = opts.rootId;
  (opts.parent ?? document.body).appendChild(root);
  return { root };
}
