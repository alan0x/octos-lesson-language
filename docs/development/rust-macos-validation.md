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
