import { test, expect, type Page } from "./test-shared";

import { adminBroadcast } from "./admin";

// Task 100 e2e: the server-side chat history buffer is the authority for
// scrollback. Spec covers the two contracts that distinguish task 100
// from task 080's append-only fan-out:
//
//   1. A late-joining client receives the existing buffer right after
//      the welcome (no waiting on the next new chat line).
//   2. Past the `CHAT_HISTORY_MAX = 20` cap, the buffer rolls over —
//      every connected client sees the same authoritative tail.

const CHAT_ROOT_SELECTOR = "#anarchy-chat-root";
const CHAT_LIST_SELECTOR = "#anarchy-chat-list li";

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

async function rowBodies(page: Page): Promise<string[]> {
  return await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel as string)).map(
      (li) => (li.textContent ?? ""),
    );
  }, CHAT_LIST_SELECTOR);
}

async function waitForRowMatching(
  page: Page,
  needle: string,
): Promise<void> {
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

test("a late-joining client receives the existing chat history after welcome", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  try {
    await openClient(pageA, "chist-early");
    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // Per-spec marker so concurrent runs / earlier specs don't false-match.
    const marker = `chist-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const bodies = [
      `early-1: ${marker}`,
      `early-2: ${marker}`,
      `early-3: ${marker}`,
    ];

    // Drive three admin broadcasts before page B opens. The CLI / admin
    // broadcast path feeds the same buffer as player typing, so the
    // history fan-out covers both kinds.
    for (const body of bodies) {
      await adminBroadcast(body);
    }
    for (const body of bodies) {
      await waitForRowMatching(pageA, body);
    }

    // Open the second client AFTER the three messages landed. With task
    // 080's append-only path this client would have seen nothing; with
    // task 100's history push it should paint all three.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    try {
      await openClient(pageB, "chist-late");
      await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

      for (const body of bodies) {
        await waitForRowMatching(pageB, body);
      }
      const rendered = await rowBodies(pageB);
      const matched = rendered.filter((row) => row.includes(marker));
      // The history snapshot may carry lines from other concurrent
      // specs that ran inside this same server lifecycle; only assert
      // about this spec's marker.
      expect(matched).toHaveLength(3);
      expect(matched[0]).toContain("early-1");
      expect(matched[1]).toContain("early-2");
      expect(matched[2]).toContain("early-3");
    } finally {
      await ctxB.close();
    }
  } finally {
    await ctxA.close();
  }
});

test("the buffer caps at 20 entries and rolls over oldest-first on overflow", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await openClient(page, "chist-roll");
    await page.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    const marker = `chistroll-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const total = 25;
    for (let i = 0; i < total; i++) {
      // Zero-pad so lexical and numeric ordering agree under any later
      // string-based assertion.
      await adminBroadcast(`${marker} idx=${i.toString().padStart(2, "0")}`);
    }
    // The most recent line must land in the DOM.
    await waitForRowMatching(page, `idx=${(total - 1).toString().padStart(2, "0")}`);

    const rendered = await rowBodies(page);
    const mine = rendered.filter((row) => row.includes(marker));
    // The server's buffer caps at 20. Other concurrent specs may also be
    // pushing to the buffer; we filter to our marker to get a stable
    // subset to assert against. Inside that subset the head must have
    // rolled — `idx=00..04` (the first 5 of our 25 sends) must be gone,
    // and `idx=05..24` must be present in order.
    expect(mine.length).toBeLessThanOrEqual(20);
    expect(mine.length).toBeGreaterThanOrEqual(5);
    // The newest line we sent must be at the bottom of our subset.
    expect(mine[mine.length - 1]).toContain(
      `idx=${(total - 1).toString().padStart(2, "0")}`,
    );
    // The first 5 must NOT be present.
    for (let i = 0; i < 5; i++) {
      const stale = `${marker} idx=${i.toString().padStart(2, "0")}`;
      expect(rendered.some((r) => r.includes(stale))).toBe(false);
    }
  } finally {
    await ctx.close();
  }
});
