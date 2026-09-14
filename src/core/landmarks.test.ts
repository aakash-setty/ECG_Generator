import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landmarksFromIntervals, intervalsFromLandmarks, NORMAL_INTERVALS, qtFromBazett, qtcBazett } from './landmarks.js';

test('landmarks reproduce the requested intervals exactly', () => {
  const iv = { ...NORMAL_INTERVALS, pr: 0.172, qrs: 0.094, st: 0.11, qt: 0.412 };
  const lm = landmarksFromIntervals(iv, 1.234);
  const back = intervalsFromLandmarks(lm);
  assert.ok(Math.abs((back.pr as number) - 0.172) < 1e-12);
  assert.ok(Math.abs(back.qrs - 0.094) < 1e-12);
  assert.ok(Math.abs(back.st - 0.11) < 1e-12);
  assert.ok(Math.abs(back.qt - 0.412) < 1e-12);
  assert.ok(lm.pOn! < lm.pPeak! && lm.pPeak! < lm.pOff! && lm.pOff! <= lm.qrsOn);
  assert.ok(lm.qrsOn < lm.qPeak && lm.qPeak < lm.rPeak && lm.rPeak < lm.sPeak && lm.sPeak < lm.j);
  assert.ok(lm.j <= lm.tOn && lm.tOn < lm.tPeak && lm.tPeak < lm.tOff);
});

test('invalid intervals are rejected with a reason', () => {
  assert.throws(() => landmarksFromIntervals({ ...NORMAL_INTERVALS, qt: 0.15 }, 0), /qt/);
  assert.throws(() => landmarksFromIntervals({ ...NORMAL_INTERVALS, pr: 0.05 }, 0), /pr/);
});

test('hasP=false yields no P landmarks', () => {
  const lm = landmarksFromIntervals({ ...NORMAL_INTERVALS, hasP: false }, 0);
  assert.equal(lm.pOn, null);
  assert.equal(lm.pOff, null);
});

test('Bazett round trip', () => {
  const qt = qtFromBazett(0.42, 0.8);
  assert.ok(Math.abs(qtcBazett(qt, 0.8) - 0.42) < 1e-12);
});
