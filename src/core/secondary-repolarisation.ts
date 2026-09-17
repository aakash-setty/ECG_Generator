/**
 * Secondary repolarisation: the ST-T change that follows an abnormal
 * depolarisation sequence (bundle branch block, paced beats, ventricular
 * ectopy, sodium channel blockade). The rule, as taught for bundle branch
 * block: "The major, terminal portion of the QRS complex and the initial
 * portion of the ST segment/T wave are discordant, meaning that they are
 * located on opposite sides of the isoelectric baseline" (Emergency Medicine
 * Cases, ECG Cases 12). This module turns that rule into numbers:
 *
 *   T amplitude          =  -k * terminal deflection amplitude
 *   J point and T onset  =   c * terminal deflection amplitude
 *
 * so the J point sits on the return limb of the terminal deflection and the T
 * wave rises from there in the opposite direction. The constants k and c and
 * the T peak fraction are decrees fitted to exemplar tracings, not published
 * measurements. The rule is applied to the eight authored channels; the
 * derived limb leads follow from the Einthoven and Goldberger identities, so
 * applying the rule vectorially in the frontal plane (via frontalTerminal)
 * gives aVR, aVL, aVF and III the correct discordance automatically.
 */

import type { LeadMorphology } from './beat.js';
import type { IndependentLead, IndependentSet } from './leads.js';
import { LIMB_LEAD_VECTORS } from './st-territory.js';

export interface SecondaryRepolOptions {
  /** T amplitude as a multiple of the terminal deflection, opposite sign. Default 0.8. */
  k?: number;
  /** J point (and T onset) level as a multiple of the terminal deflection, same sign. Default 0.3. */
  c?: number;
  /** Where the T peak sits inside the T window. Default 0.5 (symmetric dome). */
  tPeakFraction?: number;
  /**
   * Blend weight 0..1 between the lead's existing T/ST (0) and the secondary
   * rule (1). Lets a severity slider move smoothly from normal repolarisation
   * to fully secondary repolarisation. Default 1.
   */
  weight?: number;
}

/** Amplitude of the last QRS deflection in a lead (R' if present, else S, else R, else Q). */
export function terminalDeflection(m: LeadMorphology): number {
  if ((m.rPrime ?? 0) !== 0) return m.rPrime as number;
  if (m.s !== 0) return m.s;
  if (m.r !== 0) return m.r;
  return m.q;
}

/**
 * Apply the secondary repolarisation rule to the leads named in `leads`
 * (default: all eight authored channels), in place. Leads whose terminal
 * deflection is zero are left alone.
 */
export function applySecondaryRepolarisation(
  morph: IndependentSet<LeadMorphology>,
  opts: SecondaryRepolOptions = {},
  leads: readonly IndependentLead[] = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'],
): void {
  const k = opts.k ?? 0.8;
  const c = opts.c ?? 0.3;
  const w = Math.min(1, Math.max(0, opts.weight ?? 1));
  const tpf = opts.tPeakFraction ?? 0.5;
  for (const lead of leads) {
    const m = morph[lead];
    const term = terminalDeflection(m);
    if (term === 0) continue;
    const t0 = m.t;
    const j0 = m.stJ ?? 0;
    const tt0 = m.stT ?? j0;
    const tpf0 = m.tPeakFraction ?? 0.55;
    morph[lead] = {
      ...m,
      t: (1 - w) * t0 + w * (-k * term),
      stJ: (1 - w) * j0 + w * (c * term),
      stT: (1 - w) * tt0 + w * (c * term),
      tPeakFraction: (1 - w) * tpf0 + w * tpf,
    };
  }
}

/**
 * Projection of a frontal-plane vector of magnitude M (mV) at axisDeg
 * (hexaxial convention: 0° is lead I, +90° is aVF) onto leads I and II.
 * Adding the result to the terminal deflection of I and II makes the
 * derived leads carry the same vector by construction.
 */
export function frontalTerminal(M: number, axisDeg: number): { I: number; II: number } {
  const rad = (axisDeg * Math.PI) / 180;
  const vx = M * Math.cos(rad);
  const vy = M * Math.sin(rad);
  const proj = (lead: 'I' | 'II') => vx * LIMB_LEAD_VECTORS[lead][0] + vy * LIMB_LEAD_VECTORS[lead][1];
  return { I: proj('I'), II: proj('II') };
}
