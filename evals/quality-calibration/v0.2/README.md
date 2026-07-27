# OLL Quality Calibration v0.2

校准集包含一个未修改的干净对照，以及四个仍能通过 OLL Core、但带有确定性已知教学缺陷的课程。它用于验证质量 judge 的辨别力，不用于估算真实课程分布。

最终配置为 `gpt-5.6-terra` + Quality Contract v0.2 + Codex `--output-schema`。期望结果是干净对照通过、四个缺陷全部失败；实际结果与期望完全一致。

具体 lesson、case、resolved context、原始 judgment、Schema 快照和 gate 结果位于 `evals/quality-evals/2026-07-27-unseen-v1-terra-v0.2/calibration-v0.2/`。
