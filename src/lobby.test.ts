// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PASSWORD_LEN } from "./game/index.js";
import { lobbyRejectMessage, showLobby } from "./lobby.js";

describe("lobby form (ADR 0007)", () => {
  afterEach(() => {
    document.getElementById("anarchy-lobby")?.remove();
  });

  function panel(): HTMLElement {
    const el = document.getElementById("anarchy-lobby");
    if (!el) throw new Error("lobby DOM not mounted");
    return el;
  }

  it("starts in 'New player' mode by default with the color picker visible and no password field", () => {
    showLobby();
    const root = panel();
    const tabNew = root.querySelector<HTMLButtonElement>("#anarchy-tab-new")!;
    const tabReturning = root.querySelector<HTMLButtonElement>(
      "#anarchy-tab-returning",
    )!;
    expect(tabNew.classList.contains("active")).toBe(true);
    expect(tabReturning.classList.contains("active")).toBe(false);
    const colorSection = root.querySelector<HTMLElement>(
      "#anarchy-color-section",
    )!;
    const passwordSection = root.querySelector<HTMLElement>(
      "#anarchy-password-section",
    )!;
    expect(colorSection.style.display).not.toBe("none");
    expect(passwordSection.style.display).toBe("none");
  });

  it("clicking 'Returning player' shows the password field and hides the color picker", () => {
    showLobby();
    const root = panel();
    const tabReturning = root.querySelector<HTMLButtonElement>(
      "#anarchy-tab-returning",
    )!;
    tabReturning.click();
    const colorSection = root.querySelector<HTMLElement>(
      "#anarchy-color-section",
    )!;
    const passwordSection = root.querySelector<HTMLElement>(
      "#anarchy-password-section",
    )!;
    expect(colorSection.style.display).toBe("none");
    expect(passwordSection.style.display).not.toBe("none");
  });

  it("New mode submit produces an identity with empty password and reconnect=false", async () => {
    const promise = showLobby();
    const root = panel();
    const username = root.querySelector<HTMLInputElement>("#anarchy-username")!;
    username.value = "Alice";
    username.dispatchEvent(new Event("input"));
    const submit = root.querySelector<HTMLButtonElement>("#anarchy-submit")!;
    expect(submit.disabled).toBe(false);
    submit.click();
    const identity = await promise;
    expect(identity.username).toBe("Alice");
    expect(identity.reconnect).toBe(false);
    expect(identity.password ?? "").toBe("");
  });

  it("Returning mode submit produces an identity with the typed password and reconnect=true", async () => {
    const promise = showLobby({ mode: "returning" });
    const root = panel();
    const username = root.querySelector<HTMLInputElement>("#anarchy-username")!;
    username.value = "Bob";
    username.dispatchEvent(new Event("input"));
    const password = root.querySelector<HTMLInputElement>("#anarchy-password")!;
    password.value = "hunter2";
    const submit = root.querySelector<HTMLButtonElement>("#anarchy-submit")!;
    submit.click();
    const identity = await promise;
    expect(identity.username).toBe("Bob");
    expect(identity.reconnect).toBe(true);
    expect(identity.password).toBe("hunter2");
  });

  it("renders the rejectMessage when defaults supply one", () => {
    showLobby({ rejectMessage: "Account locked." });
    const root = panel();
    const reject = root.querySelector<HTMLElement>("#anarchy-reject")!;
    expect(reject.classList.contains("visible")).toBe(true);
    expect(reject.textContent).toContain("Account locked.");
  });

  it("submit stays disabled while the username is empty or invalid", () => {
    showLobby();
    const root = panel();
    const submit = root.querySelector<HTMLButtonElement>("#anarchy-submit")!;
    expect(submit.disabled).toBe(true);
    const username = root.querySelector<HTMLInputElement>("#anarchy-username")!;
    username.value = "!!!";
    username.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(true);
    username.value = "ok";
    username.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(false);
  });

  it("Enter on the username field swallows the keystroke so it can't leak into in-world bindings", () => {
    showLobby();
    const root = panel();
    const username = root.querySelector<HTMLInputElement>("#anarchy-username")!;
    username.value = "Carol";
    username.dispatchEvent(new Event("input"));
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    username.dispatchEvent(ev);
    // preventDefault + stopPropagation on the lobby's listener — the
    // bubbling stop is what keeps the same keydown from reaching a
    // freshly-attached window-level keybind on the in-world session.
    expect(ev.defaultPrevented).toBe(true);
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("password input is capped at MAX_PASSWORD_LEN so honest clients can't trip the server's wire reject", () => {
    // SECURITY-REVIEW M-3: the server rejects passwords longer than
    // `MAX_PASSWORD_LEN` at the wire seam (no oracle, no hash). The
    // lobby's `maxlength` keeps honest input under the cap so a
    // legitimate user never hits that reject.
    showLobby({ mode: "returning" });
    const root = panel();
    const password = root.querySelector<HTMLInputElement>("#anarchy-password")!;
    expect(password.maxLength).toBe(MAX_PASSWORD_LEN);
  });

  it("switching from Returning to New clears any typed password", () => {
    showLobby({ mode: "returning" });
    const root = panel();
    const password = root.querySelector<HTMLInputElement>("#anarchy-password")!;
    password.value = "secret";
    const tabNew = root.querySelector<HTMLButtonElement>("#anarchy-tab-new")!;
    tabNew.click();
    expect(password.value).toBe("");
  });
});

describe("lobbyRejectMessage", () => {
  // multi-login prevention: pin the user-visible message the
  // lobby renders when the server rejects a second concurrent in-world
  // session from the same peer IP. The string itself is the contract —
  // the lobby's `rejectMessage` overlay tests rely on it.
  it("renders a network-specific message for the multi-login reject", () => {
    expect(lobbyRejectMessage("already-connected-from-ip")).toBe(
      "Another tab from this network is already in the world.",
    );
  });

  // Switch-coverage guard: every wire reject reason must return a
  // non-empty string. TypeScript's exhaustiveness checking on `switch`
  // catches a missing case at compile time, but this test makes the
  // failure mode legible if the type union and the switch ever drift.
  it("returns a non-empty string for every wire reject reason", () => {
    const reasons = [
      "reconnect-live-session",
      "reconnect-no-record",
      "password-required",
      "password-incorrect",
      "username-taken-by-registration",
      "server-full",
      "already-connected-from-ip",
    ] as const;
    for (const r of reasons) {
      const msg = lobbyRejectMessage(r);
      expect(msg, `missing message for ${r}`).toBeTruthy();
    }
  });
});
