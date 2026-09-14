/**
 * L5: template sequencer.
 *
 * A strip is an explicit list of beats. Each beat carries its own intervals
 * and morphology, so any beat can differ from its neighbours. The beat layer
 * (L3) renders a beat from its landmarks alone and knows nothing about this
 * list; that isolation is deliberate so the sequencer can later be replaced
 * by a conduction-system event model without touching L1 to L4.
 */

import { accumulate } from './deflections.js';
import { beatDeflections, type LeadMorphology } from './beat.js';
import { landmarksFromIntervals, qtFromBazett, type BeatIntervals, type BeatLandmarks, NORMAL_INTERVALS } from './landmarks.js';
import {
  INDEPENDENT_LEADS,
  deriveLimbLeads,
  NORMAL_MORPHOLOGY,
  type IndependentLead,
  type IndependentSet,
  type LeadName,
  type LeadSet,
} from './leads.js';
import { DEFAULT_FS } from './units.js';

export type BeatLabel = 'sinus' | 'pvc' | 'blocked-p' | 'escape' | 'svt' | 'af' | 'flutter';

export interface BeatEvent {
  /** Absolute time of QRS onset, s (for a blocked P, the time the QRS would have had). */
  qrsOn: number;
  intervals: BeatIntervals;
  morphology: IndependentSet<LeadMorphology>;
  label?: BeatLabel;
}

/** Continuous atrial activity (fibrillatory or flutter waves) added under the beats. */
export interface AtrialActivity {
  kind: 'fibrillation' | 'flutter';
  at(t: number, lead: IndependentLead): number;
}

export interface PacingSpike {
  t: number;
  /** Leads the spike is visible in. Undefined means all. */
  leads?: LeadName[];
}

export interface Strip {
  fs: number;
  duration: number;
  /** Samples in mV for all 12 leads. Zero volts is the TP baseline. */
  leads: LeadSet<Float64Array>;
  /** Ground-truth landmarks for every beat, used by tests and the viewer. */
  beats: Array<{ landmarks: BeatLandmarks; label?: BeatLabel }>;
  /** Whether a continuous atrial layer was added (the TP baseline is then not isoelectric by design). */
  atrial: AtrialActivity['kind'] | null;
  /** Annotation layer; not part of the sampled signal. */
  spikes: PacingSpike[];
  /** Non-fatal problems found while rendering, e.g. a T wave overlapping the next P wave. */
  warnings: string[];
}

/** Render a beat list into a strip. */
export function renderStrip(
  beats: BeatEvent[],
  duration: number,
  fs: number = DEFAULT_FS,
  spikes: PacingSpike[] = [],
  atrial: AtrialActivity | null = null,
): Strip {
  const n = Math.round(duration * fs);
  const ind = {} as IndependentSet<Float64Array>;
  for (const l of INDEPENDENT_LEADS) ind[l] = new Float64Array(n);

  const annotated: Strip['beats'] = [];
  for (const b of [...beats].sort((a, c) => a.qrsOn - c.qrsOn)) {
    const lm = landmarksFromIntervals(b.intervals, b.qrsOn);
    annotated.push({ landmarks: lm, label: b.label });
    for (const l of INDEPENDENT_LEADS) {
      for (const d of beatDeflections(lm, b.morphology[l], b.intervals.pOnly === true)) accumulate(ind[l], fs, 0, d);
    }
  }
  if (atrial) {
    for (const l of INDEPENDENT_LEADS) {
      const buf = ind[l];
      for (let i = 0; i < n; i++) buf[i] = (buf[i] ?? 0) + atrial.at(i / fs, l);
    }
  }

  const warnings: string[] = [];
  for (let k = 0; k + 1 < annotated.length; k++) {
    const a = annotated[k]!.landmarks;
    const b = annotated[k + 1]!.landmarks;
    const nextStart = b.pOn ?? b.qrsOn;
    if (nextStart < a.end) {
      warnings.push(
        `beat ${k + 1} starts ${((a.end - nextStart) * 1000).toFixed(0)} ms before beat ${k} ends (waves overlap; QT ${((a.tOff - a.qrsOn) * 1000).toFixed(0)} ms, RR ${((b.qrsOn - a.qrsOn) * 1000).toFixed(0)} ms)`,
      );
    }
  }

  const derived = deriveLimbLeads(ind.I, ind.II);
  const leads: LeadSet<Float64Array> = { ...ind, ...derived };
  const strip: Strip = { fs, duration, leads, beats: annotated, spikes, warnings, atrial: atrial ? atrial.kind : null };
  if (!atrial) normalizeBaseline(strip);
  return strip;
}

/**
 * Baseline discipline. Zero volts is defined as the TP segment. With compact
 * support primitives the TP samples are exactly zero already, so this is a
 * guard rather than a fix: it measures the median of TP samples per lead,
 * subtracts it, and returns the corrections so a test can assert they are zero.
 */
export function normalizeBaseline(strip: Strip): LeadSet<number> {
  const corrections = {} as LeadSet<number>;
  const idx = tpSampleIndices(strip);
  for (const l of Object.keys(strip.leads) as LeadName[]) {
    const buf = strip.leads[l];
    if (idx.length === 0) {
      corrections[l] = 0;
      continue;
    }
    const vals = idx.map((i) => buf[i] ?? 0).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)] ?? 0;
    corrections[l] = med;
    if (med !== 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) - med;
  }
  return corrections;
}

/** Indices of samples that lie in a TP segment (between one beat's T offset and the next beat's earliest wave). */
export function tpSampleIndices(strip: Strip): number[] {
  const out: number[] = [];
  const bs = strip.beats;
  for (let k = 0; k + 1 < bs.length; k++) {
    const a = bs[k]!.landmarks;
    const b = bs[k + 1]!.landmarks;
    const start = a.end;
    const end = b.pOn ?? b.qrsOn;
    const i0 = Math.ceil(start * strip.fs) + 1;
    const i1 = Math.floor(end * strip.fs) - 1;
    for (let i = i0; i <= i1; i++) out.push(i);
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Sinus rhythm generator                                                  */
/* ---------------------------------------------------------------------- */

export interface SinusOptions {
  /** Heart rate in beats per minute. */
  rate: number;
  /** Strip duration, s. */
  duration: number;
  /** Standard deviation of RR as a fraction of the mean RR. 0 for perfectly regular. */
  rrJitter?: number;
  /** Corrected QT (Bazett), s. QT is derived from the running mean RR. */
  qtc?: number;
  /** Base intervals other than QT. */
  intervals?: Partial<BeatIntervals>;
  morphology?: IndependentSet<LeadMorphology>;
  /** PRNG seed for reproducibility. */
  seed?: number;
  /** Time of the first QRS onset. Default leaves room for the first P wave. */
  firstQrsOn?: number;
  /**
   * How the QT interval is split between the ST segment and the T wave.
   * Omit to keep `intervals.st` fixed (T width then absorbs every QT change).
   */
  qtPartition?: QtPartition;
  /** Ventricular ectopy inserted into the sinus train. */
  ectopy?: EctopyOptions;
  /** Atrioventricular conduction disturbance. */
  avBlock?: AvBlockOptions;
}

/**
 * AV block on the template sequencer. The atrial (P) clock runs at `rate`;
 * each P is conducted or not by the rule below. Blocked P waves are drawn as
 * P-only beats. A conduction model would derive these from AV refractoriness;
 * here they are scripted patterns.
 *
 *   first       every P conducts with the (long) PR you set
 *   wenckebach  PR grows by prIncrement on each beat of a cycle of `ratio` P waves; the last is dropped (4 = 4:3)
 *   mobitz2     constant PR; every `ratio`-th P is dropped (3 = 3:2; 2 = 2:1)
 *   complete    no P conducts; an independent escape rhythm at escapeRate
 */
export interface AvBlockOptions {
  type: 'none' | 'first' | 'wenckebach' | 'mobitz2' | 'complete';
  ratio?: number;
  /** Wenckebach PR increment per beat, s. Default 0.06. */
  prIncrement?: number;
  /** Escape rate for complete block, bpm. Default 40. */
  escapeRate?: number;
  /** Escape focus. Junctional: narrow QRS, normal morphology. Ventricular: wide, PVC morphology. Default junctional. */
  escapeFocus?: 'junctional' | 'ventricular';
}

/**
 * Ventricular ectopy (PVCs) on a template sequencer.
 *
 * A PVC is a beat with no P wave, a wide QRS of its own morphology and a
 * discordant T, placed at a coupling interval after the preceding sinus QRS.
 * The sinus clock is not reset (full compensatory pause): the next sinus beat
 * lands where it would have anyway, provided the PVC has finished. Sinus P
 * waves that would fall inside the PVC are dropped (they are buried, not
 * conducted). This is a scripted approximation; a conduction model would
 * produce it from refractoriness.
 */
export interface EctopyOptions {
  /** Insert a PVC after every Nth sinus beat: 1 = bigeminy (sinus, PVC, sinus, PVC), 2 = trigeminy. */
  every: number;
  /** Coupling interval as a fraction of the mean RR. Default 0.55. */
  couplingFraction?: number;
  /** PVC QRS duration, s. Default 0.14. */
  qrs?: number;
  /** PVC morphology, 8 channels. Default PVC_MORPHOLOGY (LBBB-like, inferior axis). */
  morphology?: IndependentSet<LeadMorphology>;
  /** Corrected QT for the PVC's own repolarisation. Default same as sinus. */
  qtc?: number;
  /**
   * Time after the PVC during which a sinus impulse is blocked, s. Default 0.6.
   * Stands in for concealed retrograde penetration of the AV node: at ordinary
   * rates the next sinus P is blocked and a full compensatory pause results;
   * at slow rates the sinus impulse arrives later, conducts, and the PVC is
   * interpolated. Both behaviours emerge from this one number.
   */
  avRefractory?: number;
}

/**
 * A generic PVC: LBBB-like (negative V1, positive V6), with discordant T waves.
 * STATUS: hand-set placeholder; real PVC morphology depends on the focus.
 */
export const PVC_MORPHOLOGY: IndependentSet<LeadMorphology> = {
  I: { p: 0, q: 0, r: 0.9, s: -0.1, t: -0.4, qrsSharpness: 1.2 },
  II: { p: 0, q: 0, r: 1.2, s: -0.1, t: -0.5, qrsSharpness: 1.2 },
  V1: { p: 0, q: -0.2, r: 0, s: -1.6, t: 0.6, qrsSharpness: 1.2 },
  V2: { p: 0, q: -0.2, r: 0, s: -1.9, t: 0.7, qrsSharpness: 1.2 },
  V3: { p: 0, q: -0.1, r: 0.2, s: -1.5, t: 0.6, qrsSharpness: 1.2 },
  V4: { p: 0, q: 0, r: 0.8, s: -0.9, t: 0.2, qrsSharpness: 1.2 },
  V5: { p: 0, q: 0, r: 1.4, s: -0.3, t: -0.4, qrsSharpness: 1.2 },
  V6: { p: 0, q: 0, r: 1.3, s: -0.2, t: -0.5, qrsSharpness: 1.2 },
};

/**
 * QT partition model.
 *
 * QT = QRS + ST + T. The ST segment is the surface expression of the action
 * potential plateau (phase 2), the T wave of the phase 3 repolarisation
 * gradient. Conditions that lengthen the plateau (hypocalcaemia, LQT3-type
 * late sodium current) lengthen the ST segment with a normal T; conditions
 * that slow phase 3 (IKr block, hypokalaemia, LQT2-type) widen the T wave.
 * Rate adaptation shortens the early part of repolarisation most: Malik and
 * colleagues report J-to-T-peak shortening of about 150 ms per second of RR
 * change and T waves becoming more symmetrical at fast rates.
 *
 * Model (a decree, see README):
 *   JT  = QT - QRS
 *   ST  = stFraction * RR^rateExponent * JT
 *   T   = JT - ST
 *   tPeakFraction moves from `tPeakFractionSlow` at RR >= 1 s toward 0.5 at RR <= 0.5 s.
 */
export interface QtPartition {
  /** ST share of JT at RR = 1 s. Normal about 0.32 (ST 100 ms of JT 310 ms). */
  stFraction: number;
  /** Extra rate steepness of the ST share. 0 keeps the share constant; 1 makes ST shrink in proportion to RR. Default 0.5. */
  rateExponent?: number;
  /** T peak position within the T wave at slow rates. Default 0.55. */
  tPeakFractionSlow?: number;
  /** Floor on T duration, s. Default 0.08. */
  minT?: number;
}

/** Compute the ST duration and T peak fraction for one beat under a partition model. */
export function partitionQt(qt: number, qrs: number, rr: number, p: QtPartition): { st: number; tPeakFraction: number; t: number } {
  const jt = Math.max(0, qt - qrs);
  const b = p.rateExponent ?? 0.5;
  const minT = p.minT ?? 0.08;
  let st = p.stFraction * Math.pow(Math.max(0.2, rr), b) * jt;
  st = Math.max(0, Math.min(st, jt - minT));
  const slow = p.tPeakFractionSlow ?? 0.55;
  const w = Math.max(0, Math.min(1, (rr - 0.5) / 0.5)); // 0 at RR<=0.5, 1 at RR>=1
  const tPeakFraction = 0.5 + (slow - 0.5) * w;
  return { st, tPeakFraction, t: jt - st };
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviate from a uniform PRNG (Box-Muller). */
export function gaussian(rng: () => number): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Number of preceding RR intervals averaged for QT adaptation. A modelling decree, see README. */
export const QT_RUNNING_MEAN_BEATS = 8;

export function sinusRhythm(opts: SinusOptions): BeatEvent[] {
  const ppMean = 60 / opts.rate;
  const jitter = opts.rrJitter ?? 0;
  const qtc = opts.qtc ?? 0.40;
  const base: BeatIntervals = { ...NORMAL_INTERVALS, ...(opts.intervals ?? {}) };
  const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
  const rng = makeRng(opts.seed ?? 1);
  const beats: BeatEvent[] = [];
  const rrHistory: number[] = [];
  const block = opts.avBlock ?? { type: 'none' };
  const ect = opts.ectopy;

  const nextPp = () => (jitter > 0 ? ppMean * Math.max(0.5, 1 + jitter * gaussian(rng)) : ppMean);
  const conductedIntervals = (pr: number, hasP: boolean): BeatIntervals => {
    const rrRecent = rrHistory.slice(-QT_RUNNING_MEAN_BEATS);
    const rrForQt = rrRecent.length ? rrRecent.reduce((a, b) => a + b, 0) / rrRecent.length : ppMean;
    const qt = qtFromBazett(qtc, rrForQt);
    const iv: BeatIntervals = { ...base, pr, qt, hasP };
    if (opts.qtPartition) {
      const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
      iv.st = part.st;
      iv.tPeakFraction = part.tPeakFraction;
    }
    return iv;
  };

  // Complete heart block: independent P train and escape train.
  if (block.type === 'complete') {
    let pOn = 0.1;
    while (pOn < opts.duration) {
      beats.push({ qrsOn: pOn + base.pr, intervals: { ...base, pOnly: true, qt: base.qt }, morphology: morph, label: 'blocked-p' });
      pOn += nextPp();
    }
    const escRr = 60 / (block.escapeRate ?? 40);
    const ventricular = block.escapeFocus === 'ventricular';
    let t = 0.35;
    while (t < opts.duration) {
      const iv = conductedIntervals(base.pr, false);
      if (ventricular) {
        iv.qrs = Math.max(0.14, base.qrs);
        iv.st = 0.02;
        iv.qt = Math.max(iv.qt, iv.qrs + 0.02 + 0.12);
      }
      beats.push({ qrsOn: t, intervals: iv, morphology: ventricular ? PVC_MORPHOLOGY : morph, label: 'escape' });
      rrHistory.push(escRr);
      t += escRr;
    }
    return beats;
  }

  let pOn = 0.05;
  let cyclePos = 0;
  let conductedCount = 0;
  let lastConductedQrs = -Infinity;
  let pendingPvc: { qrsOn: number; end: number; blockUntil: number } | null = null;

  while (pOn < opts.duration) {
    // AV conduction rule.
    let pr = base.pr;
    let conducts = true;
    if (block.type === 'wenckebach') {
      const n = Math.max(2, block.ratio ?? 4);
      pr = base.pr + cyclePos * (block.prIncrement ?? 0.06);
      conducts = cyclePos < n - 1;
      cyclePos = (cyclePos + 1) % n;
    } else if (block.type === 'mobitz2') {
      const n = Math.max(2, block.ratio ?? 3);
      conducts = cyclePos !== n - 1;
      cyclePos = (cyclePos + 1) % n;
    }
    const qrsOn = pOn + pr;

    // Post-PVC block window (concealed retrograde penetration of the AV node).
    let buried = false;
    if (pendingPvc) {
      if (qrsOn < pendingPvc.blockUntil) {
        conducts = false;
        buried = pOn < pendingPvc.end;
      } else pendingPvc = null;
    }

    if (conducts) {
      if (Number.isFinite(lastConductedQrs)) rrHistory.push(qrsOn - lastConductedQrs);
      const iv = conductedIntervals(pr, true);
      beats.push({ qrsOn, intervals: iv, morphology: morph, label: 'sinus' });
      lastConductedQrs = qrsOn;
      conductedCount++;
      if (ect && ect.every > 0 && conductedCount % ect.every === 0) {
        const coupling = (ect.couplingFraction ?? 0.55) * ppMean;
        const pvcOn = qrsOn + coupling;
        const pqrs = ect.qrs ?? 0.14;
        const rrRecent = rrHistory.slice(-QT_RUNNING_MEAN_BEATS);
        const rrForQt = rrRecent.length ? rrRecent.reduce((a, b) => a + b, 0) / rrRecent.length : ppMean;
        const pqt = qtFromBazett(ect.qtc ?? qtc, rrForQt);
        const pIntervals: BeatIntervals = {
          ...base,
          hasP: false,
          qrs: pqrs,
          st: 0.02,
          qt: Math.max(pqt, pqrs + 0.02 + 0.12),
          rPeakFraction: 0.45,
          sPeakFraction: 0.78,
          tPeakFraction: 0.5,
        };
        if (pvcOn < opts.duration) {
          beats.push({ qrsOn: pvcOn, intervals: pIntervals, morphology: ect.morphology ?? PVC_MORPHOLOGY, label: 'pvc' });
          pendingPvc = { qrsOn: pvcOn, end: pvcOn + pIntervals.qt, blockUntil: pvcOn + (ect.avRefractory ?? 0.6) };
        }
      }
    } else if (!buried) {
      beats.push({ qrsOn, intervals: { ...base, pr, pOnly: true, qt: base.qt }, morphology: morph, label: 'blocked-p' });
    }
    pOn += nextPp();
  }
  return beats;
}
