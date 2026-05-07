// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetTooltipForTests, attachTooltip } from "./tooltip.js";

const TOOLTIP_ID = "anarchy-tooltip";
const STYLE_ID = "anarchy-tooltip-style";
const SHOW_DELAY_MS = 300;

function makeCell(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function pointer(type: string, x = 10, y = 10): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, bubbles: true });
}

describe("tooltip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetTooltipForTests();
  });

  it("shows after the configured delay and hides on pointerleave", () => {
    const cell = makeCell();
    attachTooltip(cell, () => "Gold");

    cell.dispatchEvent(pointer("pointerenter"));

    // Pre-delay: the shared node is not yet visible. (It may also not yet
    // exist — the helper creates it lazily on first show.)
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    let node = document.getElementById(TOOLTIP_ID);
    expect(node === null || node.style.display === "none").toBe(true);

    vi.advanceTimersByTime(1);
    node = document.getElementById(TOOLTIP_ID);
    expect(node).not.toBeNull();
    expect(node!.textContent).toBe("Gold");
    expect(node!.style.display).toBe("block");

    cell.dispatchEvent(pointer("pointerleave"));
    expect(node!.style.display).toBe("none");
  });

  it("cancels the show if the cursor leaves before the delay elapses", () => {
    const cell = makeCell();
    attachTooltip(cell, () => "Gold");
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS - 50);
    cell.dispatchEvent(pointer("pointerleave"));
    vi.advanceTimersByTime(SHOW_DELAY_MS * 2);
    const node = document.getElementById(TOOLTIP_ID);
    expect(node === null || node.style.display === "none").toBe(true);
  });

  it("hides when getContent returns null at show time", () => {
    const cell = makeCell();
    attachTooltip(cell, () => null);
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS + 1);
    const node = document.getElementById(TOOLTIP_ID);
    expect(node === null || node.style.display === "none").toBe(true);
  });

  it("re-evaluates content on the next hover so updates between hovers surface", () => {
    let value: string | null = "Gold";
    const cell = makeCell();
    attachTooltip(cell, () => value);

    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(document.getElementById(TOOLTIP_ID)!.textContent).toBe("Gold");

    cell.dispatchEvent(pointer("pointerleave"));
    expect(document.getElementById(TOOLTIP_ID)!.style.display).toBe("none");

    value = "Stone (5)";
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(document.getElementById(TOOLTIP_ID)!.textContent).toBe("Stone (5)");
  });

  it("uses a single shared DOM node across multiple targets", () => {
    const a = makeCell();
    const b = makeCell();
    attachTooltip(a, () => "A");
    attachTooltip(b, () => "B");

    a.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    a.dispatchEvent(pointer("pointerleave"));

    b.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    const nodes = document.querySelectorAll(`#${TOOLTIP_ID}`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].textContent).toBe("B");
  });

  it("clamps to the viewport edge when the cursor sits near the bottom-right", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 200,
      configurable: true,
    });

    const cell = makeCell();
    attachTooltip(cell, () => "edge");
    cell.dispatchEvent(pointer("pointerenter", 195, 195));
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    const node = document.getElementById(TOOLTIP_ID)!;
    const left = parseFloat(node.style.left);
    const top = parseFloat(node.style.top);
    // Without clamping the cursor + offset would land at 207/207, off the
    // 200×200 viewport. Clamping must keep both axes inside.
    expect(left).toBeLessThanOrEqual(200);
    expect(top).toBeLessThanOrEqual(200);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("the shared node is styled with pointer-events: none so clicks pass through", () => {
    const cell = makeCell();
    attachTooltip(cell, () => "test");
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    const styleEl = document.getElementById(STYLE_ID)!;
    expect(styleEl.textContent).toContain("pointer-events: none");
  });

  it("detach hides a visible tooltip and ignores further hover events", () => {
    const cell = makeCell();
    const handle = attachTooltip(cell, () => "X");
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    const node = document.getElementById(TOOLTIP_ID)!;
    expect(node.style.display).toBe("block");

    handle.detach();
    expect(node.style.display).toBe("none");

    // Subsequent hovers on the detached cell stay silent.
    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS * 2);
    expect(node.style.display).toBe("none");
  });

  it("pointermove while visible refreshes content from the thunk", () => {
    let value = "Gold";
    const cell = makeCell();
    attachTooltip(cell, () => value);

    cell.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(document.getElementById(TOOLTIP_ID)!.textContent).toBe("Gold");

    // Content updates while the cursor is still inside — next move pulls
    // the new value without needing pointerleave + re-enter.
    value = "Gold (10)";
    cell.dispatchEvent(pointer("pointermove", 12, 12));
    expect(document.getElementById(TOOLTIP_ID)!.textContent).toBe("Gold (10)");
  });
});
