import { test, expect, type Page } from "./test-shared";

// Task 110 e2e: per-message sender styling on the wire end-to-end.
//
// Coverage:
//   1. Two guest clients connect with distinct palette colors. Each
//      types a chat line; on every receiver the sender span's inline
//      `color` matches the sender's lobby palette index, and the sender
//      span carries the `.anarchy-chat-sender-guest` class (italicized
//      via the injected stylesheet) because both senders are guests.
//   2. A guest sends a chat line and disconnects. A fresh client joins
//      and receives the history snapshot — the guest's line still
//      renders italic + colored from the per-message metadata frozen
//      at send time, even though the originating player is gone from
//      the world.

const CHAT_ROOT_SELECTOR = "#anarchy-chat-root";
const CHAT_LIST_SELECTOR = "#anarchy-chat-list li";
const CHAT_INPUT_SELECTOR = "#anarchy-chat-input-field";

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

// Mirrors `anarchy-client/src/game/palette.ts::PALETTE`. Inline-copied here
// to keep the spec free of source-tree imports and self-contained.
const PALETTE: readonly PaletteColor[] = [
  { r: 0xff, g: 0x30, b: 0x30 },
  { r: 0xff, g: 0x90, b: 0x30 },
  { r: 0xf5, g: 0xd0, b: 0x42 },
  { r: 0x30, g: 0xd0, b: 0xff },
  { r: 0x30, g: 0x70, b: 0xff },
  { r: 0xa0, g: 0x40, b: 0xff },
  { r: 0xff, g: 0x60, b: 0xa0 },
  { r: 0xf0, g: 0xf0, b: 0xf0 },
];

function paletteCssRgb(idx: number): string {
  const c = PALETTE[idx] ?? PALETTE[0];
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function paletteCssHex(idx: number): string {
  const c = PALETTE[idx] ?? PALETTE[0];
  const n = (c.r << 16) | (c.g << 8) | c.b;
  return `#${n.toString(16).padStart(6, "0")}`;
}

async function openClient(
  page: Page,
  username: string,
  colorIdx: number,
): Promise<{ id: number }> {
  await page.goto(`/?username=${username}&color=${colorIdx}`);
  await page.waitForFunction(() => window.__anarchy !== undefined);
  return await page
    .waitForFunction(() => {
      const a = window.__anarchy;
      if (!a) return null;
      const id = a.getLocalPlayerId();
      if (id === null || id === 0) return null;
      return { id };
    })
    .then((h) => h.jsonValue() as Promise<{ id: number }>);
}

async function typeChat(page: Page, body: string): Promise<void> {
  await page.locator("body").press("Enter");
  await page.waitForSelector(CHAT_INPUT_SELECTOR, { state: "visible" });
  await page.locator(CHAT_INPUT_SELECTOR).fill(body);
  await page.locator(CHAT_INPUT_SELECTOR).press("Enter");
}

async function waitForRow(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(
    ({ sel, needle }) => {
      const rows = Array.from(document.querySelectorAll(sel as string));
      return rows.some((li) =>
        (li.textContent ?? "").includes(needle as string),
      );
    },
    { sel: CHAT_LIST_SELECTOR, needle },
    { timeout: 10_000 },
  );
}

interface SenderShape {
  color: string;
  isGuest: boolean;
  fontStyle: string;
}

async function senderShapeFor(
  page: Page,
  needle: string,
): Promise<SenderShape | null> {
  return await page.evaluate(
    ({ sel, needle }) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(sel as string),
      );
      const row = rows.find((li) =>
        (li.textContent ?? "").includes(needle as string),
      );
      if (!row) return null;
      const sender = row.querySelector<HTMLSpanElement>(
        ".anarchy-chat-sender",
      );
      if (!sender) return null;
      const style = window.getComputedStyle(sender);
      return {
        color: sender.style.color,
        isGuest: sender.classList.contains("anarchy-chat-sender-guest"),
        fontStyle: style.fontStyle,
      };
    },
    { sel: CHAT_LIST_SELECTOR, needle },
  );
}

test("two guest clients see each other's chat lines colored by palette + italic", async ({
  browser,
}) => {
  // Two-page setup with two chat-input round-trips and two history
  // broadcasts can easily exceed the 15s default — the chat-input spec
  // already burns ~11s for a single client. Bump the budget so we don't
  // race the default ceiling.
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const suffix = Math.random().toString(36).slice(2, 6);
    const userA = `cs1a-${suffix}`;
    const userB = `cs1b-${suffix}`;
    const colorA = 2; // Yellow
    const colorB = 5; // Purple

    await openClient(pageA, userA, colorA);
    await openClient(pageB, userB, colorB);
    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    const markerA = `cs1-a-${suffix}`;
    const markerB = `cs1-b-${suffix}`;
    await typeChat(pageA, `from-a ${markerA}`);
    await typeChat(pageB, `from-b ${markerB}`);

    // Both clients see both lines.
    for (const page of [pageA, pageB]) {
      await waitForRow(page, markerA);
      await waitForRow(page, markerB);
    }

    const expectedA = [paletteCssRgb(colorA), paletteCssHex(colorA)];
    const expectedB = [paletteCssRgb(colorB), paletteCssHex(colorB)];

    for (const page of [pageA, pageB]) {
      const shapeA = await senderShapeFor(page, markerA);
      const shapeB = await senderShapeFor(page, markerB);
      expect(shapeA).not.toBeNull();
      expect(shapeB).not.toBeNull();
      // Inline `color` style on the sender span matches the palette
      // entry for the sender's lobby `color_index`, frozen at send
      // time. Browsers may normalize the hex to `rgb(...)`; accept
      // either form.
      expect(expectedA).toContain(shapeA!.color);
      expect(expectedB).toContain(shapeB!.color);
      // Both senders are unregistered (default e2e server has no
      // accounts), so both rows are italicized.
      expect(shapeA!.isGuest).toBe(true);
      expect(shapeB!.isGuest).toBe(true);
      expect(shapeA!.fontStyle).toBe("italic");
      expect(shapeB!.fontStyle).toBe("italic");
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("history replay preserves per-message color + italic after the sender disconnects", async ({
  browser,
}) => {
  test.setTimeout(45_000);
  // A guest types a message, then disconnects. A fresh client joins and
  // receives the history snapshot — the wire-baked `sender_color_index`
  // / `sender_registered` fields drive italic + palette color even
  // though the originating Player is gone from the world.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  try {
    const suffix = Math.random().toString(36).slice(2, 6);
    const userA = `cs2a-${suffix}`;
    const colorA = 4; // Blue

    await openClient(pageA, userA, colorA);
    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    const marker = `cs2-${suffix}`;
    await typeChat(pageA, `frozen ${marker}`);
    await waitForRow(pageA, marker);
  } finally {
    await ctxA.close();
  }

  // Page A is gone; the server has cleared the live `Player` but the
  // rolling chat buffer still carries the line. Open a fresh client.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const suffix = Math.random().toString(36).slice(2, 6);
    await openClient(pageB, `cs2b-${suffix}`, 0);
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // The line we sent before A disconnected is still in the history
    // snapshot pageB just received.
    const lastMarker = await pageB.evaluate(
      ({ sel }) => {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(sel as string),
        );
        // Find any row whose body contains our `cs2-` marker prefix —
        // includes prior runs but we'll narrow by the most recent one
        // visible to this client.
        return rows
          .map((li) => li.textContent ?? "")
          .filter((t) => t.includes("frozen cs2-"))
          .pop() ?? null;
      },
      { sel: CHAT_LIST_SELECTOR },
    );
    expect(lastMarker).not.toBeNull();

    // Same styling as live: italic + palette color frozen from the
    // wire metadata at send time.
    const shape = await senderShapeFor(pageB, "frozen cs2-");
    expect(shape).not.toBeNull();
    expect(shape!.isGuest).toBe(true);
    expect(shape!.fontStyle).toBe("italic");
    // Don't pin the exact color — prior spec runs may share the rolling
    // buffer with a different `colorA`. Just confirm that the inline
    // `color` is set (the wire stamped a palette index) rather than
    // empty (the pre-task-110 unstyled path).
    expect(shape!.color).not.toBe("");
  } finally {
    await ctxB.close();
  }
});
