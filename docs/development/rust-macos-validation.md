# Rust / macOS validation development log

## 2026-09-21 — first independently testable migration unit

- Branch: `codex/rust-runtime-macos-validation`, based on latest remote main `2b93d67ffc30075edb3d3f34b848f799a46717f2` checked on this date.
- User selected route B: shared Rust runtime, native Makepad adapter and later WASM adapter. TypeScript cannot execute in the Octoscript environment.
- Location: `crates/oll-runtime`; no Makepad dependency in the shared core.
- Ported the expression evaluator from `packages/core/src/math-expression.ts`.
- Validation: offline cargo tests for precedence, Unicode operators, functions, JavaScript negative rounding, malformed expressions and nonfinite results passed.
- Scope: expression evaluator only; full canonical validation, scheduling, checkpoints, WASM and rendering are not claimed complete.
- Next validation course: `examples/unit-circle-sine/lesson.canonical.jsonl`, unchanged real canonical input.
- Android APK parked at user request; installation still requires explicit confirmation.

## Restricted canonical preview slice

- Loads the unchanged unit-circle-sine JSONL; validates envelope order and rejects unsupported action/node kinds explicitly.
- Implements board.create, board.connect, board.focus and lesson.variable.animate, with variable bounds and binding reevaluation. Input clock deltas are supplied by the host.
- Tests verify both diagrams at theta=pi/2, action ordering, pause-equivalent zero elapsed time, terminal focus and invalid input.
- This is deliberately named `Preview`: it does not claim schema-complete validation, production narration scheduling, checkpoint compatibility, or student-task support. The native shell uses an explicitly labelled two-second preview pace between actions, with protocol-derived animation durations.
- User's macOS-first direction permits an early visible validation slice; Android stage gates remain open. This does not mark phase 0/1 fully complete.


## 2026-09-21 — estimated-narration scheduling and reference checks

- User reviewed the first macOS app and confirmed plots, animation, play, pause, resume and restart; continue implementation without another permission gate.
- Rechecked both remote main hashes: unchanged. Continued existing feature branches.
- Added `session` and `timing`: compile 19 operations from the real unit-circle course, retain before/during/after speech boundaries, wait for estimated narration, own pause/resume and animation timing in Rust.
- Generated oracle fixtures by bundling and executing existing TypeScript with already installed esbuild, without installing tools. Includes 7 multilingual narration samples, operation delays, final state and a controlled-clock BrowserLessonSession timeline.
- Found/fixed a genuine state mismatch: mutable JSON indexing inserted absent `arcs`/`circles` arrays as null. Binding now uses non-inserting access. Numeric JSON encoding is compared by exact f64 value, not Rust integer/float enum representation.
- Preserved existing narration budgeting during animation (animation time is not deducted). No silent teaching-policy change.
- Scope remains estimated narration at 1x with the supported four actions. This is not full runtime/phase-1 completion. Next: native shell integration and native formula samples.
