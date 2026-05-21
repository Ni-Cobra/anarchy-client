// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  showHelpDialog,
  type HelpDialogHandle,
} from "./help_dialog.js";

let handle: HelpDialogHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-help-dialog-style")
    .forEach((s) => s.remove());
});

function open(onClose?: () => void): HelpDialogHandle {
  handle = showHelpDialog({ onClose });
  return handle;
}

function root(): HTMLElement | null {
  return document.getElementById("anarchy-help-dialog-root");
}

function panel(): HTMLElement {
  const el = document.getElementById("anarchy-help-dialog-panel");
  if (!(el instanceof HTMLElement)) {
    throw new Error("help dialog panel not mounted");
  }
  return el;
}

function fireKeydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(ev);
  return ev;
}

describe("showHelpDialog", () => {
  it("mounts the modal under document.body", () => {
    open();
    expect(root()).not.toBeNull();
    expect(panel()).toBeTruthy();
  });

  it("renders all five section headings", () => {
    open();
    const headings = Array.from(panel().querySelectorAll("h3")).map(
      (h) => h.textContent ?? "",
    );
    expect(headings).toEqual([
      "Controls",
      "Crafting",
      "Equipment",
      "Combat",
      "Factions",
    ]);
  });

  it("Escape closes the dialog and fires onClose", () => {
    const onClose = vi.fn();
    open(onClose);
    fireKeydown(document.body, { key: "Escape", code: "Escape" });
    expect(root()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes; clicking inside the panel does not", () => {
    open();
    panel().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root()).not.toBeNull();
    root()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root()).toBeNull();
  });

  it("the close button closes the dialog", () => {
    open();
    const closeBtn = panel().querySelector<HTMLButtonElement>(".close")!;
    closeBtn.click();
    expect(root()).toBeNull();
  });

  it("stops bubbled keydowns from reaching window while open (input gate)", () => {
    open();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    fireKeydown(panel(), { key: "w", code: "KeyW" });
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("right-click inside the dialog has its default prevented (task 210)", () => {
    open();
    const r = root()!;
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    r.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("contextmenu guard is detached on close (task 210)", () => {
    const h = open();
    const r = root()!;
    h.close();
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    r.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("close() is idempotent — repeated calls don't re-fire onClose", () => {
    const onClose = vi.fn();
    const h = open(onClose);
    h.close();
    h.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
