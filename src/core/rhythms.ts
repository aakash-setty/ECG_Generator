/**
 * Non-sinus rhythm generators on the template sequencer.
 *
 * SVT (AVNRT-like), atrial fibrillation with fibrillatory baseline, and
 * atrial flutter with a sawtooth baseline. Each returns a beat list plus, for
 * AF and flutter, a continuous atrial layer that renderStrip adds under the
 * beats. These are scripted approximations of the surface appearance, not
 * models of the re-entrant circuits.
 */

import type { LeadMorphology } from './beat.js';
import { NORMAL_INTERVALS, qtFromBazett, type BeatIntervals } from './landmarks.js';
import { NORMAL_MORPHOLOGY, cloneMorphology, type IndependentLead, type IndependentSet } from './leads.js';
import { gaussian, makeRng, partitionQt, PVC_MORPHOLOGY, type AtrialActivity, type BeatEvent, type PacingSpike, type QtPartition } from './sequencer.js';

function meanOf(xs: number[], fallback: number): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
}

export interface RhythmCommon {
  duration: number;
  qtc?: number;
  intervals?: Partial<BeatIntervals>;
  morphology?: IndependentSet<LeadMorphology>;
  seed?: number;
  qtPartition?: QtPartition;
}

/* ---------------------------------------------------------------------- */
/* SVT (AVNRT-like)                                                        */
/* ---------------------------------------------------------------------- */

export interface SvtOptions extends RhythmCommon {
  /** Ventricular rate, bpm. Typical AVNRT 140 to 220. */
  rate: number;
  /**
   * Retrograde P visible as a pseudo-r' in V1 and pseudo-S in the inferior leads
   * (typical AVNRT). Amplitude in mV; 0 hides it. Default 0.06.
   */
  retrogradeP?: number;
  /** Rate-related ST depression in lateral leads, mV (positive number = depression). Default 0.08. */
  stDepression?: number;
}

/**
 * Regular narrow-complex tachycardia with no visible sinus P. The retrograde P
 * is drawn as a terminal deflection (rPrime) so it sits at the end of the QRS
 * where a simultaneous atrial activation would appear in typical AVNRT.
 */
export function svtRhythm(opts: SvtOptions): { beats: BeatEvent[]; atrial: null } {
  const rr = 60 / opts.rate;
  const qtc = opts.qtc ?? 0.40;
  const base: BeatIntervals = { ...NORMAL_INTERVALS, ...(opts.intervals ?? {}) };
  const rp = opts.retrogradeP ?? 0.06;
  const dep = opts.stDepression ?? 0.08;
  const morph = cloneMorphology(opts.morphology ?? NORMAL_MORPHOLOGY);
  morph.V1 = { ...morph.V1, rPrime: rp };
  morph.II = { ...morph.II, rPrime: -rp, stJ: -dep * 0.6, stT: -dep, stShape: 1 };
  morph.I = { ...morph.I, stJ: -dep * 0.3, stT: -dep * 0.5 };
  for (const l of ['V4', 'V5', 'V6'] as const) morph[l] = { ...morph[l], stJ: -dep * 0.6, stT: -dep, stShape: 1 };
  const beats: BeatEvent[] = [];
  const qt = qtFromBazett(qtc, rr);
  let t = 0.2;
  while (t < opts.duration) {
    const iv: BeatIntervals = { ...base, hasP: false, qt, rPrimePeakFraction: 0.9 };
    if (opts.qtPartition) {
      const part = partitionQt(qt, base.qrs, rr, opts.qtPartition);
      iv.st = part.st;
      iv.tPeakFraction = part.tPeakFraction;
    } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
    beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: 'svt' });
    t += rr;
  }
  return { beats, atrial: null };
}

/* ---------------------------------------------------------------------- */
/* Atrial fibrillation                                                     */
/* ---------------------------------------------------------------------- */

export interface AfOptions extends RhythmCommon {
  /** Mean ventricular rate, bpm. */
  ventricularRate: number;
  /** Log-normal spread of RR (sigma of ln RR). 0.25 is typical AF; 0.05 would look almost regular. Default 0.25. */
  irregularity?: number;
  /** Fibrillatory wave amplitude in V1, mV. 0.05 fine, 0.15 coarse. Default 0.06. */
  fWaveAmplitude?: number;
  /** Dominant fibrillatory frequency, Hz (350 to 600 per minute is 6 to 10 Hz). Default 7. */
  fWaveFrequency?: number;
}

/** Relative f-wave amplitude by authored channel. V1 is the reference. III, aVR, aVL, aVF follow from I and II. */
const F_WAVE_WEIGHTS: Record<IndependentLead, number> = { I: 0.25, II: 0.6, V1: 1.0, V2: 0.7, V3: 0.45, V4: 0.3, V5: 0.25, V6: 0.25 };

/**
 * Irregularly irregular RR from a log-normal distribution, no P waves, and a
 * fibrillatory baseline made of three incommensurate sinusoids with slow
 * amplitude modulation. Refractoriness is imposed as a floor on RR.
 */
export function atrialFibrillation(opts: AfOptions): { beats: BeatEvent[]; atrial: AtrialActivity } {
  const rrMean = 60 / opts.ventricularRate;
  const sigma = opts.irregularity ?? 0.25;
  const qtc = opts.qtc ?? 0.40;
  const base: BeatIntervals = { ...NORMAL_INTERVALS, ...(opts.intervals ?? {}) };
  const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
  const rng = makeRng(opts.seed ?? 1);
  const beats: BeatEvent[] = [];
  const history: number[] = [];
  // Log-normal with the requested mean: E[exp(mu + sigma z)] = exp(mu + sigma^2/2).
  const mu = Math.log(rrMean) - (sigma * sigma) / 2;
  let t = 0.3;
  while (t < opts.duration) {
    const rrForQt = meanOf(history.slice(-8), rrMean);
    const qt = qtFromBazett(qtc, rrForQt);
    const iv: BeatIntervals = { ...base, hasP: false, qt };
    if (opts.qtPartition) {
      const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
      iv.st = part.st;
      iv.tPeakFraction = part.tPeakFraction;
    } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
    beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: 'af' });
    let rr = Math.exp(mu + sigma * gaussian(rng));
    rr = Math.max(0.3, Math.min(3 * rrMean, rr));
    history.push(rr);
    t += rr;
  }

  const A = opts.fWaveAmplitude ?? 0.06;
  const f = opts.fWaveFrequency ?? 7;
  const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const atrial: AtrialActivity = {
    kind: 'fibrillation',
    at(time: number, lead: IndependentLead): number {
      const mod = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.37 * time + (phases[3] ?? 0));
      const v =
        0.55 * Math.sin(2 * Math.PI * f * time + (phases[0] ?? 0)) +
        0.3 * Math.sin(2 * Math.PI * f * 1.31 * time + (phases[1] ?? 0)) +
        0.15 * Math.sin(2 * Math.PI * f * 0.73 * time + (phases[2] ?? 0));
      return A * mod * v * F_WAVE_WEIGHTS[lead];
    },
  };
  return { beats, atrial };
}

/* ---------------------------------------------------------------------- */
/* Atrial flutter                                                          */
/* ---------------------------------------------------------------------- */

export interface FlutterOptions extends RhythmCommon {
  /** Flutter (atrial) rate per minute. Typical 250 to 350; 300 is the textbook value. Default 300. */
  flutterRate?: number;
  /** AV conduction ratio: 2 (2:1, ~150 bpm), 3, 4 (4:1, ~75 bpm), or 'variable'. Default 2. */
  conduction?: 2 | 3 | 4 | 'variable';
  /** Flutter-wave amplitude in lead II, mV. Default 0.15. */
  amplitude?: number;
}

/**
 * Sawtooth flutter waves by authored channel for typical (counter-clockwise
 * cavotricuspid) flutter: negative sawtooth in II (so III and aVF follow),
 * near-flat in I (so aVL and aVR come out positive), positive waves in V1.
 */
const FLUTTER_WEIGHTS: Record<IndependentLead, number> = { I: 0.05, II: -1.0, V1: 0.6, V2: 0.3, V3: 0.15, V4: 0.1, V5: 0.1, V6: 0.1 };

/** Asymmetric sawtooth on [0,1): slow ramp over 80% of the cycle, fast return over 20%. Zero-mean, range about [-1, 1]. */
export function sawtooth(u: number): number {
  const x = u - Math.floor(u);
  return x < 0.8 ? 1 - (2 * x) / 0.8 : -1 + (2 * (x - 0.8)) / 0.2;
}

export function atrialFlutter(opts: FlutterOptions): { beats: BeatEvent[]; atrial: AtrialActivity } {
  const fr = opts.flutterRate ?? 300;
  const cycle = 60 / fr;
  const qtc = opts.qtc ?? 0.40;
  const base: BeatIntervals = { ...NORMAL_INTERVALS, ...(opts.intervals ?? {}) };
  const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
  const rng = makeRng(opts.seed ?? 1);
  const beats: BeatEvent[] = [];
  const history: number[] = [];
  const cond = opts.conduction ?? 2;
  let k = 1; // flutter cycle index of the next conducted wave
  let t = 0.25;
  while (t < opts.duration) {
    const rrForQt = meanOf(history.slice(-8), cycle * (typeof cond === 'number' ? cond : 3));
    const qt = qtFromBazett(qtc, rrForQt);
    const iv: BeatIntervals = { ...base, hasP: false, qt };
    if (opts.qtPartition) {
      const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
      iv.st = part.st;
      iv.tPeakFraction = part.tPeakFraction;
    } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
    beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: 'flutter' });
    const n = typeof cond === 'number' ? cond : ([2, 3, 4] as const)[Math.floor(rng() * 3)]!;
    const rr = n * cycle;
    history.push(rr);
    k += n;
    t += rr;
  }
  const A = opts.amplitude ?? 0.15;
  const atrial: AtrialActivity = {
    kind: 'flutter',
    at(time: number, lead: IndependentLead): number {
      return A * FLUTTER_WEIGHTS[lead] * sawtooth(time / cycle);
    },
  };
  return { beats, atrial };
}

/* ---------------------------------------------------------------------- */
/* Ventricular pacing (VVI-like)                                           */
/* ---------------------------------------------------------------------- */

export interface PacedOptions extends RhythmCommon {
  /** Paced rate, bpm. Default 70. */
  rate?: number;
  /** Paced QRS duration, s. Default 0.16 (RV apical pacing gives an LBBB-like wide complex). */
  qrs?: number;
  /** Whether underlying P waves are visible and dissociated (no AV synchrony). Default false. */
  dissociatedP?: boolean;
  /** Atrial rate for the dissociated P train, bpm. Default 75. */
  atrialRate?: number;
}

/**
 * Ventricular pacing: a pacing spike (annotation layer, not sampled) followed
 * by a wide LBBB-like complex with discordant T at a fixed rate. With
 * `dissociatedP`, an independent sinus P train is drawn (VVI in a patient
 * with intact sinus node and complete block).
 */
export function pacedRhythm(opts: PacedOptions): { beats: BeatEvent[]; spikes: PacingSpike[]; atrial: null } {
  const rate = opts.rate ?? 70;
  const rr = 60 / rate;
  const qtc = opts.qtc ?? 0.42;
  const base: BeatIntervals = { ...NORMAL_INTERVALS, ...(opts.intervals ?? {}) };
  const morph = opts.morphology ?? PVC_MORPHOLOGY;
  const qrs = opts.qrs ?? 0.16;
  const beats: BeatEvent[] = [];
  const spikes: PacingSpike[] = [];
  const qt = Math.max(qtFromBazett(qtc, rr), qrs + 0.02 + 0.12);
  let t = 0.3;
  while (t < opts.duration) {
    const iv: BeatIntervals = { ...base, hasP: false, qrs, st: 0.02, qt, rPeakFraction: 0.45, sPeakFraction: 0.78, tPeakFraction: 0.5 };
    beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: 'escape' });
    spikes.push({ t: t - 0.004 });
    t += rr;
  }
  if (opts.dissociatedP) {
    const pp = 60 / (opts.atrialRate ?? 75);
    const pMorph = opts.morphology ?? NORMAL_MORPHOLOGY;
    let pOn = 0.12;
    while (pOn < opts.duration) {
      beats.push({ qrsOn: pOn + base.pr, intervals: { ...base, pOnly: true, qt: base.qt }, morphology: pMorph, label: 'blocked-p' });
      pOn += pp;
    }
  }
  return { beats, spikes, atrial: null };
}
