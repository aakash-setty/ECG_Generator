/**
 * L4: the lead set.
 *
 * A 12-lead ECG has 8 independent channels. Real machines acquire I, II and
 * V1 to V6 and compute the other four. We do the same, so III, aVR, aVL and
 * aVF are correct by construction:
 *
 *   III = II - I                (Einthoven)
 *   aVR = -(I + II) / 2         (Goldberger)
 *   aVL =  I - II / 2
 *   aVF =  II - I / 2
 *   aVR + aVL + aVF = 0
 */

import type { LeadMorphology } from './beat.js';

export const INDEPENDENT_LEADS = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;
export const DERIVED_LEADS = ['III', 'aVR', 'aVL', 'aVF'] as const;
export const ALL_LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;

export type IndependentLead = (typeof INDEPENDENT_LEADS)[number];
export type DerivedLead = (typeof DERIVED_LEADS)[number];
export type LeadName = (typeof ALL_LEADS)[number];

export type IndependentSet<T> = Record<IndependentLead, T>;
export type LeadSet<T> = Record<LeadName, T>;

export function deriveLimbLeads(I: Float64Array, II: Float64Array): Record<DerivedLead, Float64Array> {
  if (I.length !== II.length) throw new Error('deriveLimbLeads: I and II must have equal length');
  const n = I.length;
  const III = new Float64Array(n);
  const aVR = new Float64Array(n);
  const aVL = new Float64Array(n);
  const aVF = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = I[i] ?? 0;
    const b = II[i] ?? 0;
    III[i] = b - a;
    aVR[i] = -(a + b) / 2;
    aVL[i] = a - b / 2;
    aVF[i] = b - a / 2;
  }
  return { III, aVR, aVL, aVF };
}

/**
 * Typical adult sinus-rhythm amplitudes in mV.
 *
 * STATUS: these are approximate textbook-typical values chosen by hand so the
 * output looks like a normal ECG. They have NOT been fitted to a real corpus.
 * Fitting distributions to PTB-XL is a planned later phase; until then treat
 * every number here as a placeholder with roughly the right order of magnitude.
 */
export const NORMAL_MORPHOLOGY: IndependentSet<LeadMorphology> = {
  I: { p: 0.08, q: -0.03, r: 0.6, s: -0.1, t: 0.25 },
  II: { p: 0.15, q: -0.05, r: 1.1, s: -0.15, t: 0.35 },
  V1: { p: 0.05, q: 0, r: 0.2, s: -1.0, t: -0.1 },
  V2: { p: 0.05, q: 0, r: 0.4, s: -1.6, t: 0.5 },
  V3: { p: 0.05, q: 0, r: 0.8, s: -1.2, t: 0.6 },
  V4: { p: 0.06, q: -0.02, r: 1.5, s: -0.6, t: 0.5 },
  V5: { p: 0.06, q: -0.04, r: 1.5, s: -0.3, t: 0.4 },
  V6: { p: 0.06, q: -0.05, r: 1.2, s: -0.15, t: 0.3 },
};

export function cloneMorphology(m: IndependentSet<LeadMorphology>): IndependentSet<LeadMorphology> {
  const out = {} as IndependentSet<LeadMorphology>;
  for (const l of INDEPENDENT_LEADS) out[l] = { ...m[l] };
  return out;
}
