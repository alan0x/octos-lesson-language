# OLL v0.1 MUST traceability

Status date: 2026-07-31
Scope: language Core, Player Core, shared fixtures, and the reusable Web Runtime

This matrix is release evidence, not a feature checklist. `Pass` means the
current repository has an automated or inspectable proof. `Partial` means only
part of the requirement is proven. `Blocked` means v0.1 must not be frozen until
the named gap is resolved. Product integration requirements can remain outside
Phase 1, but they remain visible here.

## Course structure and teaching timeline

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-STR-001, OLL-STR-002, OLL-STR-003, OLL-STR-004, OLL-STR-005, OLL-STR-006 | Pass | `schema/authoring/v0.1.schema.json`; `packages/core/test/oll.test.ts` validates and normalizes every complete lesson; every manifest example produces ordered Step and Beat IDs. No branch or loop action exists. |
| OLL-TCH-001, OLL-TCH-003, OLL-TCH-005 | Pass | Narration, point targets, and provider-neutral delivery are normalized in `packages/core/src/index.ts`; Player tests prove narration markers and addressable targets. |
| OLL-TCH-002 | Pass | Narration is accessible text and participates in playback; `octos-web` sends active OLL narration from both text-input and voice-input learning modes through one profile-scoped Octos TTS endpoint. That endpoint reuses the system's resolved provider, cloud credentials, and reply voice. R-007 proves synthesis failure leaves visible narration and lesson playback intact. |
| OLL-TIME-001, OLL-TIME-002, OLL-TIME-003 | Pass | `compilePlaybackOperations` creates one Beat timeline with before/during/after phases and no model-authored millisecond field; absolute duration fields are rejected. |
| OLL-TIME-004 | Pass | Reducer semantics are TTS-independent; the shared Web Runtime narration path and R-007 failure test keep the same lesson playable without synthesized audio. |

## Board, view, and resource semantics

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-BRD-001, OLL-BRD-002, OLL-BRD-003, OLL-BRD-004, OLL-BRD-005, OLL-BRD-006 | Pass | Cross-subject examples and Core tests cover node kinds, fragments, connect, revise, group, focus, and semantic placement. |
| OLL-BRD-007, OLL-BRD-008 | Pass | Authoring placement rejects coordinates; the action/schema surface has no clear, delete, arbitrary script, or pixel-layout operation. |
| OLL-BRD-009 | Blocked | Multiple lessons can share a rendered board, but Authoring cannot yet address a prior lesson's nodes. V-005 requires an accepted external-reference/base-revision contract before this requirement is proven. |
| OLL-VIEW-001, OLL-VIEW-002 | Pass | `board.focus` carries target and intent only; Web Runtime camera tests calculate device-specific position and scale. |
| OLL-VIEW-003 | Partial | Manual navigation exists in the board view, but a conformance test proving auto-follow suspension without semantic change is missing. |
| OLL-AST-001, OLL-AST-002 | Pass | Image examples use controlled `asset_id`; validator rejects resources outside Session Context and does not accept arbitrary URL/path fields. |
| OLL-AST-003 | Partial | Asset resolution failures are observable in the browser observer, but the product-level playback state and learner-facing recovery path need a fixed E2E. |

## Incremental delivery, determinism, and compatibility

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-INC-001, OLL-INC-002 | Pass | Incremental Player and Browser session tests append complete Canonical Steps and play an accepted prefix before close. |
| OLL-INC-003, OLL-INC-004 | Pass | R-001 rejects partial JSON; R-006 proves a later invalid action leaves the committed prefix unchanged. |
| OLL-INC-005 | Pass | Canonical open/close boundaries and after-close rejection are tested. |
| OLL-INC-006 | Partial | Checkpoint continuation exists and R-006 preserves the prefix, but the public projection has no durable `interrupted` lesson status. |
| OLL-INC-007, OLL-INC-008 | Pass | R-002 and R-003 cover duplicate and gap behavior, including atomic rejection. |
| OLL-INC-009 | Pass | The v0.1 Authoring action set contains no wait-for-answer control action. |
| OLL-DET-001, OLL-DET-003 | Pass | Golden expected states, deterministic normalization, R-005 log rebuild, and reducer/player equality run in CI. |
| OLL-DET-002 | Pass | Semantic state excludes browser rectangles, zoom, animation timers, and DOM state. |
| OLL-DET-005, OLL-DET-006 | Pass | Checkpoints contain Step/Beat/phase projection; pause, refresh, seek, replay, and duplicate delivery converge without duplicate semantic actions. |
| OLL-VER-001, OLL-VER-003 | Pass | Every Authoring and Canonical record carries DSL/version/profile; unknown core action is I-014 and fails explicitly. |
| OLL-VER-002 | Partial | The repository policy requires incompatible versioning, but no automated compatibility diff gate exists. |
| OLL-VER-005 | Pass | Package, schemas, fixtures, and examples are all versioned `0.1`; CI runs them together. |
| OLL-VER-006 | Pass | Authoring is the model-facing subset and deterministic normalization produces Canonical events without changing teaching semantics. |

## Independent testing and safety

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-TST-001, OLL-TST-002 | Pass | Core tests run in Node without model, browser, network, DOM, or TTS. |
| OLL-TST-003 | Partial | Valid examples, expected states, ten invalid cases, and seven recovery cases are inventoried; I-003/I-004/I-010/I-011/I-013 still need standalone invalid fixtures or explicit non-applicability decisions. |
| OLL-TST-004 | Partial | Implemented invalid cases assert exact code and path. Limits, cycle policy, and a complete published error-code registry remain open. |
| OLL-TST-005 | Pass | `npm test` runs Core, Player and Web Runtime conformance for all manifest examples; `npm run check:examples` checks canonical and state goldens. Both run in `.github/workflows/ci.yml`. The separate `playback:conformance` command is reserved for an eval run supplied through `--source` and `--output`. |
| OLL-TST-006 | Pass | `eval-runner` and `quality-runner` are separate from Core/Player conformance and report model quality independently. |
| OLL-SAFE-001 | Pass | Core action dispatch is a closed semantic set and I-014 rejects an execution-like operation. |
| OLL-SAFE-002 | Partial | Browser rendering uses controlled content renderers, but the normative restricted-markup set and adversarial fixture are not frozen. |
| OLL-SAFE-003 | Blocked | Explicit maximum Lesson/Step/Beat/node/text/resource counts are not implemented. I-013 cannot pass yet. |
| OLL-SAFE-004 | Pass | Session resource context gates asset IDs and regions; I-012 asserts exact denial. |
| OLL-SAFE-005 | Pass | `CONFORMANCE.md`, eval reports, and quality runner keep protocol correctness separate from subject correctness. |

## Context and system boundaries

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-CTX-001 | Partial | Session and learner-context fixtures exist; a versioned Tutor/Learner/Session generation-input schema is not yet published. |
| OLL-CTX-002 | Pass | The fifth handwritten course declares strategies and authorized `context_refs`. |
| OLL-CTX-003 | Pass | OLL has no learner-context mutation operation. |
| OLL-CTX-004 | Blocked | The independent learner-suggestion channel is not implemented in this repository or the product integration. |
| OLL-CTX-005 | Pass | The language cannot record mastery; quality gates reject unsupported learner claims. |
| OLL-CTX-006 | Partial | The fixture records authorization, but host-side authorization and redaction require product integration evidence. |
| OLL-ENV-001 | Pass | Core has no React, DOM, Canvas, state-library, backend, or provider dependency. |
| OLL-ENV-002 | Pass | Reusable Web Runtime owns playback, semantic layout, camera, board rendering, and checkpoint projection. |
| OLL-ENV-003 | Partial | Architecture and current implementation keep semantic execution in the frontend, but the final persistence/transport contract is not frozen. |
| OLL-ENV-004 | Partial | The language boundary is correct; the production Skill and incremental generation adapter remain Phase 4 work. |
| OLL-ENV-005 | Blocked | `octos-web` still contains the historical assistant-to-board fallback and artifact delivery path; Phase 5 migration is incomplete. |

## Interactive whiteboard development slice

These requirements describe the post-RC implementation path and do not claim that animation, ink, tasks, or 3D are already released.

| Requirements | Status | Evidence or gap |
| --- | --- | --- |
| OLL-VAR-001, OLL-VAR-002, OLL-VAR-003 | Pass | Authoring variables and Geometry/Plot numeric bindings are defined in the Schema and implemented by the Core whitelist expression evaluator. The unit-circle fixture uses one `theta` across both nodes. |
| OLL-VAR-004, OLL-VAR-005 | Pass | `setLessonVariable` recomputes all bound nodes and serializable Semantic BoardState retains the current value; five special-angle assertions run in Core. Web Runtime tests cover animation, manual control and refresh restoration. |
| OLL-VAR-006, OLL-VAR-007, OLL-VAR-008 | Pass | Tests reject out-of-range initial values, unknown variables and unsupported targets. Bindings can only read declared Lesson variables; labels and units are inert metadata. |
| OLL-INP-001 through OLL-INP-005 | Planned | Persistence and “Ask Octopus” behavior are fixed in `INTERACTIVE-WHITEBOARD-MVP.md`; no ink or selection implementation is claimed. |
| OLL-MOT-001 through OLL-MOT-005 | Pass for 2D variable animation | `lesson.variable.animate` carries semantic pacing rather than milliseconds. Browser tests prove shared-value interpolation, mid-animation checkpoint restoration, slider takeover and reduced-motion end-state behavior. Direct Geometry handles and multi-variable timelines are deliberately outside this slice. |
| OLL-TSK-001, OLL-3D-001, OLL-3D-002 | Planned | Acceptance scenarios are fixed; implementation follows ink/selection, tasks, and basic 3D. |
| OLL-ENV-006 through OLL-ENV-009 | Decision accepted | Decision 0004 fixes repository ownership, separate student-input persistence, optional ink packaging and the no-general-plugin MVP boundary. |

## Freeze conclusion

OLL v0.1 Core and Player are substantially implemented and independently
testable, but the language is **not frozen**. Release blockers are:

1. V-005 same-board follow-up and prior-node reference semantics;
2. explicit safety/resource limits and I-013;
3. the learner-suggestion channel boundary;
4. exact disposition of remaining invalid cases and error-code registry;
5. product-owner review of the five handwritten lessons;
6. fixed DSL E2E and removal of the chat/artifact fallback. Shared
   provider-backed narration for text and voice input now has unit evidence but
   still needs real-browser acceptance.
