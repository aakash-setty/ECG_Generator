import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNoise, NOISE_PRESETS } from './noise.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { pacedRhythm } from './rhythms.js';
import { leadIdentityResiduals, delineate } from '../measure/delineate.js';

test('noise keeps the lead identities exact and has the requested scale', () => {
  const strip = addNoise(renderStrip(sinusRhythm({ rate: 70, duration: 10 }), 10), { ...NOISE_PRESETS.moderate, seed: 2 });
  const r = leadIdentityResiduals(strip.leads);
  assert.ok(r.einthoven < 1e-12 && r.goldbergerSum < 1e-12);
  // In lead I the baseline now wanders by roughly the requested amplitude.
  let max = 0;
  for (let i = 0; i < strip.leads.I.length; i++) max = Math.max(max, Math.abs(strip.leads.I[i]!));
  assert.ok(max > 0.6, 'R wave still dominates');
  const m = delineate(strip.leads.II, strip.fs);
  assert.ok(m.beats.length >= 10, `QRS detection survives moderate noise: ${m.beats.length}`);
});

test('noise "none" is a no-op', () => {
  const a = renderStrip(sinusRhythm({ rate: 70, duration: 4 }), 4);
  const before = Array.from(a.leads.V2);
  addNoise(a, NOISE_PRESETS.none);
  assert.deepEqual(Array.from(a.leads.V2), before);
});

test('paced rhythm: spike before every wide complex, fixed rate, optional dissociated P', () => {
  const r = pacedRhythm({ rate: 70, duration: 10, dissociatedP: true, atrialRate: 90 });
  const paced = r.beats.filter((b) => b.label === 'escape');
  assert.equal(r.spikes.length, paced.length);
  for (let i = 0; i < paced.length; i++) assert.ok(Math.abs(paced[i]!.qrsOn - r.spikes[i]!.t - 0.004) < 1e-12);
  assert.ok(r.beats.filter((b) => b.label === 'blocked-p').length >= 14);
  const strip = renderStrip(r.beats, 10, 1000, r.spikes);
  assert.equal(strip.spikes.length, paced.length);
  const m = delineate(strip.leads.V6, strip.fs);
  assert.ok(Math.abs((m.heartRate as number) - 70) < 1);
  assert.ok((m.meanQrs as number) > 0.13, `paced QRS ${m.meanQrs}`);
});
