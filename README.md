# Octos Lesson Language

Octos Lesson Language（OLL）是一种用于描述 AI 家庭教师课堂行为的渐进式 DSL。

它描述老师在无限白板、语音和虚拟教师组成的课堂中，按步骤说什么、写什么、画什么、强调什么以及如何引用已有内容。它不描述模型思维链，也不是聊天消息格式或 Canvas 绘图 API。

## 当前状态

OLL 处于 **v0.1 Release Candidate 1**。Authoring 与 Canonical 的已实现协议表面保持兼容，可继续参考前端 Runtime 集成；它仍不是稳定版，也尚未满足全部冻结门槛。

1. 表达能力：手写 OLL 是否足以描述真实、渐进、可继续的跨学科课程；
2. 可生成性：目标大模型是否能稳定生成高质量的 OLL Authoring Profile。

Core、headless playback、可生成性与教学质量已有大量证据，但 Phase 0/1 尚未正式退出。当前 MUST 证据和发布阻断项见 [TRACEABILITY.md](./TRACEABILITY.md) 与 [PHASE-0-1-EXIT.md](./PHASE-0-1-EXIT.md)。RC 阶段只接受兼容性修复；新增动作或改变语义必须有 decision record 和回归证据。

交互语义白板的实施范围、仓库责任、数据保存方式和四个贯穿验收场景见 [INTERACTIVE-WHITEBOARD-MVP.md](./INTERACTIVE-WHITEBOARD-MVP.md)。当前开发分支已经实现共享变量动画、互动任务、选区来源合同和可选 Ink Runtime，并加入可旋转、缩放和恢复视角的基础 3D 场景；它们仍是 RC 之后的开发切片，不表示已经发布。

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
TRACEABILITY.md                 MUST 需求到测试与缺口的追踪矩阵
PHASE-0-1-EXIT.md               Phase 0/1 退出审查
decisions/                      语言决策记录
schema/authoring/               模型生成 Schema
schema/canonical/               Runtime Schema
packages/core/                  TypeScript Schema/Validator/Normalizer/Reducer
packages/eval-runner/           可恢复的自动模型评测 CLI
packages/player-core/           DOM-free 播放状态机与 checkpoint 内核
packages/web-runtime/           可复用的浏览器播放、DOM/SVG 白板与测试门禁
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

然后访问 `http://127.0.0.1:4173`。Harness 直接读取 manifest 中的 Canonical JSONL，支持逐操作、逐 Beat、连续播放、变速、缩放/拖动画布，以及暂停后刷新恢复。它用于验证 OLL 是否真的能变成一堂渐进课程，不依赖 `/learn`，也不是生产 UI。Harness 本身只保留 fixture、控制和调试外壳，白板与浏览器播放能力来自同仓库的 `octos-lesson-language/web-runtime`。

运行真实 Chrome 教学播放观测：

```bash
npm run teaching:observe:geometry
npm run teaching:observe:quadratic
npm run teaching:observe:science
npm run teaching:observe:english
```

四个命令分别逐操作播放几何、二次函数、图片科学和英语文本 V2，在 51/45/37/47 个动作帧与各 11 个 Beat 边界测量焦点可见性、卡片宽度、正文等效字号、资源加载、fragment/region 命中、所有卡片类型的内容裁切、标签遮挡和 console 错误。报告写入 `evals/teaching-playback/` 对应目录。它不替代学科质量 judge 或学生盲测。

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

- 二次函数配方法 V2：把系数折半、完全平方、等式不变量、代数替换、常数合并与图像解释拆成 11 个可聚焦 Beat；
- 几何图片与辅助线：受控 asset region、diagram 内部元素、几何 connection 和视觉不确定性；
- 植物蒸腾作用 V2：真实受控图片、对照观察、证据与推断分层、机制模型和回到图片检验解释；
- 英语定语从句 V2：普通文本 fragment、主干提取、先行词连接、普通句还原、关系代词替换和双语语序重组；
- 学习者背景适配 V2：根据有来源的视觉偏好和工作记忆支持需求，用数轴和三个短步骤讲解负数加法，不写回学习者判断。

八份课程均具有 Authoring Lesson、Canonical Events、expected Semantic BoardState 和 TypeScript Core 测试；几何、二次函数和英语各保留一个 V1 负向样本，五个 V2 课程构成 Phase 0 人工评审集。V-005 同板追问的上一轮节点引用仍是冻结阻断项，不能由页面视觉拼接替代。

几何实验已经实际改变语言：connection 现在是可强调目标；diagram 的 element、edge 和 region 是可寻址 fragment，内部引用必须验证并规范化。21 个未见 case 的 105 次生成实验、边界修订和 121 堂真实 Canonical Lesson 的 headless playback conformance 已完成。

教学质量 v0.2 对 21 份确定性抽样课程实现 21/21 可评分并通过门禁；已知缺陷校准集实现 1 个干净对照通过、4 个缺陷样本全部拒绝。独立 playback harness 已完成第一版，并用真实 Chrome 自动验收 Canonical 事件的渐进呈现、布局、真实资源和恢复。四类视觉正向样板及三个 V1 负向探针已完成，结论见 `evals/teaching-playback/VISUAL-GATE-RESULT.md`。浏览器播放与白板代码现已提取为 `packages/web-runtime`，生产 `/learn` 已使用同一 Runtime 播放固定课程，并能向正在播放的课堂幂等追加已验证 Canonical Step。下一门是完成真实模型 Authoring artifact 的端到端生成验收；TTS 先采用 Beat 级粗粒度衔接，不要求毫秒同步。

几何辅助线 V2 已作为第一份教学可理解性垂直切片：11 个 Beat 使用现有 OLL v0.1 完成“读题 → 连接 AD → 三组边逐行出现 → SSS → 角平分线 → 三步推出垂线 → 总结路线”。Reference Runtime 已补齐 diagram fragment emphasis、焦点镜头和只按可见内容测量卡片尺寸；逐 Beat 验收记录在 `examples/geometry-auxiliary-line-v2/ACCEPTANCE.md`。

二次函数配方法 V2 是第二份正向切片：11 个 Beat 使用同一协议完成“读题 → 取系数一半 → 构造完全平方 → 补9减9 → 替换与化简 → 图像解释 → 总结路线”。真实 Chrome Observer 对 45 个动作帧和 11 个 Beat 全部通过；旧二次函数课在同一门禁下继续 expected-fail。验收记录在 `examples/quadratic-v2/ACCEPTANCE.md`。

植物蒸腾作用 V2 是第三份正向切片和第一份真实图片课：11 个 Beat 完成“直接观察 → 无叶对照 → 推断 → 根/茎/叶运输模型 → 凝结 → 回图检验 → 证据分层”。Runtime 通过宿主 resolver 加载 PNG 和 region bounds，未修改 OLL v0.1；真实 Chrome Observer 对 37 个动作帧和 11 个 Beat 全部通过。验收记录在 `examples/science-transpiration-v2/ACCEPTANCE.md`。

英语定语从句 V2 是第四份正向切片和第一份文本证据课：11 个 Beat 完成“明确核心问题 → 圈出从句 → 抽出主句 → 找先行词 → 还原普通句 → the book 替换为 that → 标注成分 → 重组含义”。最终白板按课题、主句、从句作用、句意和总结五个区域组织。真实 Chrome Observer 对 47 个动作帧和 11 个 Beat 全部通过；英语 V1 在同一门禁下 expected-fail。验收记录在 `examples/english-relative-clause-v2/ACCEPTANCE.md`。
