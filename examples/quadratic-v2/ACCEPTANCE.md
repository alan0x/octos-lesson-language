# Quadratic completion V2 acceptance

Date: 2026-07-27

Viewport: 1280 × 720, real Chrome playback harness, deterministic action and Beat observation.

## Result

The lesson passes the second teaching-comprehensibility vertical slice. Together
with geometry V2, it shows that the existing OLL v0.1 surface can express both a
visual proof and a symbolic algebra lesson without adding subject-specific DSL
actions.

This is evidence that a handwritten Canonical lesson is renderable and staged
well. It is not yet evidence that a model will author lessons of this quality or
that a learner understood the material.

## Keyframes

| Beat | Durable board change | Teaching boundary |
| --- | --- | --- |
| show-problem-and-goal | original expression and goal card | answer is not exposed |
| isolate-quadratic-part | focus on `x²+6x` | no coefficient calculation yet |
| halve-linear-coefficient | `6÷2=3` | the number entering the bracket is explicit |
| build-perfect-square | `x²+6x+9=(x+3)²` | the missing 9 is justified |
| add-and-subtract-nine | `+9-9` in the original expression | equality invariant is its own Beat |
| replace-with-square | `y=(x+3)²-9+5` | only the completed-square terms are replaced |
| simplify-constant | `y=(x+3)²-4` | constant simplification is separate |
| locate-vertex | parabola, vertex and symmetry axis | graph appears only after algebra completes |
| read-vertex-and-axis | durable graph facts | vertex and axis are stated together |
| describe-translation | left 3, down 4 | bracket sign is explained through `x+3=0` |
| show-complete-route | six-stage route and takeaway | final view can be retold from start to finish |

## Automated evidence

- Golden normalization and reducer state are deterministic.
- Eleven exact Beat boundaries are asserted in Player Core.
- The coefficient calculation, square identity, invariant, vertex form and plot
  are each absent before their teaching Beat.
- `+9` and `-9` are independently addressable and simultaneously emphasized.
- Every Beat has narration, a visible transition and explicit end focus.
- Full repository suite: 56 tests passed.
- Real Chrome Observer: 11/11 Beat keyframes and 45/45 action frames passed.
- Every Beat focus rendered at world scale 1; formula cards used 24px math text.
- No KaTeX error, clipping, label/node overlap, duplicate internal connection or
  browser console warning/error was observed.

## Negative-control comparison

The retained V1 lesson is played by the same Runtime with the same content
domain. It remains expected-fail: nine of ten Beats have no explicit end focus,
and the final all-content overview shrinks the focused card below the teaching
threshold. The distinction therefore comes from lesson staging, not a special
case in the renderer.

## Cross-subject conclusion

The repeated authoring unit is not a geometry primitive or an algebra primitive.
It is a teaching Beat with one cognitive change, addressable evidence, a durable
board result and an explicit camera focus. Geometry and algebra need different
node content, but share the same progressive teaching grammar.

The next useful specimen should leave mathematics. An image-based science lesson
can test observation-to-explanation staging, real asset loading and whether the
same Beat discipline survives less formal content.
