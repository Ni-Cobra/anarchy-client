// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Renderer } from "../render/index.js";
import type { ChatInputHandle, InventoryUiHandle } from "../ui/index.js";
import { attachKeybindings } from "./keybindings.js";

// Minimal stubs — `attachKeybindings` only touches the methods used by the
// branches we exercise here. Cast through `unknown` so we don't have to
// satisfy the full surface of `Renderer` / `InventoryUiHandle`.
function buildInventoryUi(): InventoryUiHandle {
  return {
    isOpen: () => false,
    setOpen: vi.fn(),
    toggle: vi.fn(),
    selectedHotbarSlot: () => 0,
    selectHotbarSlot: vi.fn(),
  } as unknown as InventoryUiHandle;
}

function buildRenderer(): Renderer {
  return {
    setZoomedOut: vi.fn(),
    nudgeZoom: vi.fn(),
  } as unknown as Renderer;
}

function buildChatInput(): ChatInputHandle & {
  open: ReturnType<typeof vi.fn>;
} {
  let openFlag = false;
  return {
    open: vi.fn(() => {
      openFlag = true;
    }),
    close: vi.fn(() => {
      openFlag = false;
    }),
    isOpen: () => openFlag,
    currentBody: () => "",
    setBody: vi.fn(),
    unmount: vi.fn(),
  };
}

describe("attachKeybindings — Enter / chat open (task 060 regression)", () => {
  let detach: (() => void) | null = null;

  afterEach(() => {
    detach?.();
    detach = null;
  });

  it("ignores Enter keydowns whose dispatch began before the listener was attached", async () => {
    // Construct the event FIRST so its `timeStamp` predates the attach.
    // This mirrors the production sequence: the lobby's submit-on-Enter
    // keydown is in flight, the await continuation runs as a microtask
    // mid-dispatch and attaches the in-world keybindings, and then the
    // *same* keydown finishes bubbling up to `window`.
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    // Make sure measurable time elapses so `attachedAt` > `enter.timeStamp`
    // even on very fast machines (timeStamp is high-resolution but the
    // measurement granularity in happy-dom can be coarse).
    await new Promise<void>((r) => setTimeout(r, 1));

    const chatInput = buildChatInput();
    detach = attachKeybindings(window, {
      inventoryUi: buildInventoryUi(),
      renderer: buildRenderer(),
      chatInput,
    });

    window.dispatchEvent(enter);
    expect(chatInput.open).not.toHaveBeenCalled();
  });

  it("opens chat on Enter keydowns dispatched after attach", () => {
    const chatInput = buildChatInput();
    detach = attachKeybindings(window, {
      inventoryUi: buildInventoryUi(),
      renderer: buildRenderer(),
      chatInput,
    });

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(enter);
    expect(chatInput.open).toHaveBeenCalledTimes(1);
  });
});
