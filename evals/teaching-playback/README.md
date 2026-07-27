# Teaching playback observations

This directory stores deterministic real-browser observations of fixed Canonical lessons. It is the Browser-renderable and objective portion of the Teaching-comprehensible gate; it is not a model-generation score or a claim that a learner understood the lesson.

## Run

```bash
npm run teaching:observe:geometry
npm run teaching:observe:quadratic
npm run teaching:observe:science
npm run teaching:observe:english
```

Generic form:

```bash
npm run teaching:observe -- \
  --lesson geometry \
  --width 1280 \
  --height 720 \
  --output evals/teaching-playback/geometry-v2/report.json
```

The runner builds the harness, starts an isolated local server, launches an existing Chrome/Chromium executable through `playwright-core`, executes every playback operation, and writes both JSON and Markdown reports. Set `OLL_CHROME_PATH` when Chrome is not in a standard location.

## Report layers

- `action_frames`: the target of each visible classroom action exists and intersects the viewport;
- `beats`: the committed teaching focus is fully in view and meets focal size/readability thresholds;
- global DOM gates: no KaTeX error, content clipping, connection-label/node overlap, duplicated internal diagram line, pending/failed lesson image, or browser console warning/error;
- failure screenshots: captured only for failing cursors and replaced on the next run.

The JSON report is intended for CI and later cross-lesson aggregation. The Markdown report is the review surface for humans.

## Negative control

```bash
npm run teaching:observe:calibration
```

The retained geometry V1 is an expected-fail fixture. `--expect fail` makes the command succeed only when the observer rejects it; an accidental PASS is a calibration failure. Its current baseline failures are missing Beat focus and an unreadably small final overview. Image-region emphasis targets are now real addressable DOM, so they are deliberately no longer part of the negative baseline. Calibration omits screenshots because the remaining defects are already documented.

## Cross-subject positive slice

```bash
npm run teaching:observe:quadratic
```

Quadratic V2 is the second expected-pass specimen. It separates coefficient
halving, construction of the perfect square, the `+9-9` invariant, substitution,
constant simplification and graph interpretation into eleven explicitly focused
Beats. Its report is stored in `quadratic-v2/`.

Science transpiration V2 is the third expected-pass specimen and the first to
load a real controlled PNG. It separates direct observation, comparison,
inference, internal transport, transpiration and condensation across eleven
Beats. The Observer additionally rejects pending or failed lesson images. Its
report is stored in `science-transpiration-v2/`.

English relative clause V2 is the fourth expected-pass specimen. It reconstructs
the ordinary clause and the `the book → that` replacement before assigning
grammar roles. Its report is stored in `english-relative-clause-v2/`.

## Cross-subject negative probe

```bash
npm run teaching:observe:quadratic-probe
npm run teaching:observe:english-probe
```

The original quadratic lesson is also expected to fail, but for authoring rather than fragment rendering: nine Beats have no explicit end focus and its final all-content overview shrinks the focused card below the threshold. The probe originally exposed clipped formulas and missing math/plot fragment DOM; those Runtime defects were fixed before this expected-fail baseline was accepted. Keeping V1 and V2 side by side ensures the observer is measuring staging rather than merely recognizing a subject.

The original English lesson is an equivalent text-domain negative probe: four of
five Beats lack end focus and its final all-content overview is too small. The
aggregate visual-gate decision is recorded in `VISUAL-GATE-RESULT.md`.
