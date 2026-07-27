# Octos Lesson Language

Octos Lesson Language（OLL）是一种用于描述 AI 家庭教师课堂行为的渐进式 DSL。

它描述老师在无限白板、语音和虚拟教师组成的课堂中，按步骤说什么、写什么、画什么、强调什么以及如何引用已有内容。它不描述模型思维链，也不是聊天消息格式或 Canvas 绘图 API。

## 当前状态

OLL 处于 **v0.1 Release Candidate 1**。Authoring 与 Canonical 协议表面已冻结，可进入参考前端 Runtime 集成；它仍不是稳定版，也不代表儿童产品已经完成验收。

1. 表达能力：手写 OLL 是否足以描述真实、渐进、可继续的跨学科课程；
2. 可生成性：目标大模型是否能稳定生成高质量的 OLL Authoring Profile。

表达、可生成、headless playback 与教学质量门已经完成。RC 阶段只接受兼容性修复；新增动作或改变语义必须有 decision record 和回归证据。

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
packages/quality-runner/        版本化教学质量 judge、宿主门禁与审计产物
apps/playback-harness/          独立浏览器播放实验室（DOM/SVG 无限白板）
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

启动独立浏览器 playback harness：

```bash
npm run harness:dev
```

然后访问 `http://127.0.0.1:4173`。Harness 直接读取三份 Canonical JSONL，支持逐操作、逐 Beat、连续播放、变速、缩放/拖动画布，以及暂停后刷新恢复。它用于验证 OLL 是否真的能变成一堂渐进课程，不依赖 `/learn`，也不是生产 UI。

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

几何实验已经实际改变语言：connection 现在是可强调目标；diagram 的 element、edge 和 region 是可寻址 fragment，内部引用必须验证并规范化。21 个未见 case 的 105 次生成实验、边界修订和 121 堂真实 Canonical Lesson 的 headless playback conformance 已完成。

教学质量 v0.2 对 21 份确定性抽样课程实现 21/21 可评分并通过门禁；已知缺陷校准集实现 1 个干净对照通过、4 个缺陷样本全部拒绝。独立 playback harness 已完成第一版，开始验证 Canonical 事件在真实浏览器中的渐进呈现、布局与恢复。RC 决策、限制和下一门见 `RELEASE-CANDIDATE.md`；在视觉与语音门通过前不直接绑定生产 `/learn`。
