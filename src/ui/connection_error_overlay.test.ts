// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTION_ERROR_BODY,
  CONNECTION_ERROR_RELOAD_LABEL,
  CONNECTION_ERROR_TITLE,
  mountConnectionErrorOverlay,
} from "./connection_error_overlay.js";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("mountConnectionErrorOverlay", () => {
  it("starts hidden — DOM exists but the visible class is off", () => {
    const overlay = mountConnectionErrorOverlay();
    const root = document.getElementById("anarchy-connection-error-overlay")!;
    expect(root).not.toBeNull();
    expect(overlay.isVisible()).toBe(false);
    expect(root.classList.contains("visible")).toBe(false);
    overlay.unmount();
  });

  it("renders the documented title, body, and Reload button label", () => {
    const overlay = mountConnectionErrorOverlay();
    const title = document.querySelector(
      "#anarchy-connection-error-overlay h2",
    )!;
    const body = document.querySelector(
      "#anarchy-connection-error-overlay .body",
    )!;
    const button = document.querySelector<HTMLButtonElement>(
      "#anarchy-connection-error-reload",
    )!;
    expect(title.textContent).toBe(CONNECTION_ERROR_TITLE);
    expect(body.textContent).toBe(CONNECTION_ERROR_BODY);
    expect(button.textContent).toBe(CONNECTION_ERROR_RELOAD_LABEL);
    overlay.unmount();
  });

  it("show() flips the visible class on", () => {
    const overlay = mountConnectionErrorOverlay();
    overlay.show();
    const root = document.getElementById("anarchy-connection-error-overlay")!;
    expect(overlay.isVisible()).toBe(true);
    expect(root.classList.contains("visible")).toBe(true);
    overlay.unmount();
  });

  it("show() is idempotent — repeated calls keep one visible overlay", () => {
    const overlay = mountConnectionErrorOverlay();
    overlay.show();
    overlay.show();
    overlay.show();
    expect(
      document.querySelectorAll("#anarchy-connection-error-overlay").length,
    ).toBe(1);
    expect(overlay.isVisible()).toBe(true);
    overlay.unmount();
  });

  it("clicking Reload invokes the onReload callback", () => {
    const onReload = vi.fn();
    const overlay = mountConnectionErrorOverlay({ onReload });
    overlay.show();
    const button = document.getElementById(
      "anarchy-connection-error-reload",
    ) as HTMLButtonElement;
    button.click();
    expect(onReload).toHaveBeenCalledTimes(1);
    overlay.unmount();
  });

  it("default onReload routes through window.location.reload", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      const overlay = mountConnectionErrorOverlay();
      overlay.show();
      const button = document.getElementById(
        "anarchy-connection-error-reload",
      ) as HTMLButtonElement;
      button.click();
      expect(reload).toHaveBeenCalledTimes(1);
      overlay.unmount();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("unmount removes the DOM root", () => {
    const overlay = mountConnectionErrorOverlay();
    expect(
      document.getElementById("anarchy-connection-error-overlay"),
    ).not.toBeNull();
    overlay.unmount();
    expect(
      document.getElementById("anarchy-connection-error-overlay"),
    ).toBeNull();
  });

  it("show() after unmount is a no-op", () => {
    const overlay = mountConnectionErrorOverlay();
    overlay.unmount();
    overlay.show();
    expect(
      document.getElementById("anarchy-connection-error-overlay"),
    ).toBeNull();
  });

  it("input gate eats keyboard events targeted at the overlay", () => {
    const overlay = mountConnectionErrorOverlay();
    overlay.show();
    const button = document.getElementById(
      "anarchy-connection-error-reload",
    ) as HTMLButtonElement;
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      const ev = new KeyboardEvent("keydown", {
        key: "w",
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(ev);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", seen);
      overlay.unmount();
    }
  });
});
