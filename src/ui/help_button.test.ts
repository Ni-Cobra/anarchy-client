// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountHelp,
  mountHowToPlayButton,
  type HelpHandle,
  type HowToPlayButtonHandle,
} from "./help_button.js";

let help: HelpHandle | null = null;
let howTo: HowToPlayButtonHandle | null = null;

afterEach(() => {
  howTo?.unmount();
  howTo = null;
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

function mountHowTo(): HowToPlayButtonHandle {
  howTo = mountHowToPlayButton();
  return howTo;
}

function cornerRoot(): HTMLElement {
  const el = document.getElementById("anarchy-help-button-root");
  if (el === null) throw new Error("help button root not mounted");
  return el;
}

function cornerButton(): HTMLButtonElement {
  const el = cornerRoot().querySelector("button");
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("corner button not mounted");
  }
  return el;
}

function howToButton(): HTMLButtonElement {
  const el = document.querySelector("#anarchy-howto-button-root button");
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("how-to-play button not mounted");
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
    expect(cornerButton()).toBeTruthy();
    expect(cornerButton().textContent).toBe("?");
    expect(dialogRoot()).toBeNull();
    expect(h.isOpen()).toBe(false);
  });

  it("clicking the corner button opens the dialog", () => {
    const h = mount();
    cornerButton().click();
    expect(h.isOpen()).toBe(true);
    expect(dialogRoot()).not.toBeNull();
  });

  it("clicking again closes the dialog (toggle)", () => {
    const h = mount();
    cornerButton().click();
    expect(h.isOpen()).toBe(true);
    cornerButton().click();
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
    help = null;
    expect(document.getElementById("anarchy-help-button-root")).toBeNull();
    expect(dialogRoot()).toBeNull();
    // After unmount, H must not re-open anything.
    fireKeydown(document.body, { key: "h" });
    expect(document.getElementById("anarchy-help-dialog-root")).toBeNull();
  });

  it("clicking the corner button does not bubble mousedown to window", () => {
    mount();
    const onWindow = vi.fn();
    window.addEventListener("mousedown", onWindow);
    cornerButton().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("mousedown", onWindow);
  });

  it("mounting twice without unmount throws", () => {
    mount();
    expect(() => mountHelp()).toThrow();
  });
});

describe("mountHowToPlayButton", () => {
  it("mounts a labeled button and hides the corner button", () => {
    mount();
    mountHowTo();
    const btn = howToButton();
    expect(btn.textContent).toBe("How to play and goal");
    // Corner root is still in the DOM but hidden via the `hidden` class.
    expect(cornerRoot().classList.contains("hidden")).toBe(true);
  });

  it("clicking the how-to button opens the same dialog as the corner", () => {
    const h = mount();
    mountHowTo();
    howToButton().click();
    expect(h.isOpen()).toBe(true);
    expect(dialogRoot()).not.toBeNull();
    howToButton().click();
    expect(h.isOpen()).toBe(false);
  });

  it("H fires exactly once when both buttons coexist (no double-toggle)", () => {
    const h = mount();
    mountHowTo();
    // Start closed. Pressing H once should open; if the handler fired
    // twice the second invocation would close it again.
    fireKeydown(document.body, { key: "h" });
    expect(h.isOpen()).toBe(true);
    fireKeydown(document.body, { key: "h" });
    expect(h.isOpen()).toBe(false);
  });

  it("unmount restores the corner button and removes the how-to root", () => {
    mount();
    const ht = mountHowTo();
    ht.unmount();
    howTo = null;
    expect(document.getElementById("anarchy-howto-button-root")).toBeNull();
    expect(cornerRoot().classList.contains("hidden")).toBe(false);
  });

  it("clicking the how-to button does not bubble mousedown to window", () => {
    mount();
    mountHowTo();
    const onWindow = vi.fn();
    window.addEventListener("mousedown", onWindow);
    howToButton().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("mousedown", onWindow);
  });

  it("throws if called before mountHelp", () => {
    expect(() => mountHowToPlayButton()).toThrow();
  });
});
