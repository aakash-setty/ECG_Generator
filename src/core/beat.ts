/**
 * L3: one beat in one lead.
 *
 * Takes a landmark timeline and a per-lead morphology, returns the
 * deflections that make up that beat. Overlap between Q, R and S is
 * arranged so that each wave's peak amplitude is exact: at the R peak the
 * Q bump has already reached its off and the S bump has not yet started.
 */

import { bump, plateau, type Deflection } from './deflections.js';
import type { BeatLandmarks } from './landmarks.js';

export interface LeadMorphology {
  /** P amplitude, mV (0 disables). */
  p: number;
  /** Q amplitude, mV, usually <= 0 (0 disables). */
  q: number;
  /** R amplitude, mV (0 disables). */
  r: number;
  /** S amplitude, mV, usually <= 0 (0 disables). */
  s: number;
  /** T peak amplitude measured from the TP baseline, mV. */
  t: number;
  /** Terminal R' amplitude, mV (RBBB-like or sodium-channel-blockade terminal deflection). 0 disables. */
  rPrime?: number;
  /** U wave amplitude, mV. Rendered only when the beat's intervals define a U window. */
  u?: number;
  /**
   * ST scoop: a bump centred in the ST segment, mV. Negative gives the sagging
   * "reverse tick" of digoxin effect; positive gives a hump. Added on top of the
   * stJ/stT plateau. 0 disables.
   */
  stScoop?: number;
  /** T notch: a small second hump on the T wave, mV. Position given by tNotchFraction (default 0.72 of the T window). */
  tNotch?: number;
  tNotchFraction?: number;
  /** ST level at the J point, mV relative to TP baseline. */
  stJ?: number;
  /** ST level at T onset, mV relative to TP baseline. Defaults to stJ. */
  stT?: number;
  /** ST body shape exponent. See plateau(). Default 1. */
  stShape?: number;
  /** Sharpness for P, QRS waves and T. See bump(). */
  pSharpness?: number;
  qrsSharpness?: number;
  /**
   * Sharpness of the LAST QRS deflection only (R' if present, else S, else R).
   * Defaults to qrsSharpness. Values above 1 make the terminal deflection a
   * broad dome with a slurred return to J, as in conduction delay.
   */
  terminalSharpness?: number;
  tSharpness?: number;
  /**
   * Per-lead override of where the T peak sits within [T onset, T offset], 0 to 1.
   * T onset and offset stay beat-level landmarks (they define the QT); only the
   * peak position moves. Used by convex/dome ST morphologies.
   */
  tPeakFraction?: number;
}

/** Returns the deflections for one beat in one lead. Pass pOnly for a non-conducted P wave. */
export function beatDeflections(lm: BeatLandmarks, m: LeadMorphology, pOnly = false): Deflection[] {
  const out: Deflection[] = [];
  const pS = m.pSharpness ?? 1.0;
  const qrsS = m.qrsSharpness ?? 0.8;
  const termS = m.terminalSharpness ?? qrsS;
  const tS = m.tSharpness ?? 1.0;

  if (lm.pOn !== null && lm.pPeak !== null && lm.pOff !== null && m.p !== 0) {
    out.push(bump({ on: lm.pOn, peak: lm.pPeak, off: lm.pOff, amplitude: m.p, sharpness: pS }));
  }
  if (pOnly) return out;

  const hasQ = m.q !== 0;
  const hasR = m.r !== 0;
  const hasS = m.s !== 0;
  const hasRPrime = (m.rPrime ?? 0) !== 0;
  const last: 'q' | 'r' | 's' | 'rp' | null = hasRPrime ? 'rp' : hasS ? 's' : hasR ? 'r' : hasQ ? 'q' : null;

  if (hasQ) {
    out.push(bump({ on: lm.qrsOn, peak: lm.qPeak, off: hasR ? lm.rPeak : hasS ? lm.sPeak : lm.j, amplitude: m.q, sharpness: last === 'q' ? termS : qrsS }));
  }
  if (hasR) {
    out.push(
      bump({
        on: hasQ ? lm.qPeak : lm.qrsOn,
        peak: lm.rPeak,
        off: hasS ? lm.sPeak : lm.j,
        amplitude: m.r,
        sharpness: last === 'r' ? termS : qrsS,
      }),
    );
  }
  if (hasS) {
    out.push(bump({ on: hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn, peak: lm.sPeak, off: hasRPrime ? lm.rPrimePeak : lm.j, amplitude: m.s, sharpness: last === 's' ? termS : qrsS }));
  }
  if (hasRPrime) {
    out.push(bump({ on: hasS ? lm.sPeak : hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn, peak: lm.rPrimePeak, off: lm.j, amplitude: m.rPrime as number, sharpness: termS }));
  }

  // ST segment. The rise from 0 to the J-point level happens during the terminal
  // QRS (from the last QRS peak to J), so it merges visually with the S upstroke.
  const stJ = m.stJ ?? 0;
  const stT = m.stT ?? stJ;
  let st: Deflection | null = null;
  const lastPeak = hasRPrime ? lm.rPrimePeak : hasS ? lm.sPeak : hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn;
  if (stJ !== 0 || stT !== 0) {
    st = plateau({
      on: lastPeak,
      riseEnd: lm.j,
      fallStart: lm.tOn,
      off: lm.tOff,
      levelA: stJ,
      levelB: stT,
      shape: m.stShape ?? 1,
    });
    out.push(st);
  }

  // ST scoop: a bump confined to [J, T onset], so the J level and the T-onset level are untouched.
  if ((m.stScoop ?? 0) !== 0 && lm.tOn > lm.j) {
    out.push(bump({ on: lm.j, peak: lm.j + 0.5 * (lm.tOn - lm.j), off: lm.tOn, amplitude: m.stScoop as number, sharpness: 1 }));
  }

  // T wave. Its bump amplitude is reduced by whatever the ST plateau contributes
  // at the T peak, so the T peak measured from baseline equals m.t exactly.
  if (m.t !== 0) {
    const tPeak = m.tPeakFraction === undefined ? lm.tPeak : lm.tOn + Math.min(0.95, Math.max(0.05, m.tPeakFraction)) * (lm.tOff - lm.tOn);
    const stAtPeak = st ? st.at(tPeak) : 0;
    out.push(bump({ on: lm.tOn, peak: tPeak, off: lm.tOff, amplitude: m.t - stAtPeak, sharpness: tS }));
  }
  // T notch: a narrow second hump inside the T window (LQT2-like notched T).
  if ((m.tNotch ?? 0) !== 0) {
    const f = Math.min(0.95, Math.max(0.05, m.tNotchFraction ?? 0.72));
    const c = lm.tOn + f * (lm.tOff - lm.tOn);
    const half = 0.12 * (lm.tOff - lm.tOn);
    out.push(bump({ on: c - half, peak: c, off: Math.min(lm.tOff, c + half), amplitude: m.tNotch as number, sharpness: 1 }));
  }
  // U wave.
  if ((m.u ?? 0) !== 0 && lm.uOn !== null && lm.uPeak !== null && lm.uOff !== null) {
    out.push(bump({ on: lm.uOn, peak: lm.uPeak, off: lm.uOff, amplitude: m.u as number, sharpness: 1 }));
  }

  return out;
}
