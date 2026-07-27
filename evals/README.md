# Model generation evaluations

此目录用于验证目标模型生成 OLL Authoring Profile 的能力。

评测必须分开报告：

- 协议质量：解析、Schema、语义引用和完整性；
- 教学质量：学科正确性、渐进性、讲述板书一致性和个性化依据。

第一次实验保留模型原始输出，不自动修复，以免掩盖 Authoring Profile 的真实难度。

首份真实模型基线：[`results/2026-07-27/openai-codex-gpt-5.6-sol/REPORT.md`](results/2026-07-27/openai-codex-gpt-5.6-sol/REPORT.md)。

## 自动 runner

`packages/eval-runner` 直接复用 `packages/core` 的 Schema、Validator、Normalizer 和 Reducer。正式 unseen suite 包含 21 个跨学科案例：

```bash
npm run eval -- --suite evals/suites/unseen-v1.json --run-id unseen-v1-gpt-5.6-sol --repetitions 5 --concurrency 2 --resume
```

`--resume` 会跳过已有 `result.json` 的调用，也会重新评估已经生成但尚未完成判定的 `raw.json`。这使 105 次调用可以安全中断后继续。
