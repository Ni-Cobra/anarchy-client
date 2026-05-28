/**
 * Platform / user-agent helpers. Used by the lobby (`lobby.ts`) to
 * short-circuit into a "Mobile not supported" page before any
 * desktop-only controls render — touch drag/drop and the hotbar
 * shortcuts weren't designed for phones / tablets. UA spoofing isn't a
 * concern: anyone setting a desktop UA on purpose is consenting to the
 * desktop UI.
 *
 * `isMobile()` combines the UA sniff with a touch-capability fallback.
 * iPadOS 13+ defaults to a Mac-like desktop UA (no `iPad` substring),
 * so the regex alone misses it; `maxTouchPoints > 1` AND `(pointer:
 * coarse)` catches iPad while letting Surface-style laptops with an
 * attached touchscreen but a fine mouse pointer through.
 */

const MOBILE_UA = /iPhone|iPad|iPod|Android|Mobile|BlackBerry|Opera Mini/i;

export function isMobileUserAgent(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  return MOBILE_UA.test(ua);
}

/** Signals consumed by `isMobile()`. All optional; defaults read from
 * the live `navigator` / `window.matchMedia` at call time. Exposed for
 * tests and for any caller that wants to override one axis. */
export interface MobileSignals {
  readonly ua?: string;
  readonly maxTouchPoints?: number;
  readonly coarsePointer?: boolean;
}

function defaultMaxTouchPoints(): number {
  if (typeof navigator === "undefined") return 0;
  const n = navigator.maxTouchPoints;
  return typeof n === "number" ? n : 0;
}

function defaultCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
}

export function isMobile(signals: MobileSignals = {}): boolean {
  const ua =
    signals.ua ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (isMobileUserAgent(ua)) return true;
  const maxTouchPoints = signals.maxTouchPoints ?? defaultMaxTouchPoints();
  const coarsePointer = signals.coarsePointer ?? defaultCoarsePointer();
  return maxTouchPoints > 1 && coarsePointer;
}
