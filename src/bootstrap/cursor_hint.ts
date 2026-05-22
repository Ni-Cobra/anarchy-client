/**
 * Cursor-anchored hint chip with two compositional channels (task 020).
 *
 * The chip sits next to the user's cursor (offset enough that the cursor
 * doesn't overlap the text) and follows it on `mousemove`. `pointer-events:
 * none` keeps the chip from eating clicks. The chip clamps inside the
 * viewport so it doesn't clip when the cursor is near the right/bottom
 * edges.
 *
 * Two channels:
 *   - **sticky**  — shown while the underlying condition holds; hidden when
 *     the caller flips it off. Used by the tier-gate mining hint
 *     (`break_place.ts::applyHint`).
 *   - **transient** — shown briefly, optionally with an auto-fade timer.
 *     Takes priority over sticky for its lifetime; when the transient
 *     clears, any still-active sticky text resumes. Used by task 030 to
 *     surface "Attack on cooldown".
 *
 * Lazy host: the chip element and its scoped `<style>` are only inserted
 * into the DOM on the first paint that has visible text, so sessions that
 * never trigger a hint pay no DOM cost. `unmount` strips host + style and
 * detaches the mousemove listener so a Disconnect leaves the page clean.
 */

const HOST_ID = "anarchy-cursor-hint";
const STYLE_ID = "anarchy-cursor-hint-style";
const CURSOR_OFFSET_X = 16;
const CURSOR_OFFSET_Y = 12;

export type CursorHintChannel = "sticky" | "transient";

export interface CursorHintShowOptions {
  /** Defaults to "sticky". Transient takes paint priority over sticky. */
  channel?: CursorHintChannel;
  /** When set on a transient `show`, auto-hides after the timeout fires.
   *  Ignored for sticky shows. */
  durationMs?: number;
}

export interface CursorHint {
  show(text: string, opts?: CursorHintShowOptions): void;
  hide(channel?: CursorHintChannel): void;
  unmount(): void;
}

export function createCursorHint(target: Window = window): CursorHint {
  let host: HTMLDivElement | null = null;
  let cursorX = 0;
  let cursorY = 0;

  let stickyText: string | null = null;
  let transientText: string | null = null;
  let transientTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureHost(): HTMLDivElement {
    if (host !== null) return host;
    if (target.document.getElementById(STYLE_ID) === null) {
      const style = target.document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${HOST_ID} {
          position: fixed;
          top: 0;
          left: 0;
          z-index: 9700;
          padding: 6px 14px;
          background: rgba(20, 24, 30, 0.92);
          border: 1px solid rgba(255, 100, 100, 0.45);
          border-radius: 6px;
          color: #ffb3b3;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13px;
          line-height: 1.3;
          pointer-events: none;
          display: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          white-space: nowrap;
        }
      `;
      target.document.head.appendChild(style);
    }
    const el = target.document.createElement("div");
    el.id = HOST_ID;
    target.document.body.appendChild(el);
    host = el;
    return el;
  }

  function reposition(): void {
    if (host === null) return;
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    let x = cursorX + CURSOR_OFFSET_X;
    let y = cursorY + CURSOR_OFFSET_Y;
    const vw = target.innerWidth;
    const vh = target.innerHeight;
    if (x + w > vw) x = Math.max(0, vw - w);
    if (y + h > vh) y = Math.max(0, vh - h);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    host.style.transform = `translate(${x}px, ${y}px)`;
  }

  function paint(): void {
    const text = transientText ?? stickyText;
    if (text === null) {
      if (host !== null && host.style.display !== "none") {
        host.style.display = "none";
      }
      return;
    }
    const el = ensureHost();
    if (el.textContent !== text) el.textContent = text;
    if (el.style.display !== "block") el.style.display = "block";
    reposition();
  }

  function clearTransientTimer(): void {
    if (transientTimer !== null) {
      clearTimeout(transientTimer);
      transientTimer = null;
    }
  }

  const onMousemove = (ev: MouseEvent): void => {
    cursorX = ev.clientX;
    cursorY = ev.clientY;
    if (host !== null && host.style.display === "block") {
      reposition();
    }
  };
  target.addEventListener("mousemove", onMousemove);

  return {
    show(text, opts) {
      const channel = opts?.channel ?? "sticky";
      if (channel === "transient") {
        transientText = text;
        clearTransientTimer();
        if (opts?.durationMs !== undefined) {
          const duration = opts.durationMs;
          transientTimer = setTimeout(() => {
            transientText = null;
            transientTimer = null;
            paint();
          }, duration);
        }
      } else {
        stickyText = text;
      }
      paint();
    },
    hide(channel) {
      if (channel === undefined || channel === "transient") {
        transientText = null;
        clearTransientTimer();
      }
      if (channel === undefined || channel === "sticky") {
        stickyText = null;
      }
      paint();
    },
    unmount() {
      clearTransientTimer();
      target.removeEventListener("mousemove", onMousemove);
      if (host !== null) {
        host.remove();
        host = null;
      }
      target.document.getElementById(STYLE_ID)?.remove();
      stickyText = null;
      transientText = null;
    },
  };
}
