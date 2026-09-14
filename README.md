# ECG Generator v0

Landmark-first, millimetre-exact 12-lead ECG generator. TypeScript core, Node test harness, browser viewer. Synthetic output for engineering and teaching work; not for clinical use.

Implements phases 0 to 4 of `architecture/00-plan-v0.md` (units, deflection primitives, landmark timeline, per-lead beat, 8 + 4 lead set, template sequencer, SVG renderer, delineator, round-trip tests) plus a first browser viewer. Not yet implemented: noise and filter model (L6), the monitor waveform on Canvas, pathology library as data files, criteria-conformance tests, any fitting to real data.

## Run

Requires Node 18 or newer.

```
npm install          # installs typescript and esbuild only
npm test             # compiles and runs the 78 tests
npm run bundle       # rebuilds viewer/bundle.js and viewer/tox-bundle.js
npm run render       # writes seven sample strips to ./samples and prints their measurements
```

Open `viewer/index.html` directly in a browser (no server needed; the bundles are committed). `viewer/tox.html` is the toxicology tab; the main page links to it.

## Layout

```
src/core/units.ts          L0  seconds and mV to mm; the only place mm exists
src/core/deflections.ts    L1  compact-support bump and plateau primitives
src/core/landmarks.ts      L2  clinical intervals -> absolute landmark timeline
src/core/beat.ts           L3  landmarks + per-lead morphology -> deflections
src/core/leads.ts          L4  8 independent channels; III, aVR, aVL, aVF derived
src/core/sequencer.ts      L5  beat list -> strip; sinus rhythm generator; QT partition; baseline guard
src/core/st-morphology.ts      ST shape library: concave, convex, straight up/horizontal/down, tombstone
src/core/st-territory.ts       territory patterns; frontal-plane least-squares ST vector; reciprocal change
src/core/rhythms.ts            SVT, atrial fibrillation (f-wave layer), atrial flutter (sawtooth layer)
src/core/noise.ts              L6 (partial): baseline wander, mains, muscle artefact added after synthesis
src/core/tox.ts                six toxicology patterns on a severity slider
src/measure/tox-measures.ts    checklist measurements (sinus-only intervals, aVR R' and R/S, ST nadir, U, PVC count)
src/viewer/tox.ts              toxicology tab
src/render/svg.ts          L7  mm-exact SVG, 3x4 + rhythm layout, min/max decimation, calipers inverse
src/measure/delineate.ts   L8  reads samples only; QRS/P/T delineation; lead identity residuals
src/viewer/common.ts           shared viewer plumbing: calipers, SVG export, stat tiles
src/viewer/main.ts             generator page
viewer/ui.css                  shared design system for both pages
src/cli/render.ts              sample renderer
samples/                       rendered SVG examples (sinus, STEMI, AF, flutter, tox)
```

L8 imports nothing from L1 to L5. That is what makes the round-trip test meaningful.

## What the design guarantees, and how it is tested

Compact support. Every primitive is exactly zero outside its landmark window. Consequences that are asserted by tests: onset and offset landmarks are literal, the TP baseline is exactly zero (not approximately), and no wave leaks into its neighbour.

Landmarks primary. You set PR, QRS duration, ST duration and QT (via QTc). Shapes are fitted inside the resulting windows. `intervalsFromLandmarks(landmarksFromIntervals(x)) == x` to floating point.

Exact amplitudes. Q, R, S bumps are overlapped so that at each wave's peak the neighbouring bumps are exactly zero, so the peak amplitude you set is the amplitude that renders. The T bump amplitude is reduced by the ST plateau's value at the T peak, so T amplitude measured from baseline equals the requested value.

Eight independent channels. Real machines acquire I, II, V1 to V6 and compute the rest. So do we. Einthoven and Goldberger identities hold to 1e-12 mV on every strip.

Millimetre exactness. The SVG viewBox is in mm with width and height in mm, so 1 user unit is 1 mm on screen and on paper. The renderer is a pure affine transform, and the viewer's calipers use its inverse. Tests assert the 1 mV calibration pulse is 10 mm tall and 5 mm wide, and that consecutive 1 ms samples are 0.025 mm apart at 25 mm/s.

Peaks survive decimation. The path emits the min and max of each bin rather than every nth sample.

## Round-trip precision as measured

The delineator finds onsets and offsets by amplitude threshold (default 5 microvolts) relative to a histogram-mode baseline, and the QRS by slope. Threshold delineation lags a smooth onset by a few milliseconds by its nature. The test suite prints the observed maximum error per landmark across a 10 s strip. Current values (lead II, 50 to 120 bpm, sharpness defaults):

| landmark | max error | tolerance |
|---|---|---|
| QRS onset | 2.0 ms | 8 ms |
| J point | 2.0 ms | 8 ms |
| P onset, P offset | 6.0 ms | 12 ms |
| P peak, T peak | 0.5 ms | 3 ms |
| T offset | 4 to 9 ms (worse at slow rates and low T amplitude; 12.6 ms in V1) | 15 ms |
| R, S, T amplitude | 0.001 mV | 0.01 mV |

The plan's original 2 ms target was not met for onsets and offsets and the tolerances were revised. The reason is structural rather than a bug: a C1 wave starts with zero slope, so any amplitude threshold crosses it some distance inside the window, further for low, wide waves (P, T) than for tall, narrow ones (QRS). Real algorithms have the same problem, which is why T-end determination is a known source of inter-algorithm disagreement.

## ST elevation types and reciprocal change

`st-morphology.ts` maps a named shape plus a signed J-point level onto the per-lead parameters (level at J, level at T onset, body exponent, T amplitude, T sharpness, T peak position). Types: concave upward, convex (coved), straight upsloping, straight horizontal, straight downsloping, tombstone. Direction words describe the slope of the segment, so "upsloping depression" rises back toward baseline and "upsloping elevation" climbs further. The numeric factors are stylisations tuned to match the textbook drawings, not fits to data.

On the shape rule itself: the teaching split (convex or straight = ischaemic, concave = non-ischaemic) is a heuristic with limited sensitivity. Brady et al. (2001) reported that non-concave morphology had sensitivity 77% and specificity 97% for AMI (figures quoted here via a secondary source; verify against the paper). Smith and colleagues have reported that around 40 to 50% of acute LAD occlusions show concave ST segments in V2 to V5. The dropdown is a shape library, not a diagnostic rule.

`st-territory.ts` handles reciprocal change by two different mechanisms, and the distinction matters:

1. Limb leads. The six frontal leads are projections of one 2-D vector and cannot be set independently. The territory table lists requested limb-lead levels; a least-squares fit finds the frontal ST vector, the fitted values are written into leads I and II, and III, aVR, aVL and aVF follow from the identities. Reciprocal aVL depression in inferior STEMI is therefore not authored; it is the geometry. The viewer shows the fitted vector (magnitude and axis), the resulting six limb-lead levels, and the rms residual, which says how far the requested pattern is from anything a single frontal vector can produce.
2. Precordial leads. V1 to V6 are independent, so reciprocal change there (inferior depression during anterior injury, V1 to V3 depression as the mirror of posterior injury) is an authored per-lead weight. No physics enforces it.

Territories: inferior (RCA pattern, III > II), inferior (LCx pattern), anterior, anteroseptal, anterolateral, lateral, high lateral, posterior, diffuse. Lead weights are textbook-typical and hand-set. Not modelled: PR-segment depression (pericarditis), V7 to V9, right-sided leads, Q-wave evolution, hyperacute T waves as a separate stage.

## QT partition: how ST duration and T width share the QT

QT = QRS + ST + T. The earlier build held ST fixed so every QT change went into T width. That is wrong in general: the ST segment is the surface expression of the action-potential plateau and the T wave of the phase 3 repolarisation gradient, and they respond to different things. Hypocalcaemia and LQT3-type late sodium current lengthen the plateau, so the ST segment lengthens with a normal T. IKr block, hypokalaemia and LQT2-type mechanisms slow phase 3, so the T widens. Rate adaptation shortens the early part of repolarisation most: Malik's group report that J-to-T-peak shortens by about 150 ms per second of RR change (JTpc = JTp + 0.150(1 - RR)) and that T waves become more symmetrical at fast rates.

Model, in `partitionQt()`:

```
JT = QT - QRS
ST = stFraction * RR^rateExponent * JT      (stFraction default 0.32, rateExponent default 0.5)
T  = JT - ST                                 (floored at 80 ms)
T peak fraction: 0.55 at RR >= 1 s, sliding to 0.5 at RR <= 0.5 s
```

The proportional part (ST as a share of JT) is a reasonable first approximation. The extra rate exponent, the specific default of 0.32, and the linear symmetry ramp are decrees; the sources above establish the direction of the effects, not these numbers. The viewer offers this mode and a fixed-ST mode side by side, and prints the resulting QRS + ST + T split at the current rate.

## Rhythm engine (template sequencer, extended)

The sinus generator now runs an atrial clock and applies an AV conduction rule per P wave, so AV block is a first-class option:

- `avBlock: { type: 'first' | 'wenckebach' | 'mobitz2' | 'complete', ratio, prIncrement, escapeRate, escapeFocus }`. Wenckebach lengthens PR by `prIncrement` per beat and drops the last P of each cycle of `ratio`; Mobitz II drops every `ratio`-th P with a constant PR (2 gives 2:1); complete block draws an independent P train and a junctional (narrow) or ventricular (wide) escape train. Non-conducted P waves are drawn as P-only beats (`pOnly`) and labelled `blocked-p`.
- Ventricular ectopy (`ectopy`) is unchanged, with `every: 1` bigeminy.

`rhythms.ts` adds three non-sinus generators that return a beat list and, for the atrial arrhythmias, a continuous atrial layer that `renderStrip` adds under the beats:

- `pacedRhythm`: VVI-like ventricular pacing, a spike (annotation layer) before each wide LBBB-like complex, optionally with a dissociated sinus P train. This is what the spike annotation layer was built for.
- `svtRhythm`: regular narrow tachycardia, no sinus P, a retrograde P drawn as a terminal deflection (pseudo-r' in V1, pseudo-S in II) and mild rate-related lateral ST depression. AVNRT-like by appearance only; no re-entrant circuit is modelled.
- `atrialFibrillation`: log-normal RR with the requested mean and a `irregularity` sigma, a 300 ms floor standing in for AV refractoriness, no P, and a fibrillatory baseline from three incommensurate sinusoids around 7 Hz with slow amplitude modulation, largest in V1. The TP baseline is not isoelectric by design, so the zero-baseline guard is skipped for these strips (`strip.atrial` says so).
- `atrialFlutter`: sawtooth at the flutter rate (default 300 per minute) with fixed 2:1, 3:1, 4:1 or variable conduction. Wave polarity follows typical counter-clockwise flutter: negative sawtooth authored in II (III and aVF follow), near-flat in I (so aVL and aVR come out positive), positive in V1.

## Interface

Both pages share one design system (`viewer/ui.css`): a dark app bar with the two tabs, a control sidebar of collapsible cards, the paper card with a toolbar (case title, summary chips, calipers, print, download), a row of stat tiles (measured value with the delta against the request, coloured by size), and detail tables beneath. The layout is a two-column grid down to about 980 px, below which the paper comes first and the controls stack under it. The paper scales with the column width; printing still uses true millimetre size.

Realism controls live under Display: paper speed and gain, rhythm strip lead, red or grey grid, and a noise level (none, light, moderate, heavy) that adds baseline wander, mains and muscle artefact after synthesis. The noise is applied to the 8 authored channels and the limb leads are re-derived, so the lead identities still hold exactly. No bandpass filter stage is modelled yet.

## Main tab layout

The controls are the state. The Preset dropdown loads every control once (rhythm, rates, block, ectopy, intervals, QT partition, ST territory and type). After that, any edit marks the case Custom and nothing is reloaded behind you. The ST panel is an overlay applied to whichever rhythm is selected; it rebuilds the per-lead morphology set, and the advanced table edits that set until the ST panel or a preset rebuilds it. Rows that do not apply to the selected rhythm are hidden.

## Toxicology tab

`viewer/tox.html` renders three toxidromes from one severity slider (0 = drug effect or early toxicity, 1 = severe). The feature tables follow the LITFL ECG Library and CCC pages cited in `tox.ts`; the severity-to-parameter mappings are stylisations chosen so the published thresholds are crossed at plausible points of the slider, not fits to case data. Each pattern lists what is not modelled.

Sodium channel blocker (TCA type). Sinus tachycardia (M1 blockade), QRS widening (LITFL: > 100 ms predicts seizures, > 160 ms predicts ventricular arrhythmias), terminal R' in aVR > 3 mm or R/S > 0.7, QT prolongation. Implemented as a terminal frontal-plane QRS vector at +200 degrees whose magnitude grows with severity: it deepens the S waves in I and II, and the aVR R' emerges from the derivation rather than being drawn. V1 to V2 get an RBBB-like terminal R'. Not modelled: Brugada-pattern ST elevation, VT, rate-dependent block.

Digoxin (effect to toxicity). Scooped, sagging ST depression in leads with tall R waves (new `stScoop` primitive on top of the J-level plateau), flattened then inverted T, short QT (QTc reaches about 335 ms), PR lengthening toward 240 ms, U waves, and at higher severity sinus bradycardia with PVCs (LITFL: the most common toxic abnormality), bigeminy at the top of the slider. Not modelled: AV block patterns, atrial tachycardia with block, regularised AF, bidirectional VT, the hyperkalaemia of acute overdose.

Potassium efflux (hERG) blocker. QT prolongation with broad, low, notched T waves (new `tNotch` primitive), prominent U waves, and bradycardia (which raises torsades risk). Checklist uses the LITFL QTc thresholds (440 men, 460 women, 500 high risk). The QT nomogram is named but not implemented numerically. Torsades itself is not modelled.

Hyperkalaemia. LITFL: the earliest manifestation is an increase in T wave amplitude (peaked T), then P widening and flattening with PR prolongation, bradyarrhythmias and high-grade AV block, conduction blocks and QRS widening, and above about 9 mmol/L a sine wave, VF, PEA or asystole; changes generally do not manifest below about 6.0 mmol/L and the correlation with serum potassium is loose. Severity ramps peaked T first, then P loss and PR, then QRS widening and bradycardia, then a sine-wave stage; the stage label gives an approximate potassium band and says so. Listed under toxicology because acute digoxin poisoning, hydrofluoric acid, potassium salts and succinylcholine all cause it.

Beta-blocker or calcium-channel blocker. LITFL: sinus bradycardia, first to third degree AV block, junctional and ventricular bradycardia, and a prolonged PR as an early sign even without significant bradycardia; propranolol behaves like a tricyclic (QRS widening, aVR R'), sotalol blocks potassium channels (QT prolongation, torsades). Severity steps the block type (first degree, Wenckebach 4:3, 2:1, complete with junctional then ventricular escape). A drug-class selector adds the propranolol or sotalol overlay by reusing the sodium and potassium channel patterns.

Hypocalcaemia. LITFL: QTc prolongation primarily by prolonging the ST segment, with the T wave typically unchanged; dysrhythmias uncommon. Included as a toxicology pattern because hydrofluoric acid (fluoride binds calcium and magnesium; LITFL calls the degree of QT prolongation a useful biomarker of hypocalcaemia), ethylene glycol and citrate all cause it. Built entirely from the QT partition model with a rising ST share, which is the direct contrast to the potassium channel blocker pattern where the T broadens instead.

Delineator note for tall peaked T waves: QRS candidates are now filtered by half-amplitude width, so a T wave more than twice as wide as a nearby narrow candidate is not counted as a QRS. Without this the hyperkalaemia pattern double-counted, which is exactly the monitor failure it teaches.

The checklist is measured from the generated samples by the delineator, with PVCs excluded from interval means and rate correction from the underlying sinus cycle. Two known weaknesses show up here as they do on real machines: the QRS end drifts late when the ST segment falls steeply right after J (a slope cap was added to limit this), and QT is unreliable when the T is flat and the U is prominent.

## New primitives added for the toxicology work

- U wave: `uDuration` on the beat's intervals opens a window after T offset; `u` on the lead sets its amplitude. The TP baseline now starts after the U.
- Terminal R': `rPrime` on the lead adds a terminal deflection after the S, with the S bump ending at the R' peak so both amplitudes stay exact.
- ST scoop: `stScoop` on the lead adds a bump confined to [J, T onset]; the J level and T-onset level are unchanged.
- T notch: `tNotch` and `tNotchFraction` add a narrow second hump inside the T window.
- Ventricular ectopy: `ectopy` on the sinus generator inserts PVCs after every Nth sinus beat (1 = bigeminy) at a coupling fraction of the RR, with a post-PVC block window standing in for concealed retrograde AV penetration. At ordinary rates the next sinus P is blocked and a full compensatory pause results; at slow rates the impulse arrives after the window, conducts, and the PVC is interpolated. Both behaviours come from one number (`avRefractory`, default 0.6 s), which is a decree.

## Modelling decrees (choices, not physiology)

These are stated so they can be challenged.

1. QT is computed from the mean of the preceding 8 RR intervals via Bazett, not the instantaneous RR. Real QT/RR adaptation is slower still (minutes) and Bazett over-corrects at high rates; Fridericia is provided but not used by default.
2. PR does not shorten with rate. Known coupling, not yet modelled.
3. T-wave polarity is not constrained by QRS width. A wide QRS should force a discordant T; this is not enforced yet and is a planned coupling.
3a. ST shape factors and territory lead weights are stylisations. See the ST section above.
4. Default amplitudes in `NORMAL_MORPHOLOGY` are hand-set textbook-typical values. They have not been fitted to any corpus.
5. The ST plateau's rise from 0 to the J-point level happens between the last QRS peak and J. Physiologically the shift is masked by the QRS; this is a rendering convenience.
6. Wave shape is `sin(pi u)^(2p)` with independent rise and fall warping. Defaults: P and T `p = 1.0`, QRS `p = 0.8`. `p > 1` makes edges softer and delays threshold-based detection.
7. Baseline for measurement is global (histogram mode of the whole lead), so baseline wander is not handled by the delineator yet.
8. The sequencer is a beat list. The beat layer renders from landmarks alone and does not know the list exists. That isolation is the precondition for replacing the sequencer with a conduction-system model later without touching L1 to L4.

## What is NOT validated

The delineator has not been validated against human-annotated wave boundaries. A passing round-trip test proves the generator and the delineator agree with each other, not that either agrees with a cardiologist. Both were written from the same mental model, so a shared misconception passes silently. The next validation step is to run `delineate()` over a corpus with expert P/QRS/T boundary annotations (the QT Database or LUDB on PhysioNet are candidates; check scope and licence) and report its error against those.

No blinded expert read has been done. Nothing here has face validity beyond "looks like an ECG to the person who wrote it".

No criteria-conformance tests exist yet (Sokolow-Lyon, Sgarbossa, Brugada morphology, and so on). The pathology presets in the viewer are hand-authored illustrations, not criteria-checked cases.

## Known visual limitations

- PR and TP segments are perfectly flat. There is no noise, baseline wander, mains interference or muscle artifact layer yet.
- The ST plateau joins the T wave with a visible corner when `stShape` is far from 1. A slope-matched join is possible and is a small change to `beat.ts`.
- Beats are cut at the 2.5 s column boundaries, as on a real machine.
- Pacing spikes are supported as an annotation layer (`strip.spikes`) but no preset uses them.

## References used in this build

- Brady WJ et al. Electrocardiographic ST-segment elevation: the diagnosis of acute myocardial infarction by morphologic analysis of the ST segment. Acad Emerg Med 2001. https://pubmed.ncbi.nlm.nih.gov/11581081/
- Smith SW et al. Upwardly concave ST segment morphology is common in acute left anterior descending coronary occlusion. J Emerg Med 2006. https://www.sciencedirect.com/science/article/abs/pii/S0736467906002903
- LITFL ECG Library: Tricyclic Overdose (Sodium Channel Blocker Toxicity). https://litfl.com/tricyclic-overdose-sodium-channel-blocker-toxicity/
- LITFL ECG Library: Digoxin Effect. https://litfl.com/digoxin-effect-ecg-library/
- LITFL ECG Library: Digoxin Toxicity. https://litfl.com/digoxin-toxicity-ecg-library/
- LITFL ECG Library: QT Interval. https://litfl.com/qt-interval-ecg-library/
- LITFL CCC: ECG in Toxicology. https://litfl.com/ecg-in-toxicology/
- LITFL ECG Library: Hyperkalaemia. https://litfl.com/hyperkalaemia-ecg-library/
- LITFL ECG Library: Beta-blocker and Calcium-channel blocker toxicity. https://litfl.com/beta-blocker-and-calcium-channel-blocker-toxicity/
- LITFL ECG Library: Hypocalcaemia. https://litfl.com/hypocalcaemia-ecg-library/
- LITFL Toxicology Library: Hydrofluoric acid. https://litfl.com/hydrofluric-acid/
- Malik M et al. Heart rate dependency of JT interval sections. J Electrocardiol 2017. https://pubmed.ncbi.nlm.nih.gov/28912074/ (and the Scientific Reports 2019 follow-up on JTp and JT50, https://pmc.ncbi.nlm.nih.gov/articles/PMC6803767)

## Next phases, in the order the plan suggests

5. Pathology library as data files with criteria-conformance tests (Sgarbossa, hyperacute T, Q-wave stage).
6. Architecture stress features: Osborn wave (a `notch` at J), Brugada type 1, delta wave, pacing spikes.
7. L6 acquisition model (diagnostic vs monitor bandpass, noise, wander) and the Canvas monitor renderer.
8. Fit `NORMAL_MORPHOLOGY` and interval distributions to PTB-XL.
9. Validate the delineator against expert annotations, then run a blinded read.
