/**
 * Bottom-right Discord invite button — persistent while playing. Mounted
 * once per session by `bootstrap/session.ts`; the lobby has its own
 * in-panel Discord button (`lobby_dom.ts`). The URL is sourced from
 * `config.ts::DISCORD_INVITE_URL`; both call sites import from there so
 * the literal lives in exactly one place.
 *
 * Visual language mirrors `corner_actions.ts` (top-right Disconnect /
 * Register row): same pill shape, padding, font, focus rules. The button
 * sits in the bottom-right corner, away from the top-right action row,
 * the bottom-center hotbar, and the bottom-left chat — so existing HUD
 * layout is untouched. The corner `?` help button (`help_button.ts`) is
 * hidden in-game (replaced by the bottom-center "How to play" pill), so
 * there is no overlap there either.
 *
 * Click handling mirrors `corner_actions.ts`: `mousedown` / `mouseup` /
 * `click` / `contextmenu` are stopped from bubbling to `window`, so the
 * bootstrap-level break / place handlers don't double-fire when a click
 * lands on the link. `contextmenu` is also default-prevented so right-
 * clicking doesn't pop the browser menu.
 */

import { DISCORD_INVITE_URL } from "../config.js";

const STYLE_ID = "anarchy-discord-button-style";
const ROOT_ID = "anarchy-discord-button-root";

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 8800;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #${ROOT_ID} a {
    display: inline-block;
    padding: 10px 14px;
    background: #5865F2;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: background 0.1s ease;
  }
  #${ROOT_ID} a:hover { background: #4752C4; }
  #${ROOT_ID} a:focus { outline: none; }
`;

export interface DiscordButtonHandle {
  unmount(): void;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountDiscordButton(): DiscordButtonHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const link = document.createElement("a");
  link.href = DISCORD_INVITE_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Discord";
  link.setAttribute("aria-label", "Join the Discord (opens in a new tab)");
  root.appendChild(link);

  for (const ev of ["mousedown", "mouseup", "click"] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }
  root.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  document.body.appendChild(root);

  let unmounted = false;
  return {
    unmount: (): void => {
      if (unmounted) return;
      unmounted = true;
      root.remove();
    },
  };
}
