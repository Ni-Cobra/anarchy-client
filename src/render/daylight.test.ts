import { describe, it, expect } from "vitest";

import { DAY_LENGTH_SECONDS } from "../config.js";
import {
  DAY_AMBIENT,
  MOON_PEAK_INTENSITY,
  NIGHT_AMBIENT,
  NIGHT_FLOOR_INTENSITY,
  SUN_PEAK_INTENSITY,
  dayPhaseFromSeconds,
  sampleDaylight,
} from "./daylight.js";

const PHASE_NOON = 0.25;
const PHASE_SUNSET = 0.5;
const PHASE_MIDNIGHT = 0.75;

describe("dayPhaseFromSeconds", () => {
  it("wraps positive seconds modulo DAY_LENGTH_SECONDS", () => {
    expect(dayPhaseFromSeconds(0)).toBe(0);
    expect(dayPhaseFromSeconds(DAY_LENGTH_SECONDS)).toBe(0);
    expect(dayPhaseFromSeconds(DAY_LENGTH_SECONDS / 4)).toBeCloseTo(PHASE_NOON);
    expect(dayPhaseFromSeconds(DAY_LENGTH_SECONDS / 2)).toBeCloseTo(PHASE_SUNSET);
    expect(dayPhaseFromSeconds(DAY_LENGTH_SECONDS * 3)).toBeCloseTo(0);
  });

  it("normalises negative seconds back into [0, 1)", () => {
    expect(dayPhaseFromSeconds(-DAY_LENGTH_SECONDS / 4)).toBeCloseTo(PHASE_MIDNIGHT);
    expect(dayPhaseFromSeconds(-DAY_LENGTH_SECONDS)).toBe(0);
  });

  it("collapses non-finite inputs to 0 (sunrise)", () => {
    expect(dayPhaseFromSeconds(Number.NaN)).toBe(0);
    expect(dayPhaseFromSeconds(Infinity)).toBe(0);
    expect(dayPhaseFromSeconds(-Infinity)).toBe(0);
  });
});

describe("sampleDaylight angle / intensity", () => {
  // Half-diagonal arc (task 440): sunrise / sunset still lie on the
  // horizon (y == 0) because the around-+x rotation fixes the +x axis,
  // but the 45° azimuth puts them on the (+x, -z) and (-x, +z) diagonals
  // rather than pure ±x. Noon / midnight inherit the small tilt off the
  // y axis (cos(22°) ≈ 0.927 vs 1.0 previously).
  const COS_AZ_45 = Math.SQRT1_2;
  const NOON_TILT_RAD = (22 * Math.PI) / 180;
  const COS_TILT = Math.cos(NOON_TILT_RAD);

  it("at sunrise the sun sits on the horizon along the half-diagonal", () => {
    const s = sampleDaylight(0);
    expect(s.phase).toBe(0);
    expect(s.sunDir.x).toBeCloseTo(COS_AZ_45);
    expect(s.sunDir.y).toBeCloseTo(0);
    expect(s.sunDir.z).toBeCloseTo(-COS_AZ_45);
  });

  it("at noon the sun is near zenith with a slight off-axis tilt at full intensity", () => {
    const s = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_NOON);
    expect(s.sunDir.y).toBeCloseTo(COS_TILT);
    // x and z share the tilt equally (azimuth = 45°) and are both
    // positive: noon sits on the +x/+z diagonal in scene space.
    expect(s.sunDir.x).toBeGreaterThan(0);
    expect(s.sunDir.z).toBeCloseTo(s.sunDir.x);
    // Intensity tracks `Math.sin(theta)` (the arc-zenith parameter),
    // not the geometric y, so noon still maxes the envelope.
    expect(s.sunIntensity).toBeCloseTo(SUN_PEAK_INTENSITY);
    expect(s.ambientIntensity).toBeCloseTo(DAY_AMBIENT);
  });

  it("at sunset the sun returns to the horizon on the opposite diagonal", () => {
    const s = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_SUNSET);
    expect(s.sunDir.x).toBeCloseTo(-COS_AZ_45);
    expect(s.sunDir.y).toBeCloseTo(0);
    expect(s.sunDir.z).toBeCloseTo(COS_AZ_45);
  });

  it("at midnight the sun is below the world and intensity floors", () => {
    const s = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_MIDNIGHT);
    expect(s.sunDir.y).toBeCloseTo(-COS_TILT);
    expect(s.sunIntensity).toBeCloseTo(NIGHT_FLOOR_INTENSITY);
    expect(s.ambientIntensity).toBeCloseTo(NIGHT_AMBIENT);
  });

  it("sunDir is unit length across the arc", () => {
    for (const phase of [0, 0.1, PHASE_NOON, 0.35, PHASE_SUNSET, 0.6, PHASE_MIDNIGHT, 0.9]) {
      const s = sampleDaylight(DAY_LENGTH_SECONDS * phase);
      const len = Math.hypot(s.sunDir.x, s.sunDir.y, s.sunDir.z);
      expect(len).toBeCloseTo(1);
    }
  });

  it("nightFactor is 0 from sunrise through sunset and 1 at midnight (task 350)", () => {
    expect(sampleDaylight(0).nightFactor).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_NOON).nightFactor).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_SUNSET).nightFactor).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_MIDNIGHT).nightFactor).toBeCloseTo(1);
    // Halfway from sunset to midnight, sun has dipped below horizon by sin(π/4).
    const between = sampleDaylight(
      DAY_LENGTH_SECONDS * (PHASE_SUNSET + (PHASE_MIDNIGHT - PHASE_SUNSET) / 2),
    );
    expect(between.nightFactor).toBeGreaterThan(0);
    expect(between.nightFactor).toBeLessThan(1);
  });

  it("moonDir is the antipode of sunDir across the arc (task 070)", () => {
    for (const phase of [0, 0.1, PHASE_NOON, 0.35, PHASE_SUNSET, 0.6, PHASE_MIDNIGHT, 0.9]) {
      const s = sampleDaylight(DAY_LENGTH_SECONDS * phase);
      expect(s.moonDir.x).toBeCloseTo(-s.sunDir.x);
      expect(s.moonDir.y).toBeCloseTo(-s.sunDir.y);
      expect(s.moonDir.z).toBeCloseTo(-s.sunDir.z);
    }
  });

  it("moon is above the horizon at midnight and below at noon (task 070)", () => {
    const noon = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_NOON);
    const midnight = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_MIDNIGHT);
    expect(noon.moonDir.y).toBeCloseTo(-COS_TILT);
    expect(midnight.moonDir.y).toBeCloseTo(COS_TILT);
  });

  it("moonIntensity is 0 from sunrise through sunset and peaks at midnight (task 070)", () => {
    expect(sampleDaylight(0).moonIntensity).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_NOON).moonIntensity).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_SUNSET).moonIntensity).toBeCloseTo(0);
    expect(sampleDaylight(DAY_LENGTH_SECONDS * PHASE_MIDNIGHT).moonIntensity).toBeCloseTo(
      MOON_PEAK_INTENSITY,
    );
    const between = sampleDaylight(
      DAY_LENGTH_SECONDS * (PHASE_SUNSET + (PHASE_MIDNIGHT - PHASE_SUNSET) / 2),
    );
    expect(between.moonIntensity).toBeGreaterThan(0);
    expect(between.moonIntensity).toBeLessThan(MOON_PEAK_INTENSITY);
  });

  it("intensity is monotonic from sunrise up to noon", () => {
    const a = sampleDaylight(DAY_LENGTH_SECONDS * 0.0);
    const b = sampleDaylight(DAY_LENGTH_SECONDS * 0.1);
    const c = sampleDaylight(DAY_LENGTH_SECONDS * 0.2);
    const d = sampleDaylight(DAY_LENGTH_SECONDS * PHASE_NOON);
    expect(a.sunIntensity).toBeLessThan(b.sunIntensity);
    expect(b.sunIntensity).toBeLessThan(c.sunIntensity);
    expect(c.sunIntensity).toBeLessThan(d.sunIntensity);
  });
});
