# OLL Authoring v0.1 — boundary revision targeted confirmation

日期：2026-07-28

状态：fresh-generation 定向确认，不是全量跨学科复测，也不是前端真实播放或教学质量结论。

## 1. 目的与设置

在 `b00deca` 修订 Authoring 边界后，让模型真实看到新版 prompt 和 Schema，确认 `patient` delivery、group `point` / `emphasize`、image `asset_id` 和精确评测指标不是只在旧 raw 上离线放宽规则。

| 项目 | 值 |
| --- | --- |
| Model | `gpt-5.6-sol` |
| Suite | `authoring-boundaries-v0.1` |
| Cases / repetitions | 5 / 每题 5 次 |
| Fresh calls / concurrency | 25 / 3 |
| Core revision / suite commit | `b00deca` / `8f00513` |
| JSON repair / retry | 无 / 无 |

## 2. 结果

| 指标 | 结果 |
| --- | ---: |
| 完成调用 | 25 / 25 |
| First-pass Core-executable | **25 / 25（100%）** |
| Mechanical coverage among executable | **25 / 25（100%）** |
| Parse / Schema / Semantic failure | 0 / 0 / 0 |
| Normalizer / Reducer failure | 0 / 0 |

### 与旧合同的同 case 对比

| Case | 旧合同 | 新合同 fresh |
| --- | ---: | ---: |
| math-fraction-compare-001 | 2 / 5 | 5 / 5 |
| science-photosynthesis-001 | 3 / 5 | 5 / 5 |
| language-poem-imagery-001 | 4 / 5 | 5 / 5 |
| history-silk-road-001 | 4 / 5 | 5 / 5 |
| science-series-circuit-001 | 4 / 5 | 5 / 5 |
| 合计 | 17 / 25（68%） | **25 / 25（100%）** |

这不是严格的 A/B 实验：调用时间不同，模型采样也不同；对比只能用于确认原失败边界在新版合同下没有继续复现。

## 3. 新能力确实被使用

| 观察 | 次数 |
| --- | ---: |
| `delivery: patient` beats | 80 |
| 对 group 执行 `point` / `emphasize` | 7 |
| image nodes | 10 |
| image 使用规范 `asset_id` | 10 / 10 |
| image 使用错误 `source_asset` | 0 |

group target 分布在丝绸之路 1 次、诗歌意象 2 次、光合作用 4 次。图片节点来自丝绸之路地图和串联电路，各 5 份。

## 4. 结论

1. 协议修订同时通过 105 份旧 raw 的 post-hoc revalidation（103 / 105）和 25 次新版合同 fresh generation（25 / 25）；
2. 新版输出实际使用了目标能力，因此结果不是靠绕开新规则取得；
3. 没有证据要求重新设计 OLL 顶层结构，也没有理由把这些错误交给后端补丁或 Runtime 猜测；
4. 25 / 25 不能外推为全学科生产成功率；原 21-case 基线仍为 96 / 105，不能被覆盖；
5. 下一道门应转向 headless playback conformance 与教学质量抽样。

完整本地运行产物保存在被 Git 忽略的 `evals/runs/2026-07-28-boundary-v01-gpt-5.6-sol/`。
