import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStShift, ST_TYPE_KEYS, ST_TYPES, type StType } from './st-morphology.js';
import { NORMAL_MORPHOLOGY, cloneMorphology } from './leads.js';
import { renderStrip, sinusRhythm } from './sequencer.js';
import { delineate } from '../measure/delineate.js';

function stripFor(type: StType, level: number, lead: 'II' | 'V3' = 'II') {
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  morph[lead] = applyStShift(morph[lead], type, level);
  return renderStrip(sinusRhythm({ rate: 70, duration: 5, morphology: morph, qtc: 0.42 }), 5);
}

function segmentSamples(strip: ReturnType<typeof renderStrip>, lead: 'II' | 'V3', k = 1): { xs: number[]; ys: number[] } {
  const lm = strip.beats[k]!.landmarks;
  const v = strip.leads[lead];
  const i0 = Math.round(lm.j * strip.fs);
  const i1 = Math.round(lm.tOn * strip.fs);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = i0; i <= i1; i++) {
    xs.push((i - i0) / (i1 - i0));
    ys.push(v[i] ?? 0);
  }
  return { xs, ys };
}

test('every type sets the J-point level exactly to the requested value', () => {
  for (const type of ST_TYPE_KEYS) {
    if (type === 'none') continue;
    const strip = stripFor(type, 0.3);
    const lm = strip.beats[1]!.landmarks;
    const v = strip.leads.II[Math.round(lm.j * strip.fs)] ?? NaN;
    assert.ok(Math.abs(v - 0.3) < 0.003, `${type}: J level ${v}`);
  }
});

test('straight types are linear between J and T onset; slopes have the right sign', () => {
  for (const [type, expectSign] of [
    ['straight-upsloping', 1],
    ['straight-horizontal', 0],
    ['straight-downsloping', -1],
  ] as Array<[StType, number]>) {
    const strip = stripFor(type, 0.3);
    const { xs, ys } = segmentSamples(strip, 'II');
    const y0 = ys[0]!;
    const y1 = ys[ys.length - 1]!;
    const slope = y1 - y0;
    if (expectSign === 0) assert.ok(Math.abs(slope) < 0.003, `${type}: slope ${slope}`);
    else assert.ok(Math.sign(slope) === expectSign, `${type}: slope ${slope}`);
    // Linearity: residual from the chord is tiny for the straight variants.
    for (let i = 0; i < xs.length; i++) {
      const chord = y0 + (y1 - y0) * xs[i]!;
      assert.ok(Math.abs(ys[i]! - chord) < 0.004, `${type}: not straight at x=${xs[i]}: ${ys[i]} vs ${chord}`);
    }
  }
});

test('convex bows above the chord, concave bows below it', () => {
  for (const [type, above] of [
    ['convex', true],
    ['concave', false],
  ] as Array<[StType, boolean]>) {
    const strip = stripFor(type, 0.3);
    const { xs, ys } = segmentSamples(strip, 'II');
    const y0 = ys[0]!;
    const y1 = ys[ys.length - 1]!;
    const mid = Math.floor(xs.length / 2);
    const chord = y0 + (y1 - y0) * xs[mid]!;
    if (above) assert.ok(ys[mid]! > chord + 0.01, `${type}: mid ${ys[mid]} not above chord ${chord}`);
    else assert.ok(ys[mid]! < chord - 0.01, `${type}: mid ${ys[mid]} not below chord ${chord}`);
  }
});

test('depression: direction words describe the slope, so upsloping depression rises toward baseline', () => {
  const up = applyStShift(NORMAL_MORPHOLOGY.V3, 'straight-upsloping', -0.2);
  const down = applyStShift(NORMAL_MORPHOLOGY.V3, 'straight-downsloping', -0.2);
  const flat = applyStShift(NORMAL_MORPHOLOGY.V3, 'straight-horizontal', -0.2);
  assert.equal(up.stJ, -0.2);
  assert.ok((up.stT as number) > -0.2 && (up.stT as number) < 0);
  assert.ok((down.stT as number) < -0.2);
  assert.equal(flat.stT, -0.2);
  // Depression keeps the T upright by default.
  assert.ok(up.t > 0 && down.t > 0 && flat.t > 0);
});

test('downsloping elevation inverts the T by default; polarity can be forced', () => {
  const d = applyStShift(NORMAL_MORPHOLOGY.II, 'straight-downsloping', 0.3);
  assert.ok(d.t < 0);
  const forced = applyStShift(NORMAL_MORPHOLOGY.II, 'straight-downsloping', 0.3, { tPolarity: 'upright' });
  assert.ok(forced.t > 0);
  const conv = applyStShift(NORMAL_MORPHOLOGY.II, 'convex', 0.3, { tPolarity: 'inverted' });
  assert.ok(conv.t < 0);
});

test('tombstone attenuates the R wave; other types leave the QRS alone', () => {
  const tomb = applyStShift(NORMAL_MORPHOLOGY.V3, 'tombstone', 0.6);
  assert.ok(tomb.r < NORMAL_MORPHOLOGY.V3.r);
  const conv = applyStShift(NORMAL_MORPHOLOGY.V3, 'convex', 0.6);
  assert.equal(conv.r, NORMAL_MORPHOLOGY.V3.r);
  assert.equal(conv.s, NORMAL_MORPHOLOGY.V3.s);
});

test("type 'none' or level 0 clears ST parameters", () => {
  const m = applyStShift(NORMAL_MORPHOLOGY.II, 'convex', 0.3);
  const cleared = applyStShift(m, 'none', 0.3);
  assert.equal(cleared.stJ, undefined);
  assert.equal(cleared.stShape, undefined);
  const zero = applyStShift(m, 'convex', 0);
  assert.equal(zero.stJ, undefined);
});

test('the delineator measures the requested J level for every type (within 30 microvolts)', () => {
  for (const type of Object.keys(ST_TYPES) as StType[]) {
    const strip = stripFor(type, 0.25);
    const m = delineate(strip.leads.II, strip.fs);
    const b = m.beats[1]!;
    assert.ok(Math.abs(b.stJ - 0.25) < 0.03, `${type}: measured stJ ${b.stJ}`);
  }
});
