# OLL Authoring v0.1 — unseen cross-disciplinary stability evaluation

日期：2026-07-27

状态：OLL Core 可执行性门禁；不是前端真实播放或教学质量准入结论。

## 1. 实验目的

本实验回答一个窄而关键的问题：目标模型面对未见过的跨学科请求时，能否在不修复、不重试的情况下输出可被 OLL Core 确定性执行的 Authoring Profile。

这里沿用历史指标名 `first_pass_playable`，其严格含义是 **first-pass Core-executable**：原始输出能直接解析为 JSON，依次通过独立 JSON Schema、OLL 语义校验、Normalizer 和 Reducer，并形成 Semantic BoardState。它不表示浏览器已经真实渲染，也不评价布局、动画、TTS、学科正确性或教学质量。

## 2. 实验设置

| 项目 | 值 |
| --- | --- |
| Provider/client | OpenAI Codex CLI |
| Model | `gpt-5.6-sol` |
| Suite | `unseen-cross-disciplinary-v1` |
| Case | 21 个，覆盖 8 个学科域 |
| Repetitions | 每题 5 次 |
| 总调用 | 105 |
| Concurrency | 3 |
| Reference answers | 0；case 不含 `reference_authoring` |
| Prompt | `evals/prompts/authoring-v0.1.md` + 完整 Authoring Schema + case + resolved Session Context |
| 自动 JSON 修复 | 无 |
| 自动重试 | 无 |
| Resume | 按 `result.json` 断点续跑，不重复已完成调用 |
| OLL Core commit | `8e07b05` |

21 个 case 包括数学、科学、语言、历史、地理、计算机、经济和音乐；其中串联电路、水循环、丝绸之路使用受控 `asset_id` / `region_id` Session Context。

## 3. 机器结论

| 指标 | 结果 |
| --- | ---: |
| 完成调用 | 105 / 105 |
| First-pass Core-executable | **96 / 105（91.4%）** |
| Parse failure | 1 |
| JSON Schema failure | 3 |
| OLL semantic failure | 5 |
| Normalizer failure | 0 |
| Reducer failure | 0 |

所有通过语义校验的输出都能完成 Normalization 和 Reduction。当前风险集中在模型与 Authoring 边界的对齐，而不是 Canonical Core 的确定性执行。

### 按学科域

| Domain | Core-executable | Rate |
| --- | ---: | ---: |
| computing | 10 / 10 | 100.0% |
| economics | 5 / 5 | 100.0% |
| geography | 10 / 10 | 100.0% |
| history | 9 / 10 | 90.0% |
| language | 18 / 20 | 90.0% |
| math | 17 / 20 | 85.0% |
| music | 5 / 5 | 100.0% |
| science | 22 / 25 | 88.0% |

### 按 case

| Case | Domain | Core-executable |
| --- | --- | ---: |
| math-fraction-compare-001 | math | 2 / 5 |
| math-linear-word-problem-001 | math | 5 / 5 |
| math-probability-tree-001 | math | 5 / 5 |
| math-slope-intercept-001 | math | 5 / 5 |
| science-photosynthesis-001 | science | 3 / 5 |
| science-series-circuit-001 | science | 4 / 5 |
| science-newton-force-001 | science | 5 / 5 |
| science-water-cycle-001 | science | 5 / 5 |
| science-state-change-001 | science | 5 / 5 |
| language-english-passive-001 | language | 5 / 5 |
| language-present-perfect-001 | language | 4 / 5 |
| language-argument-structure-001 | language | 5 / 5 |
| language-poem-imagery-001 | language | 4 / 5 |
| history-silk-road-001 | history | 4 / 5 |
| history-industrial-revolution-001 | history | 5 / 5 |
| geography-monsoon-001 | geography | 5 / 5 |
| geography-latitude-climate-001 | geography | 5 / 5 |
| computing-binary-search-001 | computing | 5 / 5 |
| computing-loop-trace-001 | computing | 5 / 5 |
| economics-compound-interest-001 | economics | 5 / 5 |
| music-time-signature-001 | music | 5 / 5 |

## 4. 九次不可执行输出的具体归因

| Case / repetition | Stage | 首个错误 | 归因 |
| --- | --- | --- | --- |
| fraction 01、03、05 | Schema | `delivery: patient` 不在枚举中 | Tutor Context 使用 `patient`，模型自然映射到 beat delivery；合同/枚举边界不一致 |
| silk-road 01 | Semantic | 对 group 执行 `emphasize` | 模型意图合理，OLL v0.1 目标类型过窄 |
| poem-imagery 01 | Semantic | 对 group 执行 `emphasize` | 同上 |
| photosynthesis 02、04 | Semantic | 对 group 执行 `point` | 同上；老师指向整组原料是自然课堂动作 |
| series-circuit 01 | Semantic | image 使用 `source_asset` 而非 `asset_id` | 模型字段漂移；应保留单一规范字段并强化 kind-specific Schema/示例 |
| present-perfect 05 | Parse | JSON 字符串使用中文弯引号 `“` | 纯生成格式错误；普通 prompt 不能彻底约束 JSON |

关键发现：9 次不可执行中有 7 次集中在两个重复边界：

1. `patient` delivery 枚举不一致（3 次）；
2. group 不能成为 `point` / `emphasize` 目标（4 次）。

如果仅以反事实方式放宽这两个合理边界，原始输出中 103 / 105（98.1%）将可执行。这个数字不是本轮正式通过率，但说明主要问题不是 DSL 总体不可生成，而是两处可修正的 Authoring 设计。

## 5. Mechanical coverage 的审计

自动报告给出 94 / 105（89.5%）。这个分母把 9 个协议不可执行结果也算作 coverage failure；另外两个可执行结果被脆弱的字符串匹配误判：

- English passive 04 实际三次写出 `was/were + 过去分词`，matcher 只接受 `was +` / `was+`；
- Linear word problem 05 实际写出 `0\\le x\\le 3`，matcher 在 `JSON.stringify` 后受反斜杠转义影响未命中。

因此，在 96 个 Core-executable 输出中，人工复核后的浅层必备概念覆盖为 96 / 96。它仍然只是关键词级覆盖，不等于学科正确、渐进、讲板一致或教学质量通过。

后续 runner 必须把 coverage 状态改为 `passed | failed | not_evaluated`，并遍历 JSON 字符串值后做 LaTeX/空白归一化，不能继续把不可执行结果和 coverage failure 混为一谈。

## 6. 延迟

| 指标 | 时长 |
| --- | ---: |
| min | 77.0 s |
| p50 | 121.1 s |
| mean | 125.0 s |
| p90 | 155.1 s |
| p95 | 170.2 s |
| max | 233.7 s |

本轮性能数据来自 Codex CLI 完整课程生成，不代表未来产品 API、流式 OLL 或首个 beat 的可见延迟。

## 7. 结论

1. **OLL Authoring 的跨学科可生成性成立。** 21 个未知 case、105 次调用中 91.4% 无修复通过完整 Core 链路；8 个学科域均出现稳定成功。
2. **当前 v0.1 还不应直接接入 `/learn`。** 91.4% 意味着约每 12 次就有一次整堂课无法执行，而且尚未做浏览器真实播放和教学质量评审。
3. **失败不是平均分散的。** 两处重复协议边界贡献 7 / 9 失败，应先修语言，而不是堆后端补丁或让 Runtime 猜测模型意图。
4. **Core 的确定性部分表现稳定。** 一旦通过 Authoring 语义校验，Normalizer/Reducer 为 96 / 96；没有发现状态重放层错误。
5. **不能把 91.4% 写成教学成功率。** 本轮没有验证真实布局、动画、TTS、讲板语义一致、学科正确性或因材施教。

## 8. 下一步门禁

按顺序推进：

1. 形成 OLL v0.1 修订提案：允许 group 成为 `point` / `emphasize` 目标；明确 `patient` 是合法 beat delivery，或规定 Tutor tone 到现有 delivery 的确定映射；
2. 增加 kind-specific image Schema，保持规范字段 `asset_id`，并给模型一个最小受控图片示例；
3. 修复 coverage evaluator 的三态和字符串归一化；
4. 用本轮 105 份 raw 做离线 revalidation，确认拟议协议变化只扩大预期能力、不掩盖其他错误；
5. 对失败相关的 4 个 case 做定向 5 次复测；
6. 建立最小 headless playback conformance harness，验证 Canonical Events 的时间顺序、增量出现和最终 BoardState；
7. 抽样做独立教学质量评审；完成这些门禁后，才决定是否接回 `/learn`。

完整本地运行产物保存在被 Git 忽略的 `evals/runs/2026-07-27-unseen-v1-gpt-5.6-sol/`，包括每次 raw、generation metadata、result、Canonical JSONL 和 Semantic BoardState。
