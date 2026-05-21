// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachModalContextMenuGuard } from "./modal_contextmenu.js";

describe("attachModalContextMenuGuard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function makeRoot(): { root: HTMLDivElement; inside: HTMLDivElement } {
    const root = document.createElement("div");
    const inside = document.createElement("div");
    root.appendChild(inside);
    document.body.appendChild(root);
    return { root, inside };
  }

  it("prevents the default on contextmenu events targeted at the root", () => {
    const { root } = makeRoot();
    const guard = attachModalContextMenuGuard(root);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    guard.detach();
  });

  it("prevents the default on contextmenu events bubbling from a descendant", () => {
    const { inside } = makeRoot();
    const guard = attachModalContextMenuGuard(inside.parentElement as HTMLElement);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    inside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    guard.detach();
  });

  it("detach restores the default", () => {
    const { root } = makeRoot();
    const guard = attachModalContextMenuGuard(root);
    guard.detach();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("detach is idempotent", () => {
    const { root } = makeRoot();
    const guard = attachModalContextMenuGuard(root);
    guard.detach();
    guard.detach();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("does not affect contextmenu events outside the root", () => {
    const { root } = makeRoot();
    const guard = attachModalContextMenuGuard(root);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    guard.detach();
  });
});
