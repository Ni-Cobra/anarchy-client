/**
 * Platform / user-agent helpers. Currently a single mobile-UA sniff used
 * by the lobby (`lobby.ts`) to short-circuit into a "Mobile not supported"
 * page before any desktop-only controls render — touch drag/drop and the
 * hotbar shortcuts weren't designed for phones / tablets. UA spoofing
 * isn't a concern: anyone setting a desktop UA on purpose is consenting
 * to the desktop UI.
 */

const MOBILE_UA = /iPhone|iPad|iPod|Android|Mobile|BlackBerry|Opera Mini/i;

export function isMobileUserAgent(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  return MOBILE_UA.test(ua);
}
