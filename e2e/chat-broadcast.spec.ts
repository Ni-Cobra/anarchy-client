import { test, expect, type Page } from "./test-shared";

import { adminBroadcast } from "./admin";

// Task 080 e2e: an admin broadcast lands as an admin-styled chat line on
// every connected client. We drive the broadcast through the admin HTTP
// surface (`/admin/broadcast`) — the same dispatch path the CLI
// `broadcast` command uses — so the server-side fan-out + the client-side
// HUD render are both covered end-to-end.

const CHAT_ROOT_SELECTOR = "#anarchy-chat-root";
const CHAT_LIST_SELECTOR = "#anarchy-chat-list li";

async function openClient(page: Page, username: string): Promise<{ id: number }> {
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

test("admin broadcast renders on every connected client as an admin chat line", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    await openClient(pageA, "chat-alpha");
    await openClient(pageB, "chat-bravo");

    // The chat root mounts on session construction — wait for it on both
    // pages so we know the wire sink is wired before the broadcast.
    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // Use a per-test marker so concurrent specs / earlier runs can't make
    // a false-positive match against our assertions.
    const marker = `chat-broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = `maintenance notice: ${marker}`;

    await adminBroadcast(body);

    // The line must appear on both pages within a few ticks. We assert
    // (a) the row exists with the right body, (b) it carries the admin
    // class (so the bold+tint styling applies), and (c) the sender is
    // the CLI-stamped "SERVER".
    for (const page of [pageA, pageB]) {
      await page.waitForFunction(
        ({ sel, needle }) => {
          const rows = Array.from(document.querySelectorAll(sel));
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
      expect(matched!.text).toContain("SERVER");
      expect(matched!.text).toContain(body);
      expect(matched!.isAdmin).toBe(true);
      expect(matched!.isPlayer).toBe(false);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
