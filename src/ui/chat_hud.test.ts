// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { paletteColorHex } from "../game/index.js";

import {
  CHAT_HUD_ADMIN_COLOR,
  CHAT_HUD_MAX_LINES,
  CHAT_HUD_SYSTEM_COLOR,
  CHAT_HUD_TIME_COLOR,
  CHAT_HUD_TIME_OPACITY,
  type ChatHudHandle,
  type ChatLine,
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

function player(
  sender: string,
  body: string,
  opts: { colorIndex?: number; registered?: boolean } = {},
): ChatLine {
  return {
    kind: "player",
    sender,
    body,
    colorIndex: opts.colorIndex ?? 0,
    registered: opts.registered ?? true,
  };
}

function admin(body: string): ChatLine {
  return {
    kind: "admin",
    sender: "SERVER",
    body,
    colorIndex: 0,
    registered: true,
  };
}

function system(body: string): ChatLine {
  return {
    kind: "system",
    sender: "",
    body,
    colorIndex: 0,
    registered: true,
  };
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
    handle.replaceHistory([player("Alice", "hi there")]);
    const row = rows()[0];
    expect(row).toBeDefined();
    expect(row.textContent).toContain("Alice");
    expect(row.textContent).toContain("hi there");
    expect(row.classList.contains("anarchy-chat-admin")).toBe(false);
    expect(row.classList.contains("anarchy-chat-player")).toBe(true);
  });

  it("renders an admin-kind message as bold + warm tint", () => {
    handle = mountChatHud();
    handle.replaceHistory([admin("maintenance soon")]);
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

  it("renders the history in arrival order (newest at the bottom)", () => {
    handle = mountChatHud();
    handle.replaceHistory([
      player("A", "first"),
      admin("second"),
      player("B", "third"),
    ]);
    const bodies = rows().map((r) => r.textContent);
    expect(bodies[0]).toContain("first");
    expect(bodies[1]).toContain("second");
    expect(bodies[2]).toContain("third");
  });

  it("escapes HTML in sender + body via textContent (no markup injection)", () => {
    handle = mountChatHud();
    handle.replaceHistory([
      {
        kind: "player",
        sender: "<b>nope</b>",
        body: "<script>alert(1)</script>",
        colorIndex: 0,
        registered: true,
      },
    ]);
    const row = rows()[0];
    expect(row.innerHTML).not.toContain("<script>");
    expect(row.innerHTML).not.toContain("<b>nope</b>");
    expect(row.textContent).toContain("<b>nope</b>");
    expect(row.textContent).toContain("<script>alert(1)</script>");
  });

  it("replaceHistory([]) clears the rendered rows", () => {
    handle = mountChatHud();
    handle.replaceHistory([player("A", "hi"), player("B", "yo")]);
    expect(handle.size()).toBe(2);
    handle.replaceHistory([]);
    expect(handle.size()).toBe(0);
    expect(rows()).toHaveLength(0);
  });

  it("replaceHistory replaces the rendered rows with the new snapshot", () => {
    handle = mountChatHud();
    handle.replaceHistory([player("A", "one"), player("B", "two")]);
    handle.replaceHistory([player("C", "three")]);
    const bodies = rows().map((r) => r.textContent);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("C");
    expect(bodies[0]).toContain("three");
  });

  it("preserves the timestamp of a line that already appeared in the prior snapshot (task 100)", () => {
    // Drive `now` from the test so the assertion can pin the exact
    // displayed timestamp.
    const clock = new MockClock(["10:00:00", "10:00:30"]);
    handle = mountChatHud({ now: () => clock.next() });

    // First snapshot at 10:00:00: m1 + m2 are stamped at that time.
    handle.replaceHistory([player("A", "one"), player("B", "two")]);
    const beforeTimes = rows().map(timeOf);
    expect(beforeTimes).toEqual(["10:00:00", "10:00:00"]);

    // Second snapshot at 10:00:30: m1 + m2 carry their original
    // 10:00:00 stamp; m3 is brand new and stamps at 10:00:30.
    handle.replaceHistory([
      player("A", "one"),
      player("B", "two"),
      player("C", "three"),
    ]);
    const afterTimes = rows().map(timeOf);
    expect(afterTimes).toEqual(["10:00:00", "10:00:00", "10:00:30"]);
  });

  it("forgets a line's timestamp when the server evicts it (task 100)", () => {
    // If the same `kind|sender|body` is re-broadcast LATER after the
    // server's rolling buffer pushed it out, it should be treated as a
    // fresh line — stamped at the new arrival time, not the original.
    const clock = new MockClock(["10:00:00", "10:01:00", "10:02:00"]);
    handle = mountChatHud({ now: () => clock.next() });

    handle.replaceHistory([player("A", "one")]);
    expect(rows().map(timeOf)).toEqual(["10:00:00"]);

    // Server evicts "one" (buffer rolled over); we ship a new snapshot
    // with a different line.
    handle.replaceHistory([player("B", "two")]);
    expect(rows().map(timeOf)).toEqual(["10:01:00"]);

    // Now "one" comes back (in real life: a player re-typed it). The
    // identity table was purged at the eviction step, so this is a
    // fresh stamp.
    handle.replaceHistory([player("B", "two"), player("A", "one")]);
    expect(rows().map(timeOf)).toEqual(["10:01:00", "10:02:00"]);
  });

  it("trims oldest rows when CHAT_HUD_MAX_LINES is exceeded (defensive cap)", () => {
    // The server caps at 20 but a future bump could ship more — the
    // HUD's render-side trim defends against that. We construct a
    // snapshot larger than the cap and confirm the head is dropped.
    handle = mountChatHud();
    const snapshot: ChatLine[] = [];
    for (let i = 0; i < CHAT_HUD_MAX_LINES + 5; i++) {
      snapshot.push(player("S", `line-${i}`));
    }
    handle.replaceHistory(snapshot);
    expect(handle.size()).toBe(CHAT_HUD_MAX_LINES);
    const first = rows()[0];
    // The first 5 lines should have been trimmed; the new first is line-5.
    expect(first.textContent).toContain("line-5");
  });

  it("prefixes each row with a dim-gray HH:MM:SS timestamp (task 020)", () => {
    handle = mountChatHud();
    handle.replaceHistory([player("Alice", "hi")]);
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

  // Task 110 — per-message sender styling: palette color on the sender
  // span for player-kind rows; italic when the player was unregistered
  // at send time; admin lines stay untouched (bold + warm tint).
  it("applies the palette color to the sender span on a player-kind row (task 110)", () => {
    handle = mountChatHud();
    handle.replaceHistory([player("Alice", "hi", { colorIndex: 5 })]);
    const sender = rows()[0].querySelector<HTMLSpanElement>(
      ".anarchy-chat-sender",
    );
    expect(sender).not.toBeNull();
    const expected = paletteColorHex(5);
    const expectedHex = `#${expected.toString(16).padStart(6, "0")}`;
    const expectedRgb = hexToRgb(expectedHex);
    // happy-dom returns the raw inline value (hex) while browsers tend
    // to normalize to rgb(); accept either form.
    expect([expectedHex, expectedRgb]).toContain(sender!.style.color);
  });

  it("italicizes the sender on a guest player-kind row (task 110)", () => {
    handle = mountChatHud();
    handle.replaceHistory([
      player("Guest", "hello", { colorIndex: 3, registered: false }),
    ]);
    const sender = rows()[0].querySelector<HTMLSpanElement>(
      ".anarchy-chat-sender",
    );
    expect(sender).not.toBeNull();
    expect(
      sender!.classList.contains("anarchy-chat-sender-guest"),
    ).toBe(true);
    // Resolves through the injected stylesheet.
    expect(window.getComputedStyle(sender!).fontStyle).toBe("italic");
  });

  it("does not italicize the sender on a registered player-kind row (task 110)", () => {
    handle = mountChatHud();
    handle.replaceHistory([
      player("Alice", "hello", { colorIndex: 2, registered: true }),
    ]);
    const sender = rows()[0].querySelector<HTMLSpanElement>(
      ".anarchy-chat-sender",
    );
    expect(sender).not.toBeNull();
    expect(
      sender!.classList.contains("anarchy-chat-sender-guest"),
    ).toBe(false);
  });

  // Task 120 — System-kind rows render grey-italic with no `<sender>:`
  // prefix. The renderer branches on `kind` in one place so the body is
  // the sole non-timestamp child of the row.
  it("renders a system-kind row with the anarchy-chat-system class and no sender prefix (task 120)", () => {
    handle = mountChatHud();
    handle.replaceHistory([system("Player Alice joined")]);
    const row = rows()[0];
    expect(row.classList.contains("anarchy-chat-system")).toBe(true);
    expect(row.classList.contains("anarchy-chat-player")).toBe(false);
    expect(row.classList.contains("anarchy-chat-admin")).toBe(false);
    // No `<sender>:` prefix — the body is rendered without a sender span.
    expect(row.querySelector(".anarchy-chat-sender")).toBeNull();
    const body = row.querySelector<HTMLSpanElement>(".anarchy-chat-body");
    expect(body).not.toBeNull();
    expect(body!.textContent).toBe("Player Alice joined");
    // Timestamp prefix is still applied (system lines share the
    // `[hh:mm:ss]` lead-in with player / admin rows).
    const time = row.querySelector(".anarchy-chat-time");
    expect(time).not.toBeNull();
    expect(time!.textContent).toMatch(/^\d{2}:\d{2}:\d{2} $/);
  });

  it("styles a system-kind row with grey italic body via the injected stylesheet (task 120)", () => {
    handle = mountChatHud();
    handle.replaceHistory([system("Player Bob disconnected")]);
    const row = rows()[0];
    const style = window.getComputedStyle(row);
    const expectedRgb = hexToRgb(CHAT_HUD_SYSTEM_COLOR);
    expect([CHAT_HUD_SYSTEM_COLOR, expectedRgb]).toContain(style.color);
    expect(style.fontStyle).toBe("italic");
  });

  it("ignores colorIndex + registered on admin-kind rows (task 110)", () => {
    // Admin lines render bold + warm-tint regardless of the per-message
    // metadata. The HUD must not stamp an inline color override (it
    // would clobber the warm tint) and must not apply the guest-italic
    // class even if the wire frame happens to carry `registered: false`.
    handle = mountChatHud();
    handle.replaceHistory([
      {
        kind: "admin",
        sender: "SERVER",
        body: "important",
        colorIndex: 5,
        registered: false,
      },
    ]);
    const row = rows()[0];
    const sender = row.querySelector<HTMLSpanElement>(".anarchy-chat-sender");
    expect(sender).not.toBeNull();
    expect(sender!.style.color).toBe("");
    expect(
      sender!.classList.contains("anarchy-chat-sender-guest"),
    ).toBe(false);
    // The admin class still drives the warm-tint + bold styling.
    expect(row.classList.contains("anarchy-chat-admin")).toBe(true);
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

function timeOf(row: HTMLLIElement): string {
  const t = row.querySelector(".anarchy-chat-time");
  return (t?.textContent ?? "").trim();
}

class MockClock {
  private idx = 0;
  constructor(private readonly stamps: string[]) {}
  next(): Date {
    const s = this.stamps[Math.min(this.idx, this.stamps.length - 1)];
    this.idx++;
    const [h, m, sec] = s.split(":").map(Number);
    return new Date(2026, 0, 1, h, m, sec);
  }
}
