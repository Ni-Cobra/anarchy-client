/**
 * Suppress the browser's default right-click context menu while a
 * full-viewport modal is mounted. Companion to `attachInputGate`.
 *
 * Why this is needed: every modal that uses an `inset: 0` backdrop +
 * `attachInputGate(root)` covers the whole viewport, so every right-click
 * lands on its backdrop. The input gate stops the event from bubbling to
 * the bootstrap-level `contextmenu` suppression in `break_place.ts`, so
 * absent this guard the browser's native menu pops on top of the modal.
 *
 * Implementation: capture-phase `contextmenu` listener on `root` that
 * calls `preventDefault()`. Capture phase wires it ahead of anything
 * inside the modal that might `stopPropagation()` on the same event.
 * Kept separate from `attachInputGate` so the gate's "passive bubble
 * stop" semantics stay explicit — the gate observes propagation, this
 * cancels a default.
 *
 * Scope is intentionally blanket: native context menus on
 * `<input type="text">` fields inside modals are suppressed too. If a
 * user complains about losing copy-paste affordances, a future task can
 * scope the guard to non-input targets.
 */

export interface ModalContextMenuGuardHandle {
  /** Remove the capture-phase listener. Idempotent. */
  detach(): void;
}

export function attachModalContextMenuGuard(
  root: HTMLElement,
): ModalContextMenuGuardHandle {
  const onContextMenu = (ev: MouseEvent): void => ev.preventDefault();
  root.addEventListener("contextmenu", onContextMenu, { capture: true });
  let detached = false;
  return {
    detach: (): void => {
      if (detached) return;
      detached = true;
      root.removeEventListener("contextmenu", onContextMenu, { capture: true });
    },
  };
}
