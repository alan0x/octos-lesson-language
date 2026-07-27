# Model generation evaluations

此目录用于验证目标模型生成 OLL Authoring Profile 的能力。

评测必须分开报告：

- 协议质量：解析、Schema、语义引用和完整性；
- 教学质量：学科正确性、渐进性、讲述板书一致性和个性化依据。

第一次实验保留模型原始输出，不自动修复，以免掩盖 Authoring Profile 的真实难度。

首份真实模型基线：[`results/2026-07-27/openai-codex-gpt-5.6-sol/REPORT.md`](results/2026-07-27/openai-codex-gpt-5.6-sol/REPORT.md)。

21 个未见跨学科案例、每题 5 次的稳定性报告：[`results/2026-07-27/openai-codex-gpt-5.6-sol-unseen-v1/REPORT.md`](results/2026-07-27/openai-codex-gpt-5.6-sol-unseen-v1/REPORT.md)。正式结果为 96 / 105（91.4%）first-pass Core-executable；该指标不等于浏览器真实播放或教学质量。

## 自动 runner

`packages/eval-runner` 直接复用 `packages/core` 的 Schema、Validator、Normalizer 和 Reducer。正式 unseen suite 包含 21 个跨学科案例：

```bash
npm run eval -- --suite evals/suites/unseen-v1.json --run-id unseen-v1-gpt-5.6-sol --repetitions 5 --concurrency 2 --resume
```

`--resume` 会跳过已有 `result.json` 的调用，也会重新评估已经生成但尚未完成判定的 `raw.json`。这使 105 次调用可以安全中断后继续。

离线重验不会调用模型，也不会修改 raw；它用新版 Core 对已有原始输出做 post-hoc revalidation：

```bash
npm run eval:revalidate -- --suite evals/suites/unseen-v1.json --source evals/runs/<source-run> --output evals/revalidations/<revision> --run-id <revision> --repetitions 5
```

离线结果只能证明协议修订对已保存输出的影响，不能冒充模型看到新合同后的 fresh generation rate。
