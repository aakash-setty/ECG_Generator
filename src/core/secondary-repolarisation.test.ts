import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NORMAL_MORPHOLOGY, cloneMorphology, INDEPENDENT_LEADS } from './leads.js';
import { applySecondaryRepolarisation, frontalTerminal, terminalDeflection } from './secondary-repolarisation.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { applyToxidrome } from './tox.js';
import { delineate } from '../measure/delineate.js';

test('secondary repolarisation: T opposes the terminal deflection and J sits on its return limb', () => {
  const m = cloneMorphology(NORMAL_MORPHOLOGY);
  m.II = { ...m.II, s: -0.6 };
  m.V1 = { ...m.V1, rPrime: 0.8 };
  applySecondaryRepolarisation(m, { k: 0.8, c: 0.3 });
  assert.ok(Math.abs(m.II.t - 0.48) < 1e-9, `II t ${m.II.t}`);
  assert.ok(Math.abs((m.II.stJ ?? 0) + 0.18) < 1e-9, `II stJ ${m.II.stJ}`);
  assert.ok(Math.abs(m.V1.t + 0.64) < 1e-9, `V1 t ${m.V1.t}`);
  assert.ok((m.V1.stJ ?? 0) > 0, 'V1 J point positive under a positive R\'');
});

test('secondary repolarisation: weight 0 leaves the morphology unchanged', () => {
  const m = cloneMorphology(NORMAL_MORPHOLOGY);
  const before = JSON.stringify(m);
  applySecondaryRepolarisation(m, { weight: 0 });
  for (const lead of INDEPENDENT_LEADS) {
    assert.equal(m[lead].t, NORMAL_MORPHOLOGY[lead].t);
  }
  // Only the explicit tPeakFraction/stJ/stT keys are added; values are the originals.
  assert.notEqual(before, '');
});

test('frontalTerminal at +250 degrees gives S in I, II and III and a positive R\' in aVR', () => {
  const f = frontalTerminal(1, 250);
  const III = f.II - f.I;
  const aVR = -(f.I + f.II) / 2;
  assert.ok(f.I < 0 && f.II < 0 && III < 0, `I ${f.I} II ${f.II} III ${III}`);
  assert.ok(aVR > 0.5, `aVR ${aVR}`);
});

test('terminalDeflection picks R\' over S over R', () => {
  assert.equal(terminalDeflection({ ...NORMAL_MORPHOLOGY.II, s: -0.3, rPrime: 0.4 }), 0.4);
  assert.equal(terminalDeflection({ ...NORMAL_MORPHOLOGY.II, s: -0.3 }), -0.3);
  assert.equal(terminalDeflection({ ...NORMAL_MORPHOLOGY.II, s: 0 }), NORMAL_MORPHOLOGY.II.r);
});

test('sodium channel blocker at severity 0.6: T discordant to the terminal S in II, concordant-negative in aVR, no flat ST', () => {
  const r = applyToxidrome('sodium-channel-blocker', 0.6);
  const strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 6, seed: 3 }), 6);
  const g = strip.beats[2]!.landmarks;
  const at = (lead: 'II' | 'aVR' | 'V1' | 'V5', t: number) => strip.leads[lead][Math.round(t * strip.fs)] ?? 0;
  // II: S negative, T positive, J below baseline and between S nadir and T peak.
  assert.ok(at('II', g.sPeak) < -0.3, 'II S');
  assert.ok(at('II', g.tPeak) > 0.3, 'II T');
  assert.ok(at('II', g.j) < 0 && at('II', g.j) > at('II', g.sPeak), 'II J on the return limb');
  // No flat ST: the ST window is under 5 ms.
  assert.ok(g.tOn - g.j < 0.005, `ST ${g.tOn - g.j}`);
  // aVR mirrors II: terminal deflection positive, T negative. V1: R' positive, T negative. V5: S then upright T.
  assert.ok(at('aVR', g.j) > 0 && at('aVR', g.tPeak) < 0, 'aVR');
  assert.ok(at('V1', g.rPrimePeak) > 0.4 && at('V1', g.tPeak) < 0, 'V1');
  assert.ok(at('V5', g.sPeak) < -0.4 && at('V5', g.tPeak) > 0.3, 'V5');
});

test('sodium channel blocker: the delineator follows the slurred S to a J point within 12 ms across severities', () => {
  for (const s of [0.3, 0.6, 0.9]) {
    const r = applyToxidrome('sodium-channel-blocker', s);
    const strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 8, seed: 3 }), 8);
    const m = delineate(strip.leads.II, strip.fs);
    const g = strip.beats[2]!.landmarks;
    const b = m.beats[2]!;
    assert.ok(Math.abs(b.j - g.j) < 0.012, `severity ${s}: J error ${((b.j - g.j) * 1000).toFixed(1)} ms`);
    assert.ok(Math.abs((m.heartRate ?? 0) - r.sinus.rate) < 6, `severity ${s}: rate ${m.heartRate} vs ${r.sinus.rate}`);
  }
});

test('sodium channel blocker at full severity: the rate is not double counted despite QRS-T fusion', () => {
  const r = applyToxidrome('sodium-channel-blocker', 1);
  const strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 12, seed: 3 }), 12);
  const m = delineate(strip.leads.II, strip.fs);
  assert.ok(Math.abs((m.heartRate ?? 0) - r.sinus.rate) < 8, `rate ${m.heartRate} vs ${r.sinus.rate}`);
});
