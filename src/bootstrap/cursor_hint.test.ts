// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCursorHint, type CursorHint } from "./cursor_hint.js";

const HOST_ID = "anarchy-cursor-hint";
const STYLE_ID = "anarchy-cursor-hint-style";

function host(): HTMLDivElement | null {
  return document.getElementById(HOST_ID) as HTMLDivElement | null;
}

function moveCursor(x: number, y: number): void {
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
}

/** Parse the `translate(Xpx, Ypx)` transform back into numbers. */
function readTransform(el: HTMLElement): { x: number; y: number } {
  const m = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(
    el.style.transform,
  );
  if (m === null) throw new Error(`unexpected transform: ${el.style.transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

describe("createCursorHint", () => {
  let hint: CursorHint | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      configurable: true,
    });
  });

  afterEach(() => {
    hint?.unmount();
    hint = null;
    document.body.innerHTML = "";
    document.getElementById(STYLE_ID)?.remove();
    vi.useRealTimers();
  });

  it("does not mount any DOM until the first show", () => {
    hint = createCursorHint(window);
    expect(host()).toBeNull();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("show mounts the chip, paints text, and positions near the latest cursor", () => {
    hint = createCursorHint(window);
    moveCursor(200, 150);
    hint.show("Iron Ore requires Stone+ Pickaxe", { channel: "sticky" });
    const el = host();
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("Iron Ore requires Stone+ Pickaxe");
    expect(el!.style.display).toBe("block");
    // Offset is (16, 12) from the cursor — clamping is a no-op here.
    expect(readTransform(el!)).toEqual({ x: 216, y: 162 });
  });

  it("show defaults to the sticky channel when no opts provided", () => {
    hint = createCursorHint(window);
    moveCursor(50, 50);
    hint.show("default-channel");
    expect(host()!.textContent).toBe("default-channel");
    hint.hide("sticky");
    expect(host()!.style.display).toBe("none");
  });

  it("follows the cursor on subsequent mousemove events", () => {
    hint = createCursorHint(window);
    moveCursor(100, 100);
    hint.show("follow", { channel: "sticky" });
    expect(readTransform(host()!)).toEqual({ x: 116, y: 112 });
    moveCursor(400, 250);
    expect(readTransform(host()!)).toEqual({ x: 416, y: 262 });
  });

  it("clamps the chip inside the viewport at the right/bottom edges", () => {
    hint = createCursorHint(window);
    moveCursor(0, 0);
    hint.show("edge", { channel: "sticky" });
    const el = host()!;
    // happy-dom reports zero layout size; clamp logic still must keep
    // the chip non-negative. Force a width/height to exercise the clamp.
    Object.defineProperty(el, "offsetWidth", { value: 200, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 40, configurable: true });
    // Near right edge: cursor at x=1000 + offset 16 = 1016, chip width 200
    // → would overflow 1024. Clamp pushes x back to 824.
    moveCursor(1000, 100);
    let pos = readTransform(el);
    expect(pos.x).toBe(1024 - 200);
    expect(pos.y).toBe(112);
    // Near bottom edge: y clamps to vh - height = 768 - 40 = 728.
    moveCursor(100, 760);
    pos = readTransform(el);
    expect(pos.x).toBe(116);
    expect(pos.y).toBe(768 - 40);
  });

  it("hide('sticky') clears the sticky text and unpaints the chip", () => {
    hint = createCursorHint(window);
    moveCursor(50, 50);
    hint.show("sticky-msg", { channel: "sticky" });
    expect(host()!.style.display).toBe("block");
    hint.hide("sticky");
    expect(host()!.style.display).toBe("none");
  });

  it("transient channel paints on top of sticky; clearing transient restores sticky", () => {
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("sticky-msg", { channel: "sticky" });
    expect(host()!.textContent).toBe("sticky-msg");
    hint.show("transient-msg", { channel: "transient" });
    expect(host()!.textContent).toBe("transient-msg");
    hint.hide("transient");
    // Sticky text resumes — the chip didn't get torn down.
    expect(host()!.textContent).toBe("sticky-msg");
    expect(host()!.style.display).toBe("block");
  });

  it("transient with durationMs auto-clears and lets sticky resume", () => {
    vi.useFakeTimers();
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("sticky-bg", { channel: "sticky" });
    hint.show("transient-fast", { channel: "transient", durationMs: 1000 });
    expect(host()!.textContent).toBe("transient-fast");
    vi.advanceTimersByTime(999);
    expect(host()!.textContent).toBe("transient-fast");
    vi.advanceTimersByTime(1);
    expect(host()!.textContent).toBe("sticky-bg");
  });

  it("transient with no sticky behind it hides on auto-clear", () => {
    vi.useFakeTimers();
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("only-transient", { channel: "transient", durationMs: 500 });
    expect(host()!.textContent).toBe("only-transient");
    expect(host()!.style.display).toBe("block");
    vi.advanceTimersByTime(500);
    expect(host()!.style.display).toBe("none");
  });

  it("re-showing transient cancels the prior timer (no premature hide)", () => {
    vi.useFakeTimers();
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("first", { channel: "transient", durationMs: 1000 });
    vi.advanceTimersByTime(800);
    hint.show("second", { channel: "transient", durationMs: 1000 });
    // The 200ms remaining from "first" elapses but must not clear "second".
    vi.advanceTimersByTime(200);
    expect(host()!.textContent).toBe("second");
    vi.advanceTimersByTime(800);
    expect(host()!.style.display).toBe("none");
  });

  it("hide() with no channel clears both sticky and transient", () => {
    vi.useFakeTimers();
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("s", { channel: "sticky" });
    hint.show("t", { channel: "transient", durationMs: 5000 });
    hint.hide();
    expect(host()!.style.display).toBe("none");
    // Pending transient timer must not resurface after clear.
    vi.advanceTimersByTime(10000);
    expect(host()!.style.display).toBe("none");
  });

  it("updating sticky while transient is visible only changes what paints when transient clears", () => {
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("sticky-a", { channel: "sticky" });
    hint.show("transient", { channel: "transient" });
    expect(host()!.textContent).toBe("transient");
    hint.show("sticky-b", { channel: "sticky" });
    expect(host()!.textContent).toBe("transient");
    hint.hide("transient");
    expect(host()!.textContent).toBe("sticky-b");
  });

  it("unmount strips host, style block, and detaches the mousemove listener", () => {
    hint = createCursorHint(window);
    moveCursor(10, 10);
    hint.show("x", { channel: "sticky" });
    expect(host()).not.toBeNull();
    expect(document.getElementById(STYLE_ID)).not.toBeNull();
    hint.unmount();
    hint = null;
    expect(host()).toBeNull();
    expect(document.getElementById(STYLE_ID)).toBeNull();
    // After unmount, further mousemove events must not throw or re-mount.
    moveCursor(500, 500);
    expect(host()).toBeNull();
  });
});
