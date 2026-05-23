// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountCornerActions,
  type CornerActionsHandle,
} from "./corner_actions.js";

let handle: CornerActionsHandle | null = null;

afterEach(() => {
  handle?.unmount();
  handle = null;
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-corner-actions-style")
    .forEach((s) => s.remove());
});

function root(): HTMLElement {
  const el = document.getElementById("anarchy-corner-actions-root");
  if (el === null) throw new Error("corner actions root not mounted");
  return el;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(root().querySelectorAll<HTMLButtonElement>("button"));
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = buttons().find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`no button with label '${label}'`);
  return found;
}

describe("mountCornerActions", () => {
  it("mounts one button per action in the given order", () => {
    const a = vi.fn();
    const b = vi.fn();
    handle = mountCornerActions({
      actions: [
        { label: "Register", onClick: a },
        { label: "Disconnect", onClick: b },
      ],
    });
    const labels = buttons().map((b) => b.textContent);
    expect(labels).toEqual(["Register", "Disconnect"]);
  });

  it("clicking a button invokes its handler", () => {
    const onDisconnect = vi.fn();
    handle = mountCornerActions({
      actions: [{ label: "Disconnect", onClick: onDisconnect }],
    });
    buttonByLabel("Disconnect").click();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("mousedown / mouseup / click / contextmenu do not propagate to window", () => {
    handle = mountCornerActions({
      actions: [{ label: "Disconnect", onClick: () => {} }],
    });
    const onWindow = vi.fn();
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      window.addEventListener(ev, onWindow);
    }
    const btn = buttonByLabel("Disconnect");
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
    }
    expect(onWindow).not.toHaveBeenCalled();
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      window.removeEventListener(ev, onWindow);
    }
  });

  it("contextmenu on a button is prevented (no native menu)", () => {
    handle = mountCornerActions({
      actions: [{ label: "Disconnect", onClick: () => {} }],
    });
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    buttonByLabel("Disconnect").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("rebuild swaps the action list in place", () => {
    handle = mountCornerActions({
      actions: [
        { label: "Register", onClick: () => {} },
        { label: "Disconnect", onClick: () => {} },
      ],
    });
    expect(buttons().map((b) => b.textContent)).toEqual([
      "Register",
      "Disconnect",
    ]);
    handle.rebuild([{ label: "Disconnect", onClick: () => {} }]);
    expect(buttons().map((b) => b.textContent)).toEqual(["Disconnect"]);
  });

  it("rebuild replaces handlers — old closures don't fire on the new buttons", () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    handle = mountCornerActions({
      actions: [{ label: "Disconnect", onClick: oldHandler }],
    });
    handle.rebuild([{ label: "Disconnect", onClick: newHandler }]);
    buttonByLabel("Disconnect").click();
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledTimes(1);
  });

  it("unmount removes the host from the DOM", () => {
    handle = mountCornerActions({
      actions: [{ label: "Disconnect", onClick: () => {} }],
    });
    expect(document.getElementById("anarchy-corner-actions-root")).not.toBeNull();
    handle.unmount();
    handle = null;
    expect(document.getElementById("anarchy-corner-actions-root")).toBeNull();
  });
});
