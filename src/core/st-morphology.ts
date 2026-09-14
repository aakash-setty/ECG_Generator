/**
 * ST segment morphology types.
 *
 * Maps a named morphology plus a signed J-point level (mV) onto the per-lead
 * parameters the beat layer understands: ST level at J, ST level at T onset,
 * body shape exponent, and T-wave amplitude, sharpness and peak position.
 *
 * The morphology vocabulary follows the common teaching split of ischaemic
 * ST elevation into convex (coved) and straight (upsloping, horizontal,
 * downsloping) variants, with concave-upward elevation as the shape more often
 * seen in non-ischaemic causes. The shape rule is a heuristic with limited
 * sensitivity: Brady et al. (2001) reported that a non-concave morphology had
 * high specificity but only moderate sensitivity for AMI, and concave elevation
 * occurs in a substantial fraction of LAD occlusions (see README). Nothing here
 * should be read as a diagnostic claim; it is a shape library.
 *
 * All numeric factors below are STYLISATIONS chosen so the rendered segment
 * matches the textbook drawing of each type. They are not fitted to data.
 */

import type { LeadMorphology } from './beat.js';

export type StType =
  | 'none'
  | 'concave'
  | 'convex'
  | 'straight-upsloping'
  | 'straight-horizontal'
  | 'straight-downsloping'
  | 'tombstone';

export type TPolarity = 'default' | 'upright' | 'inverted';

export interface StTypeDefinition {
  key: StType;
  label: string;
  /** Whether the teaching literature files this shape under ischaemic elevation. */
  ischaemicPattern: boolean;
  description: string;
  /** Change in level from J to T onset, as a fraction of |level|. Positive means the segment rises. */
  slopeFactor: number;
  /** Body shape exponent. 1 linear, < 1 fast early change (convex), > 1 slow early change (concave). */
  shape: number;
  /** T amplitude = tScale * |baseline T| * polaritySign + tAdd * |level| * polaritySign. */
  tScale: number;
  tAdd: number;
  tSharpness?: number;
  tPeakFraction?: number;
  /** Multipliers on R and S amplitudes (tombstone loses the R wave). */
  rScale?: number;
  sScale?: number;
  defaultTPolarity: 'upright' | 'inverted';
}

export const ST_TYPES: Record<Exclude<StType, 'none'>, StTypeDefinition> = {
  concave: {
    key: 'concave',
    label: 'Concave upward',
    ischaemicPattern: false,
    description:
      'Segment bows downward then rises into the T wave (the "smiley"). Typical of pericarditis and early repolarisation, but also seen in a substantial minority of LAD occlusions.',
    slopeFactor: 0.5,
    shape: 1.9,
    tScale: 1.3,
    tAdd: 0.2,
    tSharpness: 1.0,
    defaultTPolarity: 'upright',
  },
  convex: {
    key: 'convex',
    label: 'Convex (coved)',
    ischaemicPattern: true,
    description: 'Segment rises steeply right after J then bows over into a dome that merges with the T wave (the "frowny"). The classic transmural injury shape.',
    slopeFactor: 0.2,
    shape: 0.45,
    tScale: 1.15,
    tAdd: 0.5,
    tSharpness: 0.8,
    tPeakFraction: 0.42,
    defaultTPolarity: 'upright',
  },
  'straight-upsloping': {
    key: 'straight-upsloping',
    label: 'Straight, upsloping',
    ischaemicPattern: true,
    description: 'Linear segment climbing from J to the T wave. For depression, rises back toward baseline.',
    slopeFactor: 0.6,
    shape: 1.0,
    tScale: 1.1,
    tAdd: 0.3,
    defaultTPolarity: 'upright',
  },
  'straight-horizontal': {
    key: 'straight-horizontal',
    label: 'Straight, horizontal',
    ischaemicPattern: true,
    description: 'Flat shelf at the J-point level until the T wave begins.',
    slopeFactor: 0.0,
    shape: 1.0,
    tScale: 1.0,
    tAdd: 0.2,
    defaultTPolarity: 'upright',
  },
  'straight-downsloping': {
    key: 'straight-downsloping',
    label: 'Straight, downsloping',
    ischaemicPattern: true,
    description: 'Linear segment falling from J toward the T wave. Less common in elevation; often accompanied by T inversion. For depression, goes deeper.',
    slopeFactor: -0.45,
    shape: 1.0,
    tScale: 0.8,
    tAdd: 0.3,
    defaultTPolarity: 'inverted',
  },
  tombstone: {
    key: 'tombstone',
    label: 'Tombstone',
    ischaemicPattern: true,
    description: 'Massive convex elevation with loss of the R wave; QRS, ST and T fuse into one dome. Stylised.',
    slopeFactor: 0.15,
    shape: 0.3,
    tScale: 0.6,
    tAdd: 1.2,
    tSharpness: 0.7,
    tPeakFraction: 0.4,
    rScale: 0.45,
    sScale: 0.25,
    defaultTPolarity: 'upright',
  },
};

export const ST_TYPE_KEYS: StType[] = ['none', 'concave', 'convex', 'straight-upsloping', 'straight-horizontal', 'straight-downsloping', 'tombstone'];

export interface ApplyStOptions {
  tPolarity?: TPolarity;
}

/**
 * Return a copy of `m` with the ST-T parameters set for the given morphology
 * and signed J-point level (mV, negative for depression). `level === 0` or
 * type 'none' clears ST parameters but leaves the rest untouched.
 *
 * Direction words are about the segment's slope, not the sign of the shift:
 * "upsloping" always means the level rises between J and T onset, so upsloping
 * depression rises back toward baseline and upsloping elevation climbs further.
 */
export function applyStShift(m: LeadMorphology, type: StType, level: number, opts: ApplyStOptions = {}): LeadMorphology {
  const base: LeadMorphology = { ...m };
  delete base.stJ;
  delete base.stT;
  delete base.stShape;
  delete base.tPeakFraction;
  if (type === 'none' || level === 0) return base;

  const def = ST_TYPES[type];
  const mag = Math.abs(level);
  const stJ = level;
  const stT = level + def.slopeFactor * mag;

  const polarity = opts.tPolarity ?? 'default';
  const sign = polarity === 'upright' ? 1 : polarity === 'inverted' ? -1 : def.defaultTPolarity === 'inverted' ? -1 : 1;
  // Depression variants keep the T upright unless asked otherwise; the inverted
  // default of the downsloping type is meant for elevation.
  const effSign = level < 0 && polarity === 'default' ? 1 : sign;
  const t = effSign * (def.tScale * Math.abs(m.t) + def.tAdd * mag);

  const out: LeadMorphology = { ...base, stJ, stT, stShape: def.shape, t };
  if (def.tSharpness !== undefined) out.tSharpness = def.tSharpness;
  if (def.tPeakFraction !== undefined) out.tPeakFraction = def.tPeakFraction;
  if (def.rScale !== undefined) out.r = m.r * def.rScale;
  if (def.sScale !== undefined) out.s = m.s * def.sScale;
  return out;
}
