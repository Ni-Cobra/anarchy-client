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

function tabHeaders(): HTMLButtonElement[] {
  return Array.from(
    panel().querySelectorAll<HTMLButtonElement>(".anarchy-help-tab-header"),
  );
}

function tabPanes(): HTMLElement[] {
  return Array.from(panel().querySelectorAll<HTMLElement>(".anarchy-help-tab-pane"));
}

function activePaneId(): string | null {
  const active = panel().querySelector<HTMLElement>(".anarchy-help-tab-pane.active");
  return active?.getAttribute("data-tab-id") ?? null;
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

  it("renders the four tabs in order with General active by default", () => {
    const h = open();
    expect(tabHeaders().map((b) => b.textContent ?? "")).toEqual([
      "General",
      "Inventory",
      "Combat",
      "Factions",
    ]);
    expect(tabPanes().map((p) => p.getAttribute("data-tab-id"))).toEqual([
      "general",
      "inventory",
      "combat",
      "factions",
    ]);
    expect(activePaneId()).toBe("general");
    expect(h.activeTabIndex()).toBe(0);
  });

  it("only the active tab's pane is visible at a time", () => {
    open();
    const visible = tabPanes().filter((p) => p.classList.contains("active"));
    expect(visible).toHaveLength(1);
    expect(visible[0]?.getAttribute("data-tab-id")).toBe("general");
  });

  it("clicking a tab header switches the active pane", () => {
    const h = open();
    tabHeaders()[2]?.click();
    expect(h.activeTabIndex()).toBe(2);
    expect(activePaneId()).toBe("combat");
    expect(tabHeaders()[0]?.classList.contains("active")).toBe(false);
    expect(tabHeaders()[2]?.classList.contains("active")).toBe(true);
  });

  it("ArrowRight cycles forward through tabs and wraps to General", () => {
    const h = open();
    for (let i = 1; i <= 3; i++) {
      fireKeydown(document.body, { key: "ArrowRight", code: "ArrowRight" });
      expect(h.activeTabIndex()).toBe(i);
    }
    fireKeydown(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(h.activeTabIndex()).toBe(0);
    expect(activePaneId()).toBe("general");
  });

  it("ArrowLeft from General wraps to Factions", () => {
    const h = open();
    fireKeydown(document.body, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(h.activeTabIndex()).toBe(3);
    expect(activePaneId()).toBe("factions");
  });

  it("reopening the dialog starts on General even after switching tabs", () => {
    const first = open();
    tabHeaders()[3]?.click();
    expect(first.activeTabIndex()).toBe(3);
    first.close();
    const second = open();
    expect(second.activeTabIndex()).toBe(0);
    expect(activePaneId()).toBe("general");
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

  it("right-click inside the dialog has its default prevented", () => {
    open();
    const r = root()!;
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    r.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("contextmenu guard is detached on close", () => {
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

  it("arrow-key cycling stops once the dialog is closed", () => {
    const h = open();
    h.close();
    // After close, document-level capture handler is detached; firing
    // arrow keys should not throw, and the panel is gone.
    fireKeydown(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(panel.bind(null)).toThrow(); // panel is gone
  });
});
