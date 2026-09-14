/**
 * Main viewer. Thin UI over the same core the tests run.
 *
 * State model: the controls are the state. A preset writes every control
 * once; after that, any edit marks the case Custom and nothing is reloaded.
 * The ST panel rebuilds the per-lead morphology set; the advanced table
 * edits that set until the ST panel or a preset rebuilds it again.
 */
import { renderStrip, sinusRhythm, partitionQt, type Strip, type AvBlockOptions, type EctopyOptions, type AtrialActivity, type BeatEvent, type PacingSpike } from '../core/sequencer.js';
import { svtRhythm, atrialFibrillation, atrialFlutter, pacedRhythm } from '../core/rhythms.js';
import { addNoise, NOISE_PRESETS } from '../core/noise.js';
import { renderSvg, layoutFor, type Layout } from '../render/svg.js';
import { delineate, leadIdentityResiduals } from '../measure/delineate.js';
import { NORMAL_MORPHOLOGY, INDEPENDENT_LEADS, cloneMorphology, type IndependentSet, type IndependentLead } from '../core/leads.js';
import type { LeadMorphology } from '../core/beat.js';
import { NORMAL_INTERVALS } from '../core/landmarks.js';
import { ST_TYPES, ST_TYPE_KEYS, type StType, type TPolarity } from '../core/st-morphology.js';
import { TERRITORIES, TERRITORY_KEYS, applyTerritory, type Territory, type FrontalFit } from '../core/st-territory.js';
import { $, setRoot, getRoot, val, num, readCalibration, readRhythmLead, fmtMs, syncOutputs, Calipers, downloadSvg, statTile, deltaTone } from './common.js';

type Rhythm = 'sinus' | 'svt' | 'af' | 'flutter' | 'paced';

let morphology: IndependentSet<LeadMorphology> = cloneMorphology(NORMAL_MORPHOLOGY);
let lastFrontal: FrontalFit | null = null;
let strip: Strip | null = null;
let layout: Layout | null = null;
let loadingPreset = false;
let calipers: Calipers;

/* ------------------------------ presets ------------------------------- */

interface PresetSettings {
  rhythm?: Rhythm;
  rate?: number;
  jitter?: number;
  avblock?: AvBlockOptions['type'];
  blockratio?: number;
  escape?: number;
  escapefocus?: 'junctional' | 'ventricular';
  ectopy?: number;
  irreg?: number;
  fwave?: number;
  flutterrate?: number;
  conduction?: string;
  flutteramp?: number;
  pacedp?: number;
  pdur?: number;
  pr?: number;
  qrs?: number;
  qtc?: number;
  qtmode?: 'fraction' | 'fixed';
  stfrac?: number;
  stexp?: number;
  st?: number;
  territory?: Territory | 'none';
  sttype?: StType;
  stmag?: number;
  reciptype?: StType;
  tpol?: TPolarity;
}

const BASE: Required<PresetSettings> = {
  rhythm: 'sinus', rate: 72, jitter: 3, avblock: 'none', blockratio: 4, escape: 40, escapefocus: 'junctional', ectopy: 0,
  irreg: 0.25, fwave: 0.06, flutterrate: 300, conduction: '2', flutteramp: 0.15, pacedp: 1,
  pdur: 90, pr: 160, qrs: 90, qtc: 410, qtmode: 'fraction', stfrac: 0.32, stexp: 0.5, st: 100,
  territory: 'none', sttype: 'convex', stmag: 0.3, reciptype: 'straight-horizontal', tpol: 'default',
};

const PRESETS: Record<string, PresetSettings> = {
  normal: {},
  'brady-pr': { rate: 48, jitter: 4, pdur: 100, pr: 220, avblock: 'first', qtc: 400 },
  tachy: { rate: 140, jitter: 1, pdur: 80, pr: 130, qrs: 86, qtc: 400 },
  wenckebach: { rate: 70, avblock: 'wenckebach', blockratio: 4 },
  'two-to-one': { rate: 80, avblock: 'mobitz2', blockratio: 2 },
  chb: { rate: 80, avblock: 'complete', escape: 38, escapefocus: 'junctional' },
  bigeminy: { rate: 70, ectopy: 1 },
  paced: { rhythm: 'paced', rate: 70, pacedp: 1, qrs: 160, qtc: 440 },
  svt: { rhythm: 'svt', rate: 180, qtc: 400 },
  af: { rhythm: 'af', rate: 85, irreg: 0.25, fwave: 0.08 },
  'af-rvr': { rhythm: 'af', rate: 150, irreg: 0.22, fwave: 0.05 },
  'af-svr': { rhythm: 'af', rate: 45, irreg: 0.3, fwave: 0.08 },
  'flutter-21': { rhythm: 'flutter', flutterrate: 300, conduction: '2' },
  'flutter-41': { rhythm: 'flutter', flutterrate: 300, conduction: '4' },
  'flutter-var': { rhythm: 'flutter', flutterrate: 300, conduction: 'variable' },
  'inferior-ste': { rate: 80, jitter: 2, qtc: 420, territory: 'inferior', sttype: 'convex', stmag: 0.3 },
  'anterior-ste': { rate: 92, jitter: 2, pr: 150, qrs: 92, qtc: 430, territory: 'anterior', sttype: 'tombstone', stmag: 0.5 },
  pericarditis: { rate: 96, jitter: 2, pr: 150, qrs: 88, territory: 'diffuse', sttype: 'concave', stmag: 0.15, tpol: 'upright' },
  posterior: { rate: 78, jitter: 2, qtc: 420, territory: 'posterior', sttype: 'straight-horizontal', stmag: 0.25, tpol: 'upright' },
  lqt: { rate: 60, qtc: 520, stfrac: 0.2 },
  hypocalcaemia: { rate: 66, qtc: 500, stfrac: 0.6, stexp: 0.3 },
};

const RHYTHM_NOTES: Record<Rhythm, string> = {
  sinus: 'Sinus generator: an atrial clock with an AV conduction rule per P wave. Blocked P waves are drawn. Ectopy inserts PVCs with a post-PVC AV block window (compensatory pause at ordinary rates, interpolation at slow rates).',
  svt: 'SVT: regular narrow complexes with no sinus P. The retrograde P is drawn as a terminal deflection (pseudo-r’ in V1, pseudo-S in II) with mild rate-related ST depression. AVNRT-like by appearance; no re-entrant circuit is modelled.',
  af: 'Atrial fibrillation: log-normal RR with a 300 ms refractory floor, no P waves, fibrillatory baseline largest in V1. The TP baseline is not isoelectric by design.',
  flutter: 'Atrial flutter: sawtooth at the flutter rate with fixed or variable AV conduction. Negative sawtooth in II and near-flat I, so III and aVF come out negative and aVL and aVR positive by derivation (typical counter-clockwise pattern).',
  paced: 'Ventricular pacing: a spike (annotation layer, not sampled) before each wide LBBB-like complex at a fixed rate. Underlying dissociated sinus P waves march through independently.',
};

function loadPreset(name: string): void {
  const p = { ...BASE, ...(PRESETS[name] ?? {}) };
  loadingPreset = true;
  for (const [k, v] of Object.entries(p)) {
    const el = getRoot().querySelector('#' + k) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = String(v);
  }
  loadingPreset = false;
  rebuildMorphologyFromSt();
  $<HTMLSelectElement>('preset').value = name;
}

function markCustom(): void {
  if (!loadingPreset) $<HTMLSelectElement>('preset').value = 'custom';
}

/* ------------------------------ ST panel ------------------------------- */

function rebuildMorphologyFromSt(): void {
  const territory = val('territory') as Territory | 'none';
  const type = val('sttype') as StType;
  const mag = num('stmag');
  $<HTMLParagraphElement>('sttype-desc').textContent = type === 'none' ? '' : ST_TYPES[type].description;
  if (territory === 'none' || type === 'none' || mag === 0) {
    morphology = cloneMorphology(NORMAL_MORPHOLOGY);
    lastFrontal = null;
    return;
  }
  const r = applyTerritory(NORMAL_MORPHOLOGY, territory, mag, {
    elevationType: type,
    depressionType: val('reciptype') as StType,
    tPolarity: val('tpol') as TPolarity,
  });
  morphology = r.morphology;
  lastFrontal = r.frontal;
}

function buildStSelects(): void {
  $<HTMLSelectElement>('territory').innerHTML =
    '<option value="none">None</option>' + TERRITORY_KEYS.map((k) => `<option value="${k}">${TERRITORIES[k].label}</option>`).join('');
  $<HTMLSelectElement>('sttype').innerHTML = ST_TYPE_KEYS.map((k) => `<option value="${k}">${k === 'none' ? 'None' : ST_TYPES[k].label}</option>`).join('');
  $<HTMLSelectElement>('sttype').value = 'convex';
}

function renderFrontal(): void {
  const el = $<HTMLDivElement>('frontal');
  if (!lastFrontal) {
    el.textContent = '';
    return;
  }
  const f = lastFrontal;
  const leads = (['I', 'II', 'III', 'aVR', 'aVL', 'aVF'] as const).map((l) => `${l} ${f.fitted[l] >= 0 ? '+' : ''}${f.fitted[l].toFixed(2)}`).join('  ');
  el.innerHTML =
    `Frontal ST vector <b>${f.magnitude.toFixed(2)} mV at ${f.axisDeg.toFixed(0)}&deg;</b> (least-squares fit, rms residual ${f.rms.toFixed(3)} mV).<br>Limb leads at J: ${leads}.<br>III, aVR, aVL and aVF follow from I and II; their change is geometry, not authored.`;
}

/* ------------------------------ morphology table ------------------------------- */

type MorphKey = 'p' | 'q' | 'r' | 's' | 't' | 'stJ' | 'stT' | 'stShape';
const MORPH_COLS: Array<{ key: MorphKey; label: string; step: number }> = [
  { key: 'p', label: 'P', step: 0.01 }, { key: 'q', label: 'Q', step: 0.01 }, { key: 'r', label: 'R', step: 0.05 }, { key: 's', label: 'S', step: 0.05 },
  { key: 't', label: 'T', step: 0.05 }, { key: 'stJ', label: 'ST@J', step: 0.05 }, { key: 'stT', label: 'ST@T', step: 0.05 }, { key: 'stShape', label: 'ST shape', step: 0.1 },
];

function buildMorphTable(): void {
  const table = $<HTMLTableElement>('morph');
  table.innerHTML =
    '<tr><th></th>' + MORPH_COLS.map((c) => `<th>${c.label}</th>`).join('') + '</tr>' +
    INDEPENDENT_LEADS.map((lead) => `<tr><th>${lead}</th>` + MORPH_COLS.map((c) => `<td><input type="number" step="${c.step}" data-lead="${lead}" data-key="${c.key}"></td>`).join('') + '</tr>').join('');
  table.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const v = Number(el.value);
    if (!Number.isFinite(v)) return;
    const lead = el.dataset['lead'] as IndependentLead;
    morphology[lead] = { ...morphology[lead], [el.dataset['key'] as MorphKey]: v };
    markCustom();
    update();
  });
}

function syncMorphTable(): void {
  getRoot().querySelectorAll<HTMLInputElement>('#morph input').forEach((el) => {
    const m = morphology[el.dataset['lead'] as IndependentLead];
    const key = el.dataset['key'] as MorphKey;
    const v = key === 'stShape' ? m.stShape ?? 1 : key === 'stT' ? m.stT ?? m.stJ ?? 0 : (m[key] as number | undefined) ?? 0;
    el.value = String(Math.round(v * 1000) / 1000);
  });
}

/* ------------------------------ generate ------------------------------- */

function showRowsForRhythm(rhythm: Rhythm): void {
  const av = val('avblock');
  getRoot().querySelectorAll<HTMLElement>('.row').forEach((row) => {
    const c = row.classList;
    let show = true;
    if (c.contains('rh-sinus')) show = rhythm === 'sinus';
    if (c.contains('rh-af')) show = rhythm === 'af';
    if (c.contains('rh-flutter')) show = rhythm === 'flutter';
    if (c.contains('rh-paced')) show = rhythm === 'paced';
    if (c.contains('rh-block-ratio')) show = show && (av === 'wenckebach' || av === 'mobitz2');
    if (c.contains('rh-escape')) show = show && av === 'complete';
    row.classList.toggle('hidden', !show);
  });
  $<HTMLLabelElement>('rate-label').textContent =
    rhythm === 'sinus' ? (av === 'complete' ? 'Atrial rate (bpm)' : 'Sinus rate (bpm)')
    : rhythm === 'af' ? 'Mean ventricular rate (bpm)'
    : rhythm === 'flutter' ? 'Rate (from flutter rate and ratio)'
    : rhythm === 'paced' ? 'Paced rate (bpm)' : 'Rate (bpm)';
  $<HTMLInputElement>('rate').disabled = rhythm === 'flutter';
}

function update(): void {
  const rhythm = val('rhythm') as Rhythm;
  showRowsForRhythm(rhythm);
  syncOutputs(['rate', 'jitter', 'blockratio', 'escape', 'irreg', 'fwave', 'flutterrate', 'flutteramp', 'pdur', 'pr', 'qrs', 'st', 'qtc', 'seed', 'stfrac', 'stexp', 'stmag']);

  const rate = num('rate');
  const pDuration = num('pdur') / 1000;
  const pr = Math.max(num('pr') / 1000, pDuration);
  const qrs = num('qrs') / 1000;
  const st = num('st') / 1000;
  const qtc = num('qtc') / 1000;
  const seed = num('seed');
  const qtMode = val('qtmode');
  const qtPartition = qtMode === 'fraction' ? { stFraction: num('stfrac'), rateExponent: num('stexp') } : undefined;
  $<HTMLInputElement>('st').disabled = qtMode === 'fraction';
  $<HTMLInputElement>('stfrac').disabled = qtMode !== 'fraction';
  $<HTMLInputElement>('stexp').disabled = qtMode !== 'fraction';

  const intervals = { ...NORMAL_INTERVALS, pDuration, pr, qrs, st };
  const common = { duration: 10, qtc, intervals, morphology, seed, qtPartition };
  const warnings: string[] = [];
  if (pr !== num('pr') / 1000) warnings.push(`PR raised to ${(pr * 1000).toFixed(0)} ms so the PR segment is not negative.`);

  let beats: BeatEvent[];
  let atrial: AtrialActivity | null = null;
  let spikes: PacingSpike[] = [];
  let requestedRate = rate;
  const chips: string[] = [];
  try {
    if (rhythm === 'sinus') {
      const avType = val('avblock') as AvBlockOptions['type'];
      const avBlock: AvBlockOptions = { type: avType, ratio: num('blockratio'), escapeRate: num('escape'), escapeFocus: val('escapefocus') as 'junctional' | 'ventricular' };
      const every = num('ectopy');
      const ectopy: EctopyOptions | undefined = every > 0 ? { every, couplingFraction: 0.55 } : undefined;
      beats = sinusRhythm({ ...common, rate, rrJitter: num('jitter') / 100, avBlock, ectopy });
      if (avType === 'complete') requestedRate = num('escape');
      chips.push(avType === 'complete' ? `Complete block, escape ${num('escape')}` : `Sinus ${rate}`);
      if (avType === 'wenckebach') chips.push(`Wenckebach ${num('blockratio')}:${num('blockratio') - 1}`);
      if (avType === 'mobitz2') chips.push(`${num('blockratio')}:1 block`);
      if (avType === 'first') chips.push('First-degree block');
      if (every === 1) chips.push('Bigeminy');
      else if (every === 2) chips.push('Trigeminy');
      else if (every > 2) chips.push(`PVC every ${every}`);
    } else if (rhythm === 'svt') {
      beats = svtRhythm({ ...common, rate }).beats;
      chips.push(`SVT ${rate}`);
    } else if (rhythm === 'af') {
      const r = atrialFibrillation({ ...common, ventricularRate: rate, irregularity: num('irreg'), fWaveAmplitude: num('fwave') });
      beats = r.beats;
      atrial = r.atrial;
      chips.push(`AF, mean ${rate}`);
    } else if (rhythm === 'flutter') {
      const condRaw = val('conduction');
      const conduction = condRaw === 'variable' ? 'variable' : (Number(condRaw) as 2 | 3 | 4);
      const r = atrialFlutter({ ...common, flutterRate: num('flutterrate'), conduction, amplitude: num('flutteramp') });
      beats = r.beats;
      atrial = r.atrial;
      requestedRate = conduction === 'variable' ? NaN : num('flutterrate') / conduction;
      chips.push(`Flutter ${num('flutterrate')}, ${condRaw === 'variable' ? 'variable' : condRaw + ':1'}`);
    } else {
      const r = pacedRhythm({ ...common, rate, qrs: Math.max(qrs, 0.12), dissociatedP: num('pacedp') === 1 });
      beats = r.beats;
      spikes = r.spikes;
      chips.push(`Paced ${rate}`);
    }
    strip = renderStrip(beats, 10, 1000, spikes, atrial);
    const noise = val('noise') as keyof typeof NOISE_PRESETS;
    if (noise !== 'none') {
      addNoise(strip, { ...NOISE_PRESETS[noise], seed });
      chips.push(`${noise} noise`);
    }
  } catch (err) {
    $<HTMLDivElement>('warnings').textContent = String(err);
    $<HTMLDivElement>('warnings').className = 'warn-text';
    return;
  }

  const presetName = $<HTMLSelectElement>('preset').selectedOptions[0]?.textContent ?? '';
  const opts = { calibration: readCalibration(), rhythmLead: readRhythmLead(), theme: val('theme') as 'paper' | 'mono', title: `Synthetic ECG: ${presetName}` };
  layout = layoutFor(strip, opts);
  $<HTMLDivElement>('ecg').innerHTML = renderSvg(strip, opts);
  calipers.clear();
  $<HTMLSpanElement>('case-title').textContent = presetName;
  const territory = val('territory');
  if (territory !== 'none' && num('stmag') > 0) chips.push(`${TERRITORIES[territory as Territory].label.split(' (')[0]} ${ST_TYPES[val('sttype') as Exclude<StType, 'none'>]?.label.toLowerCase() ?? ''} ${num('stmag').toFixed(2)} mV`);
  $<HTMLSpanElement>('case-chips').innerHTML = chips.map((c, i) => `<span class="chip${i === 0 ? ' accent' : ''}">${c}</span>`).join('');

  // Partition info at the requested rate.
  {
    const rr0 = 60 / (Number.isFinite(requestedRate) ? requestedRate : rate);
    const qt0 = qtc * Math.sqrt(rr0);
    const part = qtPartition ? partitionQt(qt0, qrs, rr0, qtPartition) : { st, t: qt0 - qrs - st };
    $<HTMLElement>('partition-info').textContent =
      `At RR ${(rr0 * 1000).toFixed(0)} ms: QT ${(qt0 * 1000).toFixed(0)} = QRS ${(qrs * 1000).toFixed(0)} + ST ${(part.st * 1000).toFixed(0)} + T ${(part.t * 1000).toFixed(0)} ms` + (part.t < 0.08 ? ' (T too narrow)' : '');
  }

  // Measurements on lead II.
  const m = delineate(strip.leads.II, strip.fs);
  const rrReq = 60 / (Number.isFinite(requestedRate) ? requestedRate : rate);
  const qtReq = qtc * Math.sqrt(rrReq);
  const isSinus = rhythm === 'sinus' && val('avblock') !== 'complete';

  // Stat tiles.
  const tiles: string[] = [];
  {
    const hr = m.heartRate;
    const d = hr === null || !Number.isFinite(requestedRate) ? null : hr - requestedRate;
    tiles.push(statTile('Ventricular rate', hr === null ? 'n/a' : hr.toFixed(0), 'bpm', d === null ? (Number.isFinite(requestedRate) ? null : 'variable conduction') : `${d >= 0 ? '+' : ''}${d.toFixed(1)} vs requested`, d === null ? 'muted' : deltaTone(Math.abs(d), 2, 5)));
  }
  if (isSinus) {
    const d = m.meanPr === null ? null : (m.meanPr - pr) * 1000;
    tiles.push(statTile('PR', fmtMs(m.meanPr), 'ms', d === null ? null : `${d >= 0 ? '+' : ''}${d.toFixed(0)} ms vs ${fmtMs(pr)}`, d === null ? 'muted' : deltaTone(Math.abs(d), 10, 25)));
  }
  {
    const d = m.meanQrs === null ? null : (m.meanQrs - qrs) * 1000;
    tiles.push(statTile('QRS', fmtMs(m.meanQrs), 'ms', d === null ? null : `${d >= 0 ? '+' : ''}${d.toFixed(0)} ms vs ${fmtMs(qrs)}`, d === null ? 'muted' : deltaTone(Math.abs(d), 8, 20)));
  }
  {
    const d = m.qtcBazett === null ? null : (m.qtcBazett - qtc) * 1000;
    tiles.push(statTile('QTc (Bazett)', fmtMs(m.qtcBazett), 'ms', d === null ? null : `${d >= 0 ? '+' : ''}${d.toFixed(0)} ms vs ${fmtMs(qtc)}`, d === null ? 'muted' : deltaTone(Math.abs(d), 15, 40)));
  }
  $<HTMLDivElement>('stats').innerHTML = tiles.join('');

  // Detail table.
  const delta = (a: number | null, b: number) => (a === null || !Number.isFinite(b) ? '' : ((a - b) * 1000).toFixed(0));
  const rows: Array<[string, string, string, string]> = [];
  if (m.rr.length > 2) {
    const mean = m.rr.reduce((a, c) => a + c, 0) / m.rr.length;
    const sd = Math.sqrt(m.rr.reduce((a, c) => a + (c - mean) ** 2, 0) / m.rr.length);
    rows.push(['RR variability (sd/mean)', (sd / mean).toFixed(2), rhythm === 'af' ? num('irreg').toFixed(2) : rhythm === 'sinus' ? (num('jitter') / 100).toFixed(2) : '0.00', '']);
  }
  rows.push(['QT (ms)', fmtMs(m.meanQt), fmtMs(qtReq), delta(m.meanQt, qtReq)]);
  const b0 = m.beats[1] ?? m.beats[0];
  if (b0) {
    rows.push(['R amplitude, II (mV)', b0.rAmplitude.toFixed(2), morphology.II.r.toFixed(2), (b0.rAmplitude - morphology.II.r).toFixed(3)]);
    rows.push(['ST at J, II (mV)', b0.stJ.toFixed(2), (morphology.II.stJ ?? 0).toFixed(2), (b0.stJ - (morphology.II.stJ ?? 0)).toFixed(3)]);
    rows.push(['ST at J+60, II (mV)', b0.st60.toFixed(2), '', '']);
    if (b0.tAmplitude !== null) rows.push(['T amplitude, II (mV)', b0.tAmplitude.toFixed(2), morphology.II.t.toFixed(2), (b0.tAmplitude - morphology.II.t).toFixed(3)]);
  }
  const s = strip;
  const qrsBeats = s.beats.filter((b) => b.label !== 'blocked-p' && b.landmarks.end <= s.duration).length;
  rows.push(['QRS complexes detected / generated', String(m.beats.length), String(qrsBeats), '']);
  const blocked = s.beats.filter((b) => b.label === 'blocked-p').length;
  if (blocked) rows.push(['Non-conducted P waves (generated)', '', String(blocked), '']);
  const pvcs = s.beats.filter((b) => b.label === 'pvc').length;
  if (pvcs) rows.push(['PVCs (generated)', '', String(pvcs), '']);
  $<HTMLTableElement>('meas').innerHTML =
    '<tr><th>Quantity</th><th>Measured</th><th>Requested</th><th>Delta</th></tr>' +
    rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="dim">${r[2]}</td><td class="dim">${r[3]}</td></tr>`).join('');

  const all = [...warnings, ...strip.warnings];
  const w = $<HTMLDivElement>('warnings');
  if (all.length === 0) {
    w.textContent = 'No warnings.';
    w.className = 'ok-text';
  } else {
    const overlaps = strip.warnings.length;
    w.textContent = [...warnings, overlaps ? `${overlaps} beat${overlaps > 1 ? 's' : ''} overlap the preceding T or U wave (expected at fast rates, and whenever independent P waves march through).` : ''].filter(Boolean).join('\n');
    w.className = 'warn-text';
  }
  const res = leadIdentityResiduals(strip.leads);
  $<HTMLElement>('identities').textContent = `Einthoven residual ${res.einthoven.toExponential(1)} mV, Goldberger residual ${res.goldbergerSum.toExponential(1)} mV`;
  $<HTMLElement>('rhythm-note').textContent = RHYTHM_NOTES[rhythm];
  syncMorphTable();
  renderFrontal();
}

/* ------------------------------ wiring ------------------------------- */

function init(): void {
  setRoot(document.querySelector('[data-view="generator"]') ?? document);
  buildStSelects();
  buildMorphTable();
  calipers = new Calipers($('ecg'), () => layout, $('caliper'), readCalibration);
  const sliders = ['rate', 'jitter', 'blockratio', 'escape', 'irreg', 'fwave', 'flutterrate', 'flutteramp', 'pdur', 'pr', 'qrs', 'st', 'qtc', 'seed', 'stfrac', 'stexp'];
  for (const id of sliders) $<HTMLInputElement>(id).addEventListener('input', () => { markCustom(); update(); });
  for (const id of ['rhythm', 'avblock', 'escapefocus', 'ectopy', 'conduction', 'pacedp', 'qtmode']) $<HTMLSelectElement>(id).addEventListener('change', () => { markCustom(); update(); });
  for (const id of ['territory', 'sttype', 'reciptype', 'tpol']) $<HTMLSelectElement>(id).addEventListener('change', () => { markCustom(); rebuildMorphologyFromSt(); update(); });
  $<HTMLInputElement>('stmag').addEventListener('input', () => { markCustom(); rebuildMorphologyFromSt(); update(); });
  for (const id of ['speed', 'gain', 'rhythmlead', 'theme', 'noise']) $<HTMLSelectElement>(id).addEventListener('change', update);
  $<HTMLSelectElement>('preset').addEventListener('change', (e) => {
    const name = (e.target as HTMLSelectElement).value;
    if (name === 'custom') return;
    loadPreset(name);
    update();
  });
  $<HTMLButtonElement>('morph-reset').addEventListener('click', () => { rebuildMorphologyFromSt(); update(); });
  $<HTMLButtonElement>('download').addEventListener('click', () => downloadSvg($('ecg'), `ecg-${$<HTMLSelectElement>('preset').value}.svg`));
  $<HTMLButtonElement>('print').addEventListener('click', () => window.print());
  $<HTMLButtonElement>('clear-cal').addEventListener('click', () => calipers.clear());
  loadPreset('normal');
  update();
}

init();
