# English relative clause V2 acceptance

Date: 2026-07-27

Viewport: 1280 × 720, real Chrome playback harness, deterministic action and Beat observation.

## Result

The lesson passes the fourth teaching-comprehensibility vertical slice and the
first addressable-text reasoning slice. The board now exposes the exact lesson
question before analysis and preserves a visible section route from the example
through the conclusion. It uses existing OLL text fragments, connections,
tables, emphasis, groups and focus; no protocol change was needed.

## Keyframes

| Beat | Durable board change | Evidence boundary |
| --- | --- | --- |
| show-sentence-and-goal | persistent topic card, two core questions and original sentence | no grammar answer yet |
| bracket-relative-clause | middle clause bracket note | modifier is treated as one block |
| remove-relative-clause | `The book was fascinating` | main clause precedes labels |
| label-main-roles | three-row main-role table and numbered main-clause section | subject/linking verb/complement are grounded |
| attach-clause-to-book | modifier connection and antecedent note | attachment precedes inner analysis |
| reconstruct-ordinary-clause | `you gave me the book` | repeated noun is visibly the direct object |
| replace-book-with-that | `that you gave me` and replacement connection | transformation precedes terminology |
| label-inner-roles | four-row clause-role table and numbered transformation section | each role now has evidence |
| combine-meaning-layers | main/modifier meaning table | syntax reconnects to meaning |
| translate-in-chinese-order | three addressable Chinese fragments and meaning section | word order is made explicit |
| show-complete-route | six-stage route and explicit `that` conclusion | method and target knowledge can be retold |

## Automated evidence

- The exact eleven Beat boundaries are asserted in Player Core.
- The main clause is absent before bracketing and appears before attachment.
- `the book` is visible as ordinary-clause direct object before `that` appears.
- The role table is absent until after the replacement connection exists.
- Every Beat has narration, a visible transition and explicit end focus.
- Player Core asserts the topic card and the three ordered section anchors.
- Full repository suite: 63 tests passed.
- Real Chrome Observer: 11/11 Beat keyframes and 47/47 action frames passed.

## Browser and board-structure defects found and fixed

The earlier fixture kept its teaching goal in lesson metadata and narration, so
the final board did not reveal what knowledge was being taught. Its cards used
local anchors without section ownership, which produced a visually arbitrary
graph. Plain text, notes and lists could also exceed estimated card heights while
the old Observer checked only math and tables.

The fixture now starts with the two exact questions and groups the durable board
into main-clause analysis, relative-clause reconstruction, meaning restoration
and summary. The Runtime performs a browser-measured height pass for flow content
before recomputing groups, connections and collisions. The Observer rejects both
horizontal and vertical overflow for every card type. Structured SVG, math and
controlled images keep rendering-specific size handling so the fix does not
regress the other subject baselines.

## Negative-control comparison

The retained V1 has only five large Beats. Four end without explicit focus and
the final all-content overview shrinks its smallest card to 192 px. It remains
expected-fail under the same Runtime and Observer.

## Conclusion

Text evidence does not need a special language subsystem. Stable fragments plus
connections are enough when the course reconstructs evidence before assigning
grammar labels. This completes the planned visual cross-subject specimen set;
the next gate is narration timing and writing animation, not more sample lessons.
