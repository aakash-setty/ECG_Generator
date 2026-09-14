/**
 * Renders sample strips to ./samples as SVG and prints lead II measurements from the delineator.
 * Usage: node dist/cli/render.js
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderSvg } from '../render/svg.js';
import { renderStrip, sinusRhythm } from '../core/sequencer.js';
import { delineate } from '../measure/delineate.js';
import { NORMAL_MORPHOLOGY, cloneMorphology } from '../core/leads.js';
import { atrialFibrillation, atrialFlutter } from '../core/rhythms.js';
import { applyToxidrome } from '../core/tox.js';

mkdirSync('samples', { recursive: true });

function report(name: string, strip: ReturnType<typeof renderStrip>): void {
  const m = delineate(strip.leads.II, strip.fs);
  const ms = (x: number | null) => (x === null ? 'n/a' : (x * 1000).toFixed(0) + ' ms');
  console.log(
    `${name}: HR ${m.heartRate?.toFixed(1)} bpm  PR ${ms(m.meanPr)}  QRS ${ms(m.meanQrs)}  QT ${ms(m.meanQt)}  QTc ${ms(m.qtcBazett)}  beats ${m.beats.length}` +
      (strip.warnings.length ? `  warnings: ${strip.warnings.length}` : ''),
  );
}

{
  const strip = renderStrip(sinusRhythm({ rate: 72, duration: 10, rrJitter: 0.03, seed: 1, qtc: 0.41 }), 10);
  writeFileSync('samples/normal-sinus-72.svg', renderSvg(strip, { title: 'Normal sinus rhythm, 72 bpm (synthetic)' }));
  report('normal-sinus-72', strip);
}

{
  const morph = cloneMorphology(NORMAL_MORPHOLOGY);
  // Inferior ST elevation with reciprocal depression in I (authored per lead; V leads unchanged).
  morph.II = { ...morph.II, stJ: 0.25, stT: 0.3, stShape: 0.6, t: 0.5 };
  morph.I = { ...morph.I, stJ: -0.1, stT: -0.1 };
  const strip = renderStrip(sinusRhythm({ rate: 80, duration: 10, rrJitter: 0.02, seed: 4, qtc: 0.42, morphology: morph }), 10);
  writeFileSync('samples/inferior-st-elevation.svg', renderSvg(strip, { title: 'Inferior ST elevation, 80 bpm (synthetic, hand-authored)' }));
  report('inferior-st-elevation', strip);
}

{
  const strip = renderStrip(sinusRhythm({ rate: 48, duration: 10, rrJitter: 0.04, seed: 9, qtc: 0.40, intervals: { pr: 0.22 } }), 10);
  writeFileSync('samples/sinus-brady-first-degree.svg', renderSvg(strip, { title: 'Sinus bradycardia 48 bpm, PR 220 ms (synthetic)' }));
  report('sinus-brady-first-degree', strip);
}

{
  const strip = renderStrip(sinusRhythm({ rate: 140, duration: 10, rrJitter: 0.0, seed: 2, qtc: 0.40 }), 10);
  writeFileSync('samples/sinus-tach-140.svg', renderSvg(strip, { title: 'Sinus tachycardia 140 bpm (synthetic)' }));
  report('sinus-tach-140', strip);
  for (const w of strip.warnings.slice(0, 2)) console.log('  warning:', w);
}

{
  const r = atrialFibrillation({ ventricularRate: 110, duration: 10, seed: 4, fWaveAmplitude: 0.08 });
  const strip = renderStrip(r.beats, 10, 1000, [], r.atrial);
  writeFileSync('samples/atrial-fibrillation-110.svg', renderSvg(strip, { title: 'Atrial fibrillation, mean 110 bpm (synthetic)' }));
  report('atrial-fibrillation-110', strip);
}

{
  const r = atrialFlutter({ conduction: 2, duration: 10 });
  const strip = renderStrip(r.beats, 10, 1000, [], r.atrial);
  writeFileSync('samples/atrial-flutter-2to1.svg', renderSvg(strip, { title: 'Atrial flutter 2:1 (synthetic)' }));
  report('atrial-flutter-2to1', strip);
}

{
  const r = applyToxidrome('sodium-channel-blocker', 1);
  const strip = renderStrip(sinusRhythm({ ...r.sinus, duration: 10, seed: 3 }), 10);
  writeFileSync('samples/tox-sodium-channel-blocker.svg', renderSvg(strip, { title: 'Sodium channel blocker, severity 1.0 (synthetic)' }));
  report('tox-sodium-channel-blocker', strip);
}
