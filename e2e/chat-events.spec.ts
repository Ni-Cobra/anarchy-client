import { test, expect, type Page } from "./test-shared";

import { adminDamagePlayer } from "./admin";

// Task 120 e2e: server-generated System chat lines for join, disconnect,
// and PvP kills. The register event is exercised separately in
// `accounts.spec.ts`'s sibling assertions; this spec covers the three
// lifecycle events that don't need the in-game register flow to fire.
//
// Each event must:
//   1. Land on every connected client (broadcast fan-out).
//   2. Render with the `anarchy-chat-system` class on the HUD row.
//   3. Carry the expected `Player <...>` body text.

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

async function findSystemRow(
  page: Page,
  needle: string,
): Promise<{ text: string; isSystem: boolean } | null> {
  return await page.evaluate(
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
        isSystem: row.classList.contains("anarchy-chat-system"),
      };
    },
    { sel: CHAT_LIST_SELECTOR, needle },
  );
}

async function waitForSystemRow(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(
    ({ sel, needle }) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(sel as string),
      );
      return rows.some(
        (li) =>
          (li.textContent ?? "").includes(needle as string) &&
          li.classList.contains("anarchy-chat-system"),
      );
    },
    { sel: CHAT_LIST_SELECTOR, needle },
    { timeout: 10_000 },
  );
}

test("join and disconnect events render as System chat on every connected client (task 120)", async ({
  browser,
}) => {
  // Per-run usernames so concurrent specs / earlier runs can't collide.
  // Hard-capped at 16 chars (`MAX_USERNAME_LEN`); the suffix tail is
  // entropy enough to make collisions astronomically unlikely.
  const tag = Math.random().toString(36).slice(2, 8);
  const userA = `eA_${tag}`.slice(0, 16);
  const userB = `eB_${tag}`.slice(0, 16);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await openClient(pageA, userA);
  await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
  // The joiner's own "Player X joined" event must surface on their own HUD —
  // the broadcast snapshot replaces the local view after the history push.
  await waitForSystemRow(pageA, `Player ${userA} joined`);

  // Bring up a second client; both pages must see "Player <B> joined".
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    await openClient(pageB, userB);
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    await waitForSystemRow(pageA, `Player ${userB} joined`);
    await waitForSystemRow(pageB, `Player ${userB} joined`);

    const joinOnA = await findSystemRow(pageA, `Player ${userB} joined`);
    expect(joinOnA).not.toBeNull();
    expect(joinOnA!.isSystem).toBe(true);

    // Close B's page so the server hits the disconnect teardown path.
    await ctxB.close();

    await waitForSystemRow(pageA, `Player ${userB} disconnected`);
    const leaveOnA = await findSystemRow(
      pageA,
      `Player ${userB} disconnected`,
    );
    expect(leaveOnA).not.toBeNull();
    expect(leaveOnA!.isSystem).toBe(true);
  } finally {
    if (!pageB.isClosed()) await ctxB.close();
    await ctxA.close();
  }
});

test("PvP kill renders 'Player <killer> killed <victim>' as System chat (task 120)", async ({
  browser,
}) => {
  const tag = Math.random().toString(36).slice(2, 8);
  const killer = `kA_${tag}`.slice(0, 16);
  const victim = `kB_${tag}`.slice(0, 16);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const { id: killerId } = await openClient(pageA, killer);
    const { id: victimId } = await openClient(pageB, victim);
    await pageA.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });
    await pageB.waitForSelector(CHAT_ROOT_SELECTOR, { state: "attached" });

    // Drive the kill through the admin damage seam with a `killer=<id>`
    // query param — same `DeathCause::Pvp { killer }` path the strike
    // resolver hits, which is what `World::kill_player` records on the
    // `PlayerDeathEvent`'s `killer_player_id`. The tick task then
    // broadcasts the System chat line.
    const outcome = await adminDamagePlayer(victimId, 1000, killerId);
    expect(outcome.kind).toBe("killed");

    const expected = `Player ${killer} killed ${victim}`;
    await waitForSystemRow(pageA, expected);
    await waitForSystemRow(pageB, expected);

    const onKiller = await findSystemRow(pageA, expected);
    const onVictim = await findSystemRow(pageB, expected);
    expect(onKiller).not.toBeNull();
    expect(onKiller!.isSystem).toBe(true);
    expect(onVictim).not.toBeNull();
    expect(onVictim!.isSystem).toBe(true);
  } finally {
    await ctxB.close();
    await ctxA.close();
  }
});
