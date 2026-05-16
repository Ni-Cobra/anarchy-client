/**
 * Attack-cooldown HUD affordance — task 070b.
 *
 * A small fixed-position badge in the bottom-right corner. When the
 * local player's most recent strike fired within the last
 * `COOLDOWN_DURATION_MS`, the badge is visible with a `Xs` countdown
 * label. Otherwise it stays hidden. The server is authoritative; this
 * is purely the affordance so the user understands why a follow-up
 * left-click is being silently rejected.
 *
 * The HUD is driven from a rAF loop in `bootstrap/session.ts` that
 * polls the latest strike timestamp the renderer captured.
 */

const STYLE_ID = "anarchy-attack-cooldown-style";
const ROOT_ID = "anarchy-attack-cooldown";

/** Total cooldown window in ms (mirrors server `COOLDOWN_DURATION_SECS`). */
export const ATTACK_COOLDOWN_DURATION_MS = 5000;

const STYLE = `
  #${ROOT_ID} {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 9700;
    padding: 6px 12px 6px 28px;
    background: rgba(20, 24, 30, 0.92);
    border: 1px solid rgba(255, 180, 100, 0.45);
    border-radius: 6px;
    color: #ffe0b0;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.3;
    pointer-events: none;
    display: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    min-width: 96px;
  }
  #${ROOT_ID}::before {
    content: "⚔";
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #ffb060;
    font-size: 14px;
    line-height: 1;
  }
  #${ROOT_ID} .anarchy-cooldown-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: #ffb060;
    transition: width 0.06s linear;
  }
`;

export interface AttackCooldownHandle {
  /**
   * Push the latest cooldown sample: `nowMs` is wall-clock, `strikeMs`
   * is the wall-clock of the most recent local strike (or `null` if
   * the player has not struck this session). The handle reads the
   * delta itself and decides visibility / label / bar width.
   */
  update(nowMs: number, strikeMs: number | null): void;
  unmount(): void;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountAttackCooldown(): AttackCooldownHandle {
  injectStyle();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "Attack cooldown");

  const label = document.createElement("span");
  label.textContent = "";
  root.appendChild(label);

  const bar = document.createElement("div");
  bar.className = "anarchy-cooldown-bar";
  root.appendChild(bar);

  document.body.appendChild(root);

  let visible = false;
  let lastLabel = "";

  return {
    update: (nowMs, strikeMs) => {
      if (strikeMs === null) {
        if (visible) {
          root.style.display = "none";
          visible = false;
        }
        return;
      }
      const elapsed = nowMs - strikeMs;
      if (elapsed >= ATTACK_COOLDOWN_DURATION_MS || elapsed < 0) {
        if (visible) {
          root.style.display = "none";
          visible = false;
        }
        return;
      }
      const remaining = ATTACK_COOLDOWN_DURATION_MS - elapsed;
      const remainingSec = (remaining / 1000).toFixed(1);
      const text = `Cooldown ${remainingSec}s`;
      if (text !== lastLabel) {
        label.textContent = text;
        lastLabel = text;
      }
      // Width tracks the *remaining* fraction so the bar visually
      // depletes from full to empty over the window.
      const frac = remaining / ATTACK_COOLDOWN_DURATION_MS;
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      if (!visible) {
        root.style.display = "block";
        visible = true;
      }
    },
    unmount: () => {
      root.remove();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
}
