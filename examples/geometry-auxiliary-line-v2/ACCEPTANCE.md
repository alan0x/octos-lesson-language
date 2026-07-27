# Geometry auxiliary line V2 acceptance

Date: 2026-07-27

Viewport: 1280 × 720, browser playback harness, one `下一 Beat` action per observation.

## Result

The lesson passes the first teaching-comprehensibility vertical slice. This result is narrower than “OLL can generate every good lesson”: it proves that one handwritten geometry lesson can be expressed with OLL v0.1 and played as a readable progressive class by the reference runtime.

## Keyframes

| Beat | Durable board change | Browser observation |
| --- | --- | --- |
| show-givens-and-goal | clean triangle and task card | diagram and both goals share one readable view |
| draw-ad | internal A–D segment and construction note | AD appears only here; label stays inside the diagram without covering D |
| match-isosceles-sides | first SSS row | AB/AC are the only focused edges; AD is supporting |
| match-midpoint-halves | second SSS row | AB/AC resolve, BD/DC become focused |
| mark-common-side | third SSS row | AD becomes the focused common side |
| conclude-sss | congruence formula | three-row table and KaTeX conclusion fill the teaching view at readable size |
| derive-angle-bisector | first conclusion | one focused KaTeX card; implication connection remains visible |
| compare-d-angles | equality at D | only the corresponding-angle equality is added |
| use-straight-angle | equal angles plus 180° imply two 90° angles | three-line aligned derivation fits without horizontal scrolling |
| conclude-perpendicular | AD perpendicular to BC | compact final conclusion is readable at scale 1 |
| show-proof-route | proof route and takeaway | final recap group fills the view and can be read from top to bottom |

## Automated evidence

- Golden normalization and reducer state are deterministic.
- AD is absent before `draw-ad` and present afterwards.
- SSS table row counts progress exactly 1 → 2 → 3.
- Diagram fragment emphasis progresses focus → resolved for each side pair.
- Each Beat contains narration, a visible state transition, and an explicit end focus.
- The perpendicular derivation does not contain `AD \\perp BC` until its final Beat.
- Canonical identifiers do not affect browser card measurement.
- Full repository suite: 51 tests passed.

## Defects found by browser review and fixed

1. SSS and later formulas were shown too small because card measurement counted long Canonical fragment IDs. Measurement now counts visible content only.
2. A persisted AD focus competed with the first and second side pair. AD now becomes supporting until the common-side Beat.
3. End-of-Beat focus tried to fit the diagram and a remote result card simultaneously. Each derivation now finishes on its durable result; intermediate emphasis still brings the diagram into view during playback.
4. The perpendicular proof originally compressed four logical transitions into one Beat. It is now three Beats.
5. The 180° derivation originally overflowed horizontally. It now uses a three-line aligned KaTeX expression.

## Remaining language/runtime gaps

- OLL v0.1 has no semantic angle-arc, right-angle-square, or equal-side tick primitives. The lesson is correct without them, but these are candidates only after more geometry cases show repeated need.
- Browser automation currently asserts semantic keyframes in Node and performs the focal-size/cropping gate by browser review. A reusable screenshot/DOM teaching observer remains follow-up work.
- Learner node dragging after lesson completion remains a layout-override feature, not part of Canonical OLL.
