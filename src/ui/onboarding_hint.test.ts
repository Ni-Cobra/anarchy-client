// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectKeyboardLayoutFallback,
  DISMISS_DELAY_MS,
  FADE_DURATION_MS,
  mountOnboardingHint,
  ONBOARDING_SEEN_STORAGE_KEY,
  type OnboardingHintHandle,
} from "./onboarding_hint.js";

/**
 * Minimal in-memory storage stand-in. Tests pass this in so they don't
 * have to clear `window.localStorage` after themselves and don't trip
 * happy-dom's storage quota path.
 */
class MemStorage {
  private readonly inner = new Map<string, string>();
  getItem(k: string): string | null {
    return this.inner.has(k) ? (this.inner.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.inner.set(k, v);
  }
}

let handle: OnboardingHintHandle | null = null;
let storage: MemStorage;
let target: EventTarget;

beforeEach(() => {
  storage = new MemStorage();
  target = new EventTarget();
});

afterEach(() => {
  handle?.unmount();
  handle = null;
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-onboarding-hint-style")
    .forEach((s) => s.remove());
  vi.useRealTimers();
});

function root(): HTMLElement | null {
  return document.getElementById("anarchy-onboarding-hint");
}

function fireKey(t: EventTarget, code: string): void {
  t.dispatchEvent(
    new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }),
  );
}

describe("detectKeyboardLayoutFallback", () => {
  it("returns azerty for fr-* locales", () => {
    expect(detectKeyboardLayoutFallback("fr-FR")).toBe("azerty");
    expect(detectKeyboardLayoutFallback("fr")).toBe("azerty");
    expect(detectKeyboardLayoutFallback("FR-fr")).toBe("azerty");
  });

  it("returns qwerty for non-fr locales (and absent / empty)", () => {
    expect(detectKeyboardLayoutFallback("en-US")).toBe("qwerty");
    expect(detectKeyboardLayoutFallback("de-DE")).toBe("qwerty");
    expect(detectKeyboardLayoutFallback("")).toBe("qwerty");
    expect(detectKeyboardLayoutFallback(undefined)).toBe("qwerty");
  });
});

describe("mountOnboardingHint", () => {
  it("mounts the overlay with the QWERTY letters when layout is qwerty", () => {
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    const r = root();
    expect(r).not.toBeNull();
    const kbds = Array.from(
      (r as HTMLElement).querySelectorAll(".anarchy-onboarding-kbd"),
    ).map((e) => e.textContent);
    // First four are the directional keys in W/A/S/D order; then E, then Enter.
    expect(kbds.slice(0, 4)).toEqual(["W", "A", "S", "D"]);
    expect(kbds).toContain("E");
    expect(kbds).toContain("Enter");
  });

  it("renders Z/Q/S/D in the directional cluster on AZERTY", () => {
    handle = mountOnboardingHint({ storage, target, layout: "azerty" });
    const kbds = Array.from(
      (root() as HTMLElement).querySelectorAll(".anarchy-onboarding-kbd"),
    ).map((e) => e.textContent);
    expect(kbds.slice(0, 4)).toEqual(["Z", "Q", "S", "D"]);
  });

  it("is non-interactive (pointer-events:none) and centered above the world", () => {
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    const r = root() as HTMLElement;
    const style = window.getComputedStyle(r);
    expect(style.pointerEvents).toBe("none");
    expect(style.position).toBe("fixed");
  });

  it("returns a no-op handle and injects no DOM when the seen flag is set", () => {
    storage.setItem(ONBOARDING_SEEN_STORAGE_KEY, "1");
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    expect(root()).toBeNull();
    // unmount + dismissNow are no-ops; calling them must not throw.
    handle.unmount();
    handle.dismissNow();
  });

  it("starts the dismissal timer on the first movement keydown and clears the DOM after the fade", () => {
    vi.useFakeTimers();
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    expect(root()).not.toBeNull();

    // Non-movement key: no-op.
    fireKey(target, "KeyE");
    vi.advanceTimersByTime(DISMISS_DELAY_MS + FADE_DURATION_MS + 10);
    expect(root()).not.toBeNull();

    // Movement key: arms the timer.
    fireKey(target, "KeyW");
    vi.advanceTimersByTime(DISMISS_DELAY_MS - 1);
    expect(root()).not.toBeNull();
    expect(root()?.classList.contains("fading")).toBe(false);

    // Dismissal delay elapses: card enters the fade state.
    vi.advanceTimersByTime(1);
    expect(root()?.classList.contains("fading")).toBe(true);
    // Flag is written when the fade starts (the player has seen the
    // card for the full delay window).
    expect(storage.getItem(ONBOARDING_SEEN_STORAGE_KEY)).toBe("1");

    // Fade completes: DOM is gone.
    vi.advanceTimersByTime(FADE_DURATION_MS);
    expect(root()).toBeNull();
  });

  it("ignores subsequent movement keypresses while the timer is running (single-shot)", () => {
    vi.useFakeTimers();
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });

    fireKey(target, "KeyW");
    vi.advanceTimersByTime(DISMISS_DELAY_MS - 100);
    // Second movement keypress 100ms before the timer would fire.
    fireKey(target, "KeyA");
    // If the second press restarted the timer, the overlay would still
    // be present after another (DISMISS_DELAY_MS - 100) ms. It must not.
    vi.advanceTimersByTime(100);
    expect(root()?.classList.contains("fading")).toBe(true);
  });

  it("treats arrow keys as movement too", () => {
    vi.useFakeTimers();
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    fireKey(target, "ArrowDown");
    vi.advanceTimersByTime(DISMISS_DELAY_MS);
    expect(root()?.classList.contains("fading")).toBe(true);
  });

  it("unmount() detaches the listener and clears the DOM mid-fade", () => {
    vi.useFakeTimers();
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    fireKey(target, "KeyD");
    vi.advanceTimersByTime(DISMISS_DELAY_MS);
    expect(root()?.classList.contains("fading")).toBe(true);
    handle.unmount();
    expect(root()).toBeNull();
    // Listener is gone — firing another movement event must not throw
    // or recreate any state.
    fireKey(target, "KeyW");
    vi.advanceTimersByTime(FADE_DURATION_MS);
    expect(root()).toBeNull();
  });

  it("unmount() before any movement keypress just tears the DOM down and never sets the flag", () => {
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    expect(root()).not.toBeNull();
    handle.unmount();
    expect(root()).toBeNull();
    expect(storage.getItem(ONBOARDING_SEEN_STORAGE_KEY)).toBeNull();
  });

  it("dismissNow() short-circuits the delay and writes the seen flag", () => {
    vi.useFakeTimers();
    handle = mountOnboardingHint({ storage, target, layout: "qwerty" });
    handle.dismissNow();
    expect(root()?.classList.contains("fading")).toBe(true);
    expect(storage.getItem(ONBOARDING_SEEN_STORAGE_KEY)).toBe("1");
    vi.advanceTimersByTime(FADE_DURATION_MS);
    expect(root()).toBeNull();
  });

  it("swallows storage write errors so the overlay still mounts + dismisses", () => {
    const throwingStorage: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.useFakeTimers();
    handle = mountOnboardingHint({
      storage: throwingStorage,
      target,
      layout: "qwerty",
    });
    expect(root()).not.toBeNull();
    fireKey(target, "KeyW");
    // No throw, even though setItem threw.
    expect(() => vi.advanceTimersByTime(DISMISS_DELAY_MS)).not.toThrow();
    expect(root()?.classList.contains("fading")).toBe(true);
    vi.advanceTimersByTime(FADE_DURATION_MS);
    expect(root()).toBeNull();
  });

  it("swallows storage read errors and still mounts the overlay", () => {
    const throwingStorage: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("no access");
      },
      setItem: () => {},
    };
    handle = mountOnboardingHint({
      storage: throwingStorage,
      target,
      layout: "qwerty",
    });
    expect(root()).not.toBeNull();
  });
});
