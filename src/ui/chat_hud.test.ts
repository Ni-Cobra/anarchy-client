// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_HUD_ADMIN_COLOR,
  CHAT_HUD_MAX_LINES,
  CHAT_HUD_TIME_COLOR,
  CHAT_HUD_TIME_OPACITY,
  type ChatHudHandle,
  formatTimestamp,
  mountChatHud,
} from "./chat_hud.js";

let handle: ChatHudHandle | null = null;

afterEach(() => {
  handle?.unmount();
  handle = null;
  // Wipe style + root in case a test bypassed unmount.
  document.body.innerHTML = "";
  document
    .querySelectorAll("#anarchy-chat-hud-style")
    .forEach((s) => s.remove());
});

function rows(): HTMLLIElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLIElement>("#anarchy-chat-list li"),
  );
}

describe("mountChatHud", () => {
  it("creates the root #anarchy-chat-root container", () => {
    handle = mountChatHud();
    const root = document.getElementById("anarchy-chat-root");
    expect(root).not.toBeNull();
    expect(root?.querySelector("#anarchy-chat-list")).not.toBeNull();
  });

  it("renders a player-kind message as a plain line with no bold class", () => {
    handle = mountChatHud();
    handle.append({ kind: "player", sender: "Alice", body: "hi there" });
    const row = rows()[0];
    expect(row).toBeDefined();
    expect(row.textContent).toContain("Alice");
    expect(row.textContent).toContain("hi there");
    expect(row.classList.contains("anarchy-chat-admin")).toBe(false);
    expect(row.classList.contains("anarchy-chat-player")).toBe(true);
  });

  it("renders an admin-kind message as bold + warm tint", () => {
    handle = mountChatHud();
    handle.append({ kind: "admin", sender: "SERVER", body: "maintenance soon" });
    const row = rows()[0];
    expect(row.classList.contains("anarchy-chat-admin")).toBe(true);
    expect(row.classList.contains("anarchy-chat-player")).toBe(false);
    // Resolve computed style — happy-dom applies the stylesheet so the
    // class-driven font-weight + color reach the DOM.
    const style = window.getComputedStyle(row);
    // Browsers normalize `700` and `bold` interchangeably; either is fine.
    expect(["700", "bold"]).toContain(style.fontWeight);
    // happy-dom returns the raw stylesheet value (it doesn't normalize
    // to rgb()); browsers usually emit rgb(...). Accept either shape.
    const expected = hexToRgb(CHAT_HUD_ADMIN_COLOR);
    expect([CHAT_HUD_ADMIN_COLOR, expected]).toContain(style.color);
  });

  it("appends lines in arrival order (newest at the bottom)", () => {
    handle = mountChatHud();
    handle.append({ kind: "player", sender: "A", body: "first" });
    handle.append({ kind: "admin", sender: "SERVER", body: "second" });
    handle.append({ kind: "player", sender: "B", body: "third" });
    const bodies = rows().map((r) => r.textContent);
    expect(bodies[0]).toContain("first");
    expect(bodies[1]).toContain("second");
    expect(bodies[2]).toContain("third");
  });

  it("escapes HTML in sender + body via textContent (no markup injection)", () => {
    handle = mountChatHud();
    handle.append({
      kind: "player",
      sender: "<b>nope</b>",
      body: "<script>alert(1)</script>",
    });
    const row = rows()[0];
    expect(row.innerHTML).not.toContain("<script>");
    expect(row.innerHTML).not.toContain("<b>nope</b>");
    expect(row.textContent).toContain("<b>nope</b>");
    expect(row.textContent).toContain("<script>alert(1)</script>");
  });

  it("trims oldest rows when CHAT_HUD_MAX_LINES is exceeded", () => {
    handle = mountChatHud();
    for (let i = 0; i < CHAT_HUD_MAX_LINES + 5; i++) {
      handle.append({ kind: "player", sender: "S", body: `line-${i}` });
    }
    expect(handle.size()).toBe(CHAT_HUD_MAX_LINES);
    const first = rows()[0];
    // The first 5 lines should have been trimmed; the new first is line-5.
    expect(first.textContent).toContain("line-5");
  });

  it("prefixes each row with a dim-gray HH:MM:SS timestamp (task 020)", () => {
    handle = mountChatHud();
    handle.append({ kind: "player", sender: "Alice", body: "hi" });
    const row = rows()[0];
    const time = row.querySelector<HTMLSpanElement>(".anarchy-chat-time");
    expect(time).not.toBeNull();
    // Format: zero-padded HH:MM:SS followed by a single space gap before
    // the sender. textContent on the span includes that trailing space.
    expect(time!.textContent).toMatch(/^\d{2}:\d{2}:\d{2} $/);
    // The time span is the first child so the prefix actually leads.
    expect(row.firstElementChild).toBe(time);
    // Styling resolves through the injected stylesheet.
    const style = window.getComputedStyle(time!);
    const expectedRgb = hexToRgb(CHAT_HUD_TIME_COLOR);
    expect([CHAT_HUD_TIME_COLOR, expectedRgb]).toContain(style.color);
    expect(parseFloat(style.opacity)).toBeCloseTo(CHAT_HUD_TIME_OPACITY, 2);
  });

  it("formatTimestamp zero-pads hours, minutes, and seconds", () => {
    // Local-time wall clock; build a Date with known components.
    const d = new Date(2026, 4, 21, 3, 7, 9);
    expect(formatTimestamp(d)).toBe("03:07:09");
    const d2 = new Date(2026, 4, 21, 23, 59, 59);
    expect(formatTimestamp(d2)).toBe("23:59:59");
  });

  it("exposes an input host slot positioned directly below the message list (task 010)", () => {
    handle = mountChatHud();
    const root = document.getElementById("anarchy-chat-root");
    const list = document.getElementById("anarchy-chat-list");
    const host = handle.inputHost();
    expect(root).not.toBeNull();
    expect(host.parentElement).toBe(root);
    // The list must come first; the input host slot follows it so a
    // mounted input renders directly below the messages.
    const children = Array.from(root!.children);
    expect(children[0]).toBe(list);
    expect(children[1]).toBe(host);
  });
});

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
