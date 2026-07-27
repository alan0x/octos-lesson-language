# Teaching playback observations

This directory stores deterministic real-browser observations of fixed Canonical lessons. It is the Browser-renderable and objective portion of the Teaching-comprehensible gate; it is not a model-generation score or a claim that a learner understood the lesson.

## Run

```bash
npm run teaching:observe:geometry
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
- global DOM gates: no KaTeX error, content clipping, connection-label/node overlap, duplicated internal diagram line, or browser console warning/error;
- failure screenshots: captured only for failing cursors and replaced on the next run.

The JSON report is intended for CI and later cross-lesson aggregation. The Markdown report is the review surface for humans.

## Negative control

```bash
npm run teaching:observe:calibration
```

The retained geometry V1 is an expected-fail fixture. `--expect fail` makes the command succeed only when the observer rejects it; an accidental PASS is a calibration failure. Its current baseline failures are missing Beat focus and an unreadably small final overview. Image-region emphasis targets are now real addressable DOM, so they are deliberately no longer part of the negative baseline. Calibration omits screenshots because the remaining defects are already documented.

## Cross-subject probe

```bash
npm run teaching:observe:quadratic-probe
```

The original quadratic lesson is also expected to fail, but for authoring rather than fragment rendering: nine Beats have no explicit end focus and its final all-content overview shrinks the focused card below the threshold. The probe originally exposed clipped formulas and missing math/plot fragment DOM; those Runtime defects were fixed before this expected-fail baseline was accepted.
