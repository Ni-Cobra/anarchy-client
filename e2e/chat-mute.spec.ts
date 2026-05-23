import { test, expect, type Page } from "./test-shared";

import { adminMute, adminUnmute } from "./admin";

// Task 130 e2e: the admin `mute` command silences a player, scrubs their
// existing chat-history entries from every connected client's scrollback,
// pushes a "<name> has been muted" system event, and silently drops any
// chat frame the muted player tries to send. `unmute` clears the flag,
// pushes the "<name> has been unmuted" system event, lets the player
// chat again — and does NOT restore the previously-scrubbed messages.

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

async function sendChatLine(page: Page, body: string): Promise<void> {
  // Drive the chat input entirely via the DOM rather than Playwright's
  // higher-level locator wrappers — those route through click+focus
  // sequences that interact poorly with the canvas underneath the HUD
  // when the page has been live for several seconds. Two synchronous
  // evaluates: open the input, then set the value + dispatch Enter on
  // it (the chat input field has a target-phase keydown listener that
  // reads `input.value` and routes through `onSubmit`).
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter" }));
  });
  await page.waitForSelector(CHAT_INPUT_SELECTOR, { state: "visible" });
  await page.evaluate((b) => {
    const el = document.getElementById(
      "anarchy-chat-input-field",
    ) as HTMLInputElement | null;
    if (!el) throw new Error("chat input field not found");
    el.value = b as string;
    el.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true }),
    );
  }, body);
  await page.waitForFunction(() => {
    const root = document.getElementById("anarchy-chat-input-root");
    return root?.classList.contains("hidden") === true;
  });
}

async function waitForRowContaining(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(
    ({ sel, n }) => {
      const rows = Array.from(document.querySelectorAll(sel as string));
      return rows.some((li) => (li.textContent ?? "").includes(n as string));
    },
    { sel: CHAT_LIST_SELECTOR, n: needle },
    { timeout: 10_000 },
  );
}

async function waitForNoRowContaining(
  page: Page,
  needle: string,
): Promise<void> {
  await page.waitForFunction(
    ({ sel, n }) => {
      const rows = Array.from(document.querySelectorAll(sel as string));
      return !rows.some((li) => (li.textContent ?? "").includes(n as string));
    },
    { sel: CHAT_LIST_SELECTOR, n: needle },
    { timeout: 10_000 },
  );
}

async function bodyMatches(page: Page, needle: string): Promise<boolean> {
  return await page.evaluate(
    ({ sel, n }) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(sel as string),
      );
      return rows.some((li) => (li.textContent ?? "").includes(n as string));
    },
    { sel: CHAT_LIST_SELECTOR, n: needle },
  );
}

test("admin mute scrubs the target's past chat lines, blocks new ones, and unmute restores chat without restoring scrollback", async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    // Usernames cap at 16 chars — keep short.
    const suffix = Math.random().toString(36).slice(2, 6);
    const usernameA = `mutea-${suffix}`;
    const usernameB = `muteb-${suffix}`;
    await openClient(pageA, usernameA);
    await openClient(pageB, usernameB);

    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // Two distinct markers from A so we can pin the scrub effect.
    const marker1 = `mute-pre-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const marker2 = `mute-pre-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    await sendChatLine(pageA, `pre-mute line one ${marker1}`);
    await sendChatLine(pageA, `pre-mute line two ${marker2}`);

    // Both clients see both pre-mute lines.
    for (const page of [pageA, pageB]) {
      await waitForRowContaining(page, marker1);
      await waitForRowContaining(page, marker2);
    }

    // Mute A through the admin HTTP shim.
    expect(await adminMute(usernameA)).toBe(true);

    // Both clients see (a) the system "<A> has been muted" line and
    // (b) A's two pre-mute markers disappear from their scrollback.
    for (const page of [pageA, pageB]) {
      await waitForRowContaining(page, `${usernameA} has been muted`);
      await waitForNoRowContaining(page, marker1);
      await waitForNoRowContaining(page, marker2);
      // The mute system line styles as a System chat row.
      const styled = await page.evaluate(
        ({ sel, name }) => {
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>(sel as string),
          );
          const row = rows.find((li) =>
            (li.textContent ?? "").includes(`${name} has been muted`),
          );
          if (!row) return null;
          return {
            isSystem: row.classList.contains("anarchy-chat-system"),
            isAdmin: row.classList.contains("anarchy-chat-admin"),
            isPlayer: row.classList.contains("anarchy-chat-player"),
          };
        },
        { sel: CHAT_LIST_SELECTOR, name: usernameA },
      );
      expect(styled).not.toBeNull();
      expect(styled!.isSystem).toBe(true);
      expect(styled!.isPlayer).toBe(false);
      expect(styled!.isAdmin).toBe(false);
    }

    // While muted, A tries to send another line; neither client sees it.
    const droppedMarker = `mute-drop-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    await sendChatLine(pageA, `dropped ${droppedMarker}`);

    // Give the server several ticks to fan out (it won't — the frame is
    // silently dropped at the server seam). 300 ms is well over a tick.
    await pageA.waitForTimeout(300);
    expect(await bodyMatches(pageA, droppedMarker)).toBe(false);
    expect(await bodyMatches(pageB, droppedMarker)).toBe(false);

    // Unmute A and verify the system event fans out.
    expect(await adminUnmute(usernameA)).toBe(true);
    for (const page of [pageA, pageB]) {
      await waitForRowContaining(page, `${usernameA} has been unmuted`);
    }

    // A's old scrubbed lines are NOT restored by unmute.
    expect(await bodyMatches(pageA, marker1)).toBe(false);
    expect(await bodyMatches(pageA, marker2)).toBe(false);
    expect(await bodyMatches(pageB, marker1)).toBe(false);
    expect(await bodyMatches(pageB, marker2)).toBe(false);

    // A can chat again — the new line lands on both clients.
    const postMarker = `mute-post-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    await sendChatLine(pageA, `back online ${postMarker}`);
    for (const page of [pageA, pageB]) {
      await waitForRowContaining(page, postMarker);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
