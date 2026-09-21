# OLL Rust runtime

Platform-independent migration of OLL runtime behavior. This crate currently contains the numeric expression evaluator; it is not yet a complete course player. The TypeScript protocol implementation remains the compatibility reference.

Run `cargo test --locked --manifest-path crates/oll-runtime/Cargo.toml`.

Expression semantics preserve right-associative powers, unary precedence, supported functions, Unicode operator normalization, finite-result checks, and JavaScript rounding of negative ties. Error wording is not a compatibility guarantee. Renderer, audio, storage and clock are platform responsibilities.

`preview::Preview` additionally provides a restricted canonical geometry/plot preview. Unsupported action and node kinds are rejected. The host supplies elapsed time and action pacing; this is not the production narration scheduler. Course tasks, checkpoints, append/resume, complete schema validation and WASM are not yet implemented. Public preview state is for renderer inspection, not a stable protocol API.


## Estimated-narration session

`session::Session` now owns play/pause state, operation boundaries, reading-budget waits and variable animation pacing. Supply monotonic elapsed seconds through `tick`; paused time does not advance the lesson. The native host no longer chooses a fixed per-action pace. Coverage remains the four supported actions and geometry/plot nodes, not the entire OLL runtime.

`compile_operations` is checked against `compilePlaybackOperations`; `timing` is checked against the existing TypeScript timing functions. The reference generator additionally executes `BrowserLessonSession` using a controlled clock. Its operation timeline is compared within one 16 ms web animation frame; final supported node content is compared structurally with exact numeric values (JSON `1` and `1.0` are equivalent). The reference fixture does not establish compatibility for every course, Unicode release or numeric formatting edge case.

Regenerate fixtures using existing repository dependencies: `node crates/oll-runtime/scripts/generate-reference.cjs`. For an isolated checkout with dependencies elsewhere, set `NODE_PATH` to that repository's existing `node_modules`; no global installation is required.

Compatibility decision: the current Web implementation does not deduct animation duration from its estimated narration budget. This port preserves that observed behavior, including the 180 ms delay after animation. Changing teaching timing is a separate protocol/product decision. External audio start/end synchronization, speed controls, checkpoint persistence, streaming appends, student tasks and WASM remain pending.
