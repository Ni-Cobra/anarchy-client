import { describe, expect, it } from "vitest";

import { isMobile, isMobileUserAgent } from "./platform.js";

// Real-world UA strings pulled from the corresponding browsers'
// navigator.userAgent so the regex isn't tested only against a shape
// the test author imagined.
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MACOS_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15";
// iPadOS 13+ defaults to a Mac-like desktop UA — string is
// indistinguishable from a real Mac. Touch capability is the only signal
// that separates them.
const IPAD_DESKTOP_UA = MACOS_SAFARI;

describe("isMobileUserAgent", () => {
  it("matches iPhone Safari", () => {
    expect(isMobileUserAgent(IPHONE_SAFARI)).toBe(true);
  });

  it("matches Android Chrome", () => {
    expect(isMobileUserAgent(ANDROID_CHROME)).toBe(true);
  });

  it("matches iPad Safari", () => {
    expect(isMobileUserAgent(IPAD_SAFARI)).toBe(true);
  });

  it("does not match Windows Chrome", () => {
    expect(isMobileUserAgent(WINDOWS_CHROME)).toBe(false);
  });

  it("does not match macOS Safari", () => {
    expect(isMobileUserAgent(MACOS_SAFARI)).toBe(false);
  });
});

describe("isMobile", () => {
  it("matches iPhone Safari via UA", () => {
    expect(
      isMobile({ ua: IPHONE_SAFARI, maxTouchPoints: 5, coarsePointer: true }),
    ).toBe(true);
  });

  it("matches iPad with default desktop UA via touch fallback", () => {
    expect(
      isMobile({
        ua: IPAD_DESKTOP_UA,
        maxTouchPoints: 5,
        coarsePointer: true,
      }),
    ).toBe(true);
  });

  it("does not match standard desktop", () => {
    expect(
      isMobile({
        ua: WINDOWS_CHROME,
        maxTouchPoints: 0,
        coarsePointer: false,
      }),
    ).toBe(false);
  });

  it("does not match a Surface-style touchscreen laptop with a fine pointer", () => {
    expect(
      isMobile({
        ua: WINDOWS_CHROME,
        maxTouchPoints: 10,
        coarsePointer: false,
      }),
    ).toBe(false);
  });

  it("does not match a desktop with a coarse pointer but no touch", () => {
    expect(
      isMobile({
        ua: MACOS_SAFARI,
        maxTouchPoints: 0,
        coarsePointer: true,
      }),
    ).toBe(false);
  });

  it("does not match a desktop with a single-point touch sensor (e.g. trackpad reporting maxTouchPoints=1)", () => {
    expect(
      isMobile({
        ua: MACOS_SAFARI,
        maxTouchPoints: 1,
        coarsePointer: true,
      }),
    ).toBe(false);
  });
});
