// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountHelp, type HelpHandle } from "./help_button.js";

let help: HelpHandle | null = null;

afterEach(() => {
  help?.unmount();
  help = null;
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-help-button-style, #anarchy-help-dialog-style")
    .forEach((s) => s.remove());
});

function mount(): HelpHandle {
  help = mountHelp();
  return help;
}

function button(): HTMLButtonElement {
  const el = document.querySelector("#anarchy-help-button-root button");
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("help button not mounted");
  }
  return el;
}

function dialogRoot(): HTMLElement | null {
  return document.getElementById("anarchy-help-dialog-root");
}

function fireKeydown(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

describe("mountHelp", () => {
  it("mounts a visible corner button by default with no dialog", () => {
    const h = mount();
    expect(button()).toBeTruthy();
    expect(button().textContent).toBe("?");
    expect(dialogRoot()).toBeNull();
    expect(h.isOpen()).toBe(false);
  });

  it("clicking the button opens the dialog", () => {
    const h = mount();
    button().click();
    expect(h.isOpen()).toBe(true);
    expect(dialogRoot()).not.toBeNull();
  });

  it("clicking again closes the dialog (toggle)", () => {
    const h = mount();
    button().click();
    expect(h.isOpen()).toBe(true);
    button().click();
    expect(h.isOpen()).toBe(false);
    expect(dialogRoot()).toBeNull();
  });

  it("H toggles the dialog open / closed", () => {
    const h = mount();
    fireKeydown(document.body, { key: "h" });
    expect(h.isOpen()).toBe(true);
    fireKeydown(document.body, { key: "h" });
    expect(h.isOpen()).toBe(false);
  });

  it("F1 toggles the dialog open / closed", () => {
    const h = mount();
    fireKeydown(document.body, { key: "F1", code: "F1" });
    expect(h.isOpen()).toBe(true);
    fireKeydown(document.body, { key: "F1", code: "F1" });
    expect(h.isOpen()).toBe(false);
  });

  it("Escape closes the dialog when open", () => {
    const h = mount();
    h.open();
    expect(h.isOpen()).toBe(true);
    fireKeydown(document.body, { key: "Escape", code: "Escape" });
    expect(h.isOpen()).toBe(false);
  });

  it("typing H in an input field does not open the dialog", () => {
    const h = mount();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    fireKeydown(input, { key: "h" });
    expect(h.isOpen()).toBe(false);
  });

  it("while the dialog is open, a KeyW keydown inside the modal does not reach window listeners", () => {
    const h = mount();
    h.open();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    const panel = document.getElementById("anarchy-help-dialog-panel")!;
    fireKeydown(panel, { key: "w", code: "KeyW" });
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("unmount removes the button, closes any open dialog, and detaches keybindings", () => {
    const h = mount();
    h.open();
    h.unmount();
    expect(document.getElementById("anarchy-help-button-root")).toBeNull();
    expect(dialogRoot()).toBeNull();
    // After unmount, H must not re-open anything.
    fireKeydown(document.body, { key: "h" });
    expect(document.getElementById("anarchy-help-dialog-root")).toBeNull();
  });

  it("clicking the button does not bubble mousedown to window (no destroy/place under the button)", () => {
    mount();
    const onWindow = vi.fn();
    window.addEventListener("mousedown", onWindow);
    button().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("mousedown", onWindow);
  });
});
