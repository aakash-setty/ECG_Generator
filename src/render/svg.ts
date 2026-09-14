/**
 * L7: millimetre-exact SVG renderer.
 *
 * The SVG viewBox is in millimetres and the element's width/height are given
 * in mm, so one user unit is exactly one millimetre on screen and on paper.
 * The renderer is a pure affine transform of (seconds, millivolts):
 *
 *   x_mm = cell.x + t * paperSpeed
 *   y_mm = cell.baseline - v * gain
 *
 * It never interpolates. Traces are polylines through densely sampled points,
 * decimated with a min/max scheme that preserves every peak.
 */

import { type Calibration, STANDARD_CALIBRATION, secondsToMm, millivoltsToMm, mmToSeconds, mmToMillivolts } from '../core/units.js';
import type { LeadName } from '../core/leads.js';
import type { Strip } from '../core/sequencer.js';

export interface RenderOptions {
  calibration?: Calibration;
  /** Lead shown as the full-width rhythm strip. Default II. */
  rhythmLead?: LeadName | null;
  /** Seconds per column in the 3x4 block. Default 2.5. */
  columnSeconds?: number;
  /** Assumed display density, used only to choose the decimation bin. Default 8 px/mm. */
  pxPerMm?: number;
  showGrid?: boolean;
  showLabels?: boolean;
  showSpikes?: boolean;
  showCalibrationPulse?: boolean;
  title?: string;
  theme?: 'paper' | 'mono';
}

export interface Cell {
  lead: LeadName;
  /** Left edge of the trace area, mm. */
  x: number;
  /** Baseline y, mm. */
  baseline: number;
  /** Width of the trace area, mm. */
  width: number;
  /** Row extent for hit testing, mm. */
  top: number;
  bottom: number;
  /** Strip time shown at x, s. */
  t0: number;
  /** Strip time at x + width, s. */
  t1: number;
  rhythm: boolean;
}

export interface Layout {
  widthMm: number;
  heightMm: number;
  cells: Cell[];
  calibration: Calibration;
  /** Left margin reserved for labels and the calibration pulse, mm. */
  marginLeft: number;
}

const LEAD_GRID: LeadName[][] = [
  ['I', 'aVR', 'V1', 'V4'],
  ['II', 'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];

export const ROW_HEIGHT_MM = 30;
export const BASELINE_OFFSET_MM = 18; // baseline sits 18 mm below the row top
export const MARGIN_LEFT_MM = 14; // room for the calibration pulse
export const MARGIN_RIGHT_MM = 6;
export const MARGIN_TOP_MM = 10;
export const MARGIN_BOTTOM_MM = 6;

export function layoutFor(strip: Strip, opts: RenderOptions = {}): Layout {
  const cal = opts.calibration ?? STANDARD_CALIBRATION;
  const colSec = opts.columnSeconds ?? 2.5;
  const rhythmLead = opts.rhythmLead === undefined ? 'II' : opts.rhythmLead;
  const colW = secondsToMm(colSec, cal);
  const totalSec = Math.min(colSec * 4, strip.duration);
  const cells: Cell[] = [];
  const rows = LEAD_GRID.length + (rhythmLead ? 1 : 0);

  LEAD_GRID.forEach((row, r) => {
    const top = MARGIN_TOP_MM + r * ROW_HEIGHT_MM;
    row.forEach((lead, c) => {
      cells.push({
        lead,
        x: MARGIN_LEFT_MM + c * colW,
        baseline: top + BASELINE_OFFSET_MM,
        width: colW,
        top,
        bottom: top + ROW_HEIGHT_MM,
        t0: c * colSec,
        t1: (c + 1) * colSec,
        rhythm: false,
      });
    });
  });

  if (rhythmLead) {
    const top = MARGIN_TOP_MM + LEAD_GRID.length * ROW_HEIGHT_MM;
    cells.push({
      lead: rhythmLead,
      x: MARGIN_LEFT_MM,
      baseline: top + BASELINE_OFFSET_MM,
      width: secondsToMm(totalSec, cal),
      top,
      bottom: top + ROW_HEIGHT_MM,
      t0: 0,
      t1: totalSec,
      rhythm: true,
    });
  }

  return {
    widthMm: MARGIN_LEFT_MM + colW * 4 + MARGIN_RIGHT_MM,
    heightMm: MARGIN_TOP_MM + rows * ROW_HEIGHT_MM + MARGIN_BOTTOM_MM,
    cells,
    calibration: cal,
    marginLeft: MARGIN_LEFT_MM,
  };
}

/** Inverse transform for calipers: SVG user coordinates (mm) to strip time and voltage. */
export function locate(layout: Layout, xMm: number, yMm: number): { cell: Cell; t: number; v: number } | null {
  for (const cell of layout.cells) {
    if (xMm >= cell.x && xMm <= cell.x + cell.width && yMm >= cell.top && yMm <= cell.bottom) {
      return {
        cell,
        t: cell.t0 + mmToSeconds(xMm - cell.x, layout.calibration),
        v: mmToMillivolts(cell.baseline - yMm, layout.calibration),
      };
    }
  }
  return null;
}

/**
 * Min/max decimation: for each bin of `bin` samples emit the minimum and the
 * maximum in time order. Peaks survive, unlike stride decimation.
 * Returns [t, v] pairs in strip seconds and mV.
 */
export function decimateMinMax(v: Float64Array, fs: number, i0: number, i1: number, bin: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (bin <= 1) {
    for (let i = i0; i < i1; i++) out.push([i / fs, v[i] ?? 0]);
    return out;
  }
  for (let start = i0; start < i1; start += bin) {
    const end = Math.min(i1, start + bin);
    let minI = start;
    let maxI = start;
    for (let i = start; i < end; i++) {
      const x = v[i] ?? 0;
      if (x < (v[minI] ?? 0)) minI = i;
      if (x > (v[maxI] ?? 0)) maxI = i;
    }
    if (minI === maxI) out.push([minI / fs, v[minI] ?? 0]);
    else if (minI < maxI) out.push([minI / fs, v[minI] ?? 0], [maxI / fs, v[maxI] ?? 0]);
    else out.push([maxI / fs, v[maxI] ?? 0], [minI / fs, v[minI] ?? 0]);
  }
  return out;
}

const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();

export function tracePath(strip: Strip, cell: Cell, cal: Calibration, pxPerMm: number): string {
  const v = strip.leads[cell.lead];
  const i0 = Math.max(0, Math.ceil(cell.t0 * strip.fs));
  const i1 = Math.min(v.length, Math.floor(cell.t1 * strip.fs) + 1);
  const bin = Math.max(1, Math.round(strip.fs / (cal.paperSpeed * pxPerMm * 2)));
  const pts = decimateMinMax(v, strip.fs, i0, i1, bin);
  let d = '';
  for (let k = 0; k < pts.length; k++) {
    const [t, val] = pts[k]!;
    const x = cell.x + secondsToMm(t - cell.t0, cal);
    const y = cell.baseline - millivoltsToMm(val, cal);
    d += (k === 0 ? 'M' : 'L') + fmt(x) + ' ' + fmt(y);
  }
  return d;
}

/** The 1 mV, 200 ms calibration pulse drawn to the left of a row. */
export function calibrationPulsePath(x: number, baseline: number, cal: Calibration): string {
  const w = secondsToMm(0.2, cal);
  const h = millivoltsToMm(1, cal);
  const x0 = x - w - 2;
  return `M${fmt(x0 - 1)} ${fmt(baseline)}L${fmt(x0)} ${fmt(baseline)}L${fmt(x0)} ${fmt(baseline - h)}L${fmt(x0 + w)} ${fmt(baseline - h)}L${fmt(x0 + w)} ${fmt(baseline)}L${fmt(x0 + w + 1)} ${fmt(baseline)}`;
}

export function renderSvg(strip: Strip, opts: RenderOptions = {}): string {
  const layout = layoutFor(strip, opts);
  const cal = layout.calibration;
  const theme = opts.theme ?? 'paper';
  const grid = opts.showGrid ?? true;
  const labels = opts.showLabels ?? true;
  const spikes = opts.showSpikes ?? true;
  const calPulse = opts.showCalibrationPulse ?? true;
  const pxPerMm = opts.pxPerMm ?? 8;
  const W = layout.widthMm;
  const H = layout.heightMm;

  const minor = theme === 'paper' ? '#f3c4c4' : '#e6e6e6';
  const major = theme === 'paper' ? '#e88f8f' : '#bdbdbd';
  const trace = '#111';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}" font-family="Helvetica, Arial, sans-serif">`,
  );
  parts.push(`<defs>
<pattern id="minor" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="${minor}" stroke-width="0.08"/></pattern>
<pattern id="major" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#minor)"/><path d="M5 0H0V5" fill="none" stroke="${major}" stroke-width="0.16"/></pattern>
</defs>`);
  parts.push(`<rect width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>`);
  if (grid) parts.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="url(#major)"/>`);

  if (opts.title) {
    parts.push(`<text x="${fmt(layout.marginLeft)}" y="6" font-size="3.2" fill="#222">${escapeXml(opts.title)}</text>`);
  }
  parts.push(
    `<text x="${fmt(W - MARGIN_RIGHT_MM)}" y="${fmt(H - 2)}" font-size="2.4" fill="#444" text-anchor="end">${cal.paperSpeed} mm/s   ${cal.gain} mm/mV   ${strip.fs} Hz</text>`,
  );

  // Calibration pulses, one per row.
  if (calPulse) {
    const rows = new Set<number>();
    for (const c of layout.cells) rows.add(c.baseline);
    for (const b of rows) {
      parts.push(`<path class="cal" d="${calibrationPulsePath(layout.marginLeft, b, cal)}" fill="none" stroke="${trace}" stroke-width="0.25"/>`);
    }
  }

  for (const cell of layout.cells) {
    parts.push(
      `<path class="trace" data-lead="${cell.lead}" d="${tracePath(strip, cell, cal, pxPerMm)}" fill="none" stroke="${trace}" stroke-width="0.25" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    if (labels) {
      parts.push(`<text x="${fmt(cell.x + 1.5)}" y="${fmt(cell.top + 4)}" font-size="3" font-weight="bold" fill="#222">${cell.lead}</text>`);
    }
    if (spikes) {
      for (const sp of strip.spikes) {
        if (sp.t < cell.t0 || sp.t >= cell.t1) continue;
        if (sp.leads && !sp.leads.includes(cell.lead)) continue;
        const x = cell.x + secondsToMm(sp.t - cell.t0, cal);
        parts.push(`<line class="spike" x1="${fmt(x)}" y1="${fmt(cell.baseline)}" x2="${fmt(x)}" y2="${fmt(cell.baseline - 8)}" stroke="${trace}" stroke-width="0.18"/>`);
      }
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
