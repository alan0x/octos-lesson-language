# OLL Authoring v0.1 — OpenAI Codex baseline

日期：2026-07-27

状态：可行性基线，不是生产准入结论。

## 1. 实验身份

| 项目 | 值 |
| --- | --- |
| Provider | OpenAI |
| Model | `gpt-5.6-sol` |
| Client | OpenAI Codex CLI `0.146.0-alpha.3.1` |
| Reasoning effort | `none` |
| 最终 Authoring 合同 commit | `92de754` |
| Action Schema 对齐 commit | `ec71dd0` |
| 初始实验基线 commit | `62c738d` |
| 示例 | 0；未向模型提供 reference authoring |
| 工具 | 禁止读取文件和调用工具 |
| 自动修复 | 无；每个 raw 文件都是模型最终消息的原样 JSON |

每次调用由以下部分组成：`evals/prompts/authoring-v0.1.md`、一个 case、对应 Session Context，以及完整 Authoring Schema。case 中的 `reference_authoring` 只用于评测人员定位基准，明确禁止模型读取。

## 2. 先给结论

1. **OLL 能表达目标课程。** 数学配方、带受控图片区域的几何辅助线、英语定语从句三类完整课程都能规范化为 Canonical Events，并通过 reducer 形成稳定白板状态。
2. **模型能生成高质量 OLL，但仅给宽泛 JSON Schema 不够。** 初始教学内容已经很好，失败集中在动态引用类型、Session resource 映射和 `close.focus` 语义。
3. **补全 Authoring 合同后，本组 3/3 最终输出无需修补即可解析、语义验证并规范化。** 这证明“模型生成 OLL”可行，但样本量只有三个，而且 case 与仓库基准同源，尚不能证明面对未知学科和未知课堂结构时的稳定性。
4. **规范与实现缺陷必须和模型缺陷分开统计。** 本轮发现并修复了 Schema 未声明动作条件必填字段、`close.focus` 含义不清，以及 connection 无法被 focus 的不合理限制。

## 3. 失败如何推动协议收敛

| Case / attempt | 结果 | 首个错误 | 归因 |
| --- | --- | --- | --- |
| quadratic 01 | 失败 | `connect.as` 缺失 | Schema 没声明验证器实际要求的条件必填字段；协议缺陷 |
| quadratic 02 | 失败 | connection 被放进 `group.members` | 模型动态类型错误；Authoring 合同也未说明类型规则 |
| geometry 01 | 失败 | 直接把 `asset_id#region` 当局部别名 | Authoring 合同未说明 resource → local fragment 映射 |
| English 01 | 失败 | connection 被当成布局 anchor | 模型动态类型错误；Authoring 合同未说明类型规则 |
| English 02 | 失败 | `close.focus` 输出摘要文字 | Schema 只写任意 string，验证器却要求局部引用；协议缺陷 |
| English 03（旧规则） | 失败 | `close.focus` 引用重要 connection | 模型意图合理；OLL 不合理地禁止聚焦可见 relation |
| English 03（最终规则） | 通过 | 同一 raw 未修改 | 允许 focus node/group/connection 后通过 |
| geometry 02 | 通过 | — | 最终合同 |
| quadratic 03 | 通过 | — | 最终合同 |

严格 response schema 模式还在模型生成前被 Provider 拒绝；详情见 `provider-strict-schema-failure.json`。这不计入模型生成失败。规范 Schema 保持 provider-neutral，Provider 专用 strict adapter 应独立设计。

## 4. 最终机器结果

| Case | JSON | 语义验证 | Normalization | Events | Revisions | Nodes | Connections | Groups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| quadratic | pass | pass | pass | 5 | 3 | 15 | 6 | 2 |
| geometry image | pass | pass | pass | 7 | 5 | 12 | 1 | 1 |
| English | pass | pass | pass | 6 | 4 | 18 | 3 | 4 |

“语义验证”包括：动作负载、先定义后引用、别名唯一、fragment、动态对象类型、相对布局、受控 asset/region，以及禁止绝对坐标。当前仓库尚未接入独立的 JSON Schema Draft 2020-12 引擎，因此下表的 Schema 项保守记 3/4；引入独立 schema runner 后再升为生产门禁。

## 5. 最终人工评分

协议质量每项 0–4：

| Case | 可解析 | Schema | 语义引用 | 完整性 | 可规范化 | 总分 / 20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| quadratic | 4 | 3 | 4 | 4 | 4 | 19 |
| geometry image | 4 | 3 | 4 | 4 | 4 | 19 |
| English | 4 | 3 | 4 | 4 | 4 | 19 |

教学质量每项 0–4：

| Case | 正确性 | 覆盖 | 渐进 | 讲板一致 | 白板利用 | 连续完成 | Context 使用 | 无虚假画像 | 总分 / 32 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| quadratic | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 32 |
| geometry image | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 32 |
| English | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 32 |

说明：几何 case 使用的是 Session Context 中的识图置信度；英语 case 没有 Learner Context。Context 得分表示模型正确使用已有上下文且没有编造画像，不表示已经验证了长期因材施教。

## 6. 仍未证明的事情

- 三个 case 与当前基准课程同源，虽然未给模型参考答案，但 required coverage 已经规定了课程范围；
- 只有一个模型、每题一个最终成功样本，没有温度、重复次数和失败率分布；
- 尚未覆盖同板追问、科学图示、历史时间线、错误题干、超长课程和上下文冲突；
- 尚未通过真实前端 Runtime 播放这些 Canonical Events；
- 尚未验证 Learner Profile 对教学选择的长期、一致、可审计影响；
- 尚未接入独立 JSON Schema validator，也没有 Provider strict-schema adapter。

## 7. 下一道门

下一阶段不应立即接 `/learn` 页面，而应先建立自动 eval runner：固定 prompt/case/schema，保存 raw，依次执行 JSON Schema、OLL semantic validator、normalizer、reducer，再产出机器报告。随后扩充到至少 20 个跨学科未知 case，每个 case 重复 5 次，统计 first-pass 可播放率和教学质量分布。
