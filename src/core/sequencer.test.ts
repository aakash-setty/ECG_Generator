import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinusRhythm, renderStrip, QT_RUNNING_MEAN_BEATS, partitionQt } from './sequencer.js';
import { qtFromBazett } from './landmarks.js';

test('sinus rhythm mean rate matches the request', () => {
  for (const rate of [45, 70, 110]) {
    const beats = sinusRhythm({ rate, duration: 60 });
    const rr = beats.slice(1).map((b, i) => b.qrsOn - beats[i]!.qrsOn);
    const mean = rr.reduce((a, c) => a + c, 0) / rr.length;
    assert.ok(Math.abs(60 / mean - rate) < 1e-9, `rate ${rate}: got ${60 / mean}`);
  }
});

test('RR jitter is reproducible from the seed and has roughly the requested spread', () => {
  const a = sinusRhythm({ rate: 70, duration: 120, rrJitter: 0.05, seed: 42 });
  const b = sinusRhythm({ rate: 70, duration: 120, rrJitter: 0.05, seed: 42 });
  assert.deepEqual(
    a.map((x) => x.qrsOn),
    b.map((x) => x.qrsOn),
  );
  const rr = a.slice(1).map((x, i) => x.qrsOn - a[i]!.qrsOn);
  const mean = rr.reduce((s, c) => s + c, 0) / rr.length;
  const sd = Math.sqrt(rr.reduce((s, c) => s + (c - mean) ** 2, 0) / rr.length);
  const frac = sd / mean;
  assert.ok(frac > 0.03 && frac < 0.07, `sd fraction ${frac}`);
});

test('QT follows Bazett from the running mean RR, not the instantaneous RR', () => {
  const beats = sinusRhythm({ rate: 60, duration: 30, rrJitter: 0.1, seed: 9, qtc: 0.42 });
  for (let k = QT_RUNNING_MEAN_BEATS + 1; k < beats.length; k++) {
    const recent = [];
    for (let j = k - QT_RUNNING_MEAN_BEATS; j < k; j++) recent.push(beats[j + 1]!.qrsOn - beats[j]!.qrsOn);
    // Note: running mean uses the RR intervals *preceding* beat k.
    const prior = [];
    for (let j = Math.max(0, k - QT_RUNNING_MEAN_BEATS); j < k; j++) prior.push(beats[j + 1]!.qrsOn - beats[j]!.qrsOn);
    const meanRr = prior.reduce((a, c) => a + c, 0) / prior.length;
    assert.ok(Math.abs(beats[k]!.intervals.qt - qtFromBazett(0.42, meanRr)) < 1e-9);
  }
});

test('renderStrip warns when the T wave overlaps the next P wave at high rate', () => {
  const strip = renderStrip(sinusRhythm({ rate: 170, duration: 5, qtc: 0.44 }), 5);
  assert.ok(strip.warnings.length > 0);
});

test('renderStrip produces 12 leads of the requested length', () => {
  const strip = renderStrip(sinusRhythm({ rate: 70, duration: 10 }), 10, 500);
  assert.equal(Object.keys(strip.leads).length, 12);
  assert.equal(strip.leads.V6.length, 5000);
});

test('QT partition: QRS + ST + T equals QT, and the ST share shrinks with rate', () => {
  const part = { stFraction: 0.32, rateExponent: 0.5 };
  const slow = partitionQt(0.44, 0.09, 1.2, part);
  const fast = partitionQt(0.28, 0.09, 0.5, part);
  assert.ok(Math.abs(0.09 + slow.st + slow.t - 0.44) < 1e-12);
  assert.ok(Math.abs(0.09 + fast.st + fast.t - 0.28) < 1e-12);
  assert.ok(slow.st / (0.44 - 0.09) > fast.st / (0.28 - 0.09), 'ST share of JT should fall with rate');
  assert.ok(slow.tPeakFraction > fast.tPeakFraction && Math.abs(fast.tPeakFraction - 0.5) < 1e-12, 'T becomes symmetric at fast rates');
  // Floor on T duration holds even with an absurd ST share.
  const extreme = partitionQt(0.3, 0.09, 1, { stFraction: 0.99, rateExponent: 0 });
  assert.ok(extreme.t >= 0.08 - 1e-12);
});

test('sinusRhythm with qtPartition changes ST with rate while QT still follows Bazett', () => {
  const slow = sinusRhythm({ rate: 50, duration: 10, qtc: 0.41, qtPartition: { stFraction: 0.32 } });
  const fast = sinusRhythm({ rate: 150, duration: 10, qtc: 0.41, qtPartition: { stFraction: 0.32 } });
  const s = slow[2]!.intervals;
  const f = fast[2]!.intervals;
  assert.ok(Math.abs(s.qt - qtFromBazett(0.41, 60 / 50)) < 1e-12);
  assert.ok(Math.abs(f.qt - qtFromBazett(0.41, 60 / 150)) < 1e-12);
  assert.ok(s.st > f.st * 2, `ST slow ${s.st} vs fast ${f.st}`);
  const tSlow = s.qt - s.qrs - s.st;
  const tFast = f.qt - f.qrs - f.st;
  assert.ok(tSlow > tFast, 'T also shortens, but by less than proportionally');
  assert.ok(tFast / tSlow > f.st / s.st, 'ST shortens by a larger factor than T');
});
