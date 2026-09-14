/**
 * L0: units and the one place millimetres exist.
 *
 * Every other layer works in seconds and millivolts. Only the renderer
 * (via this module) converts to millimetres. The transform is affine and
 * therefore exactly invertible, which is what makes on-screen calipers a
 * measurement rather than an estimate.
 */

/** Internal sampling rate in Hz. At 25 mm/s this puts one sample every 0.025 mm. */
export const DEFAULT_FS = 1000;

export type PaperSpeed = 25 | 50; // mm per second
export type Gain = 5 | 10 | 20; // mm per millivolt

export interface Calibration {
  paperSpeed: PaperSpeed;
  gain: Gain;
}

export const STANDARD_CALIBRATION: Calibration = { paperSpeed: 25, gain: 10 };

/** Seconds to millimetres along x. */
export function secondsToMm(t: number, cal: Calibration = STANDARD_CALIBRATION): number {
  return t * cal.paperSpeed;
}

/** Millivolts to millimetres along y. Positive is up on paper, negative on the SVG y axis. */
export function millivoltsToMm(v: number, cal: Calibration = STANDARD_CALIBRATION): number {
  return v * cal.gain;
}

export function mmToSeconds(x: number, cal: Calibration = STANDARD_CALIBRATION): number {
  return x / cal.paperSpeed;
}

export function mmToMillivolts(y: number, cal: Calibration = STANDARD_CALIBRATION): number {
  return y / cal.gain;
}

/** Standard paper grid. */
export const GRID_MINOR_MM = 1;
export const GRID_MAJOR_MM = 5;

/** Convert a time in seconds to a sample index (nearest). */
export function toIndex(t: number, fs: number): number {
  return Math.round(t * fs);
}

export function toTime(i: number, fs: number): number {
  return i / fs;
}
