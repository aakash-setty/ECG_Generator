import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svtRhythm, atrialFibrillation, atrialFlutter, sawtooth } from './rhythms.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { delineate, leadIdentityResiduals } from '../measure/delineate.js';

test('AV block: Wenckebach 4:3 lengthens PR then drops a QRS; blocked P waves are drawn', () => {
  const beats = sinusRhythm({ rate: 60, duration: 12, avBlock: { type: 'wenckebach', ratio: 4, prIncrement: 0.06 } });
  const first8 = beats.slice(0, 8);
  const labels = first8.map((b) => b.label);
  assert.deepEqual(labels, ['sinus', 'sinus', 'sinus', 'blocked-p', 'sinus', 'sinus', 'sinus', 'blocked-p']);
  const prs = first8.slice(0, 3).map((b) => b.intervals.pr);
  assert.ok(prs[0]! < prs[1]! && prs[1]! < prs[2]!, `PR should lengthen: ${prs}`);
  const strip = renderStrip(beats, 12);
  const m = delineate(strip.leads.II, strip.fs);
  // 12 s at 60/min gives 12 P waves; 3 of every 4 conduct.
  assert.ok(m.beats.length >= 8 && m.beats.length <= 10, `QRS count ${m.beats.length}`);
  // The blocked P is visible: a P-sized deflection where no QRS follows.
  const blocked = strip.beats.find((b) => b.label === 'blocked-p')!.landmarks;
  const v = strip.leads.II[Math.round((blocked.pPeak as number) * strip.fs)] ?? 0;
  assert.ok(v > 0.1, `blocked P amplitude ${v}`);
  const afterQrs = strip.leads.II[Math.round((blocked.qrsOn + 0.036) * strip.fs)] ?? 0;
  assert.ok(Math.abs(afterQrs) < 0.05, 'no QRS after the blocked P');
});

test('AV block: 2:1 conducts every other P', () => {
  const beats = sinusRhythm({ rate: 80, duration: 10, avBlock: { type: 'mobitz2', ratio: 2 } });
  const qrs = beats.filter((b) => b.label === 'sinus').length;
  const blocked = beats.filter((b) => b.label === 'blocked-p').length;
  assert.ok(Math.abs(qrs - blocked) <= 1, `${qrs} conducted vs ${blocked} blocked`);
  const strip = renderStrip(beats, 10);
  const m = delineate(strip.leads.II, strip.fs);
  assert.ok(Math.abs((m.heartRate as number) - 40) < 2, `ventricular rate ${m.heartRate}`);
});

test('complete heart block: P and QRS trains are independent, escape at the requested rate', () => {
  const beats = sinusRhythm({ rate: 75, duration: 12, avBlock: { type: 'complete', escapeRate: 38 } });
  const esc = beats.filter((b) => b.label === 'escape');
  const ps = beats.filter((b) => b.label === 'blocked-p');
  assert.ok(ps.length >= 14 && esc.length >= 7);
  const rr = esc.slice(1).map((b, i) => b.qrsOn - esc[i]!.qrsOn);
  for (const x of rr) assert.ok(Math.abs(x - 60 / 38) < 1e-9);
  const strip = renderStrip(beats, 12);
  assert.ok(strip.leads.V6.length === 12000);
});

test('SVT: regular, no sinus P, retrograde pseudo-r in V1 and pseudo-S in II, rate as requested', () => {
  const { beats } = svtRhythm({ rate: 180, duration: 8 });
  assert.ok(beats.every((b) => b.intervals.hasP === false));
  const strip = renderStrip(beats, 8);
  const m = delineate(strip.leads.V1, strip.fs);
  assert.ok(Math.abs((m.heartRate as number) - 180) < 1);
  const b = strip.beats[2]!.landmarks;
  const v1 = strip.leads.V1[Math.round(b.rPrimePeak * strip.fs)] ?? 0;
  const ii = strip.leads.II[Math.round(b.rPrimePeak * strip.fs)] ?? 0;
  assert.ok(v1 > 0.04 && ii < -0.04, `V1 ${v1} II ${ii}`);
});

test('atrial fibrillation: irregular RR with the requested mean, no P, fibrillatory baseline largest in V1', () => {
  const { beats, atrial } = atrialFibrillation({ ventricularRate: 110, duration: 60, seed: 5 });
  const rr = beats.slice(1).map((b, i) => b.qrsOn - beats[i]!.qrsOn);
  const mean = rr.reduce((a, c) => a + c, 0) / rr.length;
  const sd = Math.sqrt(rr.reduce((a, c) => a + (c - mean) ** 2, 0) / rr.length);
  assert.ok(Math.abs(60 / mean - 110) < 8, `mean rate ${60 / mean}`);
  assert.ok(sd / mean > 0.15, `irregularity ${sd / mean}`);
  assert.ok(beats.every((b) => b.intervals.hasP === false));
  let maxV1 = 0;
  let maxV6 = 0;
  for (let t = 0; t < 2; t += 0.001) {
    maxV1 = Math.max(maxV1, Math.abs(atrial.at(t, 'V1')));
    maxV6 = Math.max(maxV6, Math.abs(atrial.at(t, 'V6')));
  }
  assert.ok(maxV1 > maxV6 * 2);
  const strip = renderStrip(beats, 10, 1000, [], atrial);
  assert.equal(strip.atrial, 'fibrillation');
  const r = leadIdentityResiduals(strip.leads);
  assert.ok(r.einthoven < 1e-12);
});

test('atrial flutter 2:1 and 4:1: ventricular rate is the flutter rate divided by the ratio; sawtooth is negative in II and positive in aVL', () => {
  for (const [cond, expected] of [
    [2, 150],
    [4, 75],
  ] as Array<[2 | 4, number]>) {
    const { beats, atrial } = atrialFlutter({ flutterRate: 300, conduction: cond, duration: 10 });
    const rr = beats.slice(1).map((b, i) => b.qrsOn - beats[i]!.qrsOn);
    for (const x of rr) assert.ok(Math.abs(60 / x - expected) < 1e-6);
    const strip = renderStrip(beats, 10, 1000, [], atrial);
    assert.equal(strip.atrial, 'flutter');
    // In a TP window well away from any QRS, II carries the sawtooth (mean ~0 but wide swing), and aVL is its mirror scaled by 1/2.
    const n = Math.round(0.4 * strip.fs);
    let minII = Infinity;
    let maxII = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = strip.leads.II[i] ?? 0;
      minII = Math.min(minII, v);
      maxII = Math.max(maxII, v);
    }
    assert.ok(maxII - minII > 0.2, `sawtooth swing in II ${maxII - minII}`);
  }
  assert.ok(Math.abs(sawtooth(0) - 1) < 1e-12 && Math.abs(sawtooth(0.8) + 1) < 1e-12);
});
