import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bump, plateau, sum, accumulate } from './deflections.js';

const FS = 1000;

test('bump is exactly zero outside its window and exact at its landmarks', () => {
  const b = bump({ on: 0.1, peak: 0.13, off: 0.2, amplitude: 1.1, sharpness: 2.5 });
  assert.equal(b.at(0.0), 0);
  assert.equal(b.at(0.1), 0);
  assert.equal(b.at(0.2), 0);
  assert.equal(b.at(0.3), 0);
  assert.equal(b.at(0.13), 1.1);
  // Peak is the maximum.
  let max = -Infinity;
  for (let t = 0.1; t <= 0.2; t += 1 / FS) max = Math.max(max, b.at(t));
  assert.ok(Math.abs(max - 1.1) < 1e-9);
});

test('bump is continuous at 1 kHz (no jump larger than a plausible slope allows)', () => {
  const b = bump({ on: 0, peak: 0.02, off: 0.06, amplitude: 1.5, sharpness: 3 });
  let maxStep = 0;
  let prev = b.at(-1 / FS);
  for (let i = 0; i <= 70; i++) {
    const cur = b.at(i / FS);
    maxStep = Math.max(maxStep, Math.abs(cur - prev));
    prev = cur;
  }
  // A 1.5 mV rise over 20 ms cannot need more than ~0.25 mV per sample even at its steepest.
  assert.ok(maxStep < 0.25, `max step ${maxStep}`);
});

test('bump asymmetry follows the landmark times, not a width parameter', () => {
  const b = bump({ on: 0, peak: 0.01, off: 0.1, amplitude: 1 });
  // Rise is 10 ms, fall is 90 ms. Half-amplitude point on the fall should be far from the peak.
  const halfRise = 0.005;
  const halfFall = 0.055;
  assert.ok(Math.abs(b.at(halfRise) - 0.5) < 1e-9);
  assert.ok(Math.abs(b.at(halfFall) - 0.5) < 1e-9);
});

test('bump rejects invalid landmark order', () => {
  assert.throws(() => bump({ on: 0.1, peak: 0.1, off: 0.2, amplitude: 1 }));
  assert.throws(() => bump({ on: 0.1, peak: 0.3, off: 0.2, amplitude: 1 }));
});

test('plateau hits its levels at the landmarks and does not overshoot on the fall', () => {
  const p = plateau({ on: 0.06, riseEnd: 0.09, fallStart: 0.19, off: 0.4, levelA: 0.3, levelB: 0.2, shape: 1 });
  assert.equal(p.at(0.05), 0);
  assert.ok(Math.abs(p.at(0.09) - 0.3) < 1e-12);
  assert.ok(Math.abs(p.at(0.19) - 0.2) < 1e-12);
  assert.equal(p.at(0.4), 0);
  // Fall must stay within [0, levelB].
  for (let t = 0.19; t <= 0.4; t += 1 / FS) {
    const v = p.at(t);
    assert.ok(v >= -1e-12 && v <= 0.2 + 1e-12, `overshoot at ${t}: ${v}`);
  }
});

test('plateau fall is monotone even when the body slope is steep (Fritsch-Carlson clamp)', () => {
  // Body rises steeply from 0.0 to 0.5 over 20 ms, then must fall to 0 over 100 ms without overshooting.
  const p = plateau({ on: 0, riseEnd: 0.01, fallStart: 0.03, off: 0.13, levelA: 0.0, levelB: 0.5, shape: 1 });
  let prev = p.at(0.03);
  for (let t = 0.031; t <= 0.13; t += 1 / FS) {
    const v = p.at(t);
    assert.ok(v <= prev + 1e-12, `non-monotone at ${t}`);
    assert.ok(v >= -1e-12, `negative at ${t}`);
    prev = v;
  }
});

test('plateau shape exponent bends the body in the expected direction', () => {
  const up = plateau({ on: 0, riseEnd: 0.01, fallStart: 0.11, off: 0.2, levelA: 0, levelB: 0.2, shape: 2 });
  const convex = plateau({ on: 0, riseEnd: 0.01, fallStart: 0.11, off: 0.2, levelA: 0, levelB: 0.2, shape: 0.5 });
  const mid = 0.06;
  assert.ok(up.at(mid) < 0.1, 'shape>1 is below the chord (concave-up)');
  assert.ok(convex.at(mid) > 0.1, 'shape<1 is above the chord (convex)');
});

test('sum and accumulate agree', () => {
  const parts = [
    bump({ on: 0.0, peak: 0.05, off: 0.1, amplitude: 0.2 }),
    bump({ on: 0.08, peak: 0.1, off: 0.15, amplitude: -0.5, sharpness: 2 }),
  ];
  const s = sum(parts);
  const buf = new Float64Array(200);
  for (const p of parts) accumulate(buf, FS, 0, p);
  for (let i = 0; i < 200; i++) {
    assert.ok(Math.abs((buf[i] ?? 0) - s.at(i / FS)) < 1e-12);
  }
});
