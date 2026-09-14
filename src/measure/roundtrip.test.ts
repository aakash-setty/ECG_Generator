/**
 * Round-trip tests: request -> generate -> measure (samples only) -> compare.
 *
 * Tolerances are stated per landmark because threshold delineation lags a
 * smooth onset by a few milliseconds by its nature. Observed maximum errors
 * are printed so drift is visible even while the assertions still pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delineate } from './delineate.js';
import { renderStrip, sinusRhythm, tpSampleIndices, normalizeBaseline } from '../core/sequencer.js';
import { NORMAL_INTERVALS } from '../core/landmarks.js';
import { NORMAL_MORPHOLOGY, cloneMorphology, type LeadName } from '../core/leads.js';

/** Tolerances in seconds (timing) and mV (amplitude). */
export const TOL = {
  qrsOn: 0.008,
  j: 0.008,
  pOn: 0.012,
  pOff: 0.012,
  tOff: 0.015,
  peak: 0.003,
  amplitude: 0.01,
};

interface ErrStats {
  [k: string]: number;
}

function maxErr(stats: ErrStats, key: string, e: number): void {
  stats[key] = Math.max(stats[key] ?? 0, Math.abs(e));
}

function roundTrip(lead: LeadName, rate: number, qtc: number, seed: number, opts: { rrJitter?: number } = {}): ErrStats {
  const strip = renderStrip(sinusRhythm({ rate, duration: 10, qtc, seed, rrJitter: opts.rrJitter ?? 0 }), 10);
  const m = delineate(strip.leads[lead], strip.fs);
  const truth = strip.beats;
  // Drop the last true beat if its T wave runs past the strip end.
  const usable = truth.filter((b) => b.landmarks.tOff < strip.duration - 0.05);
  assert.equal(m.beats.length, truth.length, `${lead} @${rate}: detected ${m.beats.length} of ${truth.length} beats`);
  const stats: ErrStats = {};
  for (let k = 0; k < usable.length; k++) {
    const t = usable[k]!.landmarks;
    const mb = m.beats[k]!;
    maxErr(stats, 'qrsOn', mb.qrsOn - t.qrsOn);
    maxErr(stats, 'j', mb.j - t.j);
    assert.ok(mb.pOn !== null && mb.pOff !== null, `${lead} @${rate}: P not found on beat ${k}`);
    maxErr(stats, 'pOn', mb.pOn - (t.pOn as number));
    maxErr(stats, 'pOff', mb.pOff - (t.pOff as number));
    maxErr(stats, 'pPeak', (mb.pPeak as number) - (t.pPeak as number));
    assert.ok(mb.tOff !== null && mb.tPeak !== null, `${lead} @${rate}: T not found on beat ${k}`);
    maxErr(stats, 'tOff', mb.tOff - t.tOff);
    maxErr(stats, 'tPeak', mb.tPeak - t.tPeak);
    maxErr(stats, 'rAmp', mb.rAmplitude - NORMAL_MORPHOLOGY[lead as 'II'].r);
    maxErr(stats, 'sAmp', mb.sAmplitude - NORMAL_MORPHOLOGY[lead as 'II'].s);
    maxErr(stats, 'tAmp', (mb.tAmplitude as number) - NORMAL_MORPHOLOGY[lead as 'II'].t);
  }
  return stats;
}

function assertWithin(stats: ErrStats, label: string): void {
  const fail: string[] = [];
  const check = (k: string, tol: number) => {
    if ((stats[k] ?? 0) > tol) fail.push(`${k}: ${(stats[k]! * 1000).toFixed(1)} ms > ${tol * 1000} ms`);
  };
  check('qrsOn', TOL.qrsOn);
  check('j', TOL.j);
  check('pOn', TOL.pOn);
  check('pOff', TOL.pOff);
  check('pPeak', TOL.peak);
  check('tOff', TOL.tOff);
  check('tPeak', TOL.peak);
  for (const k of ['rAmp', 'sAmp', 'tAmp']) {
    if ((stats[k] ?? 0) > TOL.amplitude) fail.push(`${k}: ${stats[k]!.toFixed(4)} mV > ${TOL.amplitude} mV`);
  }
  const summary = Object.entries(stats)
    .map(([k, v]) => `${k}=${k.endsWith('Amp') ? v.toFixed(4) + 'mV' : (v * 1000).toFixed(1) + 'ms'}`)
    .join(' ');
  console.log(`  [round-trip ${label}] max errors: ${summary}`);
  assert.equal(fail.length, 0, `${label}: ${fail.join('; ')}`);
}

for (const rate of [50, 60, 75, 100, 120]) {
  test(`round-trip lead II at ${rate} bpm`, () => {
    assertWithin(roundTrip('II', rate, 0.40, 3), `II ${rate}bpm`);
  });
}

test('round-trip lead II with RR jitter', () => {
  assertWithin(roundTrip('II', 80, 0.42, 11, { rrJitter: 0.05 }), 'II 80bpm jitter');
});

test('round-trip lead I (small amplitudes)', () => {
  assertWithin(roundTrip('I', 70, 0.40, 5), 'I 70bpm');
});

test('round-trip lead V1 (S-dominant QRS, inverted T)', () => {
  assertWithin(roundTrip('V1', 70, 0.40, 5), 'V1 70bpm');
});

test('measured intervals match requested PR, QRS, QT within tolerance', () => {
  const iv = { ...NORMAL_INTERVALS, pr: 0.18, qrs: 0.10, st: 0.09 };
  const strip = renderStrip(sinusRhythm({ rate: 65, duration: 10, qtc: 0.43, intervals: iv }), 10);
  const m = delineate(strip.leads.II, strip.fs);
  const rr = 60 / 65;
  const qtExpected = 0.43 * Math.sqrt(rr);
  assert.ok(Math.abs((m.meanPr as number) - 0.18) < TOL.pOn + TOL.qrsOn, `PR ${m.meanPr}`);
  assert.ok(Math.abs((m.meanQrs as number) - 0.10) < TOL.qrsOn + TOL.j, `QRS ${m.meanQrs}`);
  assert.ok(Math.abs((m.meanQt as number) - qtExpected) < TOL.qrsOn + TOL.tOff, `QT ${m.meanQt} vs ${qtExpected}`);
  assert.ok(Math.abs((m.heartRate as number) - 65) < 0.5, `HR ${m.heartRate}`);
});

test('ST elevation round trip: J level and T amplitude from baseline are exact', () => {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph.II = { ...morph.II, stJ: 0.3, stT: 0.35, stShape: 0.7 };
  const strip = renderStrip(sinusRhythm({ rate: 70, duration: 6, morphology: morph }), 6);
  const lm = strip.beats[1]!.landmarks;
  const v = strip.leads.II;
  const at = (t: number) => v[Math.round(t * strip.fs)] ?? NaN;
  // Landmarks need not fall on the 1 kHz sample grid, so allow half a sample of slope (< 2 microvolts here).
  assert.ok(Math.abs(at(lm.j) - 0.3) < 0.002, `J level ${at(lm.j)}`);
  assert.ok(Math.abs(at(lm.tOn) - 0.35) < 0.002, `T onset level ${at(lm.tOn)}`);
  assert.ok(Math.abs(at(lm.tPeak) - morph.II.t) < 0.002, `T peak ${at(lm.tPeak)}`);
  assert.ok(Math.abs(at(lm.tOff)) < 1e-4);
  const m = delineate(v, strip.fs);
  const mb = m.beats[1]!;
  assert.ok(Math.abs(mb.stJ - 0.3) < 0.05, `measured stJ ${mb.stJ}`);
});

test('TP baseline is exactly zero by construction (compact support)', () => {
  const strip = renderStrip(sinusRhythm({ rate: 70, duration: 10, rrJitter: 0.04, seed: 2 }), 10);
  const idx = tpSampleIndices(strip);
  assert.ok(idx.length > 1000, 'expected a substantial TP sample set');
  for (const l of Object.keys(strip.leads) as LeadName[]) {
    for (const i of idx) assert.ok(strip.leads[l][i] === 0, `${l} sample ${i} not zero: ${strip.leads[l][i]}`);
  }
  const corr = normalizeBaseline(strip);
  for (const l of Object.keys(corr) as LeadName[]) assert.ok(corr[l] === 0, `${l} correction ${corr[l]}`);
});
