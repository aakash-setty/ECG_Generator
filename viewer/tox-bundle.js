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
  function qtcBazett(qt, rr) {
    return qt / Math.sqrt(rr);
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

  // src/core/tox.ts
  var TOXIDROME_KEYS = ["sodium-channel-blocker", "digoxin", "potassium-channel-blocker", "hyperkalaemia", "beta-blocker-ccb", "hypocalcaemia"];
  var BB_VARIANTS = [
    { key: "cardioselective", label: "Cardioselective BB or verapamil/diltiazem" },
    { key: "propranolol", label: "Propranolol (adds sodium channel blockade)" },
    { key: "sotalol", label: "Sotalol (adds potassium channel blockade)" }
  ];
  var lerp = (a, b, s) => a + (b - a) * s;
  var SODIUM_CHANNEL_BLOCKER = {
    key: "sodium-channel-blocker",
    label: "Sodium channel blocker (TCA type)",
    examples: "Tricyclic antidepressants; also class Ia/Ic antiarrhythmics, propranolol, carbamazepine, cocaine, local anaesthetics.",
    mechanism: "Fast sodium channel blockade slows phase 0 depolarisation, widening the QRS. LITFL: the right-sided intraventricular conducting system is more susceptible, which produces terminal right axis deviation of the QRS. Muscarinic (M1) blockade gives sinus tachycardia.",
    features: [
      "Sinus tachycardia (M1 receptor blockade)",
      "Intraventricular conduction delay: QRS > 100 ms in lead II",
      "Terminal R wave (R') in aVR > 3 mm, or R/S ratio > 0.7 in aVR (terminal right axis deviation)",
      "QRS > 100 ms predicts seizures; QRS > 160 ms predicts ventricular arrhythmias",
      "QT prolongation"
    ],
    notModelled: [
      "Brugada-pattern ST elevation in V1 to V2 (reported with sodium channel blockade)",
      "Ventricular tachycardia, hypotension-related changes, and the response to sodium bicarbonate",
      "Rate-dependent (use-dependent) block: QRS widening here does not vary with rate"
    ],
    sources: [
      { title: "LITFL ECG Library: Tricyclic Overdose (Sodium Channel Blocker Toxicity)", url: "https://litfl.com/tricyclic-overdose-sodium-channel-blocker-toxicity/" },
      { title: "LITFL CCC: ECG in Toxicology", url: "https://litfl.com/ecg-in-toxicology/" }
    ],
    checklist: [
      { label: "Sinus tachycardia", measure: "hr", threshold: 100, direction: "above", meaning: "M1 blockade" },
      { label: "QRS > 100 ms", measure: "qrs", threshold: 0.1, direction: "above", meaning: "predicts seizures" },
      { label: "QRS > 160 ms", measure: "qrs", threshold: 0.16, direction: "above", meaning: "predicts ventricular arrhythmias" },
      { label: "aVR terminal R' > 3 mm (0.3 mV)", measure: "avrRPrime", threshold: 0.3, direction: "above", meaning: "terminal right axis deviation" },
      { label: "aVR R/S > 0.7", measure: "avrRS", threshold: 0.7, direction: "above", meaning: "terminal right axis deviation" },
      { label: "QTc > 440 ms", measure: "qtc", threshold: 0.44, direction: "above", meaning: "QT prolongation" }
    ]
  };
  function sodiumChannelBlocker(s) {
    const morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const M = 0.75 * s;
    const axisDeg = 200;
    const rad = axisDeg * Math.PI / 180;
    const vx = M * Math.cos(rad);
    const vy = M * Math.sin(rad);
    const proj = (lead) => vx * LIMB_LEAD_VECTORS[lead][0] + vy * LIMB_LEAD_VECTORS[lead][1];
    morph.I = { ...morph.I, s: morph.I.s + proj("I"), t: morph.I.t * (1 - 0.4 * s) };
    morph.II = { ...morph.II, s: morph.II.s + proj("II"), t: morph.II.t * (1 - 0.4 * s) };
    morph.V1 = { ...morph.V1, rPrime: 0.55 * s, t: -0.1 - 0.15 * s };
    morph.V2 = { ...morph.V2, rPrime: 0.35 * s, t: morph.V2.t * (1 - 0.5 * s) };
    morph.V5 = { ...morph.V5, s: morph.V5.s - 0.35 * s, t: morph.V5.t * (1 - 0.4 * s) };
    morph.V6 = { ...morph.V6, s: morph.V6.s - 0.45 * s, t: morph.V6.t * (1 - 0.4 * s) };
    const rate = lerp(95, 135, s);
    const qrs = lerp(0.09, 0.18, s);
    const qtc = lerp(0.41, 0.5, s);
    const pr = lerp(0.16, 0.2, s);
    return {
      sinus: {
        rate,
        rrJitter: 0.02,
        qtc,
        intervals: { pr, qrs, rPeakFraction: 0.33, sPeakFraction: 0.62, rPrimePeakFraction: 0.84 },
        qtPartition: { stFraction: 0.3 },
        morphology: morph
      },
      morphology: morph,
      settings: {
        "Heart rate": `${rate.toFixed(0)} bpm`,
        "QRS duration": `${(qrs * 1e3).toFixed(0)} ms`,
        "Terminal QRS vector": `${M.toFixed(2)} mV at +${axisDeg}\xB0`,
        QTc: `${(qtc * 1e3).toFixed(0)} ms`,
        PR: `${(pr * 1e3).toFixed(0)} ms`
      }
    };
  }
  var DIGOXIN = {
    key: "digoxin",
    label: "Digoxin (effect to toxicity)",
    examples: "Digoxin, digitoxin; plant cardiac glycosides (oleander, foxglove).",
    mechanism: "Na+/K+-ATPase inhibition raises intracellular calcium (increased automaticity) and enhances vagal tone at the AV node (decreased AV conduction). Shortened atrial and ventricular refractory periods shorten the QT and produce secondary repolarisation changes. Digoxin effect indicates the drug is present, not toxicity.",
    features: [
      "Downsloping ST depression with a 'reverse tick' or 'Salvador Dali sagging' appearance, most in leads with tall R waves; J-point depression",
      "Flattened, inverted or biphasic T waves",
      "Shortened QT interval",
      "Mild PR prolongation (up to 240 ms, vagal)",
      "Prominent U waves",
      "Toxicity: sinus bradycardia, AV block; frequent PVCs are the most common abnormality, including bigeminy and trigeminy"
    ],
    notModelled: [
      "AV block patterns (Wenckebach, 2:1, complete heart block with escape rhythm)",
      "Paroxysmal atrial tachycardia with block, slow or regularised atrial fibrillation, atrial flutter with slow response",
      "Bidirectional VT, monomorphic and polymorphic VT",
      "Hyperkalaemia of acute overdose (peaked T waves would need the hyperkalaemia module)"
    ],
    sources: [
      { title: "LITFL ECG Library: Digoxin Effect", url: "https://litfl.com/digoxin-effect-ecg-library/" },
      { title: "LITFL ECG Library: Digoxin Toxicity", url: "https://litfl.com/digoxin-toxicity-ecg-library/" },
      { title: "LITFL CCC: ECG in Toxicology", url: "https://litfl.com/ecg-in-toxicology/" }
    ],
    checklist: [
      { label: "ST scoop depth (V5) beyond 0.1 mV", measure: "stScoop", threshold: 0.1, direction: "above", meaning: "digoxin effect" },
      { label: "QTc < 350 ms", measure: "qtc", threshold: 0.35, direction: "below", meaning: "short QT (LITFL threshold)" },
      { label: "PR > 200 ms", measure: "pr", threshold: 0.2, direction: "above", meaning: "vagal AV slowing" },
      { label: "U wave present (>= 0.05 mV)", measure: "uAmp", threshold: 0.05, direction: "above", meaning: "prominent U waves" },
      { label: "Bradycardia < 60 (conducted-beat rate)", measure: "sinusHr", threshold: 60, direction: "below", meaning: "toxicity" },
      { label: "PVCs present", measure: "pvcCount", threshold: 0, direction: "above", meaning: "most common toxic abnormality" }
    ]
  };
  function digoxin(s) {
    const morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const scoop = -(0.1 + 0.14 * s);
    const tFactor = 1 - 1.5 * s;
    const scooped = ["I", "II", "V4", "V5", "V6"];
    for (const l of scooped) {
      const base = morph[l];
      morph[l] = {
        ...base,
        stJ: -(0.03 + 0.05 * s),
        stT: -(0.02 + 0.03 * s),
        stShape: 0.7,
        stScoop: scoop * (l === "I" ? 0.7 : 1),
        t: base.t * tFactor,
        tSharpness: 0.9,
        u: 0.05 + 0.06 * s
      };
    }
    morph.V3 = { ...morph.V3, stScoop: scoop * 0.4, t: morph.V3.t * (1 - 0.6 * s), u: 0.04 + 0.05 * s };
    morph.V2 = { ...morph.V2, u: 0.04 + 0.05 * s };
    const rate = lerp(72, 42, s);
    const pr = lerp(0.16, 0.24, s);
    const qtc = lerp(0.4, 0.335, s);
    const ectopy = s >= 0.45 ? { every: s >= 0.8 ? 1 : 3, couplingFraction: 0.5 } : void 0;
    const partition = { stFraction: lerp(0.32, 0.18, s) };
    return {
      sinus: { rate, rrJitter: 0.02, qtc, intervals: { pr, uDuration: 0.16, uPeakFraction: 0.45 }, qtPartition: partition, ectopy, morphology: morph },
      morphology: morph,
      settings: {
        "Heart rate": `${rate.toFixed(0)} bpm`,
        PR: `${(pr * 1e3).toFixed(0)} ms`,
        QTc: `${(qtc * 1e3).toFixed(0)} ms`,
        "ST scoop (V5)": `${scoop.toFixed(2)} mV`,
        "T amplitude factor": tFactor.toFixed(2),
        "U amplitude (V5)": `${(0.05 + 0.06 * s).toFixed(2)} mV`,
        Ectopy: ectopy ? ectopy.every === 1 ? "bigeminy" : ectopy.every === 2 ? "trigeminy" : `PVC after every ${ectopy.every} sinus beats` : "none"
      }
    };
  }
  var POTASSIUM_CHANNEL_BLOCKER = {
    key: "potassium-channel-blocker",
    label: "Potassium efflux blocker (drug-induced long QT)",
    examples: "Sotalol, amiodarone, methadone, antipsychotics (haloperidol, quetiapine), macrolides, citalopram/escitalopram, hydroxychloroquine, ondansetron.",
    mechanism: "Block of the rapid delayed rectifier (IKr, hERG) slows phase 3 repolarisation, prolonging the action potential and the QT interval. Early afterdepolarisations at long cycle lengths trigger torsades de pointes, so bradycardia raises the risk. LITFL: risk is assessed with the QT nomogram (absolute QT against heart rate).",
    features: [
      "Prolongation of the QT interval",
      "Broad, low-amplitude T waves, often notched (LQT2-like morphology) and prominent U waves",
      "Bradycardia increases the likelihood of torsades de pointes (sotalol adds beta blockade)",
      "QTc > 440 ms (men) or > 460 ms (women) is prolonged; QTc > 500 ms carries substantially higher arrhythmia risk"
    ],
    notModelled: [
      "Torsades de pointes itself (a polymorphic rhythm needs a different engine)",
      "The QT nomogram line is not implemented numerically; the checklist uses QTc thresholds instead",
      "Macroscopic T-wave alternans, pause-dependent QT lengthening"
    ],
    sources: [
      { title: "LITFL ECG Library: QT Interval", url: "https://litfl.com/qt-interval-ecg-library/" },
      { title: "LITFL CCC: ECG in Toxicology", url: "https://litfl.com/ecg-in-toxicology/" }
    ],
    checklist: [
      { label: "QTc > 440 ms", measure: "qtc", threshold: 0.44, direction: "above", meaning: "prolonged (men)" },
      { label: "QTc > 460 ms", measure: "qtc", threshold: 0.46, direction: "above", meaning: "prolonged (women)" },
      { label: "QTc > 500 ms", measure: "qtc", threshold: 0.5, direction: "above", meaning: "substantially raised arrhythmia risk" },
      { label: "Bradycardia < 60", measure: "hr", threshold: 60, direction: "below", meaning: "raises torsades risk" },
      { label: "U wave present (>= 0.05 mV)", measure: "uAmp", threshold: 0.05, direction: "above", meaning: "prominent U waves" }
    ]
  };
  function potassiumChannelBlocker(s) {
    const morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const uAmp = 0.03 + 0.09 * s;
    for (const l of Object.keys(morph)) {
      const base = morph[l];
      morph[l] = {
        ...base,
        t: base.t * (1 - 0.5 * s),
        tSharpness: lerp(1, 0.7, s),
        tNotch: (base.t > 0 ? 1 : -1) * 0.07 * s,
        tNotchFraction: 0.72,
        u: uAmp * (base.t >= 0 ? 1 : 0.5)
      };
    }
    const rate = lerp(72, 50, s);
    const qtc = lerp(0.41, 0.57, s);
    return {
      sinus: { rate, rrJitter: 0.02, qtc, intervals: { uDuration: 0.16 }, qtPartition: { stFraction: lerp(0.32, 0.22, s) }, morphology: morph },
      morphology: morph,
      settings: {
        "Heart rate": `${rate.toFixed(0)} bpm`,
        QTc: `${(qtc * 1e3).toFixed(0)} ms`,
        "T amplitude factor": (1 - 0.5 * s).toFixed(2),
        "T notch": `${(0.07 * s).toFixed(3)} mV`,
        "U amplitude": `${uAmp.toFixed(2)} mV`
      }
    };
  }
  var HYPERKALAEMIA = {
    key: "hyperkalaemia",
    label: "Hyperkalaemia (potassium, digoxin overdose, HF acid, rhabdomyolysis)",
    examples: "Toxicological causes: acute digoxin poisoning, hydrofluoric acid (fluoride binds calcium and disrupts potassium channels), potassium salts, succinylcholine, potassium-sparing diuretics and ACE inhibitors in renal failure, tumour lysis, rhabdomyolysis.",
    mechanism: "Raised extracellular potassium depolarises the resting membrane and accelerates repolarisation (tall narrow T), then inactivates sodium channels so atrial and ventricular conduction slow (P flattening and loss, PR and QRS widening), ending in a sine-wave rhythm. LITFL: ECG changes generally do not manifest until potassium is at least about 6.0 mmol/L, and serum potassium may not correlate closely with the ECG.",
    features: [
      "The earliest manifestation is an increase in T wave amplitude: peaked T waves",
      "P wave widening and flattening, PR prolongation",
      "Bradyarrhythmias: sinus bradycardia, high-grade AV block with slow junctional and ventricular escape rhythms",
      "Conduction blocks (bundle branch block, fascicular blocks); QRS widening with bizarre QRS morphology",
      "Severe (> 9.0 mmol/L): sine wave appearance (pre-terminal), ventricular fibrillation, PEA with bizarre wide complex rhythm, asystole"
    ],
    notModelled: [
      "Bundle branch and fascicular block patterns as distinct morphologies (QRS widening here is uniform)",
      "High-grade AV block with escape (use the beta-blocker/CCB pattern for block, or the main tab)",
      "VF, PEA, asystole",
      "The stage labels map severity to approximate potassium bands; LITFL warns the correlation is loose"
    ],
    sources: [
      { title: "LITFL ECG Library: Hyperkalaemia", url: "https://litfl.com/hyperkalaemia-ecg-library/" },
      { title: "LITFL Toxicology Library: Hydrofluoric acid", url: "https://litfl.com/hydrofluric-acid/" }
    ],
    checklist: [
      { label: "Tall T in V3 (> 0.8 mV here; LITFL gives no numeric cut-off)", measure: "tAmpV3", threshold: 0.8, direction: "above", meaning: "earliest sign" },
      { label: "P amplitude in II < 0.05 mV (flattened or absent)", measure: "pAmpII", threshold: 0.05, direction: "below", meaning: "atrial conduction failure" },
      { label: "PR > 200 ms", measure: "pr", threshold: 0.2, direction: "above", meaning: "PR prolongation" },
      { label: "QRS > 120 ms", measure: "qrs", threshold: 0.12, direction: "above", meaning: "QRS widening" },
      { label: "Bradycardia < 60 (conducted-beat rate)", measure: "sinusHr", threshold: 60, direction: "below", meaning: "bradyarrhythmia" }
    ]
  };
  function hyperkalaemia(s) {
    const morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const ramp = (a, b) => Math.max(0, Math.min(1, (s - a) / (b - a)));
    const wT = Math.min(1, s / 0.5);
    const wP = ramp(0.3, 0.75);
    const wQ = ramp(0.55, 1);
    const wSine = ramp(0.85, 1);
    for (const l of Object.keys(morph)) {
      const base = morph[l];
      const tSign = base.t >= 0 ? 1 : -1;
      const tBase = Math.abs(base.t);
      const tAmp = tSign * (tBase * (1 + 2.2 * wT) + 0.25 * wT) * (1 - 0.25 * wSine);
      morph[l] = {
        ...base,
        p: base.p * (1 - 0.95 * wP),
        t: tAmp,
        tSharpness: lerp(1, 2, wT) * (1 - 0.5 * wSine),
        tPeakFraction: lerp(0.55, 0.5, wT),
        qrsSharpness: lerp(0.8, 1.6, wSine),
        r: base.r * (1 + 0.3 * wQ),
        s: base.s * (1 + 0.5 * wQ)
      };
    }
    const rate = lerp(72, 38, ramp(0.3, 1));
    const pr = lerp(0.16, 0.3, wP);
    const qrs = lerp(0.09, 0.24, wQ);
    const qtc = lerp(0.4, 0.44, wQ);
    const hasP = wP < 0.9;
    const stFraction = lerp(0.32, 0.05, Math.max(wQ, wSine));
    const stage = s < 0.3 ? "about 5.5 to 6.5 mmol/L: peaked T" : s < 0.55 ? "about 6.5 to 7.5: P flattening, PR prolongation" : s < 0.85 ? "about 7 to 9: QRS widening, P loss, bradycardia" : "above 9: sine wave (pre-terminal)";
    return {
      sinus: {
        rate,
        rrJitter: 0.02,
        qtc,
        intervals: { pr, qrs, hasP, pDuration: lerp(0.09, 0.13, wP), sPeakFraction: lerp(0.72, 0.6, wSine) },
        qtPartition: { stFraction, minT: 0.12 },
        morphology: morph
      },
      morphology: morph,
      stage,
      settings: {
        Stage: stage,
        "Heart rate": `${rate.toFixed(0)} bpm`,
        "T amplitude V3": `${morph.V3.t.toFixed(2)} mV`,
        "P amplitude II": hasP ? `${morph.II.p.toFixed(3)} mV` : "absent",
        PR: `${(pr * 1e3).toFixed(0)} ms`,
        "QRS duration": `${(qrs * 1e3).toFixed(0)} ms`
      }
    };
  }
  var BETA_BLOCKER_CCB = {
    key: "beta-blocker-ccb",
    label: "Beta-blocker or calcium-channel blocker",
    variants: BB_VARIANTS,
    examples: "Metoprolol, atenolol, propranolol, sotalol; verapamil, diltiazem (dihydropyridines cause reflex tachycardia instead and are not represented).",
    mechanism: "Beta blockade and L-type calcium channel blockade both depress SA node automaticity and AV node conduction. LITFL: a prolonged PR interval is an early sign of beta-blocker or calcium-channel blocker toxicity, even without significant bradycardia. Propranolol also blocks fast sodium channels and behaves more like a tricyclic in overdose (QRS widening, positive R\u2019 in aVR); sotalol blocks potassium channels (QT prolongation, torsades).",
    features: [
      "Sinus bradycardia",
      "1st degree, 2nd degree and 3rd degree AV block",
      "Junctional bradycardia, ventricular bradycardia",
      "Prolonged PR is an early sign, even in the absence of significant bradycardia",
      "Propranolol: QRS widening and a positive R\u2019 wave in aVR",
      "Sotalol: QT prolongation and torsades de pointes in overdose"
    ],
    notModelled: [
      "Hypotension and shock physiology (no ECG correlate is drawn)",
      "Torsades de pointes (sotalol)",
      "Hyperglycaemia of CCB poisoning versus hypoglycaemia of beta blockade (not ECG)",
      "Block type steps with severity as a scripted sequence (first degree, Wenckebach, 2:1, complete); a conduction model would make this continuous"
    ],
    sources: [
      { title: "LITFL ECG Library: Beta-blocker and Calcium-channel blocker toxicity", url: "https://litfl.com/beta-blocker-and-calcium-channel-blocker-toxicity/" },
      { title: "LITFL CCC: ECG in Toxicology", url: "https://litfl.com/ecg-in-toxicology/" }
    ],
    checklist: [
      { label: "PR > 200 ms (early sign)", measure: "pr", threshold: 0.2, direction: "above", meaning: "AV nodal depression" },
      { label: "Bradycardia < 60 (conducted-beat rate)", measure: "sinusHr", threshold: 60, direction: "below", meaning: "SA node depression or AV block" },
      { label: "Non-conducted P waves present", measure: "blockedPCount", threshold: 0, direction: "above", meaning: "2nd or 3rd degree AV block" },
      { label: "Escape beats present", measure: "escapeCount", threshold: 0, direction: "above", meaning: "complete heart block" },
      { label: "QRS > 100 ms", measure: "qrs", threshold: 0.1, direction: "above", meaning: "propranolol sodium channel effect" },
      { label: "QTc > 500 ms", measure: "qtc", threshold: 0.5, direction: "above", meaning: "sotalol potassium channel effect" }
    ]
  };
  function betaBlockerCcb(s, variant) {
    let morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const rate = lerp(70, 38, s);
    const pr = lerp(0.17, 0.3, Math.min(1, s / 0.6));
    let block;
    let stage;
    if (s < 0.35) {
      block = { type: "first" };
      stage = "sinus bradycardia with first-degree block";
    } else if (s < 0.6) {
      block = { type: "wenckebach", ratio: 4, prIncrement: 0.05 };
      stage = "Wenckebach (4:3)";
    } else if (s < 0.8) {
      block = { type: "mobitz2", ratio: 2 };
      stage = "2:1 AV block";
    } else {
      block = { type: "complete", escapeRate: lerp(45, 32, (s - 0.8) / 0.2), escapeFocus: s > 0.92 ? "ventricular" : "junctional" };
      stage = s > 0.92 ? "complete heart block, ventricular escape" : "complete heart block, junctional escape";
    }
    let qrs = 0.09;
    let qtc = 0.41;
    let uDuration;
    if (variant === "propranolol") {
      const na = sodiumChannelBlocker(s * 0.8);
      morph = na.morphology;
      qrs = lerp(0.09, 0.16, s);
    } else if (variant === "sotalol") {
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
        intervals: { pr, qrs, ...uDuration ? { uDuration } : {} },
        qtPartition: { stFraction: 0.32 },
        avBlock: block,
        morphology: morph
      },
      morphology: morph,
      stage,
      settings: {
        Variant: variant,
        Stage: stage,
        "Sinus (atrial) rate": `${rate.toFixed(0)} bpm`,
        PR: `${(pr * 1e3).toFixed(0)} ms`,
        "QRS duration": `${(qrs * 1e3).toFixed(0)} ms`,
        QTc: `${(qtc * 1e3).toFixed(0)} ms`,
        ...block.type === "complete" ? { "Escape rate": `${block.escapeRate.toFixed(0)} bpm` } : {}
      }
    };
  }
  var HYPOCALCAEMIA = {
    key: "hypocalcaemia",
    label: "Hypocalcaemia (hydrofluoric acid, ethylene glycol, citrate)",
    examples: "Toxicological causes: hydrofluoric acid burns or ingestion (fluoride binds calcium and magnesium), ethylene glycol (oxalate), massive citrated transfusion, EDTA. LITFL: the degree of QT prolongation is a useful biomarker of hypocalcaemia in HF acid poisoning.",
    mechanism: "Low extracellular calcium prolongs the action potential plateau (phase 2), so the ST segment lengthens. LITFL: hypocalcaemia causes QTc prolongation primarily by prolonging the ST segment; the T wave is typically left unchanged. Dysrhythmias are uncommon; torsades can occur but is much less common than with other electrolyte disturbances.",
    features: [
      "QTc prolongation primarily by prolonging the ST segment",
      "The T wave is typically left unchanged (contrast with potassium channel blockade, which broadens the T)",
      "Dysrhythmias are uncommon, although atrial fibrillation has been reported; torsades is possible but much less common"
    ],
    notModelled: [
      "Coexisting hyperkalaemia and hypomagnesaemia of fluoride poisoning (combine mentally with the hyperkalaemia pattern)",
      "Torsades de pointes",
      "The ST-versus-T split at a given QTc is a decree from the QT partition model (stFraction rises with severity); the source gives the direction, not numbers"
    ],
    sources: [
      { title: "LITFL ECG Library: Hypocalcaemia", url: "https://litfl.com/hypocalcaemia-ecg-library/" },
      { title: "LITFL Toxicology Library: Hydrofluoric acid", url: "https://litfl.com/hydrofluric-acid/" }
    ],
    checklist: [
      { label: "QTc > 440 ms", measure: "qtc", threshold: 0.44, direction: "above", meaning: "prolonged" },
      { label: "QTc > 500 ms", measure: "qtc", threshold: 0.5, direction: "above", meaning: "marked prolongation" },
      { label: "J to T peak > 250 ms (ST segment prolonged; decreed cut-off)", measure: "jtp", threshold: 0.25, direction: "above", meaning: "ST prolongation" },
      { label: "T peak to end < 110 ms (T wave unchanged)", measure: "tpe", threshold: 0.11, direction: "below", meaning: "T not broadened" }
    ]
  };
  function hypocalcaemia(s) {
    const morph = cloneMorphology(NORMAL_MORPHOLOGY);
    const qtc = lerp(0.41, 0.56, s);
    const stFraction = lerp(0.32, 0.66, s);
    const rate = 72;
    return {
      sinus: { rate, rrJitter: 0.03, qtc, qtPartition: { stFraction, rateExponent: 0.3, minT: 0.14 }, morphology: morph },
      morphology: morph,
      settings: {
        "Heart rate": `${rate} bpm`,
        QTc: `${(qtc * 1e3).toFixed(0)} ms`,
        "ST share of JT": stFraction.toFixed(2)
      }
    };
  }
  var TOXIDROMES = {
    "sodium-channel-blocker": SODIUM_CHANNEL_BLOCKER,
    digoxin: DIGOXIN,
    "potassium-channel-blocker": POTASSIUM_CHANNEL_BLOCKER,
    hyperkalaemia: HYPERKALAEMIA,
    "beta-blocker-ccb": BETA_BLOCKER_CCB,
    hypocalcaemia: HYPOCALCAEMIA
  };
  function applyToxidrome(key, severity, variant) {
    const s = Math.max(0, Math.min(1, severity));
    switch (key) {
      case "sodium-channel-blocker":
        return sodiumChannelBlocker(s);
      case "digoxin":
        return digoxin(s);
      case "potassium-channel-blocker":
        return potassiumChannelBlocker(s);
      case "hyperkalaemia":
        return hyperkalaemia(s);
      case "beta-blocker-ccb":
        return betaBlockerCcb(s, variant || "cardioselective");
      case "hypocalcaemia":
        return hypocalcaemia(s);
    }
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
    const mean2 = (xs) => xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null;
    const meanRr = mean2(rr);
    const meanQt = mean2(beats.map((x) => x.qt).filter((x) => x !== null));
    return {
      baseline: b,
      beats,
      rr,
      heartRate: meanRr ? 60 / meanRr : null,
      meanPr: mean2(beats.map((x) => x.pr).filter((x) => x !== null)),
      meanQrs: mean2(beats.map((x) => x.qrsDuration)),
      meanQt,
      qtcBazett: meanRr && meanQt ? meanQt / Math.sqrt(meanRr) : null
    };
  }

  // src/measure/tox-measures.ts
  var mean = (xs) => xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null;
  function sinusBeats(strip2, beats) {
    const sinusOn = strip2.beats.filter((b) => b.label !== "pvc" && b.label !== "blocked-p").map((b) => b.landmarks.qrsOn);
    return beats.filter((m) => sinusOn.some((t) => Math.abs(t - m.qrsOn) < 0.08));
  }
  function toxMeasures(strip2) {
    const fs = strip2.fs;
    const mII = delineate(strip2.leads.II, fs);
    const sinusII = sinusBeats(strip2, mII.beats);
    const rr = mII.rr;
    const meanRr = mean(rr);
    const qt = mean(sinusII.map((b) => b.qt).filter((x) => x !== null));
    const qrs = mean(sinusII.map((b) => b.qrsDuration));
    const pr = mean(sinusII.map((b) => b.pr).filter((x) => x !== null));
    const mAvr = delineate(strip2.leads.aVR, fs);
    const sinusAvr = sinusBeats(strip2, mAvr.beats);
    const avrR = mean(sinusAvr.map((b) => b.rAmplitude));
    const avrS = mean(sinusAvr.map((b) => Math.abs(b.sAmplitude)));
    const mV5 = delineate(strip2.leads.V5, fs);
    const sinusV5 = sinusBeats(strip2, mV5.beats);
    const scoops = [];
    const us = [];
    for (const b of sinusV5) {
      if (b.tPeak !== null) {
        const i0 = Math.round(b.j * fs);
        const i1 = Math.round(b.tPeak * fs);
        let nadir = Infinity;
        for (let i = i0; i <= i1; i++) nadir = Math.min(nadir, (strip2.leads.V5[i] ?? 0) - mV5.baseline);
        if (Number.isFinite(nadir)) scoops.push(-nadir);
      }
      if (b.tOff !== null) {
        const nextOn = mV5.beats.find((x) => x.qrsOn > b.qrsOn + 0.2)?.qrsOn ?? Infinity;
        if (nextOn - b.tOff < 0.28) continue;
        const i0 = Math.round(b.tOff * fs) + Math.round(0.02 * fs);
        const i1 = Math.min(strip2.leads.V5.length - 1, i0 + Math.round(0.2 * fs));
        let best = 0;
        for (let i = i0; i <= i1; i++) best = Math.max(best, Math.abs((strip2.leads.V5[i] ?? 0) - mV5.baseline));
        us.push(best);
      }
    }
    const mV3 = delineate(strip2.leads.V3, fs);
    const sinusV3 = sinusBeats(strip2, mV3.beats);
    const tAmpV3 = mean(sinusV3.map((b) => b.tAmplitude).filter((x) => x !== null));
    const pAmpII = sinusII.length ? mean(sinusII.map((b) => b.pAmplitude === null ? 0 : Math.abs(b.pAmplitude))) : null;
    const jtp = mean(sinusII.filter((b) => b.tPeak !== null).map((b) => b.tPeak - b.j));
    const tpe = mean(sinusII.filter((b) => b.tPeak !== null && b.tOff !== null).map((b) => b.tOff - b.tPeak));
    const sinusRr = [];
    for (let k = 1; k < sinusII.length; k++) sinusRr.push(sinusII[k].qrsOn - sinusII[k - 1].qrsOn);
    const sortedSinus = [...sinusRr].sort((a, b) => a - b);
    const lowerHalf = sortedSinus.slice(0, Math.max(1, Math.ceil(sortedSinus.length / 2)));
    const sinusCycle = lowerHalf.length ? lowerHalf[Math.floor(lowerHalf.length / 2)] : null;
    return {
      hr: meanRr ? 60 / meanRr : null,
      sinusHr: sinusCycle ? 60 / sinusCycle : null,
      pr,
      qrs,
      qt,
      // Rate correction uses the underlying sinus cycle, not the mean over PVC couplings and pauses.
      qtc: sinusCycle && qt ? qtcBazett(qt, sinusCycle) : null,
      qtcFridericia: sinusCycle && qt ? qt / Math.cbrt(sinusCycle) : null,
      avrRPrime: avrR,
      avrRS: avrR !== null && avrS ? avrR / avrS : null,
      stScoop: mean(scoops),
      uAmp: mean(us),
      pvcCount: strip2.beats.filter((b) => b.label === "pvc").length,
      sinusBeatsMeasured: sinusII.length,
      tAmpV3,
      pAmpII,
      blockedPCount: strip2.beats.filter((b) => b.label === "blocked-p").length,
      escapeCount: strip2.beats.filter((b) => b.label === "escape").length,
      jtp,
      tpe
    };
  }

  // src/viewer/common.ts
  var root = document;
  function setRoot(el) {
    root = el;
  }
  var $ = (id) => root.querySelector("#" + id);
  var val = (id) => $(id).value;
  var num = (id) => Number(val(id));
  function readCalibration() {
    return { paperSpeed: num("speed"), gain: num("gain") };
  }
  function readRhythmLead() {
    const v = val("rhythmlead");
    return v === "none" ? null : v;
  }
  function syncOutputs(ids, format = {}) {
    for (const id of ids) {
      const out = root.querySelector("#" + id + "-out");
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

  // src/viewer/tox.ts
  var strip = null;
  var layout = null;
  var calipers;
  function fmt2(measure, v) {
    if (v === null) return "n/a";
    switch (measure) {
      case "hr":
      case "sinusHr":
        return `${v.toFixed(0)} bpm`;
      case "pr":
      case "qrs":
      case "qt":
      case "qtc":
      case "qtcFridericia":
      case "jtp":
      case "tpe":
        return `${(v * 1e3).toFixed(0)} ms`;
      case "avrRPrime":
      case "tAmpV3":
      case "pAmpII":
        return `${v.toFixed(2)} mV (${(v * 10).toFixed(1)} mm)`;
      case "avrRS":
        return v.toFixed(2);
      case "stScoop":
      case "uAmp":
        return `${v.toFixed(2)} mV`;
      case "pvcCount":
      case "sinusBeatsMeasured":
      case "blockedPCount":
      case "escapeCount":
        return String(v);
    }
  }
  function update() {
    const key = val("tox");
    const sev = num("sev");
    const seed = num("seed");
    syncOutputs(["sev", "seed"], { sev: (v) => Number(v).toFixed(2) });
    const spec = TOXIDROMES[key];
    const variantRow = $("variant-row");
    const variantSel = $("variant");
    if (spec.variants) {
      variantRow.classList.remove("hidden");
      if (variantSel.dataset["for"] !== key) {
        variantSel.innerHTML = spec.variants.map((v) => `<option value="${v.key}">${v.label}</option>`).join("");
        variantSel.dataset["for"] = key;
      }
    } else variantRow.classList.add("hidden");
    const r = applyToxidrome(key, sev, spec.variants ? variantSel.value : void 0);
    strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 10, seed }), 10);
    const noise = val("noise");
    if (noise !== "none") addNoise(strip, { ...NOISE_PRESETS[noise], seed });
    const opts = { calibration: readCalibration(), rhythmLead: readRhythmLead(), theme: val("theme"), title: `${spec.label}, severity ${sev.toFixed(2)} (synthetic)` };
    layout = layoutFor(strip, opts);
    $("ecg").innerHTML = renderSvg(strip, opts);
    calipers.clear();
    $("case-title").textContent = spec.label;
    const chips = [`severity ${sev.toFixed(2)}`];
    if (r.stage) chips.push(r.stage);
    if (spec.variants) chips.push(variantSel.selectedOptions[0]?.textContent ?? "");
    if (noise !== "none") chips.push(`${noise} noise`);
    $("case-chips").innerHTML = chips.map((c, i) => `<span class="chip${i === 0 ? " accent" : ""}">${c}</span>`).join("");
    $("settings").innerHTML = Object.entries(r.settings).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    $("examples").textContent = spec.examples;
    $("mechanism").textContent = spec.mechanism;
    $("features").innerHTML = spec.features.map((f) => `<li>${f}</li>`).join("");
    $("notmodelled").innerHTML = spec.notModelled.map((f) => `<li>${f}</li>`).join("");
    $("sources").innerHTML = spec.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`).join("");
    const m = toxMeasures(strip);
    const present = spec.checklist.filter((c) => {
      const v = m[c.measure];
      return v !== null && (c.direction === "above" ? v > c.threshold : v < c.threshold);
    }).length;
    $("check-count").textContent = `${present} of ${spec.checklist.length} present`;
    const rows = spec.checklist.map((c) => {
      const v = m[c.measure];
      const hit = v !== null && (c.direction === "above" ? v > c.threshold : v < c.threshold);
      return `<tr><td class="left">${c.label}<div class="small">${c.meaning}</div></td><td>${fmt2(c.measure, v)}</td><td><span class="status ${hit ? "present" : "absent"}">${hit ? "present" : "absent"}</span></td></tr>`;
    });
    $("check").innerHTML = "<tr><th>Feature</th><th>Measured</th><th>Status</th></tr>" + rows.join("");
    const all = [
      ["Ventricular rate (all QRS)", fmt2("hr", m.hr)],
      ["Conducted-beat rate (sinus-to-sinus)", fmt2("sinusHr", m.sinusHr)],
      ["PR", fmt2("pr", m.pr)],
      ["QRS", fmt2("qrs", m.qrs)],
      ["QT", fmt2("qt", m.qt)],
      ["QTc Bazett / Fridericia", `${fmt2("qtc", m.qtc)} / ${fmt2("qtcFridericia", m.qtcFridericia)}`],
      ["aVR largest positive in QRS (R')", fmt2("avrRPrime", m.avrRPrime)],
      ["aVR R/S", fmt2("avrRS", m.avrRS)],
      ["V5 ST nadir depth", fmt2("stScoop", m.stScoop)],
      ["V5 post-T deflection (U)", fmt2("uAmp", m.uAmp)],
      ["V3 T amplitude", fmt2("tAmpV3", m.tAmpV3)],
      ["II P amplitude", fmt2("pAmpII", m.pAmpII)],
      ["II J to T peak / T peak to end", `${fmt2("jtp", m.jtp)} / ${fmt2("tpe", m.tpe)}`],
      ["PVCs in strip", String(m.pvcCount)],
      ["Non-conducted P waves", String(m.blockedPCount)],
      ["Escape beats", String(m.escapeCount)]
    ];
    $("allmeas").innerHTML = "<tr><th>Quantity</th><th>Value</th></tr>" + all.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
    $("measnote").textContent = `Measured on ${m.sinusBeatsMeasured} conducted beats; PVCs are excluded from interval means and rate correction uses the sinus cycle. QT measurement with flattened T waves and prominent U waves is unreliable in this delineator, as on real machines.`;
    $("warnings").textContent = strip.warnings.length ? `${strip.warnings.length} beats overlap the preceding T or U wave` : "";
  }
  function init() {
    setRoot(document.querySelector('[data-view="tox"]') ?? document);
    const sel = $("tox");
    sel.innerHTML = TOXIDROME_KEYS.map((k) => `<option value="${k}">${TOXIDROMES[k].label}</option>`).join("");
    calipers = new Calipers($("ecg"), () => layout, $("caliper"), readCalibration);
    for (const id of ["tox", "variant", "speed", "gain", "rhythmlead", "theme", "noise"]) $(id).addEventListener("change", update);
    for (const id of ["sev", "seed"]) $(id).addEventListener("input", update);
    $("download").addEventListener("click", () => downloadSvg($("ecg"), `tox-${val("tox")}.svg`));
    $("print").addEventListener("click", () => window.print());
    $("clear-cal").addEventListener("click", () => calipers.clear());
    update();
  }
  init();
})();
