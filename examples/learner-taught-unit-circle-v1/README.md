# Learner-taught unit circle V1 probe

Riley (grade 10) teaches "how the unit circle turns into a sine wave" in four
cards, without any handwriting. This probe checks that interactive components
recorded by a learner fit OLL v0.1:

- a component inserted mid-recording declares its lesson variable at
  submission (`theta`), with bindings written when the node is created;
- a back-and-forth drag (0 → 1.2 → 0.6 → π/2) becomes three sequential
  `animate` actions in one Beat;
- a "Your turn" card becomes an `after_lesson` task whose check (`sin(theta)`)
  the learner picked from the bound readouts after demonstrating the target.

`recording.json` is the illustrative host capture, including the drag
segmentation rule. Findings are in
[`docs/LEARNER-TAUGHT-V1-FINDINGS.md`](../../docs/LEARNER-TAUGHT-V1-FINDINGS.md).
