import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToxidrome, TOXIDROMES, TOXIDROME_KEYS } from './tox.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { toxMeasures } from '../measure/tox-measures.js';
import { leadIdentityResiduals } from '../measure/delineate.js';

function stripFor(key: Parameters<typeof applyToxidrome>[0], severity: number) {
  const r = applyToxidrome(key, severity);
  return renderStrip(sinusRhythm({ ...r.sinus, duration: 12, seed: 3 }), 12);
}

test('every toxidrome renders at every severity and keeps lead identities', () => {
  for (const key of TOXIDROME_KEYS) {
    for (const s of [0, 0.5, 1]) {
      const strip = stripFor(key, s);
      const r = leadIdentityResiduals(strip.leads);
      assert.ok(r.einthoven < 1e-12 && r.goldbergerSum < 1e-12, `${key} @${s}`);
    }
  }
});

test('sodium channel blocker at full severity crosses the LITFL thresholds; at zero it does not', () => {
  const hi = toxMeasures(stripFor('sodium-channel-blocker', 1));
  assert.ok((hi.hr as number) > 100, `HR ${hi.hr}`);
  assert.ok((hi.qrs as number) > 0.16, `QRS ${hi.qrs}`);
  assert.ok((hi.avrRPrime as number) > 0.3, `aVR R' ${hi.avrRPrime}`);
  assert.ok((hi.avrRS as number) > 0.7, `aVR R/S ${hi.avrRS}`);
  assert.ok((hi.qtc as number) > 0.44, `QTc ${hi.qtc}`);
  const lo = toxMeasures(stripFor('sodium-channel-blocker', 0));
  assert.ok((lo.qrs as number) < 0.1, `QRS ${lo.qrs}`);
  assert.ok((lo.avrRS as number) < 0.7, `aVR R/S ${lo.avrRS}`);
});

test('sodium channel blocker: features scale monotonically with severity', () => {
  let prevQrs = 0;
  let prevRp = -1;
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    const m = toxMeasures(stripFor('sodium-channel-blocker', s));
    assert.ok((m.qrs as number) >= prevQrs - 0.002, `QRS not monotone at ${s}`);
    assert.ok((m.avrRPrime as number) >= prevRp - 0.002, `aVR R' not monotone at ${s}`);
    prevQrs = m.qrs as number;
    prevRp = m.avrRPrime as number;
  }
});

test('digoxin: effect at low severity (scoop, short QT trend, U), toxicity at high severity (brady, PR > 200, PVCs)', () => {
  const lo = toxMeasures(stripFor('digoxin', 0.1));
  assert.ok((lo.stScoop as number) > 0.08, `scoop ${lo.stScoop}`);
  assert.equal(lo.pvcCount, 0);
  assert.ok((lo.hr as number) > 60);
  const hi = toxMeasures(stripFor('digoxin', 1));
  assert.ok((hi.sinusHr as number) < 60, `sinus HR ${hi.sinusHr}`);
  assert.ok((hi.pr as number) > 0.2, `PR ${hi.pr}`);
  assert.ok((hi.qtc as number) < 0.36, `QTc ${hi.qtc}`);
  assert.ok((hi.uAmp as number) >= 0.05, `U ${hi.uAmp}`);
  assert.ok(hi.pvcCount >= 3, `PVCs ${hi.pvcCount}`);
  assert.ok(hi.sinusBeatsMeasured >= 3);
});

test('potassium channel blocker: QTc crosses 440 then 500 as severity rises; bradycardia at full severity', () => {
  const lo = toxMeasures(stripFor('potassium-channel-blocker', 0));
  const mid = toxMeasures(stripFor('potassium-channel-blocker', 0.4));
  const hi = toxMeasures(stripFor('potassium-channel-blocker', 1));
  assert.ok((lo.qtc as number) < 0.44, `lo QTc ${lo.qtc}`);
  assert.ok((mid.qtc as number) > 0.44, `mid QTc ${mid.qtc}`);
  assert.ok((hi.qtc as number) > 0.5, `hi QTc ${hi.qtc}`);
  assert.ok((hi.hr as number) < 60);
  assert.ok((hi.uAmp as number) >= 0.05, `U ${hi.uAmp}`);
});

test('every toxidrome documents sources and non-modelled features', () => {
  for (const key of TOXIDROME_KEYS) {
    const spec = TOXIDROMES[key];
    assert.ok(spec.sources.length >= 1);
    assert.ok(spec.notModelled.length >= 1);
    assert.ok(spec.checklist.length >= 3);
  }
});

test('hyperkalaemia: peaked T first, then P loss, PR and QRS widening, bradycardia', () => {
  const lo = toxMeasures(stripFor('hyperkalaemia', 0.25));
  assert.ok((lo.tAmpV3 as number) > 0.8, `T V3 ${lo.tAmpV3}`);
  assert.ok((lo.qrs as number) < 0.11, `QRS ${lo.qrs}`);
  assert.ok((lo.pAmpII as number) > 0.1, `P ${lo.pAmpII}`);
  const mid = toxMeasures(stripFor('hyperkalaemia', 0.6));
  assert.ok((mid.hr as number) < 70, `peaked T waves must not be counted as QRS: rate ${mid.hr}`);
  assert.ok((mid.tAmpV3 as number) > 1.5, `T V3 ${mid.tAmpV3}`);
  const hi = toxMeasures(stripFor('hyperkalaemia', 0.9));
  // Soft, fused edges at this stage make the measured QRS an underestimate; the checklist threshold is what matters.
  assert.ok((hi.qrs as number) > 0.12, `QRS ${hi.qrs}`);
  assert.ok((hi.pAmpII as number) < 0.05, `P ${hi.pAmpII}`);
  assert.ok((hi.sinusHr as number) < 60, `HR ${hi.sinusHr}`);
});

test('beta-blocker/CCB: PR prolongs early, then Wenckebach, 2:1, complete block with escape', () => {
  const early = toxMeasures(stripFor('beta-blocker-ccb', 0.2));
  assert.ok((early.pr as number) > 0.2, `PR ${early.pr}`);
  assert.equal(early.blockedPCount, 0);
  const wen = toxMeasures(stripFor('beta-blocker-ccb', 0.5));
  assert.ok(wen.blockedPCount > 0);
  const chb = toxMeasures(stripFor('beta-blocker-ccb', 0.9));
  assert.ok(chb.escapeCount > 0 && chb.blockedPCount > 0);
  const prop = toxMeasures(renderStrip(sinusRhythm({ ...applyToxidrome('beta-blocker-ccb', 0.3, 'propranolol').sinus, duration: 12, seed: 3 }), 12));
  assert.ok((prop.qrs as number) > 0.1, `propranolol QRS ${prop.qrs}`);
  const sot = toxMeasures(renderStrip(sinusRhythm({ ...applyToxidrome('beta-blocker-ccb', 0.3, 'sotalol').sinus, duration: 12, seed: 3 }), 12));
  assert.ok((sot.qtc as number) > 0.44, `sotalol QTc ${sot.qtc}`);
});

test('hypocalcaemia: QTc rises through ST prolongation while T peak-to-end stays short', () => {
  const lo = toxMeasures(stripFor('hypocalcaemia', 0));
  const hi = toxMeasures(stripFor('hypocalcaemia', 1));
  assert.ok((hi.qtc as number) > 0.5, `QTc ${hi.qtc}`);
  assert.ok((hi.jtp as number) > (lo.jtp as number) + 0.1, `JTp ${lo.jtp} -> ${hi.jtp}`);
  assert.ok(Math.abs((hi.tpe as number) - (lo.tpe as number)) < 0.03, `Tpe ${lo.tpe} -> ${hi.tpe}`);
  assert.ok((hi.tpe as number) < 0.11);
});
