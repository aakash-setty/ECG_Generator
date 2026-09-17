/**
 * Measurements used by the toxicology checklist. Reads samples plus the
 * strip's beat labels (to separate sinus beats from PVCs); it does not read
 * the generator's morphology parameters.
 */
import { delineate, type BeatMeasurement } from './delineate.js';
import type { Strip } from '../core/sequencer.js';
import { qtcBazett } from '../core/landmarks.js';

export interface ToxMeasures {
  /** Ventricular rate from every detected QRS, including PVCs. */
  hr: number | null;
  /** Rate of conducted (non-PVC) beats from their shortest repeated cycle. With 2:1 block this is half the atrial rate, since the delineator only sees QRS complexes. */
  sinusHr: number | null;
  pr: number | null;
  qrs: number | null;
  qt: number | null;
  qtc: number | null;
  qtcFridericia: number | null;
  /** Largest positive deflection inside the aVR QRS, mV (the terminal R' when present). */
  avrRPrime: number | null;
  avrRS: number | null;
  /** Depth of the ST nadir (most negative point between the measured QRS end and the T peak) in V5, mV; positive = depression. */
  stScoop: number | null;
  /** Largest deflection in the 200 ms after the measured T offset in V5, mV. */
  uAmp: number | null;
  pvcCount: number;
  sinusBeatsMeasured: number;
  /** T amplitude in V3 (signed, mV), from the delineator. */
  tAmpV3: number | null;
  /** P amplitude in II (absolute, mV); 0 when no P is detected on a conducted beat. */
  pAmpII: number | null;
  /** Non-conducted P waves in the strip (from labels). */
  blockedPCount: number;
  /** Escape beats in the strip (from labels). */
  escapeCount: number;
  /** J point to T peak in II, s. */
  jtp: number | null;
  /** T peak to T end in II, s. */
  tpe: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);

/** Match delineated beats to ground-truth sinus beats by QRS onset (within 80 ms). */
function sinusBeats(strip: Strip, beats: BeatMeasurement[]): BeatMeasurement[] {
  const sinusOn = strip.beats.filter((b) => b.label !== 'pvc' && b.label !== 'blocked-p').map((b) => b.landmarks.qrsOn);
  return beats.filter((m) => sinusOn.some((t) => Math.abs(t - m.qrsOn) < 0.08));
}

export function toxMeasures(strip: Strip): ToxMeasures {
  const fs = strip.fs;
  const mII = delineate(strip.leads.II, fs);
  const sinusII = sinusBeats(strip, mII.beats);
  const rr = mII.rr;
  const meanRr = mean(rr);
  const qt = mean(sinusII.map((b) => b.qt).filter((x): x is number => x !== null));
  const qrs = mean(sinusII.map((b) => b.qrsDuration));
  const pr = mean(sinusII.map((b) => b.pr).filter((x): x is number => x !== null));

  const mAvr = delineate(strip.leads.aVR, fs);
  const sinusAvr = sinusBeats(strip, mAvr.beats);
  const avrR = mean(sinusAvr.map((b) => b.rAmplitude));
  const avrS = mean(sinusAvr.map((b) => Math.abs(b.sAmplitude)));

  const mV5 = delineate(strip.leads.V5, fs);
  const sinusV5 = sinusBeats(strip, mV5.beats);
  const scoops: number[] = [];
  const us: number[] = [];
  for (const b of sinusV5) {
    if (b.tPeak !== null) {
      // Nadir between the QRS peak region and the T peak. The delineator's J point drifts late when the
      // ST segment falls steeply right after J (a known weakness of slope-based QRS-end detection), so
      // the search starts a fixed 40 ms after the QRS peak rather than at the measured J.
      const i0 = Math.round(b.j * fs);
      const i1 = Math.round(b.tPeak * fs);
      let nadir = Infinity;
      for (let i = i0; i <= i1; i++) nadir = Math.min(nadir, (strip.leads.V5[i] ?? 0) - mV5.baseline);
      if (Number.isFinite(nadir)) scoops.push(-nadir);
    }
    if (b.tOff !== null) {
      // Only meaningful when there is room before the next beat's P wave; otherwise the "U" would be a P.
      const nextOn = mV5.beats.find((x) => x.qrsOn > b.qrsOn + 0.2)?.qrsOn ?? Infinity;
      if (nextOn - b.tOff < 0.28) continue;
      const i0 = Math.round(b.tOff * fs) + Math.round(0.02 * fs);
      const i1 = Math.min(strip.leads.V5.length - 1, i0 + Math.round(0.2 * fs));
      let best = 0;
      for (let i = i0; i <= i1; i++) best = Math.max(best, Math.abs((strip.leads.V5[i] ?? 0) - mV5.baseline));
      us.push(best);
    }
  }

  // V3 T amplitude with QRS timing taken from lead II (as a multi-lead machine would): the
  // largest excursion from the V3 baseline between J(II) + 40 ms and the next QRS onset. A giant
  // peaked T in V3 can out-slope V3's own small QRS, so V3's own detection is not trusted here.
  const v3 = strip.leads.V3;
  const bV3 = (() => {
    const counts = new Map<number, number>();
    for (let i = 0; i < v3.length; i++) counts.set(Math.round((v3[i] ?? 0) / 0.005), (counts.get(Math.round((v3[i] ?? 0) / 0.005)) ?? 0) + 1);
    let bestK = 0;
    let bestC = -1;
    for (const [k, c] of counts) if (c > bestC) { bestC = c; bestK = k; }
    return bestK * 0.005;
  })();
  const tV3s: number[] = [];
  for (let k = 0; k < sinusII.length; k++) {
    const b = sinusII[k]!;
    const next = mII.beats.find((m) => m.qrsOn > b.j);
    const i0 = Math.round((b.j + 0.04) * fs);
    const i1 = Math.min(v3.length - 1, Math.round(((next ? next.qrsOn - 0.15 : b.j + 0.5)) * fs), Math.round((b.j + 0.5) * fs));
    let best = 0;
    for (let i = i0; i <= i1; i++) {
      const a = (v3[i] ?? 0) - bV3;
      if (Math.abs(a) > Math.abs(best)) best = a;
    }
    if (i1 > i0 && Math.abs(best) >= 0.03) tV3s.push(best);
  }
  const tAmpV3 = mean(tV3s);
  const pAmpII = sinusII.length ? mean(sinusII.map((b) => (b.pAmplitude === null ? 0 : Math.abs(b.pAmplitude)))) : null;
  const jtp = mean(sinusII.filter((b) => b.tPeak !== null).map((b) => (b.tPeak as number) - b.j));
  const tpe = mean(sinusII.filter((b) => b.tPeak !== null && b.tOff !== null).map((b) => (b.tOff as number) - (b.tPeak as number)));

  const sinusRr: number[] = [];
  for (let k = 1; k < sinusII.length; k++) sinusRr.push(sinusII[k]!.qrsOn - sinusII[k - 1]!.qrsOn);
  // With a compensatory pause the sinus-to-sinus interval across a PVC is 2 RR; take the smallest
  // repeated interval as the underlying cycle length (median of the lower half).
  const sortedSinus = [...sinusRr].sort((a, b) => a - b);
  const lowerHalf = sortedSinus.slice(0, Math.max(1, Math.ceil(sortedSinus.length / 2)));
  const sinusCycle = lowerHalf.length ? lowerHalf[Math.floor(lowerHalf.length / 2)]! : null;
  return {
    hr: meanRr ? 60 / meanRr : null,
    sinusHr: sinusCycle ? 60 / sinusCycle : null,
    pr,
    qrs,
    qt,
    // Rate correction uses the underlying sinus cycle, not the mean over PVC couplings and pauses.
    qtc: sinusCycle && qt ? qtcBazett(qt, sinusCycle) : null,
    qtcFridericia: sinusCycle && qt ? qt / Math.cbrt(sinusCycle) : null,
    avrRPrime: avrR,
    avrRS: avrR !== null && avrS ? avrR / avrS : null,
    stScoop: mean(scoops),
    uAmp: mean(us),
    pvcCount: strip.beats.filter((b) => b.label === 'pvc').length,
    sinusBeatsMeasured: sinusII.length,
    tAmpV3,
    pAmpII,
    blockedPCount: strip.beats.filter((b) => b.label === 'blocked-p').length,
    escapeCount: strip.beats.filter((b) => b.label === 'escape').length,
    jtp,
    tpe,
  };
}
