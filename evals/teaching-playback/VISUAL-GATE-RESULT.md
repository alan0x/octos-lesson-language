# OLL visual teaching-playback gate result

Date: 2026-07-27

Status: **COMPLETE for the v0.1 reference specimen set**

## Positive baselines

| Subject pattern | Fixture | Beat keyframes | Action frames | Result |
| --- | --- | ---: | ---: | --- |
| geometry proof | geometry V2 | 11 | 51 | PASS |
| symbolic algebra and plot | quadratic V2 | 11 | 45 | PASS |
| controlled image science | transpiration V2 | 11 | 37 | PASS |
| addressable text reasoning | relative clause V2 | 11 | 47 | PASS |

All four use the same Player Core, DOM/SVG board Runtime and Observer gates.
The Runtime measures flow-content cards from the rendered DOM before the final
layout pass, while the Observer checks horizontal and vertical overflow on every
card type. This prevents plain text and note clipping from being hidden behind a
formula/table-only gate.

The board renderer updates nodes and groups by semantic ID. Existing cards keep
the same DOM instance across phase, narration, focus and emphasis operations;
only a newly created card receives the write-in animation. The Observer records
instance IDs across sampled frames and fails on an unintended remount.

## Negative calibration

- geometry V1 remains expected-fail for missing Beat focus and an unreadable overview;
- quadratic V1 remains expected-fail for missing Beat focus and an unreadable overview;
- English V1 remains expected-fail for missing Beat focus and an unreadable overview.

The Observer therefore does not pass a lesson merely because its Canonical
events execute or because its final board contains a correct answer.

## Cross-subject result

The reusable teaching unit is a Beat with:

1. one primary cognitive change;
2. addressable evidence or a visible transformation;
3. a durable board result;
4. explicit end focus at readable scale;
5. a final route that can be retold from its entry point.

No new OLL v0.1 action was needed for the algebra, science or language V2
specimens. The image case required a host asset resolver, which belongs to the
frontend Runtime rather than the lesson language.

## What this result does not claim

- It does not prove that a model consistently authors lessons at V2 quality.
- It does not prove learner comprehension or subject transfer.
- It does not validate TTS timing, writing animation or the Octos avatar.
- It does not integrate the Runtime with production `/learn`.

## Decision

Stop expanding fixed visual specimens for v0.1. The next engineering gate is a
timed narration-and-writing slice: define Runtime timing policy without adding
millisecond authoring burden to OLL, play real TTS, align before/during/after
speech actions, and observe pause/resume and refresh recovery on the same timeline.
