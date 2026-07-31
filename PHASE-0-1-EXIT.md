# Phase 0/1 exit review

Status date: 2026-07-31
Decision: **not exited; ready for focused review and gap closure**

This document prevents implementation volume from being mistaken for phase
completion. The evidence below is current and reproducible.

## Phase 0 — product and language baseline

| Deliverable | State | Evidence / next decision |
| --- | --- | --- |
| Product documents reviewed | Ready for product-owner review | Obsidian `learn-product-v2` remains the product source of truth. Engineering audit is complete; product sign-off cannot be self-issued by this repository. |
| OLL v0.1 specification revision | Implemented as RC | Authoring/Canonical schemas, Core types, normalizer, reducer, and Runtime all use 0.1 RC semantics. |
| Five handwritten standard lessons | Ready for review | Quadratic V2, geometry V2, English V2, science transpiration V2, and learner-context number-line V2 all normalize and play. The product owner must decide whether transpiration satisfies the intended science slot or whether an exact photosynthesis course is required. |
| MUST-to-test matrix | Complete as an audit | `TRACEABILITY.md` maps every MUST and records Pass/Partial/Blocked instead of treating missing evidence as pass. |
| Open questions list | Complete | Obsidian O-001/O-002/O-003/O-005 remain open. Additional freeze blockers are listed below. |

Phase 0 cannot exit until:

1. the product owner reads and accepts the five lessons;
2. V-005 same-board follow-up semantics are decided;
3. the science standard-course interpretation is accepted or replaced;
4. every MUST marked Blocked has an owner and target phase.

## Phase 1 — independent DSL Core

| Deliverable | State | Evidence / gap |
| --- | --- | --- |
| TypeScript types and schemas | Pass | Authoring and Canonical 0.1 surfaces build and validate. |
| Parser, Validator, stable errors | Partial | `parseAuthoringLessonJson` adds stable malformed-JSON failure; ten invalid fixtures assert exact code/path. A complete error registry, limits, and remaining invalid cases are open. |
| Reference normalizer and reducer | Pass | All manifest examples match canonical JSONL and expected state; Player final state matches Reducer. |
| Valid fixtures | Partial | Five cross-domain V2 lessons exist; V-005 prior-node reference is not expressible yet. |
| Invalid fixtures | Partial | I-001/I-002/I-005/I-006/I-007/I-008/I-009/I-012/I-014/I-015 run in CI. I-003/I-004/I-010/I-011/I-013 require fixtures or explicit profile-level disposition. |
| Recovery fixtures | Pass across repositories | R-001 through R-006 run in this repository. R-007 records the Web integration test that preserves narration and playback when the configured system TTS provider fails. |
| CLI-equivalent commands | Pass | `npm test`, `npm run check:examples`, and `npm run generate:goldens`; eval runs additionally use parameterized `npm run playback:conformance -- --source … --output …`. |
| CI | Added | `.github/workflows/ci.yml` runs typecheck, full tests, example goldens, and playback conformance. |

Phase 1 cannot formally exit until the Partial items above are resolved. The
current automated baseline is 110 passing tests.

## Decisions required before implementing V-005

Authoring aliases are currently lesson-local. A follow-up lesson therefore
cannot safely say “anchor this explanation to the previous formula” even though
the product page can visually compose multiple lessons.

The language decision must define:

1. how the host exposes addressable prior nodes/groups to Authoring;
2. how a model refers to them without inventing Canonical IDs;
3. how `base_revision` mismatch fails;
4. whether follow-up validation receives an initial Semantic BoardState or a
   smaller read-only reference catalog;
5. how the same rule works for normalization, reducer, Player, and Web Runtime.

Until that decision is accepted, visual co-location is not evidence of semantic
same-board follow-up.
