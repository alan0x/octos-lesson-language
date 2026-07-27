# Lesson DSL 一致性与测试计划

状态：Exploration Draft
日期：2026-07-27

本仓库首先验证 Authoring Profile 能否稳定规范化为 Canonical Profile，再验证 Canonical Profile 的 Reducer 和 Runtime 一致性。

## 1. 测试目标

本计划证明三件彼此独立的事：

1. DSL 语言定义一致且可验证；
2. Runtime 正确执行 DSL；
3. Skill 和模型能够生成教学质量足够的 DSL。

第三项失败不能推导出 DSL 失败，前两项通过也不能推导出老师讲得正确。

## 2. 独立测试包

建议建立不依赖 React、浏览器、模型和 Octos 后端的核心包：

```text
lesson-dsl/
├── schema/
├── src/
│   ├── types.ts
│   ├── parse.ts
│   ├── validate.ts
│   ├── reduce.ts
│   ├── normalize.ts
│   └── errors.ts
├── fixtures/
│   ├── valid/
│   ├── invalid/
│   ├── expected-state/
│   └── expected-trace/
└── tests/
```

核心 API 形态：

```ts
parseLessonEvent(input: unknown): ParseResult
validateLessonEvent(event, context): ValidationResult
applyLessonEvent(state, event): ApplyResult
reduceLesson(events, initialState): SemanticBoardState
normalizeBoardState(state): CanonicalBoardState
```

## 3. Reference Validator

Validator 分层运行并保留稳定错误码：

### 3.1 结构层

- JSON 是否完整；
- 公共字段是否存在；
- 枚举和值域是否有效；
- 数组和文本是否超过上限；
- `op` 对应的条件字段是否完整。

### 3.2 事件流层

- 第一个事件是否为 open；
- sequence 是否连续；
- lesson ID 是否一致；
- close 后是否仍有事件；
- 重复事件是否完全等价。

### 3.3 语义层

- ID 是否重复；
- 节点和 fragment 引用是否存在；
- placement anchor 是否存在；
- group 是否循环；
- revise 是否指向已有节点；
- 资源是否授权；
- Board revision 是否匹配。

### 3.4 能力层

- Runtime 是否支持 DSL version；
- 是否支持所有核心 action 和 node kind；
- 是否满足所需资源能力。

## 4. Reference Reducer

Reference Reducer 只计算语义最终状态，不渲染像素，不播放 TTS。

输入：

```text
InitialSemanticBoardState + ordered Lesson Events
```

输出至少包含：

```json
{
  "board_id": "board-1",
  "revision": 3,
  "nodes": [],
  "connections": [],
  "groups": [],
  "focus": [],
  "applied_lessons": [],
  "applied_actions": []
}
```

规范化输出规则：

- map 按 ID 排序；
- 不包含时间戳和随机值；
- 不包含像素坐标和动画状态；
- 数值使用稳定序列化；
- transient 的 teacher expression 不进入最终 BoardState；
- revision 每成功应用一个 Step 增加 1。

## 5. Fixture 分类

### 5.1 Valid fixtures

至少包括：

| 编号 | 场景 | 主要能力 |
|---|---|---|
| V-001 | 二次函数配方 | math、fragment、plot、connect、group |
| V-002 | 几何辅助线 | image、shape、diagram、uncertainty |
| V-003 | 英语句子结构 | text fragment、group、connect |
| V-004 | 光合作用 | diagram、flow、summary |
| V-005 | 同板追问 | base revision、旧节点引用、追加 Lesson |
| V-006 | 无 narration 的焦点移动 | board.focus |
| V-007 | 无 TTS 执行 | 相同语义结果 |

### 5.2 Invalid fixtures

每个稳定错误码至少有一个独立 fixture：

| 编号 | 错误 |
|---|---|
| I-001 | 非法 JSON |
| I-002 | 不支持的 version |
| I-003 | sequence 跳跃 |
| I-004 | lesson ID 改变 |
| I-005 | 重复 node ID |
| I-006 | 引用不存在节点 |
| I-007 | 引用不存在 fragment |
| I-008 | revise 不存在节点 |
| I-009 | placement 缺少 anchor |
| I-010 | group 循环 |
| I-011 | close 后继续 step |
| I-012 | 未授权 asset ID |
| I-013 | 超过节点或文本上限 |
| I-014 | 未知核心 op |
| I-015 | action payload 与 op 不匹配 |

### 5.3 Recovery fixtures

| 编号 | 输入情况 | 预期行为 |
|---|---|---|
| R-001 | 流停在半个 JSON | 不应用该事件 |
| R-002 | Step 2 重复到达 | 幂等，不重复创建 |
| R-003 | Step 3 先于 Step 2 | 缓冲或明确 sequence error，不越过执行 |
| R-004 | 播放中刷新 | 从 checkpoint 恢复，不重复语义动作 |
| R-005 | Snapshot 丢失 | 从 DSL 日志重建相同 BoardState |
| R-006 | Step 4 无效 | Step 1–3 保持，Lesson interrupted |
| R-007 | TTS 失败 | 显示 narration 并继续或明确暂停，不转聊天 |

## 6. 测试层级

### 6.1 单元测试

- 每个 op 的 payload 规则；
- 每种 placement；
- ID 注册与引用；
- revision 增加；
- normalize 稳定性；
- error path 精确性。

### 6.2 Conformance 测试

任何 Runtime 使用相同 fixtures，并输出 canonical state 和 playback trace。结果必须与基准一致。

### 6.3 属性测试

核心属性：

- 相同事件重放两次不重复改变正式状态；
- 任意 valid 前缀都产生合法中间状态；
- 在任意 Step 边界中断都可恢复；
- Playback Projection 的重放不改变 Committed Projection；
- normalize(normalize(x)) 等于 normalize(x)；
- Snapshot 后继续和从完整日志重放得到相同状态；
- 任意未知核心 op 都不能被静默接受。

### 6.4 Fuzz 测试

针对 JSON 解析、深层嵌套、巨大数组、循环 group、恶意 LaTeX、受限 markdown 和数学表达式解析器进行 fuzz 或随机生成测试。

### 6.5 Playback Trace 测试

Runtime 在测试模式输出：

```text
lesson.opened
step.started
beat.started
narration.started
action.started
board.node.created
action.completed
narration.completed
beat.completed
step.completed
lesson.completed
```

测试只断言语义顺序和目标 ID，不断言真实毫秒时间。

### 6.6 视觉回归

对五个标准场景选择关键帧：

- Lesson 开始；
- 中间推导；
- 图示形成；
- Lesson 完成；
- 追问追加；
- 缩小后的全景；
- 刷新恢复。

视觉回归验证布局冲突、遮挡、数学渲染、镜头焦点和知识结构，不替代语义测试。

### 6.7 E2E

E2E 分成两套：

1. 固定 DSL E2E：不调用模型，验证产品 Runtime；
2. 模型 E2E：调用目标模型，验证 Skill、生成适配和教学质量。

固定 DSL E2E 必须稳定；模型 E2E 可以统计概率指标，但不能掩盖产品 Runtime 故障。

## 7. 模型生成评测

模型评测输入固定的：

- Tutor Context；
- Learner Context；
- Session Context；
- 学生请求；
- OLL 模型生成 Schema；
- Skill 版本和模型版本。

指标分组：

### 协议指标

- 完整事件率；
- Schema 通过率；
- 语义 Validator 通过率；
- sequence 正确率；
- 旧节点引用正确率；
- 未支持动作率。

### 教学指标

- 学科内容正确性；
- 请求覆盖完整性；
- 推导是否渐进；
- 讲述与板书一致性；
- 是否中途等待学生；
- 是否使用适当图示；
- 是否根据 Learner Context 做了有依据的适配；
- 是否产生未经证据支持的学生判断。

每次报告必须同时标出模型、供应商、参数、Skill commit 和 DSL version。

## 8. 建议的开发命令

最终工具应支持等价能力：

```bash
npm test
npm run check:examples
npm run generate:goldens
```

`check:examples` 对 manifest 中的每堂课程执行 Authoring validation、确定性 normalization、Canonical event 对比和 Semantic BoardState golden 对比。`generate:goldens` 只用于明确接受语言变化后更新基准，不能代替人工 diff 审查。

## 9. CI 门禁

### DSL 核心包

- 类型检查；
- Schema 和语义单测；
- valid/invalid fixtures；
- expected-state golden；
- 属性测试；
- 打包后 API smoke test。

### 前端 Runtime

- DSL conformance suite；
- playback trace；
- 组件单测；
- 固定 DSL E2E；
- 关键视觉回归。

### Skill

- prompt 结构测试；
- schema 引用版本测试；
- 离线 fixture 对照；
- 目标模型抽样评测，不作为每次无网络 CI 的硬依赖。

## 10. 需求追踪

测试用例必须标注需求 ID，例如：

```ts
it("OLL-INC-007: duplicated step is idempotent", () => {})
```

发布前生成追踪表：

| Requirement | Spec section | Test IDs | Status |
|---|---|---|---|
| OLL-INC-007 | 规范 §6.1 | R-002, property-idempotency | required |
| OLL-DET-003 | 规范 §16 | R-005 | required |
| OLL-CTX-003 | 教师与学习者上下文 §7 | context-no-direct-write | required |

任何 MUST 没有测试或明确人工验收方式时，v0.1 不得冻结。

## 11. DSL v0.1 Definition of Done

- [ ] 规范完成产品评审；
- [ ] Schema 与规范没有已知冲突；
- [ ] Reference Validator 完成；
- [ ] Reference Reducer 完成；
- [ ] 五个 valid 标准课程完成；
- [ ] 所有稳定错误码有 invalid fixture；
- [ ] recovery fixtures 全部通过；
- [ ] Runtime 通过 conformance suite；
- [ ] 至少一次固定 DSL 真实浏览器 E2E；
- [ ] 至少一个目标模型完成生成评测；
- [ ] 规范、Schema、包和 fixtures 使用相同版本发布。
