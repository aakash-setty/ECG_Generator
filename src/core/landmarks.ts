/**
 * L2: the landmark timeline.
 *
 * Landmarks are primary, shapes are secondary. You set the clinical
 * intervals; the wave shapes are then fitted inside the resulting windows.
 * PR, QRS duration and QT are therefore exact by construction, because they
 * are differences between numbers you chose.
 *
 * All times are absolute seconds. QRS onset is the beat's reference time.
 */

export interface BeatIntervals {
  /** P wave duration, s. Typical 0.08 to 0.11. */
  pDuration: number;
  /** PR interval, P onset to QRS onset, s. Typical 0.12 to 0.20. */
  pr: number;
  /** QRS duration, QRS onset to J point, s. Typical 0.07 to 0.10. */
  qrs: number;
  /** ST segment, J point to T onset, s. Typical 0.08 to 0.12. */
  st: number;
  /** QT interval, QRS onset to T offset, s. */
  qt: number;
  /** Whether a P wave is present (false for junctional or ventricular beats). */
  hasP?: boolean;
  /** Render only the P wave (a non-conducted atrial impulse). The QRS/T landmarks are still computed but nothing is drawn for them. */
  pOnly?: boolean;
  /** Position of P peak within the P window, 0 to 1. Default 0.5. */
  pPeakFraction?: number;
  /** Position of T peak within [T onset, T offset], 0 to 1. Default 0.55 (T is asymmetric: slower upslope). */
  tPeakFraction?: number;
  /** Q peak time as a fraction of QRS duration. Default 0.12. */
  qPeakFraction?: number;
  /** R peak time as a fraction of QRS duration. Default 0.40. */
  rPeakFraction?: number;
  /** S peak time as a fraction of QRS duration. Default 0.72. */
  sPeakFraction?: number;
  /** Terminal R' peak time as a fraction of QRS duration (used only when a lead has rPrime != 0). Default 0.88. */
  rPrimePeakFraction?: number;
  /** U wave duration, s. 0 or undefined means no U wave. The U window starts at T offset. */
  uDuration?: number;
  /** Position of the U peak within the U window. Default 0.5. */
  uPeakFraction?: number;
}

export const NORMAL_INTERVALS: BeatIntervals = {
  pDuration: 0.09,
  pr: 0.16,
  qrs: 0.09,
  st: 0.10,
  qt: 0.40,
  hasP: true,
};

export interface BeatLandmarks {
  pOn: number | null;
  pPeak: number | null;
  pOff: number | null;
  qrsOn: number;
  qPeak: number;
  rPeak: number;
  sPeak: number;
  /** J point = QRS offset. */
  j: number;
  tOn: number;
  tPeak: number;
  tOff: number;
  /** Terminal R' peak (inside the QRS, after the S peak). */
  rPrimePeak: number;
  uOn: number | null;
  uPeak: number | null;
  uOff: number | null;
  /** End of the beat's last wave (U offset if present, otherwise T offset). */
  end: number;
}

export function validateIntervals(iv: BeatIntervals): void {
  const problems: string[] = [];
  if (!(iv.qrs > 0)) problems.push('qrs must be > 0');
  if (!(iv.st >= 0)) problems.push('st must be >= 0');
  if (!(iv.qt > iv.qrs + iv.st)) problems.push(`qt (${iv.qt}) must exceed qrs + st (${iv.qrs + iv.st})`);
  if (iv.hasP !== false) {
    if (!(iv.pDuration > 0)) problems.push('pDuration must be > 0');
    if (!(iv.pr >= iv.pDuration)) problems.push(`pr (${iv.pr}) must be >= pDuration (${iv.pDuration}) so the PR segment is not negative`);
  }
  const q = iv.qPeakFraction ?? 0.12;
  const r = iv.rPeakFraction ?? 0.4;
  const s = iv.sPeakFraction ?? 0.72;
  const rp = iv.rPrimePeakFraction ?? 0.88;
  if (!(0 < q && q < r && r < s && s < rp && rp < 1)) problems.push('need 0 < qPeakFraction < rPeakFraction < sPeakFraction < rPrimePeakFraction < 1');
  if (iv.uDuration !== undefined && iv.uDuration < 0) problems.push('uDuration must be >= 0');
  if (problems.length) throw new Error('Invalid intervals: ' + problems.join('; '));
}

/** Build the absolute landmark timeline for one beat whose QRS onset is at qrsOn. */
export function landmarksFromIntervals(iv: BeatIntervals, qrsOn: number): BeatLandmarks {
  validateIntervals(iv);
  const hasP = iv.hasP !== false;
  const pOn = hasP ? qrsOn - iv.pr : null;
  const pOff = hasP ? qrsOn - iv.pr + iv.pDuration : null;
  const pPeak = hasP ? (pOn as number) + (iv.pPeakFraction ?? 0.5) * iv.pDuration : null;
  const j = qrsOn + iv.qrs;
  const tOn = j + iv.st;
  const tOff = qrsOn + iv.qt;
  const tPeak = tOn + (iv.tPeakFraction ?? 0.55) * (tOff - tOn);
  const hasU = (iv.uDuration ?? 0) > 0;
  const uOn = hasU ? tOff : null;
  const uOff = hasU ? tOff + (iv.uDuration as number) : null;
  const uPeak = hasU ? tOff + (iv.uPeakFraction ?? 0.5) * (iv.uDuration as number) : null;
  return {
    pOn,
    pPeak,
    pOff,
    qrsOn,
    qPeak: qrsOn + (iv.qPeakFraction ?? 0.12) * iv.qrs,
    rPeak: qrsOn + (iv.rPeakFraction ?? 0.4) * iv.qrs,
    sPeak: qrsOn + (iv.sPeakFraction ?? 0.72) * iv.qrs,
    rPrimePeak: qrsOn + (iv.rPrimePeakFraction ?? 0.88) * iv.qrs,
    j,
    tOn,
    tPeak,
    tOff,
    uOn,
    uPeak,
    uOff,
    end: iv.pOnly && pOff !== null ? pOff : uOff ?? tOff,
  };
}

/** Intervals implied by a landmark set. Used by tests to confirm the timeline is self-consistent. */
export function intervalsFromLandmarks(lm: BeatLandmarks): { pr: number | null; qrs: number; st: number; qt: number } {
  return {
    pr: lm.pOn === null ? null : lm.qrsOn - lm.pOn,
    qrs: lm.j - lm.qrsOn,
    st: lm.tOn - lm.j,
    qt: lm.tOff - lm.qrsOn,
  };
}

/* ---------------------------------------------------------------------- */
/* Rate corrections                                                        */
/* ---------------------------------------------------------------------- */

/** Bazett: QT = QTc * sqrt(RR). RR in seconds. */
export function qtFromBazett(qtc: number, rr: number): number {
  return qtc * Math.sqrt(rr);
}

/** Fridericia: QT = QTc * RR^(1/3). */
export function qtFromFridericia(qtc: number, rr: number): number {
  return qtc * Math.cbrt(rr);
}

export function qtcBazett(qt: number, rr: number): number {
  return qt / Math.sqrt(rr);
}
