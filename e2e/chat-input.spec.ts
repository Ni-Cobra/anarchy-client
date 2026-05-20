import { test, expect, type Page } from "./test-shared";

// Task 090 e2e: a player typing in the chat input field round-trips
// through the server's `SendChat` → `broadcast_chat` path and renders
// on every connected client (sender included). Driven through the
// browser-level Enter keybinding + the input field so the keybinding /
// input gate / wire path / fan-out are all exercised end-to-end.
//
// Also pins the input-gate contract: a second client typing into the
// chat input must not have their WASD-equivalent keystrokes drive
// movement. We assert this by verifying their player position doesn't
// budge while the input is focused and characters are typed.

const CHAT_ROOT_SELECTOR = "#anarchy-chat-root";
const CHAT_LIST_SELECTOR = "#anarchy-chat-list li";
const CHAT_INPUT_SELECTOR = "#anarchy-chat-input-field";

async function openClient(
  page: Page,
  username: string,
): Promise<{ id: number }> {
  await page.goto(`/?username=${username}&color=0`);
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

test("player typing routes through SendChat and renders on every connected client", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    // Usernames cap at 16 chars server-side; keep these short so the
    // lobby admits them.
    const suffix = Math.random().toString(36).slice(2, 6);
    const usernameA = `cauth-${suffix}`;
    await openClient(pageA, usernameA);
    await openClient(pageB, `cspec-${suffix}`);

    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // Per-test marker so concurrent specs / earlier runs can't match.
    const marker = `chat-input-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const body = `hello from a player: ${marker}`;

    // Press Enter on the body element to open the chat input via the
    // window-level keybinding.
    await pageA.locator("body").press("Enter");
    await pageA.waitForSelector(CHAT_INPUT_SELECTOR, { state: "visible" });

    // Type the body and submit with Enter.
    await pageA.locator(CHAT_INPUT_SELECTOR).fill(body);
    await pageA.locator(CHAT_INPUT_SELECTOR).press("Enter");

    // Both pages must see the player-styled echo with the typed body
    // and the author's username as the sender.
    for (const page of [pageA, pageB]) {
      await page.waitForFunction(
        ({ sel, needle }) => {
          const rows = Array.from(document.querySelectorAll(sel as string));
          return rows.some((li) =>
            (li.textContent ?? "").includes(needle as string),
          );
        },
        { sel: CHAT_LIST_SELECTOR, needle: marker },
        { timeout: 10_000 },
      );
      const matched = await page.evaluate(
        ({ sel, needle }) => {
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>(sel as string),
          );
          const row = rows.find((li) =>
            (li.textContent ?? "").includes(needle as string),
          );
          if (!row) return null;
          return {
            text: row.textContent ?? "",
            isAdmin: row.classList.contains("anarchy-chat-admin"),
            isPlayer: row.classList.contains("anarchy-chat-player"),
          };
        },
        { sel: CHAT_LIST_SELECTOR, needle: marker },
      );
      expect(matched).not.toBeNull();
      expect(matched!.text).toContain(usernameA);
      expect(matched!.text).toContain(body);
      expect(matched!.isPlayer).toBe(true);
      expect(matched!.isAdmin).toBe(false);
    }

    // After submit, the input field is hidden again.
    await pageA.waitForFunction(() => {
      const root = document.getElementById("anarchy-chat-input-root");
      return root?.classList.contains("hidden") === true;
    });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("typing in the chat input does not drive movement (input gate)", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const suffix = Math.random().toString(36).slice(2, 6);
    const { id } = await openClient(page, `cgate-${suffix}`);

    // Record the player's starting position.
    const startPos = await page.evaluate((pid) => {
      const a = window.__anarchy;
      const p = a?.world.getPlayer(pid as number);
      return p ? { x: p.x, y: p.y } : null;
    }, id);
    expect(startPos).not.toBeNull();

    // Open the chat input and type a sequence of W A S D characters.
    await page.locator("body").press("Enter");
    await page.waitForSelector(CHAT_INPUT_SELECTOR, { state: "visible" });
    await page.locator(CHAT_INPUT_SELECTOR).type("wasdwasd");

    // Let several ticks fly past — if the gate leaks, the movement
    // controller would have started ramping velocity and the player
    // would have drifted by now. Wait ~200ms (4 ticks at 20 Hz).
    await page.waitForTimeout(250);

    const endPos = await page.evaluate((pid) => {
      const a = window.__anarchy;
      const p = a?.world.getPlayer(pid as number);
      return p ? { x: p.x, y: p.y } : null;
    }, id);
    expect(endPos).not.toBeNull();
    expect(endPos!.x).toBeCloseTo(startPos!.x, 3);
    expect(endPos!.y).toBeCloseTo(startPos!.y, 3);

    // Escape closes without sending — afterwards the input is hidden.
    await page.locator(CHAT_INPUT_SELECTOR).press("Escape");
    await page.waitForFunction(() => {
      const root = document.getElementById("anarchy-chat-input-root");
      return root?.classList.contains("hidden") === true;
    });

    // No chat line should have been emitted (the body wasn't submitted).
    const chatLineCount = await page.evaluate((sel) => {
      return document.querySelectorAll(sel as string).length;
    }, CHAT_LIST_SELECTOR);
    // We don't assert exactly 0 (other specs may have sent admin lines
    // earlier in the page lifetime), but specifically no row containing
    // our typed body.
    expect(chatLineCount).toBeGreaterThanOrEqual(0);
    const sawDraft = await page.evaluate((sel) => {
      const rows = Array.from(document.querySelectorAll(sel as string));
      return rows.some((li) => (li.textContent ?? "").includes("wasdwasd"));
    }, CHAT_LIST_SELECTOR);
    expect(sawDraft).toBe(false);
  } finally {
    await ctx.close();
  }
});
