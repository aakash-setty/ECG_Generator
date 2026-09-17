/**
 * L8: delineation and measurement.
 *
 * READS SAMPLES ONLY. This module must not import from the generator layers
 * (deflections, landmarks, beat, leads, sequencer). Its job is to measure a
 * signal the way an ECG machine would, with no knowledge of how it was made,
 * so that a round-trip test (request -> generate -> measure -> compare) is
 * meaningful.
 *
 * STATUS: this delineator has NOT been validated against human-annotated
 * wave boundaries (for example the QT Database or LUDB). Until it is, a
 * passing round-trip test proves the generator and the delineator agree with
 * each other, not that either agrees with a cardiologist. See README.
 *
 * Onsets and offsets are found by amplitude-threshold crossing relative to
 * the baseline, plus slope criteria for the QRS. Threshold delineation lags a
 * smooth onset by a few milliseconds by its nature; the thresholds are explicit
 * parameters so that lag is a known quantity rather than a hidden one.
 */

export interface DelineatorOptions {
  /** Amplitude threshold for wave onset/offset detection, mV. Default 0.005 (5 microvolts). */
  ampThreshold?: number;
  /** Minimum absolute amplitude to accept a candidate P wave, mV. Default 0.02. */
  pMinAmplitude?: number;
  /** Minimum absolute amplitude to accept a candidate T wave, mV. Default 0.03. */
  tMinAmplitude?: number;
  /** Fraction of the maximum absolute slope used to detect QRS regions. Default 0.30. */
  qrsSlopeFraction?: number;
  /** Fraction of the maximum absolute slope below which the QRS is considered ended. Default 0.02. */
  qrsEndSlopeFraction?: number;
  /** Absolute floor for the QRS-end slope threshold, mV/s. Default 3. An upsloping ST segment (1 to 3 mV/s) must count as "not QRS". */
  qrsEndSlopeFloor?: number;
  /** Cap on the QRS-end slope threshold, mV/s. Default 8. The threshold is min(cap, 0.1 * max slope), never below the floor. */
  qrsEndSlopeCap?: number;
  /** Refractory period after a QRS detection, s. Default 0.15. */
  refractory?: number;
}

export interface BeatMeasurement {
  /** Sample index and time of the QRS detection (largest absolute deflection). */
  qrsPeakIndex: number;
  qrsPeak: number;
  qrsPeakAmplitude: number;
  qrsOn: number;
  j: number;
  qrsDuration: number;
  pOn: number | null;
  pPeak: number | null;
  pOff: number | null;
  pAmplitude: number | null;
  pr: number | null;
  tPeak: number | null;
  tOff: number | null;
  tAmplitude: number | null;
  qt: number | null;
  /** ST level at J and at J + 60 ms, mV relative to baseline. */
  stJ: number;
  st60: number;
  /** Largest positive and most negative excursions inside the QRS, mV. */
  rAmplitude: number;
  sAmplitude: number;
}

export interface StripMeasurement {
  baseline: number;
  beats: BeatMeasurement[];
  /** RR intervals between successive QRS onsets, s. */
  rr: number[];
  heartRate: number | null;
  meanPr: number | null;
  meanQrs: number | null;
  meanQt: number | null;
  /** Bazett, from mean QT and mean RR. */
  qtcBazett: number | null;
}

/** Central-difference derivative in mV/s. */
function derivative(v: Float64Array, fs: number): Float64Array {
  const n = v.length;
  const d = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) d[i] = (((v[i + 1] ?? 0) - (v[i - 1] ?? 0)) * fs) / 2;
  return d;
}

/**
 * Onset refinement. Starting near a wave's beginning, return the index of the
 * first sample at or above the amplitude threshold. Works whether the start
 * index is already at baseline (walks forward) or inside the wave (walks back).
 */
function refineOnset(v: Float64Array, b: number, start: number, thr: number, limit: number): number {
  let k = Math.max(0, start);
  let steps = 0;
  while (k < v.length - 1 && Math.abs((v[k] ?? 0) - b) < thr && steps++ < limit) k++;
  steps = 0;
  while (k > 0 && Math.abs((v[k - 1] ?? 0) - b) >= thr && steps++ < limit) k--;
  return k;
}

/** Offset refinement: index of the last sample at or above the threshold, searching from `start`. */
function refineOffset(v: Float64Array, b: number, start: number, thr: number, limit: number): number {
  let k = Math.min(v.length - 1, start);
  let steps = 0;
  while (k > 0 && Math.abs((v[k] ?? 0) - b) < thr && steps++ < limit) k--;
  steps = 0;
  while (k < v.length - 1 && Math.abs((v[k + 1] ?? 0) - b) >= thr && steps++ < limit) k++;
  return k;
}

/**
 * Baseline estimate: the mode of the amplitude histogram (bin width = ampThreshold),
 * refined as the mean of samples within one bin of the mode. The isoelectric
 * segments are the most populated amplitude in any strip without gross wander.
 * Global, not per beat; baseline drift is not modelled in v0.
 */
function estimateBaseline(v: Float64Array, bin: number): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < v.length; i++) {
    const k = Math.round((v[i] ?? 0) / bin);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bestK = 0;
  let bestC = -1;
  for (const [k, c] of counts) {
    if (c > bestC) {
      bestC = c;
      bestK = k;
    }
  }
  const centre = bestK * bin;
  let s = 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0;
    if (Math.abs(x - centre) <= bin) {
      s += x;
      n++;
    }
  }
  return n ? s / n : centre;
}

export function delineate(v: Float64Array, fs: number, opts: DelineatorOptions = {}): StripMeasurement {
  const ampThr = opts.ampThreshold ?? 0.005;
  const pMin = opts.pMinAmplitude ?? 0.02;
  const tMin = opts.tMinAmplitude ?? 0.03;
  const slopeFrac = opts.qrsSlopeFraction ?? 0.3;
  const endSlopeFrac = opts.qrsEndSlopeFraction ?? 0.02;
  const refractory = Math.round((opts.refractory ?? 0.15) * fs);

  const n = v.length;
  const b = estimateBaseline(v, ampThr);
  const d = derivative(v, fs);
  let maxAbsD = 0;
  for (let i = 0; i < n; i++) maxAbsD = Math.max(maxAbsD, Math.abs(d[i] ?? 0));
  const detectThr = slopeFrac * maxAbsD;
  // QRS end: slope below 10% of the steepest QRS slope (capped), never below the floor. The cap keeps
  // a steep ST segment (digoxin scoop, marked elevation) from being swallowed into the QRS.
  const endThr = Math.max(Math.max(endSlopeFrac * maxAbsD, opts.qrsEndSlopeFloor ?? 3), Math.min(opts.qrsEndSlopeCap ?? 8, 0.1 * maxAbsD));

  // 1. QRS detection: regions of steep slope, one detection per refractory window.
  const detections: number[] = [];
  let i = 0;
  while (i < n) {
    if (Math.abs(d[i] ?? 0) > detectThr) {
      // Largest absolute deflection within the next 120 ms.
      const w = Math.round(0.12 * fs);
      let best = i;
      let bestAmp = Math.abs((v[i] ?? 0) - b);
      for (let k = i; k < Math.min(n, i + w); k++) {
        const a = Math.abs((v[k] ?? 0) - b);
        if (a > bestAmp) {
          bestAmp = a;
          best = k;
        }
      }
      detections.push(best);
      i = best + refractory;
    } else {
      i++;
    }
  }

  // 1b. Reject tall peaked T waves mistaken for QRS: a candidate whose half-amplitude width is
  // more than twice that of a narrow (< 60 ms) candidate within 0.5 s is dropped.
  // Narrowness rather than amplitude separates QRS from T, which is what fails on monitors
  // in hyperkalaemia (double counting).
  const halfWidth = (pk: number): number => {
    const a = Math.abs((v[pk] ?? 0) - b);
    const half = a / 2;
    let l = pk;
    while (l > 0 && Math.abs((v[l] ?? 0) - b) > half) l--;
    let r = pk;
    while (r < n - 1 && Math.abs((v[r] ?? 0) - b) > half) r++;
    return (r - l) / fs;
  };
  const widths = detections.map(halfWidth);
  // Steepest slope on the approach to the peak (one half-width before it to a quarter after).
  // Depolarisation is faster than repolarisation even when both are broad (sine-wave
  // patterns), so among two broad candidates close together the slower one is the T wave.
  const peakSlope = (pk: number, w: number): number => {
    const h = Math.round(w * fs);
    let m = 0;
    for (let q = Math.max(0, pk - h); q <= Math.min(n - 1, pk + Math.round(0.25 * h)); q++) m = Math.max(m, Math.abs(d[q] ?? 0));
    return m;
  };
  const slopes = detections.map((pk, idx) => peakSlope(pk, widths[idx]!));
  const keep = detections.filter((pk, idx) => {
    const w = widths[idx]!;
    for (let j = 0; j < detections.length; j++) {
      if (j === idx) continue;
      const near = Math.abs(detections[j]! - pk) / fs < 0.5;
      if (!near) continue;
      // T-like: at least twice as wide at half amplitude as a nearby narrow candidate, and that
      // candidate is itself QRS-like (under 60 ms).
      if (widths[j]! < 0.06 && w > 2.2 * widths[j]!) return false;
      // Both broad: keep the steeper one when the slopes differ clearly.
      if (w >= 0.06 && widths[j]! >= 0.06 && slopes[idx]! < 0.7 * slopes[j]!) return false;
      // Any pair: a candidate that is both slower (under half the neighbour's approach slope) and
      // no narrower than the neighbour is repolarisation: a tall peaked T rises at a fraction of
      // the QRS rate even when its half-width is QRS-like. A PVC beside a sinus beat is broader but
      // keeps well over half the sinus slope, so it survives; a small QRS beside a giant T is
      // slower but narrower, so it survives too.
      if (slopes[idx]! < 0.5 * slopes[j]! && w >= widths[j]!) return false;
    }
    return true;
  });
  detections.length = 0;
  detections.push(...keep);

  const beats: BeatMeasurement[] = [];
  for (let k = 0; k < detections.length; k++) {
    const pk = detections[k]!;
    const prevPk = k > 0 ? detections[k - 1]! : -1;
    const nextPk = k + 1 < detections.length ? detections[k + 1]! : n;

    // 2. QRS extent by slope: walk out from the peak while slope stays high, allowing short low-slope gaps.
    const gap = Math.round(0.012 * fs);
    let s = pk;
    let lowRun = 0;
    while (s > 0 && s > pk - Math.round(0.2 * fs)) {
      if (Math.abs(d[s] ?? 0) < endThr) {
        lowRun++;
        if (lowRun > gap) break;
      } else lowRun = 0;
      s--;
    }
    let e = pk;
    lowRun = 0;
    while (e < n - 1 && e < pk + Math.round(0.2 * fs)) {
      if (Math.abs(d[e] ?? 0) < endThr) {
        lowRun++;
        if (lowRun > gap) break;
      } else lowRun = 0;
      e++;
    }
    // 3. Refine onset by amplitude from the steep-region start.
    const onIdx = refineOnset(v, b, s, ampThr, Math.round(0.08 * fs));
    // J point: end of the steep region, adjusted back over the low-slope gap we allowed.
    // If the signal is at baseline there (no ST shift), refine by amplitude; otherwise keep the slope-based estimate.
    let jIdx = Math.max(pk, e - gap);
    {
      // Look for a return to baseline within 30 ms of the slope-based estimate.
      // A transient crossing (the S wave passing through baseline on its way up to an
      // elevated J point) does not count: the signal must stay at baseline for `hold`.
      const lim = Math.min(n - 1, jIdx + Math.round(0.03 * fs));
      const hold = Math.round(0.015 * fs);
      let back = -1;
      for (let q = Math.max(pk, jIdx - Math.round(0.015 * fs)); q <= lim; q++) {
        let ok = true;
        for (let r = q; r < Math.min(n, q + hold); r++) {
          if (Math.abs((v[r] ?? 0) - b) >= ampThr) {
            ok = false;
            break;
          }
        }
        if (ok) {
          back = q;
          break;
        }
      }
      if (back >= 0) jIdx = Math.max(pk, back - 1);
    }
    {
      // Slurred terminal deflection (conduction delay, sodium channel blockade): the slope fell
      // under the threshold while the signal is still well off baseline and heading back toward
      // it. Follow the return limb, within 100 ms. The J point is where the return limb's slope
      // reaches its minimum: at the baseline, at the start of a level ST shift, or at the knee
      // where a smooth terminal deflection hands over to a straight upsloping ST segment or a
      // fused T wave. A limb moving away from baseline, or one slower than the QRS-end slope
      // floor (a downsloping ST segment, a flutter wave), is an ST shift, not a slurred S, and is left to the
      // slope-based estimate. Known limit: a downsloping ST steeper than that floor would be read
      // as slurred QRS.
      const lim = Math.min(n - 1, jIdx + Math.round(0.1 * fs));
      let q = jIdx;
      let dev = Math.abs((v[q] ?? 0) - b);
      if (dev >= 4 * ampThr) {
        // The slope-based estimate can sit a sample or two before the terminal extremum; step onto it.
        const extremumLim = Math.min(lim, q + Math.round(0.015 * fs));
        while (q < extremumLim && Math.abs((v[q + 1] ?? 0) - b) > dev + 1e-12) {
          q++;
          dev = Math.abs((v[q] ?? 0) - b);
        }
        // The start must be an extremum the QRS drove the signal to (|v - b| was still growing
        // 10 ms earlier). A J point reached on the way back to baseline, with an offset left by
        // a flutter wave or an ST shift, is not the start of a slurred limb.
        const back = Math.max(0, q - Math.round(0.01 * fs));
        const grew = Math.abs((v[back] ?? 0) - b) < dev - ampThr;
        let maxStep = 0;
        let minStep = Infinity;
        let minAt = q;
        let pastPeak = false;
        while (grew && q < lim) {
          const next = Math.abs((v[q + 1] ?? 0) - b);
          if (next >= dev) break;
          const step = dev - next;
          if (!pastPeak) {
            if (step >= maxStep) maxStep = step;
            else pastPeak = true;
          }
          if (pastPeak) {
            // Past the steepest part of the return limb: the slope minimum is the J point.
            if (step < minStep) {
              minStep = step;
              minAt = q;
            } else if (minStep < 0.6 * maxStep && step > 1.25 * minStep + 1e-9) {
              q = minAt;
              dev = Math.abs((v[q] ?? 0) - b);
              break;
            }
          }
          q++;
          dev = next;
          if (dev < ampThr) break;
        }
        // Accept only a QRS-speed return limb: an ST segment drifting toward baseline at
        // under the QRS-end slope floor is repolarisation, not a slurred terminal deflection.
        if (q > jIdx && maxStep * fs >= 1.5 * (opts.qrsEndSlopeFloor ?? 3)) jIdx = q;
      }
    }

    // R and S amplitudes inside [onIdx, jIdx].
    let rAmp = 0;
    let sAmp = 0;
    for (let q = onIdx; q <= jIdx; q++) {
      const a = (v[q] ?? 0) - b;
      if (a > rAmp) rAmp = a;
      if (a < sAmp) sAmp = a;
    }

    // 4. P wave: largest excursion in the window before QRS onset.
    let pOn: number | null = null;
    let pPeak: number | null = null;
    let pOff: number | null = null;
    let pAmp: number | null = null;
    {
      const prevT = k > 0 ? beats[k - 1]!.tOff : null;
      const afterPrev = prevT !== null ? Math.round(prevT * fs) + Math.round(0.01 * fs) : k === 0 ? 0 : prevPk + Math.round(0.12 * fs);
      const w0 = Math.max(afterPrev, onIdx - Math.round(0.30 * fs), 0);
      const w1 = onIdx - Math.round(0.005 * fs);
      let best = -1;
      let bestAmp = 0;
      for (let q = w0; q <= w1; q++) {
        const a = Math.abs((v[q] ?? 0) - b);
        if (a > bestAmp) {
          bestAmp = a;
          best = q;
        }
      }
      if (best >= 0 && bestAmp >= pMin) {
        pPeak = best;
        pAmp = (v[best] ?? 0) - b;
        pOn = refineOnset(v, b, best, ampThr, Math.round(0.15 * fs));
        pOff = refineOffset(v, b, best, ampThr, Math.round(0.15 * fs));
      }
    }

    // 5. T wave: largest excursion after the ST segment, before the next beat.
    let tPeak: number | null = null;
    let tOff: number | null = null;
    let tAmp: number | null = null;
    {
      const w0 = jIdx + Math.round(0.04 * fs);
      const w1 = Math.min(n - 1, jIdx + Math.round(0.5 * fs), nextPk - Math.round(0.15 * fs));
      let best = -1;
      let bestAmp = 0;
      for (let q = w0; q <= w1; q++) {
        const a = Math.abs((v[q] ?? 0) - b);
        if (a > bestAmp) {
          bestAmp = a;
          best = q;
        }
      }
      if (best >= 0 && bestAmp >= tMin) {
        tPeak = best;
        tAmp = (v[best] ?? 0) - b;
        tOff = refineOffset(v, b, best, ampThr, Math.round(0.4 * fs));
      }
    }

    const at = (idx: number | null) => (idx === null ? null : idx / fs);
    const j60 = Math.min(n - 1, jIdx + Math.round(0.06 * fs));
    beats.push({
      qrsPeakIndex: pk,
      qrsPeak: pk / fs,
      qrsPeakAmplitude: (v[pk] ?? 0) - b,
      qrsOn: onIdx / fs,
      j: jIdx / fs,
      qrsDuration: (jIdx - onIdx) / fs,
      pOn: at(pOn),
      pPeak: at(pPeak),
      pOff: at(pOff),
      pAmplitude: pAmp,
      pr: pOn === null ? null : (onIdx - pOn) / fs,
      tPeak: at(tPeak),
      tOff: at(tOff),
      tAmplitude: tAmp,
      qt: tOff === null ? null : (tOff - onIdx) / fs,
      stJ: (v[jIdx] ?? 0) - b,
      st60: (v[j60] ?? 0) - b,
      rAmplitude: rAmp,
      sAmplitude: sAmp,
    });
  }

  const rr: number[] = [];
  for (let k = 1; k < beats.length; k++) rr.push(beats[k]!.qrsOn - beats[k - 1]!.qrsOn);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);
  const meanRr = mean(rr);
  const meanQt = mean(beats.map((x) => x.qt).filter((x): x is number => x !== null));
  return {
    baseline: b,
    beats,
    rr,
    heartRate: meanRr ? 60 / meanRr : null,
    meanPr: mean(beats.map((x) => x.pr).filter((x): x is number => x !== null)),
    meanQrs: mean(beats.map((x) => x.qrsDuration)),
    meanQt,
    qtcBazett: meanRr && meanQt ? meanQt / Math.sqrt(meanRr) : null,
  };
}

/* ---------------------------------------------------------------------- */
/* Structural identities                                                   */
/* ---------------------------------------------------------------------- */

export interface LeadIdentityResiduals {
  einthoven: number; // max |II - I - III|
  goldbergerSum: number; // max |aVR + aVL + aVF|
  aVR: number; // max |aVR + (I + II)/2|
}

/** Maximum absolute residual of the limb-lead identities. Should be at floating-point noise for any valid 12-lead set. */
export function leadIdentityResiduals(leads: Record<string, Float64Array>): LeadIdentityResiduals {
  const I = leads['I']!;
  const II = leads['II']!;
  const III = leads['III']!;
  const aVR = leads['aVR']!;
  const aVL = leads['aVL']!;
  const aVF = leads['aVF']!;
  let e = 0;
  let g = 0;
  let r = 0;
  for (let i = 0; i < I.length; i++) {
    e = Math.max(e, Math.abs((II[i] ?? 0) - (I[i] ?? 0) - (III[i] ?? 0)));
    g = Math.max(g, Math.abs((aVR[i] ?? 0) + (aVL[i] ?? 0) + (aVF[i] ?? 0)));
    r = Math.max(r, Math.abs((aVR[i] ?? 0) + ((I[i] ?? 0) + (II[i] ?? 0)) / 2));
  }
  return { einthoven: e, goldbergerSum: g, aVR: r };
}
