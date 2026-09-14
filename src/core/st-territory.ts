/**
 * ST elevation by territory, with reciprocal change.
 *
 * Two different mechanisms produce "reciprocal" depression here, and it is
 * worth being clear which is which.
 *
 * 1. Frontal plane (limb leads). The six limb leads are projections of ONE
 *    two-dimensional vector, so they cannot be set independently. We author a
 *    frontal-plane ST vector by least-squares fitting the requested limb-lead
 *    levels, write the fitted values into leads I and II (the two channels we
 *    generate), and let III, aVR, aVL and aVF fall out of the Einthoven and
 *    Goldberger identities. Reciprocal depression in aVL during inferior
 *    elevation is therefore not authored at all; it is the geometry.
 *
 * 2. Precordial leads. V1 to V6 are generated independently, so any
 *    reciprocal change there (inferior depression during anterior injury,
 *    anterior depression as the mirror of posterior injury) is authored as a
 *    per-lead weight. No physics enforces it.
 *
 * Lead unit vectors (hexaxial reference, degrees): I 0, II +60, III +120,
 * aVR -150, aVL -30, aVF +90. The augmented leads carry a factor of sqrt(3)/2
 * relative to the bipolar leads under the standard derivation
 * (aVL = I - II/2, etc.), which the fit accounts for.
 *
 * The territory tables below are textbook-typical lead patterns, hand-set.
 * Weights are relative to the requested magnitude; negative weights are
 * reciprocal depression.
 */

import type { LeadMorphology } from './beat.js';
import { INDEPENDENT_LEADS, type IndependentSet, type LeadName } from './leads.js';
import { applyStShift, type StType, type TPolarity } from './st-morphology.js';

export type LimbLead = 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF';
export type PrecordialLead = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

const DEG = Math.PI / 180;
const AUG = Math.sqrt(3) / 2;

/** Unit vector (x, y) each limb lead projects onto, including the augmented-lead scale factor. */
export const LIMB_LEAD_VECTORS: Record<LimbLead, [number, number]> = {
  I: [1, 0],
  II: [Math.cos(60 * DEG), Math.sin(60 * DEG)],
  III: [Math.cos(120 * DEG), Math.sin(120 * DEG)],
  aVR: [AUG * Math.cos(-150 * DEG), AUG * Math.sin(-150 * DEG)],
  aVL: [AUG * Math.cos(-30 * DEG), AUG * Math.sin(-30 * DEG)],
  aVF: [AUG * Math.cos(90 * DEG), AUG * Math.sin(90 * DEG)],
};

export interface FrontalFit {
  /** Fitted ST vector components, mV. */
  vx: number;
  vy: number;
  magnitude: number;
  /** Axis in degrees on the hexaxial system (0 = lead I, +90 = aVF). */
  axisDeg: number;
  /** What each limb lead will actually show, mV. */
  fitted: Record<LimbLead, number>;
  /** Fitted minus requested for the leads that were requested, mV. */
  residuals: Partial<Record<LimbLead, number>>;
  rms: number;
}

/** Axis in degrees, hexaxial convention: 0 = lead I, +90 = aVF, range (-180, 180]. */
export function axisDegrees(vx: number, vy: number): number {
  const a = Math.atan2(vy, vx) / DEG;
  return a > 180 ? a - 360 : a;
}

/**
 * Least-squares fit of a frontal-plane vector to requested limb-lead values.
 * With two unknowns and up to six equations the request is usually
 * over-determined; the residuals say how far the requested pattern is from
 * anything a single frontal vector can produce.
 */
export function fitFrontalVector(targets: Partial<Record<LimbLead, number>>): FrontalFit {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  const entries = Object.entries(targets) as Array<[LimbLead, number]>;
  for (const [lead, z] of entries) {
    const [x, y] = LIMB_LEAD_VECTORS[lead];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  let vx = 0;
  let vy = 0;
  if (entries.length === 1) {
    // Under-determined: put the vector along the single requested lead.
    const [lead, z] = entries[0]!;
    const [x, y] = LIMB_LEAD_VECTORS[lead];
    const n2 = x * x + y * y;
    vx = (z * x) / n2;
    vy = (z * y) / n2;
  } else if (Math.abs(det) > 1e-12) {
    vx = (syy * sxz - sxy * syz) / det;
    vy = (sxx * syz - sxy * sxz) / det;
  }
  const fitted = {} as Record<LimbLead, number>;
  for (const lead of Object.keys(LIMB_LEAD_VECTORS) as LimbLead[]) {
    const [x, y] = LIMB_LEAD_VECTORS[lead];
    fitted[lead] = vx * x + vy * y;
  }
  const residuals: Partial<Record<LimbLead, number>> = {};
  let ss = 0;
  for (const [lead, z] of entries) {
    const r = fitted[lead] - z;
    residuals[lead] = r;
    ss += r * r;
  }
  return {
    vx,
    vy,
    magnitude: Math.hypot(vx, vy),
    axisDeg: axisDegrees(vx, vy),
    fitted,
    residuals,
    rms: entries.length ? Math.sqrt(ss / entries.length) : 0,
  };
}

/* ---------------------------------------------------------------------- */
/* Territories                                                             */
/* ---------------------------------------------------------------------- */

export type Territory =
  | 'inferior'
  | 'inferior-lcx'
  | 'anterior'
  | 'anteroseptal'
  | 'anterolateral'
  | 'lateral'
  | 'high-lateral'
  | 'posterior'
  | 'diffuse';

export interface TerritoryDefinition {
  key: Territory;
  label: string;
  description: string;
  /** Requested limb-lead levels as multiples of the magnitude. Fitted, not applied directly. */
  limb: Partial<Record<LimbLead, number>>;
  /** Precordial levels as multiples of the magnitude; negative = reciprocal depression. Applied directly. */
  precordial: Partial<Record<PrecordialLead, number>>;
}

export const TERRITORIES: Record<Territory, TerritoryDefinition> = {
  inferior: {
    key: 'inferior',
    label: 'Inferior (RCA pattern, III > II)',
    description: 'Elevation II, III, aVF with III > II; reciprocal depression in aVL (and often I). aVL depression emerges from the frontal-plane geometry.',
    limb: { III: 1.0, II: 0.75, aVF: 0.95, aVL: -0.5, I: -0.2 },
    precordial: {},
  },
  'inferior-lcx': {
    key: 'inferior-lcx',
    label: 'Inferior (LCx pattern, II >= III)',
    description: 'Elevation II, III, aVF with II at least III; aVL near isoelectric or mildly depressed.',
    limb: { II: 1.0, III: 0.8, aVF: 0.95, aVL: -0.2 },
    precordial: { V5: 0.3, V6: 0.35 },
  },
  anterior: {
    key: 'anterior',
    label: 'Anterior (LAD)',
    description: 'Elevation V2 to V4 (maximal V3); inferior reciprocal depression, most in III, is authored as a limb-lead target.',
    limb: { III: -0.35, aVF: -0.2, aVL: 0.25 },
    precordial: { V1: 0.3, V2: 0.85, V3: 1.0, V4: 0.85, V5: 0.4 },
  },
  anteroseptal: {
    key: 'anteroseptal',
    label: 'Anteroseptal (proximal LAD)',
    description: 'Elevation V1 to V3, with V1 involvement; aVR may rise; inferior reciprocal depression.',
    limb: { III: -0.3, aVF: -0.15, aVR: 0.25 },
    precordial: { V1: 0.7, V2: 1.0, V3: 0.9, V4: 0.45 },
  },
  anterolateral: {
    key: 'anterolateral',
    label: 'Anterolateral',
    description: 'Elevation V3 to V6 with I and aVL; reciprocal depression III and aVF.',
    limb: { I: 0.5, aVL: 0.6, III: -0.5, aVF: -0.3 },
    precordial: { V2: 0.4, V3: 0.85, V4: 1.0, V5: 0.9, V6: 0.6 },
  },
  lateral: {
    key: 'lateral',
    label: 'Lateral',
    description: 'Elevation I, aVL, V5, V6; reciprocal depression III, aVF, and mild V1 to V2.',
    limb: { I: 0.7, aVL: 0.8, III: -0.6, aVF: -0.3 },
    precordial: { V1: -0.2, V2: -0.2, V5: 1.0, V6: 0.9 },
  },
  'high-lateral': {
    key: 'high-lateral',
    label: 'High lateral (aVL, I; D1 / LCx branch)',
    description: 'Elevation aVL and I with reciprocal depression in III (and aVF); sometimes V2 elevation. Subtle in practice; magnitude often small.',
    limb: { aVL: 1.0, I: 0.6, III: -0.7, aVF: -0.4 },
    precordial: { V2: 0.25 },
  },
  posterior: {
    key: 'posterior',
    label: 'Posterior (mirror in V1 to V3)',
    description: 'Horizontal ST depression V1 to V3 with upright T as the anterior mirror of posterior elevation. V7 to V9 are not modelled. Inferior involvement optional.',
    limb: { III: 0.3, aVF: 0.3, II: 0.25 },
    precordial: { V1: -0.8, V2: -1.0, V3: -0.8 },
  },
  diffuse: {
    key: 'diffuse',
    label: 'Diffuse (non-territorial, pericarditis-like)',
    description:
      'Elevation in most leads without a coronary territory. aVR depression and mild aVL elevation follow from the frontal geometry. PR-segment depression, the other pericarditis sign, is not modelled yet.',
    limb: { I: 0.6, II: 1.0, III: 0.6, aVF: 0.9 },
    precordial: { V2: 0.6, V3: 0.9, V4: 1.0, V5: 1.0, V6: 0.8 },
  },
};

export const TERRITORY_KEYS: Territory[] = ['inferior', 'inferior-lcx', 'anterior', 'anteroseptal', 'anterolateral', 'lateral', 'high-lateral', 'posterior', 'diffuse'];

export interface ApplyTerritoryOptions {
  /** Shape for leads with elevation. */
  elevationType: StType;
  /** Shape for leads with depression (reciprocal). Default straight-horizontal. */
  depressionType?: StType;
  tPolarity?: TPolarity;
  /** Leads below this absolute level (mV) are left untouched. Default 0.02. */
  minLevel?: number;
}

export interface ApplyTerritoryResult {
  morphology: IndependentSet<LeadMorphology>;
  frontal: FrontalFit;
  /** Level actually applied per authored channel, mV. */
  applied: Partial<Record<LeadName, number>>;
}

/** Author a territory onto an 8-channel morphology set. `magnitude` is the J-point elevation, mV, that a weight of 1.0 maps to. */
export function applyTerritory(
  base: IndependentSet<LeadMorphology>,
  territory: Territory,
  magnitude: number,
  opts: ApplyTerritoryOptions,
): ApplyTerritoryResult {
  const def = TERRITORIES[territory];
  const depType = opts.depressionType ?? 'straight-horizontal';
  const minLevel = opts.minLevel ?? 0.02;

  const limbTargets: Partial<Record<LimbLead, number>> = {};
  for (const [lead, w] of Object.entries(def.limb) as Array<[LimbLead, number]>) limbTargets[lead] = w * magnitude;
  const frontal = fitFrontalVector(limbTargets);

  const out = {} as IndependentSet<LeadMorphology>;
  const applied: Partial<Record<LeadName, number>> = {};
  for (const lead of INDEPENDENT_LEADS) {
    let level = 0;
    if (lead === 'I' || lead === 'II') level = frontal.fitted[lead];
    else level = (def.precordial[lead as PrecordialLead] ?? 0) * magnitude;
    if (Math.abs(level) < minLevel) {
      out[lead] = applyStShift(base[lead], 'none', 0);
      continue;
    }
    const type = level > 0 ? opts.elevationType : depType;
    out[lead] = applyStShift(base[lead], type, level, { tPolarity: opts.tPolarity ?? 'default' });
    applied[lead] = level;
  }
  return { morphology: out, frontal, applied };
}
