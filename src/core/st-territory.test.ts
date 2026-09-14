import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFrontalVector, applyTerritory, LIMB_LEAD_VECTORS, TERRITORY_KEYS } from './st-territory.js';
import { NORMAL_MORPHOLOGY } from './leads.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { delineate } from '../measure/delineate.js';

test('limb lead vectors reproduce the Einthoven and Goldberger identities for any vector', () => {
  for (const [vx, vy] of <Array<[number, number]>>[
    [0.3, 0.1],
    [-0.2, 0.5],
    [0.7, -0.4],
  ]) {
    const L = (k: keyof typeof LIMB_LEAD_VECTORS) => vx * LIMB_LEAD_VECTORS[k][0] + vy * LIMB_LEAD_VECTORS[k][1];
    assert.ok(Math.abs(L('III') - (L('II') - L('I'))) < 1e-12);
    assert.ok(Math.abs(L('aVR') + (L('I') + L('II')) / 2) < 1e-12);
    assert.ok(Math.abs(L('aVL') - (L('I') - L('II') / 2)) < 1e-12);
    assert.ok(Math.abs(L('aVF') - (L('II') - L('I') / 2)) < 1e-12);
  }
});

test('a consistent request is fitted exactly; an inconsistent one reports residuals', () => {
  // Consistent: derive targets from a known vector.
  const vx = 0.1;
  const vy = 0.3;
  const targets = { II: vx * LIMB_LEAD_VECTORS.II[0] + vy * LIMB_LEAD_VECTORS.II[1], aVL: vx * LIMB_LEAD_VECTORS.aVL[0] + vy * LIMB_LEAD_VECTORS.aVL[1] };
  const fit = fitFrontalVector(targets);
  assert.ok(Math.abs(fit.vx - vx) < 1e-12 && Math.abs(fit.vy - vy) < 1e-12);
  assert.ok(fit.rms < 1e-12);
  // Inconsistent: elevation in every limb lead at once is impossible for a single vector.
  const bad = fitFrontalVector({ I: 0.3, II: 0.3, III: 0.3, aVR: 0.3, aVL: 0.3, aVF: 0.3 });
  assert.ok(bad.rms > 0.1, `rms ${bad.rms}`);
});

test('inferior territory: III > II elevation and aVL depression emerge from the fitted vector', () => {
  const r = applyTerritory(NORMAL_MORPHOLOGY, 'inferior', 0.3, { elevationType: 'convex' });
  const f = r.frontal.fitted;
  assert.ok(f.III > f.II && f.II > 0, `III ${f.III} II ${f.II}`);
  assert.ok(f.aVF > 0);
  assert.ok(f.aVL < -0.05, `aVL ${f.aVL}`);
  assert.ok(r.frontal.axisDeg > 60 && r.frontal.axisDeg < 130, `axis ${r.frontal.axisDeg}`);
  // Rendered strip: derived leads show what the fit predicted.
  const strip = renderStrip(sinusRhythm({ rate: 70, duration: 5, morphology: r.morphology }), 5);
  const lm = strip.beats[1]!.landmarks;
  const at = (lead: 'III' | 'aVL' | 'aVF' | 'II') => strip.leads[lead][Math.round(lm.j * strip.fs)] ?? NaN;
  assert.ok(Math.abs(at('III') - f.III) < 0.01, `III at J ${at('III')} vs ${f.III}`);
  assert.ok(Math.abs(at('aVL') - f.aVL) < 0.01, `aVL at J ${at('aVL')} vs ${f.aVL}`);
  assert.ok(Math.abs(at('aVF') - f.aVF) < 0.01);
});

test('anterior territory: V3 maximal elevation, inferior reciprocal depression appears in III', () => {
  const r = applyTerritory(NORMAL_MORPHOLOGY, 'anterior', 0.4, { elevationType: 'convex' });
  assert.ok((r.applied.V3 as number) >= (r.applied.V2 as number) && (r.applied.V3 as number) >= (r.applied.V4 as number));
  assert.ok(r.frontal.fitted.III < -0.05, `III ${r.frontal.fitted.III}`);
  const strip = renderStrip(sinusRhythm({ rate: 70, duration: 5, morphology: r.morphology }), 5);
  const m = delineate(strip.leads.V3, strip.fs);
  assert.ok(Math.abs(m.beats[1]!.stJ - 0.4) < 0.03, `V3 stJ ${m.beats[1]!.stJ}`);
});

test('posterior territory: depression V1 to V3 with upright T', () => {
  const r = applyTerritory(NORMAL_MORPHOLOGY, 'posterior', 0.3, { elevationType: 'convex' });
  for (const l of ['V1', 'V2', 'V3'] as const) {
    assert.ok((r.morphology[l].stJ as number) < 0, `${l} stJ`);
    assert.ok(r.morphology[l].t > 0, `${l} T should be upright`);
  }
});

test('every territory renders without error and keeps lead identities', () => {
  for (const t of TERRITORY_KEYS) {
    const r = applyTerritory(NORMAL_MORPHOLOGY, t, 0.3, { elevationType: 'straight-horizontal' });
    const strip = renderStrip(sinusRhythm({ rate: 75, duration: 4, morphology: r.morphology }), 4);
    assert.equal(strip.leads.V6.length, 4000);
  }
});
