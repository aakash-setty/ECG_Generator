import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { NORMAL_MORPHOLOGY, cloneMorphology } from './leads.js';
import { landmarksFromIntervals, NORMAL_INTERVALS } from './landmarks.js';

const at = (strip: ReturnType<typeof renderStrip>, lead: keyof typeof strip.leads, t: number) => strip.leads[lead][Math.round(t * strip.fs)] ?? NaN;

test('U wave: landmarks place it after T offset and its amplitude is exact', () => {
  const lm = landmarksFromIntervals({ ...NORMAL_INTERVALS, uDuration: 0.16 }, 1);
  assert.equal(lm.uOn, lm.tOff);
  assert.ok(Math.abs((lm.uOff as number) - (lm.tOff + 0.16)) < 1e-12);
  assert.equal(lm.end, lm.uOff);
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.II = { ...morph.II, u: 0.12 };
  const strip = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: morph, intervals: { uDuration: 0.16 } }), 4);
  const b = strip.beats[1]!.landmarks;
  assert.ok(Math.abs(at(strip, 'II', b.uPeak as number) - 0.12) < 0.002);
  assert.ok(Math.abs(at(strip, 'II', b.tOff)) < 0.002, 'T offset stays at baseline between T and U');
});

test("terminal R': positive terminal deflection after the S wave, S amplitude still exact", () => {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.V1 = { ...morph.V1, rPrime: 0.5 };
  const strip = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: morph, intervals: { qrs: 0.14 } }), 4);
  const b = strip.beats[1]!.landmarks;
  assert.ok(Math.abs(at(strip, 'V1', b.rPrimePeak) - 0.5) < 0.002, `R' ${at(strip, 'V1', b.rPrimePeak)}`);
  assert.ok(Math.abs(at(strip, 'V1', b.sPeak) - morph.V1.s) < 0.002, `S ${at(strip, 'V1', b.sPeak)}`);
  assert.ok(Math.abs(at(strip, 'V1', b.j)) < 0.002, 'J back at baseline');
});

test("aVR terminal R' emerges from terminal S waves in I and II", () => {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.I = { ...morph.I, s: -0.6 };
  morph.II = { ...morph.II, s: -0.5 };
  const strip = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: morph, intervals: { qrs: 0.14 } }), 4);
  const b = strip.beats[1]!.landmarks;
  assert.ok(Math.abs(at(strip, 'aVR', b.sPeak) - 0.55) < 0.002, `aVR at S peak ${at(strip, 'aVR', b.sPeak)}`);
});

test('ST scoop sags the middle of the ST segment without moving J or T onset', () => {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.V5 = { ...morph.V5, stJ: -0.05, stT: -0.05, stScoop: -0.15 };
  const strip = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: morph }), 4);
  const b = strip.beats[1]!.landmarks;
  assert.ok(Math.abs(at(strip, 'V5', b.j) + 0.05) < 0.003);
  assert.ok(Math.abs(at(strip, 'V5', b.tOn) + 0.05) < 0.003);
  const mid = at(strip, 'V5', b.j + 0.5 * (b.tOn - b.j));
  assert.ok(Math.abs(mid + 0.2) < 0.003, `mid ${mid}`);
});

test('T notch adds a second hump inside the T window', () => {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.II = { ...morph.II, t: 0.2, tSharpness: 0.8, tNotch: 0.08, tNotchFraction: 0.75 };
  const plain = cloneMorphology(NORMAL_MORPHOLOGY);
  plain.II = { ...plain.II, t: 0.2, tSharpness: 0.8 };
  const a = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: morph }), 4);
  const p = renderStrip(sinusRhythm({ rate: 60, duration: 4, morphology: plain }), 4);
  const b = a.beats[1]!.landmarks;
  const tc = b.tOn + 0.75 * (b.tOff - b.tOn);
  assert.ok(at(a, 'II', tc) - at(p, 'II', tc) > 0.07);
  assert.ok(Math.abs(at(a, 'II', b.tOff)) < 1e-9, 'notch stays inside the T window');
});

test('bigeminy: a PVC follows every sinus beat, with no P, wide QRS and a compensatory pause', () => {
  const beats = sinusRhythm({ rate: 60, duration: 12, ectopy: { every: 1, couplingFraction: 0.5 } });
  const labels = beats.map((b) => b.label);
  assert.ok(labels.filter((l) => l === 'pvc').length >= 4);
  const firstPvc = beats.findIndex((b) => b.label === 'pvc');
  const prev = beats[firstPvc - 1]!;
  const pvc = beats[firstPvc]!;
  const next = beats[firstPvc + 1]!;
  assert.equal(pvc.intervals.hasP, false);
  assert.ok(pvc.intervals.qrs >= 0.12);
  assert.ok(Math.abs(pvc.qrsOn - prev.qrsOn - 0.5) < 1e-9, 'coupling 0.5 of RR');
  assert.ok(Math.abs(next.qrsOn - prev.qrsOn - 2.0) < 1e-9, 'sinus clock not reset: next sinus at 2 RR');
  const strip = renderStrip(beats, 12);
  assert.equal(strip.leads.II.length, 12000);
});

test('at slow rates the PVC is interpolated (sinus impulse arrives after the block window)', () => {
  const beats = sinusRhythm({ rate: 40, duration: 12, ectopy: { every: 1, couplingFraction: 0.5 } });
  const i = beats.findIndex((b) => b.label === 'pvc');
  const prev = beats[i - 1]!;
  const next = beats[i + 1]!;
  assert.ok(Math.abs(next.qrsOn - prev.qrsOn - 1.5) < 1e-9, 'next sinus at 1 RR: interpolated');
});
