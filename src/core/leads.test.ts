import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLimbLeads } from './leads.js';
import { leadIdentityResiduals } from '../measure/delineate.js';
import { sinusRhythm, renderStrip } from './sequencer.js';

test('derived limb leads satisfy Einthoven and Goldberger identities to floating point', () => {
  const strip = renderStrip(sinusRhythm({ rate: 75, duration: 10, rrJitter: 0.03, seed: 7 }), 10);
  const r = leadIdentityResiduals(strip.leads);
  assert.ok(r.einthoven < 1e-12, `Einthoven residual ${r.einthoven}`);
  assert.ok(r.goldbergerSum < 1e-12, `Goldberger sum residual ${r.goldbergerSum}`);
  assert.ok(r.aVR < 1e-12, `aVR residual ${r.aVR}`);
});

test('deriveLimbLeads formulae', () => {
  const I = new Float64Array([1, 2, 3]);
  const II = new Float64Array([4, 6, 8]);
  const d = deriveLimbLeads(I, II);
  assert.deepEqual(Array.from(d.III), [3, 4, 5]);
  assert.deepEqual(Array.from(d.aVR), [-2.5, -4, -5.5]);
  assert.deepEqual(Array.from(d.aVL), [-1, -1, -1]);
  assert.deepEqual(Array.from(d.aVF), [3.5, 5, 6.5]);
});
