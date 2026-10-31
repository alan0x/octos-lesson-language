# Learner-taught slope V1 probe

Jordan (grade 8) teaches "finding slope from two points" in four cards. This is
a probe for the learner-teaching mode: it is the OLL a host would generate
deterministically from a card-by-card recording, not a model-authored lesson.

- `recording.json`: illustrative host capture (takes, timed events, ASR and
  corrected text, review). Not OLL.
- `lesson.authoring.json`: what OLL v0.1 can express today. Handwriting is
  carried as frozen ink snapshots through `image` assets declared in
  `session-context.json`. This is the measurement baseline, not the proposed
  representation.
- `lesson.proposed.json`: the same lesson with the drafted fields (`ink` kind,
  `learner_taught` mode, `author`, `write.source`, `in_place_of`). It is
  intentionally invalid under v0.1 and is not in the manifest.

Card 3 shows the recording model: the handwriting from the first take is kept,
and only the speech and pointer actions are re-recorded after review.

Findings and the schema rejection list are in
[`docs/LEARNER-TAUGHT-V1-FINDINGS.md`](../../docs/LEARNER-TAUGHT-V1-FINDINGS.md).
