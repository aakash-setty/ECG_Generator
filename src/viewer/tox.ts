/**
 * Toxicology viewer. Same core, same renderer, same delineator.
 */
import { renderStrip, sinusRhythm, type Strip } from '../core/sequencer.js';
import { addNoise, NOISE_PRESETS } from '../core/noise.js';
import { renderSvg, layoutFor, type Layout } from '../render/svg.js';
import { TOXIDROMES, TOXIDROME_KEYS, applyToxidrome, type Toxidrome } from '../core/tox.js';
import { toxMeasures, type ToxMeasures } from '../measure/tox-measures.js';
import { $, setRoot, val, num, readCalibration, readRhythmLead, syncOutputs, Calipers, downloadSvg } from './common.js';

let strip: Strip | null = null;
let layout: Layout | null = null;
let calipers: Calipers;

function fmt(measure: keyof ToxMeasures, v: number | null): string {
  if (v === null) return 'n/a';
  switch (measure) {
    case 'hr':
    case 'sinusHr':
      return `${v.toFixed(0)} bpm`;
    case 'pr':
    case 'qrs':
    case 'qt':
    case 'qtc':
    case 'qtcFridericia':
    case 'jtp':
    case 'tpe':
      return `${(v * 1000).toFixed(0)} ms`;
    case 'avrRPrime':
    case 'tAmpV3':
    case 'pAmpII':
      return `${v.toFixed(2)} mV (${(v * 10).toFixed(1)} mm)`;
    case 'avrRS':
      return v.toFixed(2);
    case 'stScoop':
    case 'uAmp':
      return `${v.toFixed(2)} mV`;
    case 'pvcCount':
    case 'sinusBeatsMeasured':
    case 'blockedPCount':
    case 'escapeCount':
      return String(v);
  }
}

function update(): void {
  const key = val('tox') as Toxidrome;
  const sev = num('sev');
  const seed = num('seed');
  syncOutputs(['sev', 'seed'], { sev: (v) => Number(v).toFixed(2) });
  const spec = TOXIDROMES[key];
  const variantRow = $<HTMLDivElement>('variant-row');
  const variantSel = $<HTMLSelectElement>('variant');
  if (spec.variants) {
    variantRow.classList.remove('hidden');
    if (variantSel.dataset['for'] !== key) {
      variantSel.innerHTML = spec.variants.map((v) => `<option value="${v.key}">${v.label}</option>`).join('');
      variantSel.dataset['for'] = key;
    }
  } else variantRow.classList.add('hidden');
  const r = applyToxidrome(key, sev, spec.variants ? variantSel.value : undefined);
  strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 10, seed }), 10);
  const noise = val('noise') as keyof typeof NOISE_PRESETS;
  if (noise !== 'none') addNoise(strip, { ...NOISE_PRESETS[noise], seed });

  const opts = { calibration: readCalibration(), rhythmLead: readRhythmLead(), theme: val('theme') as 'paper' | 'mono', title: `${spec.label}, severity ${sev.toFixed(2)} (synthetic)` };
  layout = layoutFor(strip, opts);
  $<HTMLDivElement>('ecg').innerHTML = renderSvg(strip, opts);
  calipers.clear();

  $<HTMLElement>('case-title').textContent = spec.label;
  const chips = [`severity ${sev.toFixed(2)}`];
  if (r.stage) chips.push(r.stage);
  if (spec.variants) chips.push(variantSel.selectedOptions[0]?.textContent ?? '');
  if (noise !== 'none') chips.push(`${noise} noise`);
  $<HTMLElement>('case-chips').innerHTML = chips.map((c, i) => `<span class="chip${i === 0 ? ' accent' : ''}">${c}</span>`).join('');

  $<HTMLElement>('settings').innerHTML = Object.entries(r.settings).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $<HTMLElement>('examples').textContent = spec.examples;
  $<HTMLElement>('mechanism').textContent = spec.mechanism;
  $<HTMLElement>('features').innerHTML = spec.features.map((f) => `<li>${f}</li>`).join('');
  $<HTMLElement>('notmodelled').innerHTML = spec.notModelled.map((f) => `<li>${f}</li>`).join('');
  $<HTMLElement>('sources').innerHTML = spec.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`).join('');

  const m = toxMeasures(strip);
  const present = spec.checklist.filter((c) => {
    const v = m[c.measure] as number | null;
    return v !== null && (c.direction === 'above' ? v > c.threshold : v < c.threshold);
  }).length;
  $<HTMLElement>('check-count').textContent = `${present} of ${spec.checklist.length} present`;

  const rows = spec.checklist.map((c) => {
    const v = m[c.measure] as number | null;
    const hit = v !== null && (c.direction === 'above' ? v > c.threshold : v < c.threshold);
    return `<tr><td class="left">${c.label}<div class="small">${c.meaning}</div></td><td>${fmt(c.measure, v)}</td><td><span class="status ${hit ? 'present' : 'absent'}">${hit ? 'present' : 'absent'}</span></td></tr>`;
  });
  $<HTMLTableElement>('check').innerHTML = '<tr><th>Feature</th><th>Measured</th><th>Status</th></tr>' + rows.join('');

  const all: Array<[string, string]> = [
    ['Ventricular rate (all QRS)', fmt('hr', m.hr)],
    ['Conducted-beat rate (sinus-to-sinus)', fmt('sinusHr', m.sinusHr)],
    ['PR', fmt('pr', m.pr)],
    ['QRS', fmt('qrs', m.qrs)],
    ['QT', fmt('qt', m.qt)],
    ['QTc Bazett / Fridericia', `${fmt('qtc', m.qtc)} / ${fmt('qtcFridericia', m.qtcFridericia)}`],
    ["aVR largest positive in QRS (R')", fmt('avrRPrime', m.avrRPrime)],
    ['aVR R/S', fmt('avrRS', m.avrRS)],
    ['V5 ST nadir depth', fmt('stScoop', m.stScoop)],
    ['V5 post-T deflection (U)', fmt('uAmp', m.uAmp)],
    ['V3 T amplitude', fmt('tAmpV3', m.tAmpV3)],
    ['II P amplitude', fmt('pAmpII', m.pAmpII)],
    ['II J to T peak / T peak to end', `${fmt('jtp', m.jtp)} / ${fmt('tpe', m.tpe)}`],
    ['PVCs in strip', String(m.pvcCount)],
    ['Non-conducted P waves', String(m.blockedPCount)],
    ['Escape beats', String(m.escapeCount)],
  ];
  $<HTMLTableElement>('allmeas').innerHTML = '<tr><th>Quantity</th><th>Value</th></tr>' + all.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $<HTMLElement>('measnote').textContent =
    `Measured on ${m.sinusBeatsMeasured} conducted beats; PVCs are excluded from interval means and rate correction uses the sinus cycle. QT measurement with flattened T waves and prominent U waves is unreliable in this delineator, as on real machines.`;
  $<HTMLElement>('warnings').textContent = strip.warnings.length ? `${strip.warnings.length} beats overlap the preceding T or U wave` : '';
}

function init(): void {
  setRoot(document.querySelector('[data-view="tox"]') ?? document);
  const sel = $<HTMLSelectElement>('tox');
  sel.innerHTML = TOXIDROME_KEYS.map((k) => `<option value="${k}">${TOXIDROMES[k].label}</option>`).join('');
  calipers = new Calipers($('ecg'), () => layout, $('caliper'), readCalibration);
  for (const id of ['tox', 'variant', 'speed', 'gain', 'rhythmlead', 'theme', 'noise']) $<HTMLSelectElement>(id).addEventListener('change', update);
  for (const id of ['sev', 'seed']) $<HTMLInputElement>(id).addEventListener('input', update);
  $<HTMLButtonElement>('download').addEventListener('click', () => downloadSvg($('ecg'), `tox-${val('tox')}.svg`));
  $<HTMLButtonElement>('print').addEventListener('click', () => window.print());
  $<HTMLButtonElement>('clear-cal').addEventListener('click', () => calipers.clear());
  update();
}

init();
