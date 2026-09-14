/**
 * L6 (partial): acquisition realism added after synthesis.
 *
 * Three additive components, each with an explicit amplitude so a strip can
 * be made noisier without touching the signal model:
 *   wander  baseline wander from respiration, a slow sinusoid near 0.25 Hz
 *           plus a slower drift, same phase in every lead (scaled per lead)
 *   mains   50 or 60 Hz interference, small and constant
 *   emg     muscle artifact, band-limited white noise
 *
 * Applied to the 8 authored channels; the derived limb leads are recomputed
 * so the Einthoven and Goldberger identities still hold exactly. The strip's
 * TP baseline is then no longer zero by construction, which is the point.
 * No filtering stage is modelled yet (diagnostic vs monitor bandpass).
 */

import { deriveLimbLeads, INDEPENDENT_LEADS, type IndependentLead } from './leads.js';
import { gaussian, makeRng, type Strip } from './sequencer.js';

export interface NoiseOptions {
  /** Baseline wander amplitude, mV. 0 disables. Typical 0.05 to 0.15. */
  wander?: number;
  /** Mains amplitude, mV. 0 disables. Typical 0.01 to 0.03. */
  mains?: number;
  /** Mains frequency, Hz. Default 50. */
  mainsHz?: 50 | 60;
  /** Muscle artifact amplitude (standard deviation), mV. 0 disables. Typical 0.01 to 0.04. */
  emg?: number;
  seed?: number;
}

export const NOISE_PRESETS: Record<'none' | 'light' | 'moderate' | 'heavy', NoiseOptions> = {
  none: {},
  light: { wander: 0.04, mains: 0.005, emg: 0.006 },
  moderate: { wander: 0.1, mains: 0.015, emg: 0.015 },
  heavy: { wander: 0.2, mains: 0.03, emg: 0.04 },
};

/** Per-lead scaling of wander and EMG: limb leads pick up more motion and muscle than precordials. */
const LEAD_SCALE: Record<IndependentLead, number> = { I: 1.0, II: 0.9, V1: 0.6, V2: 0.6, V3: 0.6, V4: 0.6, V5: 0.7, V6: 0.7 };

/** Add noise in place. Returns the same strip. */
export function addNoise(strip: Strip, opts: NoiseOptions): Strip {
  const wander = opts.wander ?? 0;
  const mains = opts.mains ?? 0;
  const emg = opts.emg ?? 0;
  if (wander === 0 && mains === 0 && emg === 0) return strip;
  const rng = makeRng(opts.seed ?? 11);
  const fs = strip.fs;
  const n = strip.leads.I.length;
  const mainsHz = opts.mainsHz ?? 50;
  const phase1 = rng() * 6.28;
  const phase2 = rng() * 6.28;
  const f1 = 0.22 + 0.08 * rng();
  // Band-limited EMG: first-order low-pass of white noise, cut-off about 60 Hz, then rescaled to the requested sd.
  const alpha = 1 - Math.exp((-2 * Math.PI * 60) / fs);
  for (const l of INDEPENDENT_LEADS) {
    const buf = strip.leads[l];
    const scale = LEAD_SCALE[l];
    let lp = 0;
    const emgRaw = new Float64Array(n);
    let ss = 0;
    for (let i = 0; i < n; i++) {
      lp += alpha * (gaussian(rng) - lp);
      emgRaw[i] = lp;
      ss += lp * lp;
    }
    const emgGain = emg > 0 && ss > 0 ? emg / Math.sqrt(ss / n) : 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const w = wander * scale * (0.7 * Math.sin(2 * Math.PI * f1 * t + phase1) + 0.3 * Math.sin(2 * Math.PI * 0.05 * t + phase2));
      const m = mains * Math.sin(2 * Math.PI * mainsHz * t);
      buf[i] = (buf[i] ?? 0) + w + m + emgGain * scale * (emgRaw[i] ?? 0);
    }
  }
  const d = deriveLimbLeads(strip.leads.I, strip.leads.II);
  strip.leads.III = d.III;
  strip.leads.aVR = d.aVR;
  strip.leads.aVL = d.aVL;
  strip.leads.aVF = d.aVF;
  return strip;
}
