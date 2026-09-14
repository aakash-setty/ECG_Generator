/**
 * L1: deflection primitives.
 *
 * Design rule: every primitive has COMPACT SUPPORT. It is exactly zero
 * outside its [on, off] window, so landmarks are literal (the window edges
 * are the onset and offset), the TP baseline is exactly zero by construction,
 * and no wave can leak into its neighbour.
 *
 * Smoothness is a property of these functions, not of the renderer. Sample
 * densely and plot a polyline; never interpolate in the renderer.
 */

export interface Deflection {
  /** Window start, absolute seconds. Value is exactly 0 for t <= on. */
  readonly on: number;
  /** Window end, absolute seconds. Value is exactly 0 for t >= off. */
  readonly off: number;
  /** Value in millivolts at absolute time t. */
  at(t: number): number;
}

/* ---------------------------------------------------------------------- */
/* Bump                                                                    */
/* ---------------------------------------------------------------------- */

export interface BumpSpec {
  on: number;
  /** Time of the extremum. Must satisfy on < peak < off. */
  peak: number;
  off: number;
  /** Signed amplitude at the peak, mV. Negative for Q, S, inverted T. */
  amplitude: number;
  /**
   * Peakedness. 1 gives a raised-cosine (Hann) shape: rounded peak, edges
   * rising as the square of distance from the window edge. Values below 1
   * give a more pointed peak and steeper edges (0.5 is a pure |sin|, with a
   * corner at the peak and a linear onset). Values above 1 give flatter,
   * softer edges inside the window, which delays any threshold-based onset
   * detector. Must be > 0. Defaults used by the beat layer: P and T 1.0, QRS 0.8.
   */
  sharpness?: number;
}

/**
 * Asymmetric compact-support bump.
 *
 * b(t) = A * sin(pi * u)^(2p), where u warps [on, peak] onto [0, 0.5] and
 * [peak, off] onto [0.5, 1]. Properties:
 *   b(on) = b(off) = 0 exactly
 *   b(peak) = A exactly
 *   C1 continuous everywhere (zero slope at on, peak, off)
 * Because the two halves are warped independently, the rise and fall
 * durations are set directly by the landmark times rather than by a width
 * parameter you would then have to convert.
 */
export function bump(spec: BumpSpec): Deflection {
  const { on, peak, off, amplitude } = spec;
  const p = spec.sharpness ?? 1;
  if (!(on < peak && peak < off)) {
    throw new Error(`bump: need on < peak < off, got on=${on} peak=${peak} off=${off}`);
  }
  if (!(p > 0)) throw new Error(`bump: sharpness must be > 0, got ${p}`);
  const riseDur = peak - on;
  const fallDur = off - peak;
  const exp = 2 * p;
  return {
    on,
    off,
    at(t: number): number {
      if (t <= on || t >= off) return 0;
      const u = t < peak ? (0.5 * (t - on)) / riseDur : 0.5 + (0.5 * (t - peak)) / fallDur;
      const s = Math.sin(Math.PI * u);
      return amplitude * Math.pow(s, exp);
    },
  };
}

/* ---------------------------------------------------------------------- */
/* Plateau (ST segment and other level shifts)                             */
/* ---------------------------------------------------------------------- */

export interface PlateauSpec {
  /** Start of the smooth rise from 0. */
  on: number;
  /** End of rise; value equals levelA here. For the ST segment this is the J point. */
  riseEnd: number;
  /** Start of the fall; value equals levelB here. For the ST segment this is T onset. */
  fallStart: number;
  /** End of fall; value is 0 here. For the ST segment this is T offset. */
  off: number;
  /** Level at riseEnd, mV. */
  levelA: number;
  /** Level at fallStart, mV. */
  levelB: number;
  /**
   * Body shape exponent k. Body goes from levelA to levelB as x^k.
   * k = 1 linear. k > 1 concave-up (slow start, e.g. normal upsloping ST).
   * k < 1 convex (fast early change, e.g. coved / tombstone ST). Must be > 0.
   */
  shape?: number;
}

/** C1 smoothstep on [0,1]. */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * Plateau with a smooth rise, a shaped body, and a monotone fall.
 *
 * The fall segment is a cubic Hermite that matches the body's incoming slope
 * at fallStart and has zero value and zero slope at off. The incoming slope
 * is clamped (Fritsch-Carlson bound, alpha <= 3) so the fall cannot overshoot
 * past zero. This is the one place in the generator where a spline is the
 * right tool: both endpoints and both endpoint times are pinned by landmarks.
 */
export function plateau(spec: PlateauSpec): Deflection {
  const { on, riseEnd, fallStart, off, levelA, levelB } = spec;
  const k = spec.shape ?? 1;
  if (!(on <= riseEnd && riseEnd <= fallStart && fallStart <= off)) {
    throw new Error(`plateau: need on <= riseEnd <= fallStart <= off`);
  }
  if (!(k > 0)) throw new Error(`plateau: shape must be > 0`);
  const riseDur = riseEnd - on;
  const bodyDur = fallStart - riseEnd;
  const fallDur = off - fallStart;

  // Incoming slope at fallStart from the body (d/dx of levelA + (levelB-levelA) x^k at x=1, per second).
  const bodySlopeAtEnd = bodyDur > 0 ? ((levelB - levelA) * k) / bodyDur : 0;
  // Hermite fall from y0=levelB to y1=0 over fallDur with m1=0. Monotone if |m0| <= 3*|delta|/h
  // and m0 has the sign of the secant (delta = -levelB).
  let m0 = bodySlopeAtEnd;
  if (fallDur > 0) {
    const delta = -levelB; // secant numerator
    const secant = delta / fallDur;
    if (secant === 0) m0 = 0;
    else if (Math.sign(m0) !== Math.sign(secant)) m0 = 0;
    else if (Math.abs(m0) > 3 * Math.abs(secant)) m0 = 3 * secant;
  }

  return {
    on,
    off,
    at(t: number): number {
      if (t <= on || t >= off) return 0;
      if (t < riseEnd) {
        return levelA * smoothstep((t - on) / riseDur);
      }
      if (t < fallStart) {
        const x = bodyDur > 0 ? (t - riseEnd) / bodyDur : 0;
        return levelA + (levelB - levelA) * Math.pow(x, k);
      }
      // Fall: cubic Hermite on [0,1] with p0=levelB, m0*h, p1=0, m1=0.
      const x = (t - fallStart) / fallDur;
      const h00 = (1 + 2 * x) * (1 - x) * (1 - x);
      const h10 = x * (1 - x) * (1 - x);
      return levelB * h00 + m0 * fallDur * h10;
    },
  };
}

/* ---------------------------------------------------------------------- */
/* Composition and sampling                                                */
/* ---------------------------------------------------------------------- */

/** Sum of deflections, evaluated lazily. */
export function sum(parts: readonly Deflection[]): Deflection {
  const on = parts.length ? Math.min(...parts.map((d) => d.on)) : 0;
  const off = parts.length ? Math.max(...parts.map((d) => d.off)) : 0;
  return {
    on,
    off,
    at(t: number): number {
      let v = 0;
      for (const d of parts) {
        if (t > d.on && t < d.off) v += d.at(t);
      }
      return v;
    },
  };
}

/**
 * Add a deflection into a sample buffer in place. Only touches samples inside
 * the window, so cost is proportional to the deflection's duration, not the strip's.
 */
export function accumulate(buf: Float64Array, fs: number, t0: number, d: Deflection): void {
  const i0 = Math.max(0, Math.ceil((d.on - t0) * fs));
  const i1 = Math.min(buf.length - 1, Math.floor((d.off - t0) * fs));
  for (let i = i0; i <= i1; i++) {
    const cur = buf[i] ?? 0;
    buf[i] = cur + d.at(t0 + i / fs);
  }
}
