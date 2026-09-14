import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg, layoutFor, locate, decimateMinMax, calibrationPulsePath, tracePath } from './svg.js';
import { renderStrip, sinusRhythm } from '../core/sequencer.js';
import { STANDARD_CALIBRATION } from '../core/units.js';

const strip = renderStrip(sinusRhythm({ rate: 72, duration: 10 }), 10);

test('SVG width/height in mm equal the viewBox extent (1 user unit = 1 mm)', () => {
  const svg = renderSvg(strip);
  const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(m);
  assert.equal(m[1], m[3]);
  assert.equal(m[2], m[4]);
});

test('calibration pulse is exactly 10 mm tall and 5 mm wide at 25 mm/s, 10 mm/mV', () => {
  const d = calibrationPulsePath(14, 28, STANDARD_CALIBRATION);
  const ys = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2]));
  const xs = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[1]));
  assert.equal(Math.max(...ys) - Math.min(...ys), 10);
  // The raised portion spans 5 mm.
  const raised = xs.filter((_, i) => ys[i] === Math.min(...ys));
  assert.equal(Math.max(...raised) - Math.min(...raised), 5);
});

test('time maps to x at 25 mm/s and voltage to y at 10 mm/mV', () => {
  const layout = layoutFor(strip);
  const cell = layout.cells.find((c) => c.lead === 'I')!;
  const hit = locate(layout, cell.x + 25, cell.baseline - 11);
  assert.ok(hit);
  assert.equal(hit.cell.lead, 'I');
  assert.ok(Math.abs(hit.t - 1.0) < 1e-12);
  assert.ok(Math.abs(hit.v - 1.1) < 1e-12);
});

test('trace path x coordinates advance at exactly paperSpeed mm per second', () => {
  const layout = layoutFor(strip, { pxPerMm: 1000 }); // bin = 1: every sample emitted
  const cell = layout.cells.find((c) => c.lead === 'V1')!;
  const d = tracePath(strip, cell, STANDARD_CALIBRATION, 1000);
  const xs = [...d.matchAll(/[ML]([\d.-]+) /g)].map((m) => Number(m[1]));
  // Consecutive samples are 1 ms apart: 0.025 mm at 25 mm/s (path coordinates are rounded to 0.001 mm).
  for (let i = 1; i < Math.min(xs.length, 500); i++) {
    assert.ok(Math.abs(xs[i]! - xs[i - 1]! - 0.025) < 0.002, `step ${xs[i]! - xs[i - 1]!}`);
  }
});

test('min/max decimation preserves the R peak', () => {
  const v = strip.leads.II;
  const pts = decimateMinMax(v, strip.fs, 0, v.length, 7);
  const maxDec = Math.max(...pts.map((p) => p[1]));
  let maxRaw = -Infinity;
  for (let i = 0; i < v.length; i++) maxRaw = Math.max(maxRaw, v[i]!);
  assert.equal(maxDec, maxRaw);
});

test('renders 12 lead cells plus a rhythm strip', () => {
  const svg = renderSvg(strip);
  const traces = svg.match(/class="trace"/g) ?? [];
  assert.equal(traces.length, 13);
  const leads = new Set([...svg.matchAll(/data-lead="(\w+)"/g)].map((m) => m[1]));
  assert.equal(leads.size, 12);
});

test('locate returns null outside every cell', () => {
  const layout = layoutFor(strip);
  assert.equal(locate(layout, 0.5, 0.5), null);
});
