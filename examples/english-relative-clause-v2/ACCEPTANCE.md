# English relative clause V2 acceptance

Date: 2026-07-27

Viewport: 1280 × 720, real Chrome playback harness, deterministic action and Beat observation.

## Result

The lesson passes the fourth teaching-comprehensibility vertical slice and the
first addressable-text reasoning slice. It uses existing OLL text fragments,
connections, tables, emphasis, groups and focus; no protocol change was needed.

## Keyframes

| Beat | Durable board change | Evidence boundary |
| --- | --- | --- |
| show-sentence-and-goal | original sentence and method goal | no grammar answer yet |
| bracket-relative-clause | middle clause bracket note | modifier is treated as one block |
| remove-relative-clause | `The book was fascinating` | main clause precedes labels |
| label-main-roles | three-row main-role table | subject/linking verb/complement are grounded |
| attach-clause-to-book | modifier connection and antecedent note | attachment precedes inner analysis |
| reconstruct-ordinary-clause | `you gave me the book` | repeated noun is visibly the direct object |
| replace-book-with-that | `that you gave me` and replacement connection | transformation precedes terminology |
| label-inner-roles | four-row clause-role table | each role now has evidence |
| combine-meaning-layers | main/modifier meaning table | syntax reconnects to meaning |
| translate-in-chinese-order | three addressable Chinese fragments | word order is made explicit |
| show-complete-route | six-stage route and takeaway | method can be retold from the sentence |

## Automated evidence

- The exact eleven Beat boundaries are asserted in Player Core.
- The main clause is absent before bracketing and appears before attachment.
- `the book` is visible as ordinary-clause direct object before `that` appears.
- The role table is absent until after the replacement connection exists.
- Every Beat has narration, a visible transition and explicit end focus.
- Full repository suite: 62 tests passed.
- Real Chrome Observer: 11/11 Beat keyframes and 44/44 action frames passed.

## Browser defect found and fixed

The first V2 run failed `attach-clause-to-book`. Collision avoidance placed the
antecedent note below a remote table, so focusing it with the original sentence
scaled both cards to 185 px. The note now sits immediately left of the sentence;
the same two-target focus renders at scale 1 and 240 px. The threshold was not lowered.

## Negative-control comparison

The retained V1 has only five large Beats. Four end without explicit focus and
the final all-content overview shrinks its smallest card to 192 px. It remains
expected-fail under the same Runtime and Observer.

## Conclusion

Text evidence does not need a special language subsystem. Stable fragments plus
connections are enough when the course reconstructs evidence before assigning
grammar labels. This completes the planned visual cross-subject specimen set;
the next gate is narration timing and writing animation, not more sample lessons.
