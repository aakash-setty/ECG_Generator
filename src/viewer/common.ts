/**
 * Shared viewer plumbing: calipers, SVG export, calibration read-out, formatting.
 * Used by both the main page and the toxicology page.
 */
import { locate, type Layout } from '../render/svg.js';
import type { Calibration, Gain, PaperSpeed } from '../core/units.js';
import type { LeadName } from '../core/leads.js';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const val = (id: string) => $<HTMLInputElement>(id).value;
export const num = (id: string) => Number(val(id));

export function readCalibration(): Calibration {
  return { paperSpeed: num('speed') as PaperSpeed, gain: num('gain') as Gain };
}

export function readRhythmLead(): LeadName | null {
  const v = val('rhythmlead');
  return v === 'none' ? null : (v as LeadName);
}

export const fmtMs = (x: number | null) => (x === null || !Number.isFinite(x) ? 'n/a' : (x * 1000).toFixed(0));

/** Mirror every slider's value into its `<output id="{id}-out">`, if one exists. */
export function syncOutputs(ids: string[], format: Record<string, (v: string) => string> = {}): void {
  for (const id of ids) {
    const out = document.getElementById(id + '-out') as HTMLOutputElement | null;
    if (out) out.value = (format[id] ?? ((v) => v))(val(id));
  }
}

/* ------------------------------ calipers ------------------------------- */

export interface CaliperPoint { t: number; v: number; x: number; y: number; lead: string }

export class Calipers {
  points: CaliperPoint[] = [];
  constructor(
    private readonly container: HTMLElement,
    private readonly getLayout: () => Layout | null,
    private readonly out: HTMLElement,
    private readonly getCalibration: () => Calibration,
  ) {
    container.addEventListener('click', (e) => this.onClick(e));
  }

  clear(): void {
    this.points = [];
    this.draw();
  }

  private onClick(e: MouseEvent): void {
    const layout = this.getLayout();
    const svg = this.container.querySelector<SVGSVGElement>('svg');
    if (!layout || !svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const hit = locate(layout, pt.x, pt.y);
    if (!hit) return;
    if (this.points.length >= 2) this.points = [];
    this.points.push({ t: hit.t, v: hit.v, x: pt.x, y: pt.y, lead: hit.cell.lead });
    this.draw();
  }

  draw(): void {
    const svg = this.container.querySelector<SVGSVGElement>('svg');
    if (!svg) return;
    svg.querySelector('#calipers')?.remove();
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    g.id = 'calipers';
    for (const p of this.points) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', String(p.x));
      l.setAttribute('x2', String(p.x));
      l.setAttribute('y1', String(p.y - 12));
      l.setAttribute('y2', String(p.y + 12));
      l.setAttribute('stroke', '#0f6e8c');
      l.setAttribute('stroke-width', '0.18');
      g.appendChild(l);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(p.y));
      c.setAttribute('r', '0.55');
      c.setAttribute('fill', '#0f6e8c');
      g.appendChild(c);
    }
    if (this.points.length === 2) {
      const [a, b] = this.points as [CaliperPoint, CaliperPoint];
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', String(a.x));
      l.setAttribute('y1', String(a.y));
      l.setAttribute('x2', String(b.x));
      l.setAttribute('y2', String(b.y));
      l.setAttribute('stroke', '#0f6e8c');
      l.setAttribute('stroke-width', '0.2');
      l.setAttribute('stroke-dasharray', '0.6 0.4');
      g.appendChild(l);
    }
    svg.appendChild(g);

    if (this.points.length === 0) this.out.textContent = 'Calipers: click two points on the tracing.';
    else if (this.points.length === 1) {
      const p = this.points[0]!;
      this.out.textContent = `Calipers: point 1 in ${p.lead} at ${(p.t * 1000).toFixed(0)} ms, ${p.v.toFixed(3)} mV. Click a second point.`;
    } else {
      const [a, b] = this.points as [CaliperPoint, CaliperPoint];
      const dt = b.t - a.t;
      const dv = b.v - a.v;
      const cal = this.getCalibration();
      this.out.innerHTML =
        `Calipers: <b>${(dt * 1000).toFixed(0)} ms</b> (${(dt * cal.paperSpeed).toFixed(1)} mm), ` +
        `<b>${dv.toFixed(3)} mV</b> (${(dv * cal.gain).toFixed(1)} mm)` +
        (Math.abs(dt) > 0.05 ? `, ${(60 / Math.abs(dt)).toFixed(1)} bpm if RR` : '') +
        (a.lead !== b.lead ? ` &middot; different leads (${a.lead}, ${b.lead})` : '');
    }
  }
}

/* ------------------------------ export ------------------------------- */

export function downloadSvg(container: HTMLElement, filename: string): void {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelector('#calipers')?.remove();
  const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Build one stat tile's inner HTML. `delta` is measured minus requested, in display units. */
export function statTile(label: string, value: string, unit: string, delta: string | null, tone: 'ok' | 'warn' | 'bad' | 'muted' = 'muted'): string {
  const d = delta === null ? '' : `<div class="d ${tone === 'muted' ? '' : tone}">${delta}</div>`;
  return `<div class="stat"><div class="k">${label}</div><div class="v">${value}<small>${unit}</small></div>${d}</div>`;
}

export function deltaTone(absDelta: number, okBelow: number, warnBelow: number): 'ok' | 'warn' | 'bad' {
  return absDelta < okBelow ? 'ok' : absDelta < warnBelow ? 'warn' : 'bad';
}
