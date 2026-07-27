# Octos Lesson Language

Octos Lesson Language（OLL）是一种用于描述 AI 家庭教师课堂行为的渐进式 DSL。

它描述老师在无限白板、语音和虚拟教师组成的课堂中，按步骤说什么、写什么、画什么、强调什么以及如何引用已有内容。它不描述模型思维链，也不是聊天消息格式或 Canvas 绘图 API。

## 当前状态

OLL 处于 **Exploration Draft**。当前目标不是宣布 v0.1 已经成立，而是完成两个可证伪的实验：

1. 表达能力：手写 OLL 是否足以描述真实、渐进、可继续的跨学科课程；
2. 可生成性：目标大模型是否能稳定生成高质量的 OLL Authoring Profile。

在这两个实验通过前，不冻结 v0.1，不承诺兼容性。

## 两个 Profile

```text
Tutor + Learner + Session Context
                 ↓
          Skill + Model
                 ↓
       OLL Authoring Profile
                 ↓ deterministic normalization
       OLL Canonical Profile
                 ↓
      Frontend Learning Runtime
```

- Authoring Profile：模型友好的创作形式，使用局部别名和语义动作。
- Canonical Profile：Runtime 的执行形式，包含稳定 ID、事件顺序、revision 和幂等信息。

宿主生成机械字段；模型只负责课堂内容和教学语义。

## 仓库内容

```text
REQUIREMENTS.md                 语言需求
AUTHORING.md                    模型生成 Profile 规范草案
SPEC.md                         Canonical Profile 规范草案
CONFORMANCE.md                  一致性与测试计划
decisions/                      语言决策记录
schema/authoring/               模型生成 Schema
schema/canonical/               Runtime Schema
packages/core/                  TypeScript Schema/Validator/Normalizer/Reducer
packages/eval-runner/           可恢复的自动模型评测 CLI
packages/player-core/           DOM-free 播放状态机与 checkpoint 内核
examples/                       完整课程示例
fixtures/                       非法和恢复测试输入
evals/                          模型可生成性评测
```

## 独立运行

要求 Node.js 20 或更高版本：

```bash
npm install
npm test
npm run check:examples
```

运行 21 个未见跨学科案例、每题 5 次的正式评测：

```bash
npm run eval -- --suite evals/suites/unseen-v1.json --run-id unseen-v1-gpt-5.6-sol --repetitions 5 --concurrency 2 --resume
```

Runner 不修复模型输出。只有原始文本可直接解析为 JSON，并依次通过 JSON Schema、语义校验、确定性规范化和 Reducer，才记为 `first_pass_core_executable`。这个指标不表示浏览器已经真实播放。Mechanical coverage 只在 Core-executable 输出上评估，状态为 `passed`、`failed` 或 `not_evaluated`。每次调用的原始输出、Canonical JSONL、状态和失败阶段保存在 `evals/runs/<run-id>/`。

## 权威边界

- 本仓库拥有 OLL 规范、Schema、参考实现和 conformance fixtures。
- `learning-coach` Skill 使用已锁定版本的 Authoring Schema 教模型生成 OLL。
- `octos-web` 实现 Canonical Profile 的前端 Runtime。
- Octos 后端负责模型访问、传输、资源和通用持久化，不解释课堂动作。
- Octos Learn 产品目标和体验定义保存在 Obsidian 的 `learning_coach/learn-product-v2/`。

## 当前进展

表达能力实验已覆盖：

- 二次函数配方法：math fragment、plot、关系连接和总结分组；
- 几何图片与辅助线：受控 asset region、diagram 内部元素、几何 connection 和视觉不确定性；
- 英语定语从句：普通文本 fragment、主干提取、修饰关系和分层结构。

三份课程均具有 Authoring Lesson、Canonical Events、expected Semantic BoardState 和 TypeScript Core 测试。

几何实验已经实际改变语言：connection 现在是可强调目标；diagram 的 element、edge 和 region 是可寻址 fragment，内部引用必须验证并规范化。21 个未见 case 的 105 次生成实验、边界修订和 121 堂真实 Canonical Lesson 的 headless playback conformance 已完成。当前下一门是独立教学质量抽样；通过前不接入 `/learn`。
