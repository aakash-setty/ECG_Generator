/**
 * Toxicology ECG patterns.
 *
 * Three toxidromes, each mapped from a single severity parameter (0 = drug
 * effect or early toxicity, 1 = severe toxicity) onto sinus-generator options
 * and an 8-channel morphology. The feature tables follow the LITFL ECG
 * Library and CCC pages listed in SOURCES; the numeric mappings from severity
 * to amplitudes and intervals are stylisations chosen so the classic
 * thresholds are crossed at plausible points of the slider. They are not
 * fitted to case data.
 *
 * Every toxidrome also lists what is NOT modelled, so the drop-down is not
 * mistaken for a complete description of the poisoning.
 */

import type { LeadMorphology } from './beat.js';
import { NORMAL_MORPHOLOGY, INDEPENDENT_LEADS, cloneMorphology, type IndependentSet } from './leads.js';
import { applySecondaryRepolarisation, frontalTerminal } from './secondary-repolarisation.js';
import type { SinusOptions, EctopyOptions, QtPartition, AvBlockOptions } from './sequencer.js';

export type Toxidrome = 'sodium-channel-blocker' | 'digoxin' | 'potassium-channel-blocker' | 'hyperkalaemia' | 'beta-blocker-ccb' | 'hypocalcaemia';
export const TOXIDROME_KEYS: Toxidrome[] = ['sodium-channel-blocker', 'digoxin', 'potassium-channel-blocker', 'hyperkalaemia', 'beta-blocker-ccb', 'hypocalcaemia'];

/** Drug-class variants for the beta-blocker / calcium-channel blocker pattern. */
export type BbVariant = 'cardioselective' | 'propranolol' | 'sotalol';
export const BB_VARIANTS: Array<{ key: BbVariant; label: string }> = [
  { key: 'cardioselective', label: 'Cardioselective BB or verapamil/diltiazem' },
  { key: 'propranolol', label: 'Propranolol (adds sodium channel blockade)' },
  { key: 'sotalol', label: 'Sotalol (adds potassium channel blockade)' },
];

export interface ToxFeature {
  /** Short label shown in the checklist. */
  label: string;
  /** Which measurement it is judged on. */
  measure:
    | 'hr'
    | 'sinusHr'
    | 'pr'
    | 'qrs'
    | 'qt'
    | 'qtc'
    | 'avrRPrime'
    | 'avrRS'
    | 'pvcCount'
    | 'stScoop'
    | 'uAmp'
    | 'tAmpV3'
    | 'pAmpII'
    | 'blockedPCount'
    | 'escapeCount'
    | 'jtp'
    | 'tpe';
  /** Threshold and direction. */
  threshold: number;
  direction: 'above' | 'below';
  /** What crossing it means, from the source. */
  meaning: string;
}

export interface ToxSpec {
  key: Toxidrome;
  label: string;
  /** Optional sub-variants (drug classes) selectable in the UI. */
  variants?: Array<{ key: string; label: string }>;
  examples: string;
  mechanism: string;
  /** ECG features in the source's words (paraphrased minimally). */
  features: string[];
  notModelled: string[];
  sources: Array<{ title: string; url: string }>;
  checklist: ToxFeature[];
}

export interface ToxResult {
  sinus: Omit<SinusOptions, 'duration'>;
  /** Approximate clinical stage label for the severity, when the source gives one. */
  stage?: string;
  morphology: IndependentSet<LeadMorphology>;
  /** Human-readable summary of what this severity sets. */
  settings: Record<string, string>;
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

/* ---------------------------------------------------------------------- */
/* 1. Sodium channel blockade (tricyclic antidepressants and others)        */
/* ---------------------------------------------------------------------- */

export const SODIUM_CHANNEL_BLOCKER: ToxSpec = {
  key: 'sodium-channel-blocker',
  label: 'Sodium channel blocker (TCA type)',
  examples: 'Tricyclic antidepressants; also class Ia/Ic antiarrhythmics, propranolol, carbamazepine, cocaine, local anaesthetics.',
  mechanism:
    'Fast sodium channel blockade slows phase 0 depolarisation, widening the QRS. LITFL: the right-sided intraventricular conducting system is more susceptible, which produces terminal right axis deviation of the QRS. Wolfe et al. (1989) report a terminal 40 ms frontal plane axis of 130 to 270 degrees in TCA poisoning. The slowed, abnormal depolarisation sequence carries a secondary repolarisation change of the bundle branch block kind: the T wave points opposite the terminal QRS deflection and rises straight out of it, with no flat ST segment. Muscarinic (M1) blockade gives sinus tachycardia.',
  features: [
    'Sinus tachycardia (M1 receptor blockade)',
    'Intraventricular conduction delay: QRS > 100 ms in lead II (Boehnert and Lovejoy 1985: QRS >= 100 ms predicted seizures, >= 160 ms ventricular arrhythmias)',
    "Terminal R wave (R') in aVR > 3 mm, or R/S ratio > 0.7 in aVR (Liebelt et al. 1995; terminal right axis deviation)",
    'Terminal 40 ms frontal plane QRS axis 130 to 270 degrees (Wolfe et al. 1989); modelled at +250 degrees',
    'Broad, large T waves opposite the terminal QRS deflection (upright in II, III, aVF, V3 to V6; inverted in aVR, V1, V2) with the ST segment lost into the S upstroke: secondary repolarisation, as in bundle branch block',
    'QT prolongation, mostly through the widened QRS',
    'Severe toxicity: QRS and T fuse into a sine-wave appearance (LITFL Example 1b: "marked QRS broadening producing a sine wave appearance reminiscent of hyperkalaemia")',
  ],
  notModelled: [
    'Brugada-pattern ST elevation in V1 to V2 (reported with sodium channel blockade)',
    'Ventricular tachycardia, hypotension-related changes, and the response to sodium bicarbonate',
    'Rate-dependent (use-dependent) block: QRS widening here does not vary with rate',
    'The T wave rule (T = -0.8 x terminal deflection, J point at 0.3 x terminal deflection), the +250 degree angle and the QTc ramp are fitted to three exemplar tracings and general electrophysiology, not to published measurements',
  ],
  sources: [
    { title: 'LITFL ECG Library: Tricyclic Overdose (Sodium Channel Blocker Toxicity)', url: 'https://litfl.com/tricyclic-overdose-sodium-channel-blocker-toxicity/' },
    { title: 'LITFL CCC: ECG in Toxicology', url: 'https://litfl.com/ecg-in-toxicology/' },
    { title: 'Boehnert MT, Lovejoy FH. Value of the QRS duration versus the serum drug level in predicting seizures and ventricular arrhythmias after an acute overdose of tricyclic antidepressants. N Engl J Med 1985', url: 'https://www.nejm.org/doi/full/10.1056/NEJM198508223130804' },
    { title: 'Liebelt EL, Francis PD, Woolf AD. ECG lead aVR versus QRS interval in predicting seizures and arrhythmias in acute tricyclic antidepressant toxicity. Ann Emerg Med 1995', url: 'https://pubmed.ncbi.nlm.nih.gov/7618783/' },
    { title: 'Wolfe TR, Caravati EM, Rollins DE. Terminal 40-ms frontal plane QRS axis as a marker for tricyclic antidepressant overdose. Ann Emerg Med 1989', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0196064489805669' },
    { title: 'Emergency Medicine Cases, ECG Cases 12: RBBB and occlusion MI (the appropriate-discordance rule used for the secondary T wave)', url: 'https://emergencymedicinecases.com/ecg-rbbb-occlusion-mi/' },
  ],
  checklist: [
    { label: 'Sinus tachycardia', measure: 'hr', threshold: 100, direction: 'above', meaning: 'M1 blockade' },
    { label: 'QRS > 100 ms', measure: 'qrs', threshold: 0.1, direction: 'above', meaning: 'predicts seizures' },
    { label: 'QRS > 160 ms', measure: 'qrs', threshold: 0.16, direction: 'above', meaning: 'predicts ventricular arrhythmias' },
    { label: "aVR terminal R' > 3 mm (0.3 mV)", measure: 'avrRPrime', threshold: 0.3, direction: 'above', meaning: 'terminal right axis deviation' },
    { label: 'aVR R/S > 0.7', measure: 'avrRS', threshold: 0.7, direction: 'above', meaning: 'terminal right axis deviation' },
    { label: 'QTc > 440 ms', measure: 'qtc', threshold: 0.44, direction: 'above', meaning: 'QT prolongation' },
  ],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function sodiumChannelBlocker(s: number): ToxResult {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  // Weight of the secondary repolarisation rule and of the sine-wave end state.
  const w = clamp01(s / 0.6);
  const sine = clamp01((s - 0.85) / 0.15);

  // Terminal frontal vector: rightward and superior. Wolfe et al. (1989) report a
  // terminal 40 ms frontal axis of 130 to 270 degrees in TCA poisoning; 250 is
  // inside that range and reproduces a deep S in II, III and aVF with a
  // dominant R' in aVR (the exemplar tracings). Magnitude grows with severity.
  const M = 0.75 * s;
  const axisDeg = 250;
  const f = frontalTerminal(M, axisDeg);
  morph.I = { ...morph.I, s: morph.I.s + f.I };
  morph.II = { ...morph.II, s: morph.II.s + f.II };
  // Precordial: tall broad R' in V1 to V2 (V2's own S shrinks as the R' grows), deep broad S from V3 to V6.
  morph.V1 = { ...morph.V1, rPrime: 1.2 * s };
  morph.V2 = { ...morph.V2, rPrime: 0.5 * s, s: morph.V2.s * (1 - 0.6 * s) };
  morph.V3 = { ...morph.V3, s: morph.V3.s - 0.5 * s };
  morph.V4 = { ...morph.V4, s: morph.V4.s - 0.7 * s };
  morph.V5 = { ...morph.V5, s: morph.V5.s - 0.7 * s };
  morph.V6 = { ...morph.V6, s: morph.V6.s - 0.7 * s };
  // The initial r shrinks as the terminal forces grow (limb leads in the exemplars are a small
  // narrow r before the broad S); toward the sine-wave end state it fades further so that the
  // terminal deflection and the T wave become one oscillation.
  const rScaleLimb = (1 - 0.6 * s) * (1 - 0.4 * sine);
  const rScalePrecordial = (1 - 0.3 * s) * (1 - 0.4 * sine);
  const termSharp = lerp(0.8, 1.2, s);
  const tSharp = lerp(1.0, 1.6, s);
  for (const lead of INDEPENDENT_LEADS) {
    const m = morph[lead];
    const rs = lead === 'I' || lead === 'II' ? rScaleLimb : rScalePrecordial;
    morph[lead] = { ...m, terminalSharpness: termSharp, tSharpness: tSharp, r: m.r * rs, q: m.q * (1 - sine) };
  }

  // Secondary repolarisation: T opposite the terminal deflection, J on its return limb.
  applySecondaryRepolarisation(morph, { k: lerp(0.8, 0.85, sine), c: lerp(0.3, 0.35, sine), tPeakFraction: 0.5, weight: w });

  const rate = lerp(95, 135, s);
  const qrs = lerp(0.09, 0.19, s);
  // QT lengthens mainly because the QRS does; JT is held roughly constant.
  const qtc = lerp(0.42, 0.64, s);
  const pr = lerp(0.16, 0.20, s);
  const rPeakFraction = Math.min(0.3, 0.03 / qrs);
  const sPeakFraction = lerp(0.62, 0.45, s);
  const rPrimePeakFraction = lerp(0.84, 0.72, s);
  const stFraction = 0.3 * (1 - w);
  return {
    sinus: {
      rate,
      rrJitter: 0.02,
      qtc,
      intervals: { pr, qrs, rPeakFraction, sPeakFraction, rPrimePeakFraction },
      qtPartition: { stFraction: Math.max(0.001, stFraction) },
      morphology: morph,
    },
    morphology: morph,
    settings: {
      'Heart rate': `${rate.toFixed(0)} bpm`,
      'QRS duration': `${(qrs * 1000).toFixed(0)} ms`,
      'Terminal QRS vector': `${M.toFixed(2)} mV at +${axisDeg}°`,
      'Secondary repolarisation': `${(w * 100).toFixed(0)} % (T opposite terminal QRS, ST segment ${(stFraction * 100).toFixed(0)} % of JT)`,
      QTc: `${(qtc * 1000).toFixed(0)} ms`,
      PR: `${(pr * 1000).toFixed(0)} ms`,
      ...(sine > 0 ? { 'Sine-wave fusion': `${(sine * 100).toFixed(0)} %` } : {}),
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 2. Digoxin: effect to toxicity                                          */
/* ---------------------------------------------------------------------- */

export const DIGOXIN: ToxSpec = {
  key: 'digoxin',
  label: 'Digoxin (effect to toxicity)',
  examples: 'Digoxin, digitoxin; plant cardiac glycosides (oleander, foxglove).',
  mechanism:
    'Na+/K+-ATPase inhibition raises intracellular calcium (increased automaticity) and enhances vagal tone at the AV node (decreased AV conduction). Shortened atrial and ventricular refractory periods shorten the QT and produce secondary repolarisation changes. Digoxin effect indicates the drug is present, not toxicity.',
  features: [
    "Downsloping ST depression with a 'reverse tick' or 'Salvador Dali sagging' appearance, most in leads with tall R waves; J-point depression",
    'Flattened, inverted or biphasic T waves (my-EKG: the sag swallows the initial T and leaves the "terminal portion of the pointed T wave" upright; drawn here as a terminal T that flattens and then inverts with severity)',
    'Shortened QT interval',
    'Mild PR prolongation (up to 240 ms, vagal)',
    'Prominent U waves',
    'Toxicity: sinus bradycardia, AV block; frequent PVCs are the most common abnormality, including bigeminy and trigeminy',
  ],
  notModelled: [
    'AV block patterns (Wenckebach, 2:1, complete heart block with escape rhythm)',
    'Paroxysmal atrial tachycardia with block, slow or regularised atrial fibrillation, atrial flutter with slow response',
    'Bidirectional VT, monomorphic and polymorphic VT',
    'Hyperkalaemia of acute overdose (peaked T waves would need the hyperkalaemia module)',
  ],
  sources: [
    { title: 'LITFL ECG Library: Digoxin Effect', url: 'https://litfl.com/digoxin-effect-ecg-library/' },
    { title: 'LITFL ECG Library: Digoxin Toxicity', url: 'https://litfl.com/digoxin-toxicity-ecg-library/' },
    { title: 'LITFL CCC: ECG in Toxicology', url: 'https://litfl.com/ecg-in-toxicology/' },
    { title: 'my-EKG: Digoxin on the electrocardiogram', url: 'https://en.my-ekg.com/metabolic-drugs/digoxin-ekg.html' },
  ],
  checklist: [
    { label: 'ST scoop depth (V5) beyond 0.1 mV', measure: 'stScoop', threshold: 0.1, direction: 'above', meaning: 'digoxin effect' },
    { label: 'QTc < 350 ms', measure: 'qtc', threshold: 0.35, direction: 'below', meaning: 'short QT (LITFL threshold)' },
    { label: 'PR > 200 ms', measure: 'pr', threshold: 0.2, direction: 'above', meaning: 'vagal AV slowing' },
    { label: 'U wave present (>= 0.05 mV)', measure: 'uAmp', threshold: 0.05, direction: 'above', meaning: 'prominent U waves' },
    { label: 'Bradycardia < 60 (conducted-beat rate)', measure: 'sinusHr', threshold: 60, direction: 'below', meaning: 'toxicity' },
    { label: 'PVCs present', measure: 'pvcCount', threshold: 0, direction: 'above', meaning: 'most common toxic abnormality' },
  ],
};

function digoxin(s: number): ToxResult {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  // Digoxin effect in leads with a tall R: a slight J-point depression, a concave sag that reaches
  // its nadir where the T would begin, and a T whose initial part is swallowed by the sag while its
  // terminal part stays upright (the "reverse tick"; my-EKG: "terminal portion of the pointed T
  // wave"). With severity the terminal T flattens and finally inverts.
  const sagDepth = 0.06 + 0.14 * s; // ST level at the end of the sag, mV below baseline
  const scoop = -(0.04 + 0.06 * s); // extra concavity inside the sag
  const tTerminal = lerp(0.18, -0.12, s); // biphasic (terminal upright) -> flat -> inverted
  const tallR: Array<keyof IndependentSet<LeadMorphology>> = ['I', 'II', 'V4', 'V5', 'V6'];
  for (const l of tallR) {
    const base = morph[l];
    const scale = base.r / 1.5; // sag scales with R height (LITFL: most in leads with tall R waves)
    morph[l] = {
      ...base,
      stJ: -(0.02 + 0.03 * s) * Math.max(0.5, scale),
      stT: -sagDepth * Math.max(0.5, scale),
      stShape: 0.6,
      stScoop: scoop * Math.max(0.5, scale),
      t: tTerminal * Math.max(0.5, scale),
      tPeakFraction: 0.7,
      tSharpness: 0.8,
      u: 0.05 + 0.06 * s,
    };
  }
  morph.V3 = { ...morph.V3, stJ: -0.02 * s, stT: -0.4 * sagDepth, stScoop: scoop * 0.5, t: morph.V3.t * (1 - 0.7 * s), tPeakFraction: 0.65, u: 0.04 + 0.05 * s };
  morph.V2 = { ...morph.V2, u: 0.04 + 0.05 * s };

  const rate = lerp(72, 42, s);
  const pr = lerp(0.16, 0.24, s);
  const qtc = lerp(0.40, 0.335, s);
  const ectopy: EctopyOptions | undefined = s >= 0.45 ? { every: s >= 0.8 ? 1 : 3, couplingFraction: 0.5 } : undefined;
  // Long sag, short T: the ST window carries the sag and the T window only the terminal deflection.
  const partition: QtPartition = { stFraction: lerp(0.4, 0.5, s) };
  return {
    sinus: { rate, rrJitter: 0.02, qtc, intervals: { pr, uDuration: 0.16, uPeakFraction: 0.45 }, qtPartition: partition, ectopy, morphology: morph },
    morphology: morph,
    settings: {
      'Heart rate': `${rate.toFixed(0)} bpm`,
      PR: `${(pr * 1000).toFixed(0)} ms`,
      QTc: `${(qtc * 1000).toFixed(0)} ms`,
      'ST sag at T onset (V5)': `${(-sagDepth).toFixed(2)} mV`,
      'Terminal T (V5)': `${tTerminal.toFixed(2)} mV`,
      'U amplitude (V5)': `${(0.05 + 0.06 * s).toFixed(2)} mV`,
      Ectopy: ectopy ? (ectopy.every === 1 ? 'bigeminy' : ectopy.every === 2 ? 'trigeminy' : `PVC after every ${ectopy.every} sinus beats`) : 'none',
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 3. Potassium efflux (hERG) blockade: drug-induced long QT               */
/* ---------------------------------------------------------------------- */

export const POTASSIUM_CHANNEL_BLOCKER: ToxSpec = {
  key: 'potassium-channel-blocker',
  label: 'Potassium efflux blocker (drug-induced long QT)',
  examples: 'Sotalol, amiodarone, methadone, antipsychotics (haloperidol, quetiapine), macrolides, citalopram/escitalopram, hydroxychloroquine, ondansetron.',
  mechanism:
    'Block of the rapid delayed rectifier (IKr, hERG) slows phase 3 repolarisation, prolonging the action potential and the QT interval. Early afterdepolarisations at long cycle lengths trigger torsades de pointes, so bradycardia raises the risk. LITFL: risk is assessed with the QT nomogram (absolute QT against heart rate).',
  features: [
    'Prolongation of the QT interval',
    'Broad, low-amplitude T waves, often notched (LQT2-like morphology) and prominent U waves. Yan and Antzelevitch (1998, arterially perfused wedge) reproduced the broad-based, bifid T of IKr block as a transmural dispersion effect; Moss et al. (1995) describe LQT2 T waves as low-amplitude and bifid or notched',
    'Bradycardia increases the likelihood of torsades de pointes (sotalol adds beta blockade)',
    'QTc > 440 ms (men) or > 460 ms (women) is prolonged; QTc > 500 ms carries substantially higher arrhythmia risk',
  ],
  notModelled: [
    'Torsades de pointes itself (a polymorphic rhythm needs a different engine)',
    'The QT nomogram line is not implemented numerically; the checklist uses QTc thresholds instead',
    'Macroscopic T-wave alternans, pause-dependent QT lengthening',
  ],
  sources: [
    { title: 'LITFL ECG Library: QT Interval', url: 'https://litfl.com/qt-interval-ecg-library/' },
    { title: 'LITFL CCC: ECG in Toxicology', url: 'https://litfl.com/ecg-in-toxicology/' },
    { title: 'Yan GX, Antzelevitch C. Cellular basis for the normal T wave and the electrocardiographic manifestations of the long-QT syndrome. Circulation 1998 (wedge model: IKr block gives a broad-based, bifid T)', url: 'https://www.ahajournals.org/doi/10.1161/01.cir.98.18.1928' },
    { title: 'Moss AJ et al. ECG T-wave patterns in genetically distinct forms of the hereditary long QT syndrome. Circulation 1995 (PubMed search link; the article itself was not fetched in this build)', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Moss+AJ+1995+ECG+T-wave+patterns+genetically+distinct+forms+hereditary+long+QT' },
  ],
  checklist: [
    { label: 'QTc > 440 ms', measure: 'qtc', threshold: 0.44, direction: 'above', meaning: 'prolonged (men)' },
    { label: 'QTc > 460 ms', measure: 'qtc', threshold: 0.46, direction: 'above', meaning: 'prolonged (women)' },
    { label: 'QTc > 500 ms', measure: 'qtc', threshold: 0.5, direction: 'above', meaning: 'substantially raised arrhythmia risk' },
    { label: 'Bradycardia < 60', measure: 'hr', threshold: 60, direction: 'below', meaning: 'raises torsades risk' },
    { label: 'U wave present (>= 0.05 mV)', measure: 'uAmp', threshold: 0.05, direction: 'above', meaning: 'prominent U waves' },
  ],
};

function potassiumChannelBlocker(s: number): ToxResult {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  // IKr block: the T wave becomes broad-based and low, with a late second hump (bifid or notched T)
  // and a prominent U, the LQT2-like pattern. The T peak moves late and the wave flattens (sharpness
  // above 1) rather than sharpening.
  const uAmp = 0.03 + 0.09 * s;
  for (const l of Object.keys(morph) as Array<keyof IndependentSet<LeadMorphology>>) {
    const base = morph[l];
    morph[l] = {
      ...base,
      t: base.t * (1 - 0.45 * s),
      tSharpness: lerp(1.0, 1.4, s),
      tPeakFraction: lerp(0.55, 0.42, s),
      tNotch: (base.t > 0 ? 1 : -1) * 0.10 * s,
      tNotchFraction: 0.76,
      u: uAmp * (base.t >= 0 ? 1 : 0.5),
    };
  }
  const rate = lerp(72, 50, s);
  const qtc = lerp(0.41, 0.57, s);
  return {
    sinus: { rate, rrJitter: 0.02, qtc, intervals: { uDuration: 0.16 }, qtPartition: { stFraction: lerp(0.32, 0.2, s) }, morphology: morph },
    morphology: morph,
    settings: {
      'Heart rate': `${rate.toFixed(0)} bpm`,
      QTc: `${(qtc * 1000).toFixed(0)} ms`,
      'T amplitude factor': (1 - 0.45 * s).toFixed(2),
      'T second hump': `${(0.10 * s).toFixed(3)} mV`,
      'U amplitude': `${uAmp.toFixed(2)} mV`,
    },
  };
}


/* ---------------------------------------------------------------------- */
/* 4. Hyperkalaemia                                                         */
/* ---------------------------------------------------------------------- */

export const HYPERKALAEMIA: ToxSpec = {
  key: 'hyperkalaemia',
  label: 'Hyperkalaemia (potassium, digoxin overdose, HF acid, rhabdomyolysis)',
  examples:
    'Toxicological causes: acute digoxin poisoning, hydrofluoric acid (fluoride binds calcium and disrupts potassium channels), potassium salts, succinylcholine, potassium-sparing diuretics and ACE inhibitors in renal failure, tumour lysis, rhabdomyolysis.',
  mechanism:
    'Raised extracellular potassium depolarises the resting membrane and accelerates repolarisation (tall narrow T), then inactivates sodium channels so atrial and ventricular conduction slow (P flattening and loss, PR and QRS widening), ending in a sine-wave rhythm. LITFL: ECG changes generally do not manifest until potassium is at least about 6.0 mmol/L, and serum potassium may not correlate closely with the ECG.',
  features: [
    'The earliest manifestation is an increase in T wave amplitude: peaked T waves (Littmann and Gibbs 2018: the critical feature is "the narrowing down of the base of the T waves", not height alone; most prominent in V2 to V4)',
    'P wave widening and flattening, PR prolongation',
    'Bradyarrhythmias: sinus bradycardia, high-grade AV block with slow junctional and ventricular escape rhythms',
    'Conduction blocks (bundle branch block, fascicular blocks); QRS widening with bizarre QRS morphology, drawn here as a narrow initial r with a broad slurred S that runs straight into the tall T',
    'ST elevation in V1 and V2 with the wide QRS (Littmann and Gibbs 2018: "most frequently seen in the anterior chest leads, primarily in leads V1 and V2", often resembling a type 1 Brugada pattern)',
    'Severe (> 9.0 mmol/L): sine wave appearance (pre-terminal), ventricular fibrillation, PEA with bizarre wide complex rhythm, asystole',
  ],
  notModelled: [
    'Bundle branch and fascicular block patterns as distinct morphologies (the widening here is one generic intraventricular conduction delay pattern)',
    'Pseudo-infarction ST elevation outside V1 to V2, axis shift, and the wide-QRS PEA of the terminal phase',
    'High-grade AV block with escape (use the beta-blocker/CCB pattern for block, or the main tab)',
    'VF, PEA, asystole',
    'The stage labels map severity to approximate potassium bands; LITFL warns the correlation is loose',
  ],
  sources: [
    { title: 'LITFL ECG Library: Hyperkalaemia', url: 'https://litfl.com/hyperkalaemia-ecg-library/' },
    { title: 'LITFL Toxicology Library: Hydrofluoric acid', url: 'https://litfl.com/hydrofluric-acid/' },
    { title: 'Littmann L, Gibbs MA. Electrocardiographic manifestations of severe hyperkalemia. J Electrocardiol 2018', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0022073618304473' },
    { title: 'Mattu A, Brady WJ, Robinson DA. Electrocardiographic manifestations of hyperkalemia. Am J Emerg Med 2000', url: 'https://pubmed.ncbi.nlm.nih.gov/11043630/' },
  ],
  checklist: [
    { label: 'Tall T in V3 (> 0.8 mV here; LITFL gives no numeric cut-off)', measure: 'tAmpV3', threshold: 0.8, direction: 'above', meaning: 'earliest sign' },
    { label: 'P amplitude in II < 0.05 mV (flattened or absent)', measure: 'pAmpII', threshold: 0.05, direction: 'below', meaning: 'atrial conduction failure' },
    { label: 'PR > 200 ms', measure: 'pr', threshold: 0.2, direction: 'above', meaning: 'PR prolongation' },
    { label: 'QRS > 120 ms', measure: 'qrs', threshold: 0.12, direction: 'above', meaning: 'QRS widening' },
    { label: 'Bradycardia < 60 (conducted-beat rate)', measure: 'sinusHr', threshold: 60, direction: 'below', meaning: 'bradyarrhythmia' },
  ],
};

function hyperkalaemia(s: number): ToxResult {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  // Stage weights (smooth ramps): peaked T from the start; P loss and PR from 0.3; QRS from 0.5; sine wave from 0.85.
  const ramp = (a: number, b: number) => Math.max(0, Math.min(1, (s - a) / (b - a)));
  const wT = Math.min(1, s / 0.5);
  const wP = ramp(0.3, 0.75);
  const wQ = ramp(0.5, 0.9);
  const wSine = ramp(0.85, 1.0);
  const qrs = lerp(0.09, 0.22, wQ);
  for (const l of INDEPENDENT_LEADS) {
    const base = morph[l];
    const tSign = base.t >= 0 ? 1 : -1;
    const tBase = Math.abs(base.t);
    // Peaked T: taller, symmetric, with a narrow base (Littmann and Gibbs 2018: "the narrowing down of
    // the base of the T waves" is the critical feature). Most prominent in V2 to V4. Toward the sine
    // wave the T broadens again and fuses with the terminal QRS deflection.
    const precordialBoost = l === 'V2' || l === 'V3' || l === 'V4' ? 1.2 : 1;
    let t = tSign * (tBase * (1 + 1.6 * wT * precordialBoost) + 0.2 * wT) * (1 - 0.2 * wSine);
    // Terminal QRS widening with an intraventricular conduction delay pattern: broad S in the
    // lateral and inferior leads (I, II, V4 to V6), broad terminal S in V1 to V3 with ST elevation
    // in V1 and V2 (Littmann and Gibbs: most frequently V1 and V2, often resembling a type 1
    // Brugada pattern). The initial r stays narrow and fades toward the sine wave.
    let sAmp = base.s;
    let stJ = 0;
    if (l === 'V1' || l === 'V2') {
      sAmp = base.s * (1 + 0.4 * wQ);
      stJ = (l === 'V1' ? 0.25 : 0.2) * wQ;
      if (l === 'V1') t = lerp(t, -0.35, wQ); // coved ST with a negative T in V1 at the Brugada-like stage
    } else if (l === 'V3') {
      sAmp = base.s * (1 + 0.5 * wQ);
    } else {
      sAmp = base.s - 0.7 * wQ; // lateral and inferior leads: deep broad S
    }
    // J point on the return limb of the terminal S (no flat ST once the QRS is wide), and the tall T
    // rising from there. In V1 and V2 the J offset is the ST elevation instead.
    const c = 0.3 * wQ;
    const jLevel = stJ !== 0 ? stJ : c * sAmp;
    morph[l] = {
      ...base,
      p: base.p * (1 - 0.95 * wP),
      t,
      tSharpness: lerp(1.0, 2.5, wT) * (1 - 0.5 * wSine),
      tPeakFraction: lerp(0.55, 0.5, wT),
      r: base.r * (1 - 0.35 * wQ) * (1 - 0.4 * wSine),
      q: base.q * (1 - wSine),
      s: sAmp,
      stJ: jLevel,
      stT: jLevel,
      terminalSharpness: lerp(0.8, 1.2, wQ),
    };
  }
  const rate = lerp(72, 38, ramp(0.3, 1.0));
  const pr = lerp(0.16, 0.30, wP);
  // QT: slightly shorter early (accelerated repolarisation), then longer only because the QRS widens.
  const qtc = lerp(0.40, 0.36, wT) + 0.16 * wQ;
  const hasP = wP < 0.9;
  // Narrow-based T: a modest ST share keeps the T window short while the T is tall; the share goes to
  // zero as the QRS widens so the S runs straight into the T.
  const stFraction = lerp(0.32, 0.25, wT) * (1 - wQ);
  const stage =
    s < 0.3 ? 'about 5.5 to 6.5 mmol/L: peaked T' : s < 0.5 ? 'about 6.5 to 7.5: P flattening, PR prolongation' : s < 0.85 ? 'about 7 to 9: QRS widening, P loss, bradycardia' : 'above 9: sine wave (pre-terminal)';
  return {
    sinus: {
      rate,
      rrJitter: 0.02,
      qtc,
      intervals: {
        pr,
        qrs,
        hasP,
        pDuration: lerp(0.09, 0.13, wP),
        rPeakFraction: Math.min(0.4, 0.035 / qrs),
        sPeakFraction: lerp(0.72, 0.5, wQ),
      },
      qtPartition: { stFraction: Math.max(0.001, stFraction), minT: 0.12 },
      morphology: morph,
    },
    morphology: morph,
    stage,
    settings: {
      Stage: stage,
      'Heart rate': `${rate.toFixed(0)} bpm`,
      'T amplitude V3': `${morph.V3.t.toFixed(2)} mV`,
      'P amplitude II': hasP ? `${morph.II.p.toFixed(3)} mV` : 'absent',
      PR: `${(pr * 1000).toFixed(0)} ms`,
      'QRS duration': `${(qrs * 1000).toFixed(0)} ms`,
      'ST elevation V1': `${morph.V1.stJ?.toFixed(2) ?? '0.00'} mV`,
      'ST share of JT': stFraction.toFixed(2),
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 5. Beta-blocker and calcium-channel blocker toxicity                     */
/* ---------------------------------------------------------------------- */

export const BETA_BLOCKER_CCB: ToxSpec = {
  key: 'beta-blocker-ccb',
  label: 'Beta-blocker or calcium-channel blocker',
  variants: BB_VARIANTS,
  examples: 'Metoprolol, atenolol, propranolol, sotalol; verapamil, diltiazem (dihydropyridines cause reflex tachycardia instead and are not represented).',
  mechanism:
    'Beta blockade and L-type calcium channel blockade both depress SA node automaticity and AV node conduction. LITFL: a prolonged PR interval is an early sign of beta-blocker or calcium-channel blocker toxicity, even without significant bradycardia. Propranolol also blocks fast sodium channels and behaves more like a tricyclic in overdose (QRS widening, positive R’ in aVR); sotalol blocks potassium channels (QT prolongation, torsades).',
  features: [
    'Sinus bradycardia',
    '1st degree, 2nd degree and 3rd degree AV block',
    'Junctional bradycardia, ventricular bradycardia',
    'Prolonged PR is an early sign, even in the absence of significant bradycardia',
    'Propranolol: QRS widening and a positive R’ wave in aVR',
    'Sotalol: QT prolongation and torsades de pointes in overdose',
  ],
  notModelled: [
    'Hypotension and shock physiology (no ECG correlate is drawn)',
    'Torsades de pointes (sotalol)',
    'Hyperglycaemia of CCB poisoning versus hypoglycaemia of beta blockade (not ECG)',
    'Block type steps with severity as a scripted sequence (first degree, Wenckebach, 2:1, complete); a conduction model would make this continuous',
  ],
  sources: [
    { title: 'LITFL ECG Library: Beta-blocker and Calcium-channel blocker toxicity', url: 'https://litfl.com/beta-blocker-and-calcium-channel-blocker-toxicity/' },
    { title: 'LITFL CCC: ECG in Toxicology', url: 'https://litfl.com/ecg-in-toxicology/' },
  ],
  checklist: [
    { label: 'PR > 200 ms (early sign)', measure: 'pr', threshold: 0.2, direction: 'above', meaning: 'AV nodal depression' },
    { label: 'Bradycardia < 60 (conducted-beat rate)', measure: 'sinusHr', threshold: 60, direction: 'below', meaning: 'SA node depression or AV block' },
    { label: 'Non-conducted P waves present', measure: 'blockedPCount', threshold: 0, direction: 'above', meaning: '2nd or 3rd degree AV block' },
    { label: 'Escape beats present', measure: 'escapeCount', threshold: 0, direction: 'above', meaning: 'complete heart block' },
    { label: 'QRS > 100 ms', measure: 'qrs', threshold: 0.1, direction: 'above', meaning: 'propranolol sodium channel effect' },
    { label: 'QTc > 500 ms', measure: 'qtc', threshold: 0.5, direction: 'above', meaning: 'sotalol potassium channel effect' },
  ],
};

function betaBlockerCcb(s: number, variant: BbVariant): ToxResult {
  let morph = cloneMorphology(NORMAL_MORPHOLOGY);
  const rate = lerp(70, 38, s);
  const pr = lerp(0.17, 0.30, Math.min(1, s / 0.6));
  let block: AvBlockOptions;
  let stage: string;
  if (s < 0.35) {
    block = { type: 'first' };
    stage = 'sinus bradycardia with first-degree block';
  } else if (s < 0.6) {
    block = { type: 'wenckebach', ratio: 4, prIncrement: 0.05 };
    stage = 'Wenckebach (4:3)';
  } else if (s < 0.8) {
    block = { type: 'mobitz2', ratio: 2 };
    stage = '2:1 AV block';
  } else {
    block = { type: 'complete', escapeRate: lerp(45, 32, (s - 0.8) / 0.2), escapeFocus: s > 0.92 ? 'ventricular' : 'junctional' };
    stage = s > 0.92 ? 'complete heart block, ventricular escape' : 'complete heart block, junctional escape';
  }
  let qrs = 0.09;
  let qtc = 0.41;
  let uDuration: number | undefined;
  if (variant === 'propranolol') {
    const na = sodiumChannelBlocker(s * 0.8);
    morph = na.morphology;
    qrs = lerp(0.09, 0.16, s);
  } else if (variant === 'sotalol') {
    const k = potassiumChannelBlocker(s);
    morph = k.morphology;
    qtc = lerp(0.41, 0.55, s);
    uDuration = 0.16;
  }
  return {
    sinus: {
      rate,
      rrJitter: 0.03,
      qtc,
      intervals: { pr, qrs, ...(uDuration ? { uDuration } : {}) },
      qtPartition: { stFraction: 0.32 },
      avBlock: block,
      morphology: morph,
    },
    morphology: morph,
    stage,
    settings: {
      Variant: variant,
      Stage: stage,
      'Sinus (atrial) rate': `${rate.toFixed(0)} bpm`,
      PR: `${(pr * 1000).toFixed(0)} ms`,
      'QRS duration': `${(qrs * 1000).toFixed(0)} ms`,
      QTc: `${(qtc * 1000).toFixed(0)} ms`,
      ...(block.type === 'complete' ? { 'Escape rate': `${(block.escapeRate as number).toFixed(0)} bpm` } : {}),
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 6. Hypocalcaemia (toxicological causes)                                 */
/* ---------------------------------------------------------------------- */

export const HYPOCALCAEMIA: ToxSpec = {
  key: 'hypocalcaemia',
  label: 'Hypocalcaemia (hydrofluoric acid, ethylene glycol, citrate)',
  examples:
    'Toxicological causes: hydrofluoric acid burns or ingestion (fluoride binds calcium and magnesium), ethylene glycol (oxalate), massive citrated transfusion, EDTA. LITFL: the degree of QT prolongation is a useful biomarker of hypocalcaemia in HF acid poisoning.',
  mechanism:
    'Low extracellular calcium prolongs the action potential plateau (phase 2), so the ST segment lengthens. LITFL: hypocalcaemia causes QTc prolongation primarily by prolonging the ST segment; the T wave is typically left unchanged. Dysrhythmias are uncommon; torsades can occur but is much less common than with other electrolyte disturbances.',
  features: [
    'QTc prolongation primarily by prolonging the ST segment',
    'The T wave is typically left unchanged (contrast with potassium channel blockade, which broadens the T)',
    'Dysrhythmias are uncommon, although atrial fibrillation has been reported; torsades is possible but much less common',
  ],
  notModelled: [
    'Coexisting hyperkalaemia and hypomagnesaemia of fluoride poisoning (combine mentally with the hyperkalaemia pattern)',
    'Torsades de pointes',
    'The ST-versus-T split at a given QTc is a decree from the QT partition model (stFraction rises with severity); the source gives the direction, not numbers',
  ],
  sources: [
    { title: 'LITFL ECG Library: Hypocalcaemia', url: 'https://litfl.com/hypocalcaemia-ecg-library/' },
    { title: 'LITFL Toxicology Library: Hydrofluoric acid', url: 'https://litfl.com/hydrofluric-acid/' },
  ],
  checklist: [
    { label: 'QTc > 440 ms', measure: 'qtc', threshold: 0.44, direction: 'above', meaning: 'prolonged' },
    { label: 'QTc > 500 ms', measure: 'qtc', threshold: 0.5, direction: 'above', meaning: 'marked prolongation' },
    { label: 'J to T peak > 250 ms (ST segment prolonged; decreed cut-off)', measure: 'jtp', threshold: 0.25, direction: 'above', meaning: 'ST prolongation' },
    { label: 'T peak to end < 110 ms (T wave unchanged)', measure: 'tpe', threshold: 0.11, direction: 'below', meaning: 'T not broadened' },
  ],
};

function hypocalcaemia(s: number): ToxResult {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  const qtc = lerp(0.41, 0.56, s);
  const stFraction = lerp(0.32, 0.66, s);
  const rate = 72;
  return {
    sinus: { rate, rrJitter: 0.03, qtc, qtPartition: { stFraction, rateExponent: 0.3, minT: 0.14 }, morphology: morph },
    morphology: morph,
    settings: {
      'Heart rate': `${rate} bpm`,
      QTc: `${(qtc * 1000).toFixed(0)} ms`,
      'ST share of JT': stFraction.toFixed(2),
    },
  };
}

/* ---------------------------------------------------------------------- */

export const TOXIDROMES: Record<Toxidrome, ToxSpec> = {
  'sodium-channel-blocker': SODIUM_CHANNEL_BLOCKER,
  digoxin: DIGOXIN,
  'potassium-channel-blocker': POTASSIUM_CHANNEL_BLOCKER,
  hyperkalaemia: HYPERKALAEMIA,
  'beta-blocker-ccb': BETA_BLOCKER_CCB,
  hypocalcaemia: HYPOCALCAEMIA,
};

/** Map a toxidrome and severity (0 to 1) onto generator settings. `variant` applies to patterns that declare variants. */
export function applyToxidrome(key: Toxidrome, severity: number, variant?: string): ToxResult {
  const s = Math.max(0, Math.min(1, severity));
  switch (key) {
    case 'sodium-channel-blocker':
      return sodiumChannelBlocker(s);
    case 'digoxin':
      return digoxin(s);
    case 'potassium-channel-blocker':
      return potassiumChannelBlocker(s);
    case 'hyperkalaemia':
      return hyperkalaemia(s);
    case 'beta-blocker-ccb':
      return betaBlockerCcb(s, (variant as BbVariant) || 'cardioselective');
    case 'hypocalcaemia':
      return hypocalcaemia(s);
  }
}
