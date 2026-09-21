# OLL Rust runtime

Platform-independent migration of OLL course behavior. OLL defines the protocol; this Rust runtime reads it and advances course state; hosts provide rendering, clock, storage, input and audio. The existing TypeScript implementation remains the compatibility reference. Native hosts do not execute TypeScript in Octoscript.

## Current scope (2026-09-21)

Implemented and tested slices include expressions, canonical course operations, estimated-narration scheduling, variable animation, pause/resume, camera/layout and connection geometry, native checkpoints, legacy checkpoint import, and incremental event handling. Coverage includes four courses: unit-circle-sine, quadratic, quadratic-v2 and english-relative-clause. Unsupported actions/node structures are rejected; this is not full OLL protocol support. Diagram support is restricted to sequence content.

`api::RuntimeApi` exposes load/restore/play/pause/tick/append/checkpoint/snapshot over JSON. `wasm.rs` implements a raw UTF-8 ABI and the Web adapter retains the existing board renderer. **The actual WASM binary has not been compiled or tested:** installing the missing wasm32-unknown-unknown target is awaiting user approval. Native API tests and TypeScript typechecking are not substitutes for WASM/browser validation.

`ink` is a service-integration slice for coordinate conversion, stroke cancellation and undo/redo. It does not migrate old ink files, persistence or erasing. External audio synchronization, complete student-task/voice/application flows, complete course coverage and production performance acceptance remain pending.

The separate Makepad preview is a technical test harness, **not the migrated product UI**. The user objected to its difference from main; no final product UI acceptance was given. The next product task is to inventory the latest main pages/interactions and integrate the tested core into a corresponding interface, without an unapproved redesign.

Current handoff: [AGENT_HANDOFF_CURRENT.md](/Users/alan0x/Documents/projects/YY/working/octos-learn/2026-0919-makepad数学渲染与去webview化调研/AGENT_HANDOFF_CURRENT.md). History: [development log](../../docs/development/rust-macos-validation.md).

## Validation and compatibility decisions

Run `cargo test --offline --locked --release --manifest-path crates/oll-runtime/Cargo.toml`. The v6 evidence records 23 passing core tests. Tests include old-player operation/timing/final-state comparisons, legacy checkpoints, layout/connection fixtures and the host API. Four sample courses do not establish full protocol compatibility.

Expressions preserve power/unary precedence, Unicode normalization, finite-result checks and JavaScript rounding. Session pacing preserves the old player's estimated narration behavior: animation time does not deduct from the reading budget, and an animation is followed by a 180 ms interval. Real speech timing is not connected.

Native checkpoints use octos.rust.playback.checkpoint 0.1; legacy octos.playback.checkpoint 0.1 is read and validated, not silently rewritten. Fingerprints preserve JSON.stringify ordering and UTF-16 hashing. Numeric comparisons allow documented floating-point tolerances, not arbitrary state mismatches.

Fixture generators use existing repository Node dependencies. An isolated checkout may use NODE_PATH pointing to existing node_modules for CommonJS scripts. Typechecking/bundling additionally requires normal local dependency resolution; the temporary dependency symlink used during verification was removed afterward. Do not install software without the required approval.

After WASM target approval and build, use `scripts/verify-wasm.cjs <actual.wasm> <native-host-api>` for native/WASM comparison, then build `apps/rust-preview/build.cjs` and verify in a real browser. These remain future checks. Native tick/serialization measurements exclude GPU, audio and device input latency; no product performance target has been accepted.

The v6 binary source corresponds to commit 95ab25f on codex/rust-runtime-macos-validation. Later documentation-only commits do not change that binary provenance. New product code must follow the user's latest-main feature-branch requirement while retaining existing validated commits.
