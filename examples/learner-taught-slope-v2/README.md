# Learner-taught slope V2

Jordan's slope lesson in the learner-taught format (decisions 0005–0007,
player execution 0.6.0). Compared with the [v0.1 baseline](../learner-taught-slope-v1/README.md):

- `lesson.mode` is `learner_taught`, with an opaque learner author, avatar and voice.
- Handwriting is `ink` from frozen snapshots listed in `session-context.json`
  with their checksums; strokes replay in drawing order.
- Card 2: Jordan circles point A. The circle `annotates` the grid, so it stays
  on point A wherever the grid is laid out.
- Card 3: the neat formula `replaces` the handwritten fraction in place, and
  records the ink selection it came from (`source`, confirmed by the learner).

`recording.json` in the v1 folder is still the host input this lesson is
compiled from.
