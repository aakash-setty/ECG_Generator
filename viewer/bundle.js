"use strict";
(() => {
  // src/core/deflections.ts
  function bump(spec) {
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
      at(t) {
        if (t <= on || t >= off) return 0;
        const u = t < peak ? 0.5 * (t - on) / riseDur : 0.5 + 0.5 * (t - peak) / fallDur;
        const s = Math.sin(Math.PI * u);
        return amplitude * Math.pow(s, exp);
      }
    };
  }
  function smoothstep(x) {
    return x * x * (3 - 2 * x);
  }
  function plateau(spec) {
    const { on, riseEnd, fallStart, off, levelA, levelB } = spec;
    const k = spec.shape ?? 1;
    if (!(on <= riseEnd && riseEnd <= fallStart && fallStart <= off)) {
      throw new Error(`plateau: need on <= riseEnd <= fallStart <= off`);
    }
    if (!(k > 0)) throw new Error(`plateau: shape must be > 0`);
    const riseDur = riseEnd - on;
    const bodyDur = fallStart - riseEnd;
    const fallDur = off - fallStart;
    const bodySlopeAtEnd = bodyDur > 0 ? (levelB - levelA) * k / bodyDur : 0;
    let m0 = bodySlopeAtEnd;
    if (fallDur > 0) {
      const delta = -levelB;
      const secant = delta / fallDur;
      if (secant === 0) m0 = 0;
      else if (Math.sign(m0) !== Math.sign(secant)) m0 = 0;
      else if (Math.abs(m0) > 3 * Math.abs(secant)) m0 = 3 * secant;
    }
    return {
      on,
      off,
      at(t) {
        if (t <= on || t >= off) return 0;
        if (t < riseEnd) {
          return levelA * smoothstep((t - on) / riseDur);
        }
        if (t < fallStart) {
          const x2 = bodyDur > 0 ? (t - riseEnd) / bodyDur : 0;
          return levelA + (levelB - levelA) * Math.pow(x2, k);
        }
        const x = (t - fallStart) / fallDur;
        const h00 = (1 + 2 * x) * (1 - x) * (1 - x);
        const h10 = x * (1 - x) * (1 - x);
        return levelB * h00 + m0 * fallDur * h10;
      }
    };
  }
  function accumulate(buf, fs, t0, d) {
    const i0 = Math.max(0, Math.ceil((d.on - t0) * fs));
    const i1 = Math.min(buf.length - 1, Math.floor((d.off - t0) * fs));
    for (let i = i0; i <= i1; i++) {
      const cur = buf[i] ?? 0;
      buf[i] = cur + d.at(t0 + i / fs);
    }
  }

  // src/core/beat.ts
  function beatDeflections(lm, m, pOnly = false) {
    const out = [];
    const pS = m.pSharpness ?? 1;
    const qrsS = m.qrsSharpness ?? 0.8;
    const tS = m.tSharpness ?? 1;
    if (lm.pOn !== null && lm.pPeak !== null && lm.pOff !== null && m.p !== 0) {
      out.push(bump({ on: lm.pOn, peak: lm.pPeak, off: lm.pOff, amplitude: m.p, sharpness: pS }));
    }
    if (pOnly) return out;
    const hasQ = m.q !== 0;
    const hasR = m.r !== 0;
    const hasS = m.s !== 0;
    if (hasQ) {
      out.push(bump({ on: lm.qrsOn, peak: lm.qPeak, off: hasR ? lm.rPeak : hasS ? lm.sPeak : lm.j, amplitude: m.q, sharpness: qrsS }));
    }
    if (hasR) {
      out.push(
        bump({
          on: hasQ ? lm.qPeak : lm.qrsOn,
          peak: lm.rPeak,
          off: hasS ? lm.sPeak : lm.j,
          amplitude: m.r,
          sharpness: qrsS
        })
      );
    }
    const hasRPrime = (m.rPrime ?? 0) !== 0;
    if (hasS) {
      out.push(bump({ on: hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn, peak: lm.sPeak, off: hasRPrime ? lm.rPrimePeak : lm.j, amplitude: m.s, sharpness: qrsS }));
    }
    if (hasRPrime) {
      out.push(bump({ on: hasS ? lm.sPeak : hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn, peak: lm.rPrimePeak, off: lm.j, amplitude: m.rPrime, sharpness: qrsS }));
    }
    const stJ = m.stJ ?? 0;
    const stT = m.stT ?? stJ;
    let st = null;
    const lastPeak = hasRPrime ? lm.rPrimePeak : hasS ? lm.sPeak : hasR ? lm.rPeak : hasQ ? lm.qPeak : lm.qrsOn;
    if (stJ !== 0 || stT !== 0) {
      st = plateau({
        on: lastPeak,
        riseEnd: lm.j,
        fallStart: lm.tOn,
        off: lm.tOff,
        levelA: stJ,
        levelB: stT,
        shape: m.stShape ?? 1
      });
      out.push(st);
    }
    if ((m.stScoop ?? 0) !== 0 && lm.tOn > lm.j) {
      out.push(bump({ on: lm.j, peak: lm.j + 0.5 * (lm.tOn - lm.j), off: lm.tOn, amplitude: m.stScoop, sharpness: 1 }));
    }
    if (m.t !== 0) {
      const tPeak = m.tPeakFraction === void 0 ? lm.tPeak : lm.tOn + Math.min(0.95, Math.max(0.05, m.tPeakFraction)) * (lm.tOff - lm.tOn);
      const stAtPeak = st ? st.at(tPeak) : 0;
      out.push(bump({ on: lm.tOn, peak: tPeak, off: lm.tOff, amplitude: m.t - stAtPeak, sharpness: tS }));
    }
    if ((m.tNotch ?? 0) !== 0) {
      const f = Math.min(0.95, Math.max(0.05, m.tNotchFraction ?? 0.72));
      const c = lm.tOn + f * (lm.tOff - lm.tOn);
      const half = 0.12 * (lm.tOff - lm.tOn);
      out.push(bump({ on: c - half, peak: c, off: Math.min(lm.tOff, c + half), amplitude: m.tNotch, sharpness: 1 }));
    }
    if ((m.u ?? 0) !== 0 && lm.uOn !== null && lm.uPeak !== null && lm.uOff !== null) {
      out.push(bump({ on: lm.uOn, peak: lm.uPeak, off: lm.uOff, amplitude: m.u, sharpness: 1 }));
    }
    return out;
  }

  // src/core/landmarks.ts
  var NORMAL_INTERVALS = {
    pDuration: 0.09,
    pr: 0.16,
    qrs: 0.09,
    st: 0.1,
    qt: 0.4,
    hasP: true
  };
  function validateIntervals(iv) {
    const problems = [];
    if (!(iv.qrs > 0)) problems.push("qrs must be > 0");
    if (!(iv.st >= 0)) problems.push("st must be >= 0");
    if (!(iv.qt > iv.qrs + iv.st)) problems.push(`qt (${iv.qt}) must exceed qrs + st (${iv.qrs + iv.st})`);
    if (iv.hasP !== false) {
      if (!(iv.pDuration > 0)) problems.push("pDuration must be > 0");
      if (!(iv.pr >= iv.pDuration)) problems.push(`pr (${iv.pr}) must be >= pDuration (${iv.pDuration}) so the PR segment is not negative`);
    }
    const q = iv.qPeakFraction ?? 0.12;
    const r = iv.rPeakFraction ?? 0.4;
    const s = iv.sPeakFraction ?? 0.72;
    const rp = iv.rPrimePeakFraction ?? 0.88;
    if (!(0 < q && q < r && r < s && s < rp && rp < 1)) problems.push("need 0 < qPeakFraction < rPeakFraction < sPeakFraction < rPrimePeakFraction < 1");
    if (iv.uDuration !== void 0 && iv.uDuration < 0) problems.push("uDuration must be >= 0");
    if (problems.length) throw new Error("Invalid intervals: " + problems.join("; "));
  }
  function landmarksFromIntervals(iv, qrsOn) {
    validateIntervals(iv);
    const hasP = iv.hasP !== false;
    const pOn = hasP ? qrsOn - iv.pr : null;
    const pOff = hasP ? qrsOn - iv.pr + iv.pDuration : null;
    const pPeak = hasP ? pOn + (iv.pPeakFraction ?? 0.5) * iv.pDuration : null;
    const j = qrsOn + iv.qrs;
    const tOn = j + iv.st;
    const tOff = qrsOn + iv.qt;
    const tPeak = tOn + (iv.tPeakFraction ?? 0.55) * (tOff - tOn);
    const hasU = (iv.uDuration ?? 0) > 0;
    const uOn = hasU ? tOff : null;
    const uOff = hasU ? tOff + iv.uDuration : null;
    const uPeak = hasU ? tOff + (iv.uPeakFraction ?? 0.5) * iv.uDuration : null;
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
      end: iv.pOnly && pOff !== null ? pOff : uOff ?? tOff
    };
  }
  function qtFromBazett(qtc, rr) {
    return qtc * Math.sqrt(rr);
  }

  // src/core/leads.ts
  var INDEPENDENT_LEADS = ["I", "II", "V1", "V2", "V3", "V4", "V5", "V6"];
  function deriveLimbLeads(I, II) {
    if (I.length !== II.length) throw new Error("deriveLimbLeads: I and II must have equal length");
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
  var NORMAL_MORPHOLOGY = {
    I: { p: 0.08, q: -0.03, r: 0.6, s: -0.1, t: 0.25 },
    II: { p: 0.15, q: -0.05, r: 1.1, s: -0.15, t: 0.35 },
    V1: { p: 0.05, q: 0, r: 0.2, s: -1, t: -0.1 },
    V2: { p: 0.05, q: 0, r: 0.4, s: -1.6, t: 0.5 },
    V3: { p: 0.05, q: 0, r: 0.8, s: -1.2, t: 0.6 },
    V4: { p: 0.06, q: -0.02, r: 1.5, s: -0.6, t: 0.5 },
    V5: { p: 0.06, q: -0.04, r: 1.5, s: -0.3, t: 0.4 },
    V6: { p: 0.06, q: -0.05, r: 1.2, s: -0.15, t: 0.3 }
  };
  function cloneMorphology(m) {
    const out = {};
    for (const l of INDEPENDENT_LEADS) out[l] = { ...m[l] };
    return out;
  }

  // src/core/units.ts
  var DEFAULT_FS = 1e3;
  var STANDARD_CALIBRATION = { paperSpeed: 25, gain: 10 };
  function secondsToMm(t, cal = STANDARD_CALIBRATION) {
    return t * cal.paperSpeed;
  }
  function millivoltsToMm(v, cal = STANDARD_CALIBRATION) {
    return v * cal.gain;
  }
  function mmToSeconds(x, cal = STANDARD_CALIBRATION) {
    return x / cal.paperSpeed;
  }
  function mmToMillivolts(y, cal = STANDARD_CALIBRATION) {
    return y / cal.gain;
  }

  // src/core/sequencer.ts
  function renderStrip(beats, duration, fs = DEFAULT_FS, spikes = [], atrial = null) {
    const n = Math.round(duration * fs);
    const ind = {};
    for (const l of INDEPENDENT_LEADS) ind[l] = new Float64Array(n);
    const annotated = [];
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
    const warnings = [];
    for (let k = 0; k + 1 < annotated.length; k++) {
      const a = annotated[k].landmarks;
      const b = annotated[k + 1].landmarks;
      const nextStart = b.pOn ?? b.qrsOn;
      if (nextStart < a.end) {
        warnings.push(
          `beat ${k + 1} starts ${((a.end - nextStart) * 1e3).toFixed(0)} ms before beat ${k} ends (waves overlap; QT ${((a.tOff - a.qrsOn) * 1e3).toFixed(0)} ms, RR ${((b.qrsOn - a.qrsOn) * 1e3).toFixed(0)} ms)`
        );
      }
    }
    const derived = deriveLimbLeads(ind.I, ind.II);
    const leads = { ...ind, ...derived };
    const strip2 = { fs, duration, leads, beats: annotated, spikes, warnings, atrial: atrial ? atrial.kind : null };
    if (!atrial) normalizeBaseline(strip2);
    return strip2;
  }
  function normalizeBaseline(strip2) {
    const corrections = {};
    const idx = tpSampleIndices(strip2);
    for (const l of Object.keys(strip2.leads)) {
      const buf = strip2.leads[l];
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
  function tpSampleIndices(strip2) {
    const out = [];
    const bs = strip2.beats;
    for (let k = 0; k + 1 < bs.length; k++) {
      const a = bs[k].landmarks;
      const b = bs[k + 1].landmarks;
      const start = a.end;
      const end = b.pOn ?? b.qrsOn;
      const i0 = Math.ceil(start * strip2.fs) + 1;
      const i1 = Math.floor(end * strip2.fs) - 1;
      for (let i = i0; i <= i1; i++) out.push(i);
    }
    return out;
  }
  var PVC_MORPHOLOGY = {
    I: { p: 0, q: 0, r: 0.9, s: -0.1, t: -0.4, qrsSharpness: 1.2 },
    II: { p: 0, q: 0, r: 1.2, s: -0.1, t: -0.5, qrsSharpness: 1.2 },
    V1: { p: 0, q: -0.2, r: 0, s: -1.6, t: 0.6, qrsSharpness: 1.2 },
    V2: { p: 0, q: -0.2, r: 0, s: -1.9, t: 0.7, qrsSharpness: 1.2 },
    V3: { p: 0, q: -0.1, r: 0.2, s: -1.5, t: 0.6, qrsSharpness: 1.2 },
    V4: { p: 0, q: 0, r: 0.8, s: -0.9, t: 0.2, qrsSharpness: 1.2 },
    V5: { p: 0, q: 0, r: 1.4, s: -0.3, t: -0.4, qrsSharpness: 1.2 },
    V6: { p: 0, q: 0, r: 1.3, s: -0.2, t: -0.5, qrsSharpness: 1.2 }
  };
  function partitionQt(qt, qrs, rr, p) {
    const jt = Math.max(0, qt - qrs);
    const b = p.rateExponent ?? 0.5;
    const minT = p.minT ?? 0.08;
    let st = p.stFraction * Math.pow(Math.max(0.2, rr), b) * jt;
    st = Math.max(0, Math.min(st, jt - minT));
    const slow = p.tPeakFractionSlow ?? 0.55;
    const w = Math.max(0, Math.min(1, (rr - 0.5) / 0.5));
    const tPeakFraction = 0.5 + (slow - 0.5) * w;
    return { st, tPeakFraction, t: jt - st };
  }
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gaussian(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  var QT_RUNNING_MEAN_BEATS = 8;
  function sinusRhythm(opts) {
    const ppMean = 60 / opts.rate;
    const jitter = opts.rrJitter ?? 0;
    const qtc = opts.qtc ?? 0.4;
    const base = { ...NORMAL_INTERVALS, ...opts.intervals ?? {} };
    const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
    const rng = makeRng(opts.seed ?? 1);
    const beats = [];
    const rrHistory = [];
    const block = opts.avBlock ?? { type: "none" };
    const ect = opts.ectopy;
    const nextPp = () => jitter > 0 ? ppMean * Math.max(0.5, 1 + jitter * gaussian(rng)) : ppMean;
    const conductedIntervals = (pr, hasP) => {
      const rrRecent = rrHistory.slice(-QT_RUNNING_MEAN_BEATS);
      const rrForQt = rrRecent.length ? rrRecent.reduce((a, b) => a + b, 0) / rrRecent.length : ppMean;
      const qt = qtFromBazett(qtc, rrForQt);
      const iv = { ...base, pr, qt, hasP };
      if (opts.qtPartition) {
        const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
        iv.st = part.st;
        iv.tPeakFraction = part.tPeakFraction;
      }
      return iv;
    };
    if (block.type === "complete") {
      let pOn2 = 0.1;
      while (pOn2 < opts.duration) {
        beats.push({ qrsOn: pOn2 + base.pr, intervals: { ...base, pOnly: true, qt: base.qt }, morphology: morph, label: "blocked-p" });
        pOn2 += nextPp();
      }
      const escRr = 60 / (block.escapeRate ?? 40);
      const ventricular = block.escapeFocus === "ventricular";
      let t = 0.35;
      while (t < opts.duration) {
        const iv = conductedIntervals(base.pr, false);
        if (ventricular) {
          iv.qrs = Math.max(0.14, base.qrs);
          iv.st = 0.02;
          iv.qt = Math.max(iv.qt, iv.qrs + 0.02 + 0.12);
        }
        beats.push({ qrsOn: t, intervals: iv, morphology: ventricular ? PVC_MORPHOLOGY : morph, label: "escape" });
        rrHistory.push(escRr);
        t += escRr;
      }
      return beats;
    }
    let pOn = 0.05;
    let cyclePos = 0;
    let conductedCount = 0;
    let lastConductedQrs = -Infinity;
    let pendingPvc = null;
    while (pOn < opts.duration) {
      let pr = base.pr;
      let conducts = true;
      if (block.type === "wenckebach") {
        const n = Math.max(2, block.ratio ?? 4);
        pr = base.pr + cyclePos * (block.prIncrement ?? 0.06);
        conducts = cyclePos < n - 1;
        cyclePos = (cyclePos + 1) % n;
      } else if (block.type === "mobitz2") {
        const n = Math.max(2, block.ratio ?? 3);
        conducts = cyclePos !== n - 1;
        cyclePos = (cyclePos + 1) % n;
      }
      const qrsOn = pOn + pr;
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
        beats.push({ qrsOn, intervals: iv, morphology: morph, label: "sinus" });
        lastConductedQrs = qrsOn;
        conductedCount++;
        if (ect && ect.every > 0 && conductedCount % ect.every === 0) {
          const coupling = (ect.couplingFraction ?? 0.55) * ppMean;
          const pvcOn = qrsOn + coupling;
          const pqrs = ect.qrs ?? 0.14;
          const rrRecent = rrHistory.slice(-QT_RUNNING_MEAN_BEATS);
          const rrForQt = rrRecent.length ? rrRecent.reduce((a, b) => a + b, 0) / rrRecent.length : ppMean;
          const pqt = qtFromBazett(ect.qtc ?? qtc, rrForQt);
          const pIntervals = {
            ...base,
            hasP: false,
            qrs: pqrs,
            st: 0.02,
            qt: Math.max(pqt, pqrs + 0.02 + 0.12),
            rPeakFraction: 0.45,
            sPeakFraction: 0.78,
            tPeakFraction: 0.5
          };
          if (pvcOn < opts.duration) {
            beats.push({ qrsOn: pvcOn, intervals: pIntervals, morphology: ect.morphology ?? PVC_MORPHOLOGY, label: "pvc" });
            pendingPvc = { qrsOn: pvcOn, end: pvcOn + pIntervals.qt, blockUntil: pvcOn + (ect.avRefractory ?? 0.6) };
          }
        }
      } else if (!buried) {
        beats.push({ qrsOn, intervals: { ...base, pr, pOnly: true, qt: base.qt }, morphology: morph, label: "blocked-p" });
      }
      pOn += nextPp();
    }
    return beats;
  }

  // src/core/rhythms.ts
  function meanOf(xs, fallback) {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  }
  function svtRhythm(opts) {
    const rr = 60 / opts.rate;
    const qtc = opts.qtc ?? 0.4;
    const base = { ...NORMAL_INTERVALS, ...opts.intervals ?? {} };
    const rp = opts.retrogradeP ?? 0.06;
    const dep = opts.stDepression ?? 0.08;
    const morph = cloneMorphology(opts.morphology ?? NORMAL_MORPHOLOGY);
    morph.V1 = { ...morph.V1, rPrime: rp };
    morph.II = { ...morph.II, rPrime: -rp, stJ: -dep * 0.6, stT: -dep, stShape: 1 };
    morph.I = { ...morph.I, stJ: -dep * 0.3, stT: -dep * 0.5 };
    for (const l of ["V4", "V5", "V6"]) morph[l] = { ...morph[l], stJ: -dep * 0.6, stT: -dep, stShape: 1 };
    const beats = [];
    const qt = qtFromBazett(qtc, rr);
    let t = 0.2;
    while (t < opts.duration) {
      const iv = { ...base, hasP: false, qt, rPrimePeakFraction: 0.9 };
      if (opts.qtPartition) {
        const part = partitionQt(qt, base.qrs, rr, opts.qtPartition);
        iv.st = part.st;
        iv.tPeakFraction = part.tPeakFraction;
      } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
      beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: "svt" });
      t += rr;
    }
    return { beats, atrial: null };
  }
  var F_WAVE_WEIGHTS = { I: 0.25, II: 0.6, V1: 1, V2: 0.7, V3: 0.45, V4: 0.3, V5: 0.25, V6: 0.25 };
  function atrialFibrillation(opts) {
    const rrMean = 60 / opts.ventricularRate;
    const sigma = opts.irregularity ?? 0.25;
    const qtc = opts.qtc ?? 0.4;
    const base = { ...NORMAL_INTERVALS, ...opts.intervals ?? {} };
    const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
    const rng = makeRng(opts.seed ?? 1);
    const beats = [];
    const history = [];
    const mu = Math.log(rrMean) - sigma * sigma / 2;
    let t = 0.3;
    while (t < opts.duration) {
      const rrForQt = meanOf(history.slice(-8), rrMean);
      const qt = qtFromBazett(qtc, rrForQt);
      const iv = { ...base, hasP: false, qt };
      if (opts.qtPartition) {
        const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
        iv.st = part.st;
        iv.tPeakFraction = part.tPeakFraction;
      } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
      beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: "af" });
      let rr = Math.exp(mu + sigma * gaussian(rng));
      rr = Math.max(0.3, Math.min(3 * rrMean, rr));
      history.push(rr);
      t += rr;
    }
    const A = opts.fWaveAmplitude ?? 0.06;
    const f = opts.fWaveFrequency ?? 7;
    const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
    const atrial = {
      kind: "fibrillation",
      at(time, lead) {
        const mod = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.37 * time + (phases[3] ?? 0));
        const v = 0.55 * Math.sin(2 * Math.PI * f * time + (phases[0] ?? 0)) + 0.3 * Math.sin(2 * Math.PI * f * 1.31 * time + (phases[1] ?? 0)) + 0.15 * Math.sin(2 * Math.PI * f * 0.73 * time + (phases[2] ?? 0));
        return A * mod * v * F_WAVE_WEIGHTS[lead];
      }
    };
    return { beats, atrial };
  }
  var FLUTTER_WEIGHTS = { I: 0.05, II: -1, V1: 0.6, V2: 0.3, V3: 0.15, V4: 0.1, V5: 0.1, V6: 0.1 };
  function sawtooth(u) {
    const x = u - Math.floor(u);
    return x < 0.8 ? 1 - 2 * x / 0.8 : -1 + 2 * (x - 0.8) / 0.2;
  }
  function atrialFlutter(opts) {
    const fr = opts.flutterRate ?? 300;
    const cycle = 60 / fr;
    const qtc = opts.qtc ?? 0.4;
    const base = { ...NORMAL_INTERVALS, ...opts.intervals ?? {} };
    const morph = opts.morphology ?? NORMAL_MORPHOLOGY;
    const rng = makeRng(opts.seed ?? 1);
    const beats = [];
    const history = [];
    const cond = opts.conduction ?? 2;
    let k = 1;
    let t = 0.25;
    while (t < opts.duration) {
      const rrForQt = meanOf(history.slice(-8), cycle * (typeof cond === "number" ? cond : 3));
      const qt = qtFromBazett(qtc, rrForQt);
      const iv = { ...base, hasP: false, qt };
      if (opts.qtPartition) {
        const part = partitionQt(qt, base.qrs, rrForQt, opts.qtPartition);
        iv.st = part.st;
        iv.tPeakFraction = part.tPeakFraction;
      } else iv.st = Math.min(base.st, Math.max(0.02, qt - base.qrs - 0.1));
      beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: "flutter" });
      const n = typeof cond === "number" ? cond : [2, 3, 4][Math.floor(rng() * 3)];
      const rr = n * cycle;
      history.push(rr);
      k += n;
      t += rr;
    }
    const A = opts.amplitude ?? 0.15;
    const atrial = {
      kind: "flutter",
      at(time, lead) {
        return A * FLUTTER_WEIGHTS[lead] * sawtooth(time / cycle);
      }
    };
    return { beats, atrial };
  }
  function pacedRhythm(opts) {
    const rate = opts.rate ?? 70;
    const rr = 60 / rate;
    const qtc = opts.qtc ?? 0.42;
    const base = { ...NORMAL_INTERVALS, ...opts.intervals ?? {} };
    const morph = opts.morphology ?? PVC_MORPHOLOGY;
    const qrs = opts.qrs ?? 0.16;
    const beats = [];
    const spikes = [];
    const qt = Math.max(qtFromBazett(qtc, rr), qrs + 0.02 + 0.12);
    let t = 0.3;
    while (t < opts.duration) {
      const iv = { ...base, hasP: false, qrs, st: 0.02, qt, rPeakFraction: 0.45, sPeakFraction: 0.78, tPeakFraction: 0.5 };
      beats.push({ qrsOn: t, intervals: iv, morphology: morph, label: "escape" });
      spikes.push({ t: t - 4e-3 });
      t += rr;
    }
    if (opts.dissociatedP) {
      const pp = 60 / (opts.atrialRate ?? 75);
      const pMorph = opts.morphology ?? NORMAL_MORPHOLOGY;
      let pOn = 0.12;
      while (pOn < opts.duration) {
        beats.push({ qrsOn: pOn + base.pr, intervals: { ...base, pOnly: true, qt: base.qt }, morphology: pMorph, label: "blocked-p" });
        pOn += pp;
      }
    }
    return { beats, spikes, atrial: null };
  }

  // src/core/noise.ts
  var NOISE_PRESETS = {
    none: {},
    light: { wander: 0.04, mains: 5e-3, emg: 6e-3 },
    moderate: { wander: 0.1, mains: 0.015, emg: 0.015 },
    heavy: { wander: 0.2, mains: 0.03, emg: 0.04 }
  };
  var LEAD_SCALE = { I: 1, II: 0.9, V1: 0.6, V2: 0.6, V3: 0.6, V4: 0.6, V5: 0.7, V6: 0.7 };
  function addNoise(strip2, opts) {
    const wander = opts.wander ?? 0;
    const mains = opts.mains ?? 0;
    const emg = opts.emg ?? 0;
    if (wander === 0 && mains === 0 && emg === 0) return strip2;
    const rng = makeRng(opts.seed ?? 11);
    const fs = strip2.fs;
    const n = strip2.leads.I.length;
    const mainsHz = opts.mainsHz ?? 50;
    const phase1 = rng() * 6.28;
    const phase2 = rng() * 6.28;
    const f1 = 0.22 + 0.08 * rng();
    const alpha = 1 - Math.exp(-2 * Math.PI * 60 / fs);
    for (const l of INDEPENDENT_LEADS) {
      const buf = strip2.leads[l];
      const scale = LEAD_SCALE[l];
      let lp = 0;
      const emgRaw = new Float64Array(n);
      let ss = 0;
      for (let i = 0; i < n; i++) {
        lp += alpha * (gaussian(rng) - lp);
        emgRaw[i] = lp;
        ss += lp * lp;
      }
      const emgGain = emg > 0 && ss > 0 ? emg / Math.sqrt(ss / n) : 0;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        const w = wander * scale * (0.7 * Math.sin(2 * Math.PI * f1 * t + phase1) + 0.3 * Math.sin(2 * Math.PI * 0.05 * t + phase2));
        const m = mains * Math.sin(2 * Math.PI * mainsHz * t);
        buf[i] = (buf[i] ?? 0) + w + m + emgGain * scale * (emgRaw[i] ?? 0);
      }
    }
    const d = deriveLimbLeads(strip2.leads.I, strip2.leads.II);
    strip2.leads.III = d.III;
    strip2.leads.aVR = d.aVR;
    strip2.leads.aVL = d.aVL;
    strip2.leads.aVF = d.aVF;
    return strip2;
  }

  // src/render/svg.ts
  var LEAD_GRID = [
    ["I", "aVR", "V1", "V4"],
    ["II", "aVL", "V2", "V5"],
    ["III", "aVF", "V3", "V6"]
  ];
  var ROW_HEIGHT_MM = 30;
  var BASELINE_OFFSET_MM = 18;
  var MARGIN_LEFT_MM = 14;
  var MARGIN_RIGHT_MM = 6;
  var MARGIN_TOP_MM = 10;
  var MARGIN_BOTTOM_MM = 6;
  function layoutFor(strip2, opts = {}) {
    const cal = opts.calibration ?? STANDARD_CALIBRATION;
    const colSec = opts.columnSeconds ?? 2.5;
    const rhythmLead = opts.rhythmLead === void 0 ? "II" : opts.rhythmLead;
    const colW = secondsToMm(colSec, cal);
    const totalSec = Math.min(colSec * 4, strip2.duration);
    const cells = [];
    const rows = LEAD_GRID.length + (rhythmLead ? 1 : 0);
    LEAD_GRID.forEach((row, r) => {
      const top = MARGIN_TOP_MM + r * ROW_HEIGHT_MM;
      row.forEach((lead, c) => {
        cells.push({
          lead,
          x: MARGIN_LEFT_MM + c * colW,
          baseline: top + BASELINE_OFFSET_MM,
          width: colW,
          top,
          bottom: top + ROW_HEIGHT_MM,
          t0: c * colSec,
          t1: (c + 1) * colSec,
          rhythm: false
        });
      });
    });
    if (rhythmLead) {
      const top = MARGIN_TOP_MM + LEAD_GRID.length * ROW_HEIGHT_MM;
      cells.push({
        lead: rhythmLead,
        x: MARGIN_LEFT_MM,
        baseline: top + BASELINE_OFFSET_MM,
        width: secondsToMm(totalSec, cal),
        top,
        bottom: top + ROW_HEIGHT_MM,
        t0: 0,
        t1: totalSec,
        rhythm: true
      });
    }
    return {
      widthMm: MARGIN_LEFT_MM + colW * 4 + MARGIN_RIGHT_MM,
      heightMm: MARGIN_TOP_MM + rows * ROW_HEIGHT_MM + MARGIN_BOTTOM_MM,
      cells,
      calibration: cal,
      marginLeft: MARGIN_LEFT_MM
    };
  }
  function locate(layout2, xMm, yMm) {
    for (const cell of layout2.cells) {
      if (xMm >= cell.x && xMm <= cell.x + cell.width && yMm >= cell.top && yMm <= cell.bottom) {
        return {
          cell,
          t: cell.t0 + mmToSeconds(xMm - cell.x, layout2.calibration),
          v: mmToMillivolts(cell.baseline - yMm, layout2.calibration)
        };
      }
    }
    return null;
  }
  function decimateMinMax(v, fs, i0, i1, bin) {
    const out = [];
    if (bin <= 1) {
      for (let i = i0; i < i1; i++) out.push([i / fs, v[i] ?? 0]);
      return out;
    }
    for (let start = i0; start < i1; start += bin) {
      const end = Math.min(i1, start + bin);
      let minI = start;
      let maxI = start;
      for (let i = start; i < end; i++) {
        const x = v[i] ?? 0;
        if (x < (v[minI] ?? 0)) minI = i;
        if (x > (v[maxI] ?? 0)) maxI = i;
      }
      if (minI === maxI) out.push([minI / fs, v[minI] ?? 0]);
      else if (minI < maxI) out.push([minI / fs, v[minI] ?? 0], [maxI / fs, v[maxI] ?? 0]);
      else out.push([maxI / fs, v[maxI] ?? 0], [minI / fs, v[minI] ?? 0]);
    }
    return out;
  }
  var fmt = (x) => (Math.round(x * 1e3) / 1e3).toString();
  function tracePath(strip2, cell, cal, pxPerMm) {
    const v = strip2.leads[cell.lead];
    const i0 = Math.max(0, Math.ceil(cell.t0 * strip2.fs));
    const i1 = Math.min(v.length, Math.floor(cell.t1 * strip2.fs) + 1);
    const bin = Math.max(1, Math.round(strip2.fs / (cal.paperSpeed * pxPerMm * 2)));
    const pts = decimateMinMax(v, strip2.fs, i0, i1, bin);
    let d = "";
    for (let k = 0; k < pts.length; k++) {
      const [t, val2] = pts[k];
      const x = cell.x + secondsToMm(t - cell.t0, cal);
      const y = cell.baseline - millivoltsToMm(val2, cal);
      d += (k === 0 ? "M" : "L") + fmt(x) + " " + fmt(y);
    }
    return d;
  }
  function calibrationPulsePath(x, baseline, cal) {
    const w = secondsToMm(0.2, cal);
    const h = millivoltsToMm(1, cal);
    const x0 = x - w - 2;
    return `M${fmt(x0 - 1)} ${fmt(baseline)}L${fmt(x0)} ${fmt(baseline)}L${fmt(x0)} ${fmt(baseline - h)}L${fmt(x0 + w)} ${fmt(baseline - h)}L${fmt(x0 + w)} ${fmt(baseline)}L${fmt(x0 + w + 1)} ${fmt(baseline)}`;
  }
  function renderSvg(strip2, opts = {}) {
    const layout2 = layoutFor(strip2, opts);
    const cal = layout2.calibration;
    const theme = opts.theme ?? "paper";
    const grid = opts.showGrid ?? true;
    const labels = opts.showLabels ?? true;
    const spikes = opts.showSpikes ?? true;
    const calPulse = opts.showCalibrationPulse ?? true;
    const pxPerMm = opts.pxPerMm ?? 8;
    const W = layout2.widthMm;
    const H = layout2.heightMm;
    const minor = theme === "paper" ? "#f3c4c4" : "#e6e6e6";
    const major = theme === "paper" ? "#e88f8f" : "#bdbdbd";
    const trace = "#111";
    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}" font-family="Helvetica, Arial, sans-serif">`
    );
    parts.push(`<defs>
<pattern id="minor" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="${minor}" stroke-width="0.08"/></pattern>
<pattern id="major" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#minor)"/><path d="M5 0H0V5" fill="none" stroke="${major}" stroke-width="0.16"/></pattern>
</defs>`);
    parts.push(`<rect width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>`);
    if (grid) parts.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="url(#major)"/>`);
    if (opts.title) {
      parts.push(`<text x="${fmt(layout2.marginLeft)}" y="6" font-size="3.2" fill="#222">${escapeXml(opts.title)}</text>`);
    }
    parts.push(
      `<text x="${fmt(W - MARGIN_RIGHT_MM)}" y="${fmt(H - 2)}" font-size="2.4" fill="#444" text-anchor="end">${cal.paperSpeed} mm/s   ${cal.gain} mm/mV   ${strip2.fs} Hz</text>`
    );
    if (calPulse) {
      const rows = /* @__PURE__ */ new Set();
      for (const c of layout2.cells) rows.add(c.baseline);
      for (const b of rows) {
        parts.push(`<path class="cal" d="${calibrationPulsePath(layout2.marginLeft, b, cal)}" fill="none" stroke="${trace}" stroke-width="0.25"/>`);
      }
    }
    for (const cell of layout2.cells) {
      parts.push(
        `<path class="trace" data-lead="${cell.lead}" d="${tracePath(strip2, cell, cal, pxPerMm)}" fill="none" stroke="${trace}" stroke-width="0.25" stroke-linejoin="round" stroke-linecap="round"/>`
      );
      if (labels) {
        parts.push(`<text x="${fmt(cell.x + 1.5)}" y="${fmt(cell.top + 4)}" font-size="3" font-weight="bold" fill="#222">${cell.lead}</text>`);
      }
      if (spikes) {
        for (const sp of strip2.spikes) {
          if (sp.t < cell.t0 || sp.t >= cell.t1) continue;
          if (sp.leads && !sp.leads.includes(cell.lead)) continue;
          const x = cell.x + secondsToMm(sp.t - cell.t0, cal);
          parts.push(`<line class="spike" x1="${fmt(x)}" y1="${fmt(cell.baseline)}" x2="${fmt(x)}" y2="${fmt(cell.baseline - 8)}" stroke="${trace}" stroke-width="0.18"/>`);
        }
      }
    }
    parts.push("</svg>");
    return parts.join("\n");
  }
  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/measure/delineate.ts
  function derivative(v, fs) {
    const n = v.length;
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) d[i] = ((v[i + 1] ?? 0) - (v[i - 1] ?? 0)) * fs / 2;
    return d;
  }
  function refineOnset(v, b, start, thr, limit) {
    let k = Math.max(0, start);
    let steps = 0;
    while (k < v.length - 1 && Math.abs((v[k] ?? 0) - b) < thr && steps++ < limit) k++;
    steps = 0;
    while (k > 0 && Math.abs((v[k - 1] ?? 0) - b) >= thr && steps++ < limit) k--;
    return k;
  }
  function refineOffset(v, b, start, thr, limit) {
    let k = Math.min(v.length - 1, start);
    let steps = 0;
    while (k > 0 && Math.abs((v[k] ?? 0) - b) < thr && steps++ < limit) k--;
    steps = 0;
    while (k < v.length - 1 && Math.abs((v[k + 1] ?? 0) - b) >= thr && steps++ < limit) k++;
    return k;
  }
  function estimateBaseline(v, bin) {
    const counts = /* @__PURE__ */ new Map();
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
  function delineate(v, fs, opts = {}) {
    const ampThr = opts.ampThreshold ?? 5e-3;
    const pMin = opts.pMinAmplitude ?? 0.02;
    const tMin = opts.tMinAmplitude ?? 0.03;
    const slopeFrac = opts.qrsSlopeFraction ?? 0.3;
    const endSlopeFrac = opts.qrsEndSlopeFraction ?? 0.02;
    const refractory = Math.round((opts.refractory ?? 0.2) * fs);
    const n = v.length;
    const b = estimateBaseline(v, ampThr);
    const d = derivative(v, fs);
    let maxAbsD = 0;
    for (let i2 = 0; i2 < n; i2++) maxAbsD = Math.max(maxAbsD, Math.abs(d[i2] ?? 0));
    const detectThr = slopeFrac * maxAbsD;
    const endThr = Math.max(Math.max(endSlopeFrac * maxAbsD, opts.qrsEndSlopeFloor ?? 3), Math.min(opts.qrsEndSlopeCap ?? 8, 0.1 * maxAbsD));
    const detections = [];
    let i = 0;
    while (i < n) {
      if (Math.abs(d[i] ?? 0) > detectThr) {
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
    const halfWidth = (pk) => {
      const a = Math.abs((v[pk] ?? 0) - b);
      const half = a / 2;
      let l = pk;
      while (l > 0 && Math.abs((v[l] ?? 0) - b) > half) l--;
      let r = pk;
      while (r < n - 1 && Math.abs((v[r] ?? 0) - b) > half) r++;
      return (r - l) / fs;
    };
    const widths = detections.map(halfWidth);
    const keep = detections.filter((pk, idx) => {
      const w = widths[idx];
      for (let j = 0; j < detections.length; j++) {
        if (j === idx) continue;
        const near = Math.abs(detections[j] - pk) / fs < 0.5;
        if (near && widths[j] < 0.06 && w > 2.2 * widths[j]) return false;
      }
      return true;
    });
    detections.length = 0;
    detections.push(...keep);
    const beats = [];
    for (let k = 0; k < detections.length; k++) {
      const pk = detections[k];
      const prevPk = k > 0 ? detections[k - 1] : -1;
      const nextPk = k + 1 < detections.length ? detections[k + 1] : n;
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
      const onIdx = refineOnset(v, b, s, ampThr, Math.round(0.08 * fs));
      let jIdx = Math.max(pk, e - gap);
      {
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
      let rAmp = 0;
      let sAmp = 0;
      for (let q = onIdx; q <= jIdx; q++) {
        const a = (v[q] ?? 0) - b;
        if (a > rAmp) rAmp = a;
        if (a < sAmp) sAmp = a;
      }
      let pOn = null;
      let pPeak = null;
      let pOff = null;
      let pAmp = null;
      {
        const prevT = k > 0 ? beats[k - 1].tOff : null;
        const afterPrev = prevT !== null ? Math.round(prevT * fs) + Math.round(0.01 * fs) : k === 0 ? 0 : prevPk + Math.round(0.12 * fs);
        const w0 = Math.max(afterPrev, onIdx - Math.round(0.3 * fs), 0);
        const w1 = onIdx - Math.round(5e-3 * fs);
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
      let tPeak = null;
      let tOff = null;
      let tAmp = null;
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
      const at = (idx) => idx === null ? null : idx / fs;
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
        sAmplitude: sAmp
      });
    }
    const rr = [];
    for (let k = 1; k < beats.length; k++) rr.push(beats[k].qrsOn - beats[k - 1].qrsOn);
    const mean = (xs) => xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null;
    const meanRr = mean(rr);
    const meanQt = mean(beats.map((x) => x.qt).filter((x) => x !== null));
    return {
      baseline: b,
      beats,
      rr,
      heartRate: meanRr ? 60 / meanRr : null,
      meanPr: mean(beats.map((x) => x.pr).filter((x) => x !== null)),
      meanQrs: mean(beats.map((x) => x.qrsDuration)),
      meanQt,
      qtcBazett: meanRr && meanQt ? meanQt / Math.sqrt(meanRr) : null
    };
  }
  function leadIdentityResiduals(leads) {
    const I = leads["I"];
    const II = leads["II"];
    const III = leads["III"];
    const aVR = leads["aVR"];
    const aVL = leads["aVL"];
    const aVF = leads["aVF"];
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

  // src/core/st-morphology.ts
  var ST_TYPES = {
    concave: {
      key: "concave",
      label: "Concave upward",
      ischaemicPattern: false,
      description: 'Segment bows downward then rises into the T wave (the "smiley"). Typical of pericarditis and early repolarisation, but also seen in a substantial minority of LAD occlusions.',
      slopeFactor: 0.5,
      shape: 1.9,
      tScale: 1.3,
      tAdd: 0.2,
      tSharpness: 1,
      defaultTPolarity: "upright"
    },
    convex: {
      key: "convex",
      label: "Convex (coved)",
      ischaemicPattern: true,
      description: 'Segment rises steeply right after J then bows over into a dome that merges with the T wave (the "frowny"). The classic transmural injury shape.',
      slopeFactor: 0.2,
      shape: 0.45,
      tScale: 1.15,
      tAdd: 0.5,
      tSharpness: 0.8,
      tPeakFraction: 0.42,
      defaultTPolarity: "upright"
    },
    "straight-upsloping": {
      key: "straight-upsloping",
      label: "Straight, upsloping",
      ischaemicPattern: true,
      description: "Linear segment climbing from J to the T wave. For depression, rises back toward baseline.",
      slopeFactor: 0.6,
      shape: 1,
      tScale: 1.1,
      tAdd: 0.3,
      defaultTPolarity: "upright"
    },
    "straight-horizontal": {
      key: "straight-horizontal",
      label: "Straight, horizontal",
      ischaemicPattern: true,
      description: "Flat shelf at the J-point level until the T wave begins.",
      slopeFactor: 0,
      shape: 1,
      tScale: 1,
      tAdd: 0.2,
      defaultTPolarity: "upright"
    },
    "straight-downsloping": {
      key: "straight-downsloping",
      label: "Straight, downsloping",
      ischaemicPattern: true,
      description: "Linear segment falling from J toward the T wave. Less common in elevation; often accompanied by T inversion. For depression, goes deeper.",
      slopeFactor: -0.45,
      shape: 1,
      tScale: 0.8,
      tAdd: 0.3,
      defaultTPolarity: "inverted"
    },
    tombstone: {
      key: "tombstone",
      label: "Tombstone",
      ischaemicPattern: true,
      description: "Massive convex elevation with loss of the R wave; QRS, ST and T fuse into one dome. Stylised.",
      slopeFactor: 0.15,
      shape: 0.3,
      tScale: 0.6,
      tAdd: 1.2,
      tSharpness: 0.7,
      tPeakFraction: 0.4,
      rScale: 0.45,
      sScale: 0.25,
      defaultTPolarity: "upright"
    }
  };
  var ST_TYPE_KEYS = ["none", "concave", "convex", "straight-upsloping", "straight-horizontal", "straight-downsloping", "tombstone"];
  function applyStShift(m, type, level, opts = {}) {
    const base = { ...m };
    delete base.stJ;
    delete base.stT;
    delete base.stShape;
    delete base.tPeakFraction;
    if (type === "none" || level === 0) return base;
    const def = ST_TYPES[type];
    const mag = Math.abs(level);
    const stJ = level;
    const stT = level + def.slopeFactor * mag;
    const polarity = opts.tPolarity ?? "default";
    const sign = polarity === "upright" ? 1 : polarity === "inverted" ? -1 : def.defaultTPolarity === "inverted" ? -1 : 1;
    const effSign = level < 0 && polarity === "default" ? 1 : sign;
    const t = effSign * (def.tScale * Math.abs(m.t) + def.tAdd * mag);
    const out = { ...base, stJ, stT, stShape: def.shape, t };
    if (def.tSharpness !== void 0) out.tSharpness = def.tSharpness;
    if (def.tPeakFraction !== void 0) out.tPeakFraction = def.tPeakFraction;
    if (def.rScale !== void 0) out.r = m.r * def.rScale;
    if (def.sScale !== void 0) out.s = m.s * def.sScale;
    return out;
  }

  // src/core/st-territory.ts
  var DEG = Math.PI / 180;
  var AUG = Math.sqrt(3) / 2;
  var LIMB_LEAD_VECTORS = {
    I: [1, 0],
    II: [Math.cos(60 * DEG), Math.sin(60 * DEG)],
    III: [Math.cos(120 * DEG), Math.sin(120 * DEG)],
    aVR: [AUG * Math.cos(-150 * DEG), AUG * Math.sin(-150 * DEG)],
    aVL: [AUG * Math.cos(-30 * DEG), AUG * Math.sin(-30 * DEG)],
    aVF: [AUG * Math.cos(90 * DEG), AUG * Math.sin(90 * DEG)]
  };
  function axisDegrees(vx, vy) {
    const a = Math.atan2(vy, vx) / DEG;
    return a > 180 ? a - 360 : a;
  }
  function fitFrontalVector(targets) {
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sxz = 0;
    let syz = 0;
    const entries = Object.entries(targets);
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
      const [lead, z] = entries[0];
      const [x, y] = LIMB_LEAD_VECTORS[lead];
      const n2 = x * x + y * y;
      vx = z * x / n2;
      vy = z * y / n2;
    } else if (Math.abs(det) > 1e-12) {
      vx = (syy * sxz - sxy * syz) / det;
      vy = (sxx * syz - sxy * sxz) / det;
    }
    const fitted = {};
    for (const lead of Object.keys(LIMB_LEAD_VECTORS)) {
      const [x, y] = LIMB_LEAD_VECTORS[lead];
      fitted[lead] = vx * x + vy * y;
    }
    const residuals = {};
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
      rms: entries.length ? Math.sqrt(ss / entries.length) : 0
    };
  }
  var TERRITORIES = {
    inferior: {
      key: "inferior",
      label: "Inferior (RCA pattern, III > II)",
      description: "Elevation II, III, aVF with III > II; reciprocal depression in aVL (and often I). aVL depression emerges from the frontal-plane geometry.",
      limb: { III: 1, II: 0.75, aVF: 0.95, aVL: -0.5, I: -0.2 },
      precordial: {}
    },
    "inferior-lcx": {
      key: "inferior-lcx",
      label: "Inferior (LCx pattern, II >= III)",
      description: "Elevation II, III, aVF with II at least III; aVL near isoelectric or mildly depressed.",
      limb: { II: 1, III: 0.8, aVF: 0.95, aVL: -0.2 },
      precordial: { V5: 0.3, V6: 0.35 }
    },
    anterior: {
      key: "anterior",
      label: "Anterior (LAD)",
      description: "Elevation V2 to V4 (maximal V3); inferior reciprocal depression, most in III, is authored as a limb-lead target.",
      limb: { III: -0.35, aVF: -0.2, aVL: 0.25 },
      precordial: { V1: 0.3, V2: 0.85, V3: 1, V4: 0.85, V5: 0.4 }
    },
    anteroseptal: {
      key: "anteroseptal",
      label: "Anteroseptal (proximal LAD)",
      description: "Elevation V1 to V3, with V1 involvement; aVR may rise; inferior reciprocal depression.",
      limb: { III: -0.3, aVF: -0.15, aVR: 0.25 },
      precordial: { V1: 0.7, V2: 1, V3: 0.9, V4: 0.45 }
    },
    anterolateral: {
      key: "anterolateral",
      label: "Anterolateral",
      description: "Elevation V3 to V6 with I and aVL; reciprocal depression III and aVF.",
      limb: { I: 0.5, aVL: 0.6, III: -0.5, aVF: -0.3 },
      precordial: { V2: 0.4, V3: 0.85, V4: 1, V5: 0.9, V6: 0.6 }
    },
    lateral: {
      key: "lateral",
      label: "Lateral",
      description: "Elevation I, aVL, V5, V6; reciprocal depression III, aVF, and mild V1 to V2.",
      limb: { I: 0.7, aVL: 0.8, III: -0.6, aVF: -0.3 },
      precordial: { V1: -0.2, V2: -0.2, V5: 1, V6: 0.9 }
    },
    "high-lateral": {
      key: "high-lateral",
      label: "High lateral (aVL, I; D1 / LCx branch)",
      description: "Elevation aVL and I with reciprocal depression in III (and aVF); sometimes V2 elevation. Subtle in practice; magnitude often small.",
      limb: { aVL: 1, I: 0.6, III: -0.7, aVF: -0.4 },
      precordial: { V2: 0.25 }
    },
    posterior: {
      key: "posterior",
      label: "Posterior (mirror in V1 to V3)",
      description: "Horizontal ST depression V1 to V3 with upright T as the anterior mirror of posterior elevation. V7 to V9 are not modelled. Inferior involvement optional.",
      limb: { III: 0.3, aVF: 0.3, II: 0.25 },
      precordial: { V1: -0.8, V2: -1, V3: -0.8 }
    },
    diffuse: {
      key: "diffuse",
      label: "Diffuse (non-territorial, pericarditis-like)",
      description: "Elevation in most leads without a coronary territory. aVR depression and mild aVL elevation follow from the frontal geometry. PR-segment depression, the other pericarditis sign, is not modelled yet.",
      limb: { I: 0.6, II: 1, III: 0.6, aVF: 0.9 },
      precordial: { V2: 0.6, V3: 0.9, V4: 1, V5: 1, V6: 0.8 }
    }
  };
  var TERRITORY_KEYS = ["inferior", "inferior-lcx", "anterior", "anteroseptal", "anterolateral", "lateral", "high-lateral", "posterior", "diffuse"];
  function applyTerritory(base, territory, magnitude, opts) {
    const def = TERRITORIES[territory];
    const depType = opts.depressionType ?? "straight-horizontal";
    const minLevel = opts.minLevel ?? 0.02;
    const limbTargets = {};
    for (const [lead, w] of Object.entries(def.limb)) limbTargets[lead] = w * magnitude;
    const frontal = fitFrontalVector(limbTargets);
    const out = {};
    const applied = {};
    for (const lead of INDEPENDENT_LEADS) {
      let level = 0;
      if (lead === "I" || lead === "II") level = frontal.fitted[lead];
      else level = (def.precordial[lead] ?? 0) * magnitude;
      if (Math.abs(level) < minLevel) {
        out[lead] = applyStShift(base[lead], "none", 0);
        continue;
      }
      const type = level > 0 ? opts.elevationType : depType;
      out[lead] = applyStShift(base[lead], type, level, { tPolarity: opts.tPolarity ?? "default" });
      applied[lead] = level;
    }
    return { morphology: out, frontal, applied };
  }

  // src/viewer/common.ts
  var $ = (id) => document.getElementById(id);
  var val = (id) => $(id).value;
  var num = (id) => Number(val(id));
  function readCalibration() {
    return { paperSpeed: num("speed"), gain: num("gain") };
  }
  function readRhythmLead() {
    const v = val("rhythmlead");
    return v === "none" ? null : v;
  }
  var fmtMs = (x) => x === null || !Number.isFinite(x) ? "n/a" : (x * 1e3).toFixed(0);
  function syncOutputs(ids, format = {}) {
    for (const id of ids) {
      const out = document.getElementById(id + "-out");
      if (out) out.value = (format[id] ?? ((v) => v))(val(id));
    }
  }
  var Calipers = class {
    constructor(container, getLayout, out, getCalibration) {
      this.container = container;
      this.getLayout = getLayout;
      this.out = out;
      this.getCalibration = getCalibration;
      this.points = [];
      container.addEventListener("click", (e) => this.onClick(e));
    }
    clear() {
      this.points = [];
      this.draw();
    }
    onClick(e) {
      const layout2 = this.getLayout();
      const svg = this.container.querySelector("svg");
      if (!layout2 || !svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const hit = locate(layout2, pt.x, pt.y);
      if (!hit) return;
      if (this.points.length >= 2) this.points = [];
      this.points.push({ t: hit.t, v: hit.v, x: pt.x, y: pt.y, lead: hit.cell.lead });
      this.draw();
    }
    draw() {
      const svg = this.container.querySelector("svg");
      if (!svg) return;
      svg.querySelector("#calipers")?.remove();
      const NS = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(NS, "g");
      g.id = "calipers";
      for (const p of this.points) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", String(p.x));
        l.setAttribute("x2", String(p.x));
        l.setAttribute("y1", String(p.y - 12));
        l.setAttribute("y2", String(p.y + 12));
        l.setAttribute("stroke", "#0f6e8c");
        l.setAttribute("stroke-width", "0.18");
        g.appendChild(l);
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        c.setAttribute("r", "0.55");
        c.setAttribute("fill", "#0f6e8c");
        g.appendChild(c);
      }
      if (this.points.length === 2) {
        const [a, b] = this.points;
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", String(a.x));
        l.setAttribute("y1", String(a.y));
        l.setAttribute("x2", String(b.x));
        l.setAttribute("y2", String(b.y));
        l.setAttribute("stroke", "#0f6e8c");
        l.setAttribute("stroke-width", "0.2");
        l.setAttribute("stroke-dasharray", "0.6 0.4");
        g.appendChild(l);
      }
      svg.appendChild(g);
      if (this.points.length === 0) this.out.textContent = "Calipers: click two points on the tracing.";
      else if (this.points.length === 1) {
        const p = this.points[0];
        this.out.textContent = `Calipers: point 1 in ${p.lead} at ${(p.t * 1e3).toFixed(0)} ms, ${p.v.toFixed(3)} mV. Click a second point.`;
      } else {
        const [a, b] = this.points;
        const dt = b.t - a.t;
        const dv = b.v - a.v;
        const cal = this.getCalibration();
        this.out.innerHTML = `Calipers: <b>${(dt * 1e3).toFixed(0)} ms</b> (${(dt * cal.paperSpeed).toFixed(1)} mm), <b>${dv.toFixed(3)} mV</b> (${(dv * cal.gain).toFixed(1)} mm)` + (Math.abs(dt) > 0.05 ? `, ${(60 / Math.abs(dt)).toFixed(1)} bpm if RR` : "") + (a.lead !== b.lead ? ` &middot; different leads (${a.lead}, ${b.lead})` : "");
      }
    }
  };
  function downloadSvg(container, filename) {
    const svg = container.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.querySelector("#calipers")?.remove();
    const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }
  function statTile(label, value, unit, delta, tone = "muted") {
    const d = delta === null ? "" : `<div class="d ${tone === "muted" ? "" : tone}">${delta}</div>`;
    return `<div class="stat"><div class="k">${label}</div><div class="v">${value}<small>${unit}</small></div>${d}</div>`;
  }
  function deltaTone(absDelta, okBelow, warnBelow) {
    return absDelta < okBelow ? "ok" : absDelta < warnBelow ? "warn" : "bad";
  }

  // src/viewer/main.ts
  var morphology = cloneMorphology(NORMAL_MORPHOLOGY);
  var lastFrontal = null;
  var strip = null;
  var layout = null;
  var loadingPreset = false;
  var calipers;
  var BASE = {
    rhythm: "sinus",
    rate: 72,
    jitter: 3,
    avblock: "none",
    blockratio: 4,
    escape: 40,
    escapefocus: "junctional",
    ectopy: 0,
    irreg: 0.25,
    fwave: 0.06,
    flutterrate: 300,
    conduction: "2",
    flutteramp: 0.15,
    pacedp: 1,
    pdur: 90,
    pr: 160,
    qrs: 90,
    qtc: 410,
    qtmode: "fraction",
    stfrac: 0.32,
    stexp: 0.5,
    st: 100,
    territory: "none",
    sttype: "convex",
    stmag: 0.3,
    reciptype: "straight-horizontal",
    tpol: "default"
  };
  var PRESETS = {
    normal: {},
    "brady-pr": { rate: 48, jitter: 4, pdur: 100, pr: 220, avblock: "first", qtc: 400 },
    tachy: { rate: 140, jitter: 1, pdur: 80, pr: 130, qrs: 86, qtc: 400 },
    wenckebach: { rate: 70, avblock: "wenckebach", blockratio: 4 },
    "two-to-one": { rate: 80, avblock: "mobitz2", blockratio: 2 },
    chb: { rate: 80, avblock: "complete", escape: 38, escapefocus: "junctional" },
    bigeminy: { rate: 70, ectopy: 1 },
    paced: { rhythm: "paced", rate: 70, pacedp: 1, qrs: 160, qtc: 440 },
    svt: { rhythm: "svt", rate: 180, qtc: 400 },
    af: { rhythm: "af", rate: 85, irreg: 0.25, fwave: 0.08 },
    "af-rvr": { rhythm: "af", rate: 150, irreg: 0.22, fwave: 0.05 },
    "af-svr": { rhythm: "af", rate: 45, irreg: 0.3, fwave: 0.08 },
    "flutter-21": { rhythm: "flutter", flutterrate: 300, conduction: "2" },
    "flutter-41": { rhythm: "flutter", flutterrate: 300, conduction: "4" },
    "flutter-var": { rhythm: "flutter", flutterrate: 300, conduction: "variable" },
    "inferior-ste": { rate: 80, jitter: 2, qtc: 420, territory: "inferior", sttype: "convex", stmag: 0.3 },
    "anterior-ste": { rate: 92, jitter: 2, pr: 150, qrs: 92, qtc: 430, territory: "anterior", sttype: "tombstone", stmag: 0.5 },
    pericarditis: { rate: 96, jitter: 2, pr: 150, qrs: 88, territory: "diffuse", sttype: "concave", stmag: 0.15, tpol: "upright" },
    posterior: { rate: 78, jitter: 2, qtc: 420, territory: "posterior", sttype: "straight-horizontal", stmag: 0.25, tpol: "upright" },
    lqt: { rate: 60, qtc: 520, stfrac: 0.2 },
    hypocalcaemia: { rate: 66, qtc: 500, stfrac: 0.6, stexp: 0.3 }
  };
  var RHYTHM_NOTES = {
    sinus: "Sinus generator: an atrial clock with an AV conduction rule per P wave. Blocked P waves are drawn. Ectopy inserts PVCs with a post-PVC AV block window (compensatory pause at ordinary rates, interpolation at slow rates).",
    svt: "SVT: regular narrow complexes with no sinus P. The retrograde P is drawn as a terminal deflection (pseudo-r\u2019 in V1, pseudo-S in II) with mild rate-related ST depression. AVNRT-like by appearance; no re-entrant circuit is modelled.",
    af: "Atrial fibrillation: log-normal RR with a 300 ms refractory floor, no P waves, fibrillatory baseline largest in V1. The TP baseline is not isoelectric by design.",
    flutter: "Atrial flutter: sawtooth at the flutter rate with fixed or variable AV conduction. Negative sawtooth in II and near-flat I, so III and aVF come out negative and aVL and aVR positive by derivation (typical counter-clockwise pattern).",
    paced: "Ventricular pacing: a spike (annotation layer, not sampled) before each wide LBBB-like complex at a fixed rate. Underlying dissociated sinus P waves march through independently."
  };
  function loadPreset(name) {
    const p = { ...BASE, ...PRESETS[name] ?? {} };
    loadingPreset = true;
    for (const [k, v] of Object.entries(p)) {
      const el = document.getElementById(k);
      if (el) el.value = String(v);
    }
    loadingPreset = false;
    rebuildMorphologyFromSt();
    $("preset").value = name;
  }
  function markCustom() {
    if (!loadingPreset) $("preset").value = "custom";
  }
  function rebuildMorphologyFromSt() {
    const territory = val("territory");
    const type = val("sttype");
    const mag = num("stmag");
    $("sttype-desc").textContent = type === "none" ? "" : ST_TYPES[type].description;
    if (territory === "none" || type === "none" || mag === 0) {
      morphology = cloneMorphology(NORMAL_MORPHOLOGY);
      lastFrontal = null;
      return;
    }
    const r = applyTerritory(NORMAL_MORPHOLOGY, territory, mag, {
      elevationType: type,
      depressionType: val("reciptype"),
      tPolarity: val("tpol")
    });
    morphology = r.morphology;
    lastFrontal = r.frontal;
  }
  function buildStSelects() {
    $("territory").innerHTML = '<option value="none">None</option>' + TERRITORY_KEYS.map((k) => `<option value="${k}">${TERRITORIES[k].label}</option>`).join("");
    $("sttype").innerHTML = ST_TYPE_KEYS.map((k) => `<option value="${k}">${k === "none" ? "None" : ST_TYPES[k].label}</option>`).join("");
    $("sttype").value = "convex";
  }
  function renderFrontal() {
    const el = $("frontal");
    if (!lastFrontal) {
      el.textContent = "";
      return;
    }
    const f = lastFrontal;
    const leads = ["I", "II", "III", "aVR", "aVL", "aVF"].map((l) => `${l} ${f.fitted[l] >= 0 ? "+" : ""}${f.fitted[l].toFixed(2)}`).join("  ");
    el.innerHTML = `Frontal ST vector <b>${f.magnitude.toFixed(2)} mV at ${f.axisDeg.toFixed(0)}&deg;</b> (least-squares fit, rms residual ${f.rms.toFixed(3)} mV).<br>Limb leads at J: ${leads}.<br>III, aVR, aVL and aVF follow from I and II; their change is geometry, not authored.`;
  }
  var MORPH_COLS = [
    { key: "p", label: "P", step: 0.01 },
    { key: "q", label: "Q", step: 0.01 },
    { key: "r", label: "R", step: 0.05 },
    { key: "s", label: "S", step: 0.05 },
    { key: "t", label: "T", step: 0.05 },
    { key: "stJ", label: "ST@J", step: 0.05 },
    { key: "stT", label: "ST@T", step: 0.05 },
    { key: "stShape", label: "ST shape", step: 0.1 }
  ];
  function buildMorphTable() {
    const table = $("morph");
    table.innerHTML = "<tr><th></th>" + MORPH_COLS.map((c) => `<th>${c.label}</th>`).join("") + "</tr>" + INDEPENDENT_LEADS.map((lead) => `<tr><th>${lead}</th>` + MORPH_COLS.map((c) => `<td><input type="number" step="${c.step}" data-lead="${lead}" data-key="${c.key}"></td>`).join("") + "</tr>").join("");
    table.addEventListener("change", (e) => {
      const el = e.target;
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      const lead = el.dataset["lead"];
      morphology[lead] = { ...morphology[lead], [el.dataset["key"]]: v };
      markCustom();
      update();
    });
  }
  function syncMorphTable() {
    document.querySelectorAll("#morph input").forEach((el) => {
      const m = morphology[el.dataset["lead"]];
      const key = el.dataset["key"];
      const v = key === "stShape" ? m.stShape ?? 1 : key === "stT" ? m.stT ?? m.stJ ?? 0 : m[key] ?? 0;
      el.value = String(Math.round(v * 1e3) / 1e3);
    });
  }
  function showRowsForRhythm(rhythm) {
    const av = val("avblock");
    document.querySelectorAll(".row").forEach((row) => {
      const c = row.classList;
      let show = true;
      if (c.contains("rh-sinus")) show = rhythm === "sinus";
      if (c.contains("rh-af")) show = rhythm === "af";
      if (c.contains("rh-flutter")) show = rhythm === "flutter";
      if (c.contains("rh-paced")) show = rhythm === "paced";
      if (c.contains("rh-block-ratio")) show = show && (av === "wenckebach" || av === "mobitz2");
      if (c.contains("rh-escape")) show = show && av === "complete";
      row.classList.toggle("hidden", !show);
    });
    $("rate-label").textContent = rhythm === "sinus" ? av === "complete" ? "Atrial rate (bpm)" : "Sinus rate (bpm)" : rhythm === "af" ? "Mean ventricular rate (bpm)" : rhythm === "flutter" ? "Rate (from flutter rate and ratio)" : rhythm === "paced" ? "Paced rate (bpm)" : "Rate (bpm)";
    $("rate").disabled = rhythm === "flutter";
  }
  function update() {
    const rhythm = val("rhythm");
    showRowsForRhythm(rhythm);
    syncOutputs(["rate", "jitter", "blockratio", "escape", "irreg", "fwave", "flutterrate", "flutteramp", "pdur", "pr", "qrs", "st", "qtc", "seed", "stfrac", "stexp", "stmag"]);
    const rate = num("rate");
    const pDuration = num("pdur") / 1e3;
    const pr = Math.max(num("pr") / 1e3, pDuration);
    const qrs = num("qrs") / 1e3;
    const st = num("st") / 1e3;
    const qtc = num("qtc") / 1e3;
    const seed = num("seed");
    const qtMode = val("qtmode");
    const qtPartition = qtMode === "fraction" ? { stFraction: num("stfrac"), rateExponent: num("stexp") } : void 0;
    $("st").disabled = qtMode === "fraction";
    $("stfrac").disabled = qtMode !== "fraction";
    $("stexp").disabled = qtMode !== "fraction";
    const intervals = { ...NORMAL_INTERVALS, pDuration, pr, qrs, st };
    const common = { duration: 10, qtc, intervals, morphology, seed, qtPartition };
    const warnings = [];
    if (pr !== num("pr") / 1e3) warnings.push(`PR raised to ${(pr * 1e3).toFixed(0)} ms so the PR segment is not negative.`);
    let beats;
    let atrial = null;
    let spikes = [];
    let requestedRate = rate;
    const chips = [];
    try {
      if (rhythm === "sinus") {
        const avType = val("avblock");
        const avBlock = { type: avType, ratio: num("blockratio"), escapeRate: num("escape"), escapeFocus: val("escapefocus") };
        const every = num("ectopy");
        const ectopy = every > 0 ? { every, couplingFraction: 0.55 } : void 0;
        beats = sinusRhythm({ ...common, rate, rrJitter: num("jitter") / 100, avBlock, ectopy });
        if (avType === "complete") requestedRate = num("escape");
        chips.push(avType === "complete" ? `Complete block, escape ${num("escape")}` : `Sinus ${rate}`);
        if (avType === "wenckebach") chips.push(`Wenckebach ${num("blockratio")}:${num("blockratio") - 1}`);
        if (avType === "mobitz2") chips.push(`${num("blockratio")}:1 block`);
        if (avType === "first") chips.push("First-degree block");
        if (every === 1) chips.push("Bigeminy");
        else if (every === 2) chips.push("Trigeminy");
        else if (every > 2) chips.push(`PVC every ${every}`);
      } else if (rhythm === "svt") {
        beats = svtRhythm({ ...common, rate }).beats;
        chips.push(`SVT ${rate}`);
      } else if (rhythm === "af") {
        const r = atrialFibrillation({ ...common, ventricularRate: rate, irregularity: num("irreg"), fWaveAmplitude: num("fwave") });
        beats = r.beats;
        atrial = r.atrial;
        chips.push(`AF, mean ${rate}`);
      } else if (rhythm === "flutter") {
        const condRaw = val("conduction");
        const conduction = condRaw === "variable" ? "variable" : Number(condRaw);
        const r = atrialFlutter({ ...common, flutterRate: num("flutterrate"), conduction, amplitude: num("flutteramp") });
        beats = r.beats;
        atrial = r.atrial;
        requestedRate = conduction === "variable" ? NaN : num("flutterrate") / conduction;
        chips.push(`Flutter ${num("flutterrate")}, ${condRaw === "variable" ? "variable" : condRaw + ":1"}`);
      } else {
        const r = pacedRhythm({ ...common, rate, qrs: Math.max(qrs, 0.12), dissociatedP: num("pacedp") === 1 });
        beats = r.beats;
        spikes = r.spikes;
        chips.push(`Paced ${rate}`);
      }
      strip = renderStrip(beats, 10, 1e3, spikes, atrial);
      const noise = val("noise");
      if (noise !== "none") {
        addNoise(strip, { ...NOISE_PRESETS[noise], seed });
        chips.push(`${noise} noise`);
      }
    } catch (err) {
      $("warnings").textContent = String(err);
      $("warnings").className = "warn-text";
      return;
    }
    const presetName = $("preset").selectedOptions[0]?.textContent ?? "";
    const opts = { calibration: readCalibration(), rhythmLead: readRhythmLead(), theme: val("theme"), title: `Synthetic ECG: ${presetName}` };
    layout = layoutFor(strip, opts);
    $("ecg").innerHTML = renderSvg(strip, opts);
    calipers.clear();
    $("case-title").textContent = presetName;
    const territory = val("territory");
    if (territory !== "none" && num("stmag") > 0) chips.push(`${TERRITORIES[territory].label.split(" (")[0]} ${ST_TYPES[val("sttype")]?.label.toLowerCase() ?? ""} ${num("stmag").toFixed(2)} mV`);
    $("case-chips").innerHTML = chips.map((c, i) => `<span class="chip${i === 0 ? " accent" : ""}">${c}</span>`).join("");
    {
      const rr0 = 60 / (Number.isFinite(requestedRate) ? requestedRate : rate);
      const qt0 = qtc * Math.sqrt(rr0);
      const part = qtPartition ? partitionQt(qt0, qrs, rr0, qtPartition) : { st, t: qt0 - qrs - st };
      $("partition-info").textContent = `At RR ${(rr0 * 1e3).toFixed(0)} ms: QT ${(qt0 * 1e3).toFixed(0)} = QRS ${(qrs * 1e3).toFixed(0)} + ST ${(part.st * 1e3).toFixed(0)} + T ${(part.t * 1e3).toFixed(0)} ms` + (part.t < 0.08 ? " (T too narrow)" : "");
    }
    const m = delineate(strip.leads.II, strip.fs);
    const rrReq = 60 / (Number.isFinite(requestedRate) ? requestedRate : rate);
    const qtReq = qtc * Math.sqrt(rrReq);
    const isSinus = rhythm === "sinus" && val("avblock") !== "complete";
    const tiles = [];
    {
      const hr = m.heartRate;
      const d = hr === null || !Number.isFinite(requestedRate) ? null : hr - requestedRate;
      tiles.push(statTile("Ventricular rate", hr === null ? "n/a" : hr.toFixed(0), "bpm", d === null ? Number.isFinite(requestedRate) ? null : "variable conduction" : `${d >= 0 ? "+" : ""}${d.toFixed(1)} vs requested`, d === null ? "muted" : deltaTone(Math.abs(d), 2, 5)));
    }
    if (isSinus) {
      const d = m.meanPr === null ? null : (m.meanPr - pr) * 1e3;
      tiles.push(statTile("PR", fmtMs(m.meanPr), "ms", d === null ? null : `${d >= 0 ? "+" : ""}${d.toFixed(0)} ms vs ${fmtMs(pr)}`, d === null ? "muted" : deltaTone(Math.abs(d), 10, 25)));
    }
    {
      const d = m.meanQrs === null ? null : (m.meanQrs - qrs) * 1e3;
      tiles.push(statTile("QRS", fmtMs(m.meanQrs), "ms", d === null ? null : `${d >= 0 ? "+" : ""}${d.toFixed(0)} ms vs ${fmtMs(qrs)}`, d === null ? "muted" : deltaTone(Math.abs(d), 8, 20)));
    }
    {
      const d = m.qtcBazett === null ? null : (m.qtcBazett - qtc) * 1e3;
      tiles.push(statTile("QTc (Bazett)", fmtMs(m.qtcBazett), "ms", d === null ? null : `${d >= 0 ? "+" : ""}${d.toFixed(0)} ms vs ${fmtMs(qtc)}`, d === null ? "muted" : deltaTone(Math.abs(d), 15, 40)));
    }
    $("stats").innerHTML = tiles.join("");
    const delta = (a, b) => a === null || !Number.isFinite(b) ? "" : ((a - b) * 1e3).toFixed(0);
    const rows = [];
    if (m.rr.length > 2) {
      const mean = m.rr.reduce((a, c) => a + c, 0) / m.rr.length;
      const sd = Math.sqrt(m.rr.reduce((a, c) => a + (c - mean) ** 2, 0) / m.rr.length);
      rows.push(["RR variability (sd/mean)", (sd / mean).toFixed(2), rhythm === "af" ? num("irreg").toFixed(2) : rhythm === "sinus" ? (num("jitter") / 100).toFixed(2) : "0.00", ""]);
    }
    rows.push(["QT (ms)", fmtMs(m.meanQt), fmtMs(qtReq), delta(m.meanQt, qtReq)]);
    const b0 = m.beats[1] ?? m.beats[0];
    if (b0) {
      rows.push(["R amplitude, II (mV)", b0.rAmplitude.toFixed(2), morphology.II.r.toFixed(2), (b0.rAmplitude - morphology.II.r).toFixed(3)]);
      rows.push(["ST at J, II (mV)", b0.stJ.toFixed(2), (morphology.II.stJ ?? 0).toFixed(2), (b0.stJ - (morphology.II.stJ ?? 0)).toFixed(3)]);
      rows.push(["ST at J+60, II (mV)", b0.st60.toFixed(2), "", ""]);
      if (b0.tAmplitude !== null) rows.push(["T amplitude, II (mV)", b0.tAmplitude.toFixed(2), morphology.II.t.toFixed(2), (b0.tAmplitude - morphology.II.t).toFixed(3)]);
    }
    const s = strip;
    const qrsBeats = s.beats.filter((b) => b.label !== "blocked-p" && b.landmarks.end <= s.duration).length;
    rows.push(["QRS complexes detected / generated", String(m.beats.length), String(qrsBeats), ""]);
    const blocked = s.beats.filter((b) => b.label === "blocked-p").length;
    if (blocked) rows.push(["Non-conducted P waves (generated)", "", String(blocked), ""]);
    const pvcs = s.beats.filter((b) => b.label === "pvc").length;
    if (pvcs) rows.push(["PVCs (generated)", "", String(pvcs), ""]);
    $("meas").innerHTML = "<tr><th>Quantity</th><th>Measured</th><th>Requested</th><th>Delta</th></tr>" + rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="dim">${r[2]}</td><td class="dim">${r[3]}</td></tr>`).join("");
    const all = [...warnings, ...strip.warnings];
    const w = $("warnings");
    if (all.length === 0) {
      w.textContent = "No warnings.";
      w.className = "ok-text";
    } else {
      const overlaps = strip.warnings.length;
      w.textContent = [...warnings, overlaps ? `${overlaps} beat${overlaps > 1 ? "s" : ""} overlap the preceding T or U wave (expected at fast rates, and whenever independent P waves march through).` : ""].filter(Boolean).join("\n");
      w.className = "warn-text";
    }
    const res = leadIdentityResiduals(strip.leads);
    $("identities").textContent = `Einthoven residual ${res.einthoven.toExponential(1)} mV, Goldberger residual ${res.goldbergerSum.toExponential(1)} mV`;
    $("rhythm-note").textContent = RHYTHM_NOTES[rhythm];
    syncMorphTable();
    renderFrontal();
  }
  function init() {
    buildStSelects();
    buildMorphTable();
    calipers = new Calipers($("ecg"), () => layout, $("caliper"), readCalibration);
    const sliders = ["rate", "jitter", "blockratio", "escape", "irreg", "fwave", "flutterrate", "flutteramp", "pdur", "pr", "qrs", "st", "qtc", "seed", "stfrac", "stexp"];
    for (const id of sliders) $(id).addEventListener("input", () => {
      markCustom();
      update();
    });
    for (const id of ["rhythm", "avblock", "escapefocus", "ectopy", "conduction", "pacedp", "qtmode"]) $(id).addEventListener("change", () => {
      markCustom();
      update();
    });
    for (const id of ["territory", "sttype", "reciptype", "tpol"]) $(id).addEventListener("change", () => {
      markCustom();
      rebuildMorphologyFromSt();
      update();
    });
    $("stmag").addEventListener("input", () => {
      markCustom();
      rebuildMorphologyFromSt();
      update();
    });
    for (const id of ["speed", "gain", "rhythmlead", "theme", "noise"]) $(id).addEventListener("change", update);
    $("preset").addEventListener("change", (e) => {
      const name = e.target.value;
      if (name === "custom") return;
      loadPreset(name);
      update();
    });
    $("morph-reset").addEventListener("click", () => {
      rebuildMorphologyFromSt();
      update();
    });
    $("download").addEventListener("click", () => downloadSvg($("ecg"), `ecg-${$("preset").value}.svg`));
    $("print").addEventListener("click", () => window.print());
    $("clear-cal").addEventListener("click", () => calipers.clear());
    loadPreset("normal");
    update();
  }
  init();
})();
