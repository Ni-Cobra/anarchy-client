// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DISCORD_INVITE_URL } from "../config.js";
import {
  mountDiscordButton,
  type DiscordButtonHandle,
} from "./discord_button.js";

let handle: DiscordButtonHandle | null = null;

afterEach(() => {
  handle?.unmount();
  handle = null;
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-discord-button-style")
    .forEach((s) => s.remove());
});

function root(): HTMLElement {
  const el = document.getElementById("anarchy-discord-button-root");
  if (el === null) throw new Error("discord button root not mounted");
  return el;
}

function anchor(): HTMLAnchorElement {
  const a = root().querySelector<HTMLAnchorElement>("a");
  if (a === null) throw new Error("discord button anchor not found");
  return a;
}

describe("mountDiscordButton", () => {
  it("mounts an anchor pointing at DISCORD_INVITE_URL in a new tab", () => {
    handle = mountDiscordButton();
    const a = anchor();
    expect(a.getAttribute("href")).toBe(DISCORD_INVITE_URL);
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  });

  it("mousedown / mouseup / click / contextmenu do not propagate to window", () => {
    handle = mountDiscordButton();
    const onWindow = vi.fn();
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      window.addEventListener(ev, onWindow);
    }
    const a = anchor();
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      a.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
    }
    expect(onWindow).not.toHaveBeenCalled();
    for (const ev of ["mousedown", "mouseup", "click", "contextmenu"] as const) {
      window.removeEventListener(ev, onWindow);
    }
  });

  it("contextmenu on the button is prevented (no native menu)", () => {
    handle = mountDiscordButton();
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    anchor().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("unmount removes the host from the DOM", () => {
    handle = mountDiscordButton();
    expect(document.getElementById("anarchy-discord-button-root")).not.toBeNull();
    handle.unmount();
    handle = null;
    expect(document.getElementById("anarchy-discord-button-root")).toBeNull();
  });
});
