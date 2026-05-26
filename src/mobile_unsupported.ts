/**
 * Full-page "Mobile not supported" gate. `showLobby()` short-circuits into
 * this when `isMobileUserAgent()` returns true so phone / tablet users
 * see a plain message instead of the desktop lobby controls (touch
 * drag/drop and hotbar shortcuts were never designed for them). The
 * Discord button is kept so users can ping the community from their
 * phone — there is intentionally no "Continue anyway" escape hatch.
 *
 * The card reuses `lobby_style.ts`'s `#anarchy-lobby` overlay tokens
 * (radial-gradient background, panel border / shadow) so the unsupported
 * page matches the rest of the lobby chrome. Mounting under the lobby's
 * id is safe because this is a terminal state — the real lobby never
 * mounts afterwards.
 */

import { DISCORD_INVITE_URL } from "./config.js";
import { injectLobbyStyle } from "./lobby_style.js";

const EXTRA_STYLE_ID = "anarchy-mobile-unsupported-style";

const EXTRA_STYLE = `
  #anarchy-lobby.mobile-unsupported .panel {
    text-align: center;
  }
  #anarchy-lobby.mobile-unsupported .panel p {
    color: #b8c2cc;
    font-size: 14px;
    line-height: 1.5;
    margin: 16px 0 20px 0;
  }
`;

export function showMobileUnsupportedPage(): void {
  injectLobbyStyle();
  if (!document.getElementById(EXTRA_STYLE_ID)) {
    const styleEl = document.createElement("style");
    styleEl.id = EXTRA_STYLE_ID;
    styleEl.textContent = EXTRA_STYLE;
    document.head.appendChild(styleEl);
  }
  const root = document.createElement("div");
  root.id = "anarchy-lobby";
  root.className = "mobile-unsupported";
  root.innerHTML = `
    <div class="panel" role="alertdialog" aria-label="Mobile not supported">
      <h1>Mobile not supported!</h1>
      <p>Please open on Desktop.</p>
      <a class="discord-link" id="anarchy-discord-link"
         href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer"
         aria-label="Join the Discord (opens in a new tab)">Join Discord</a>
    </div>
  `;
  document.body.appendChild(root);
}
