# 学生讲课样例 V1：发现

日期：2026-10-31。状态：探针，结论已由决定记录 0005–0008 实现（见文末）。产品计划见 `octos-learn/docs/LEARNER_TEACHING_MODE_PLAN.md`。

## 目的

学生讲课模式中，孩子不写 OLL：宿主把孩子逐张卡片录制的操作确定性地翻译成一堂 OLL 课程。改 schema 之前，先手写两堂“宿主应当生成的”课程，回答三个问题：

1. “一张卡片 = 一个 Beat”是否成立；
2. 现有 v0.1 能表达到什么程度，缺什么；
3. 计划中列出的五个待确认点各自的答案。

## 样例

| 样例 | 内容 | 组件 |
|---|---|---|
| `examples/learner-taught-slope-v1/` | 八年级 Jordan：用两点求斜率，4 张卡片 | 手写、坐标网格与结构化点、整洁公式、函数图、箭头 |
| `examples/learner-taught-unit-circle-v1/` | 十年级 Riley：单位圆如何变成正弦波，4 张卡片 | 单位圆、θ 变量与拖动、联动函数图、“轮到你了”任务；无手写 |

每个样例包含：

- `recording.json`：宿主录制输入的示意（卡片、每次录制、带时间的操作、ASR 与修正文本、检查结果）。不是 OLL，不经 OLL 工具校验。
- `lesson.authoring.json`：在 **v0.1 内**能生成的课程。手写以冻结的笔迹快照作为 `image` 资源承载——这是基线，用来量出 v0.1 缺什么，**不是**建议的最终表达。
- `lesson.canonical.jsonl`、`expected-state.json`：由 `generate:goldens` 生成。
- 斜率样例另有 `lesson.proposed.json`：加入草案字段后的同一课程，用于列出 v0.1 schema 的拒绝点。

## 证据

- 两个基线课程通过 Authoring schema、语义校验、确定性规范化与 Reducer（`npm run check:examples`）。
- 真实 Chrome（1280 × 720）教学播放观察：
  - 斜率：4 个 Beat、16 个动作帧全部通过，零控制台警告/错误（`evals/teaching-playback/learner-slope-v1/`）；
  - 单位圆：4 个 Beat、13 个动作帧全部通过，零控制台警告/错误（`evals/teaching-playback/learner-unit-circle-v1/`）。
- `lesson.proposed.json` 在 v0.1 schema 下恰好得到 6 个错误，一一对应草案（见下文“schema 拒绝点”）。

### 稳定性说明

- 单位圆样例重复 5 次全部通过。
- 斜率样例重复 10 次通过 5 次。失败全部是同一帧：整洁公式刚写上白板时的 `G3_CONTENT_OVERFLOW`（动作帧 38），随后的 Beat 结束帧仍然通过。提交的报告取自一次通过的运行。
- 同一类间歇性数学卡片溢出也出现在现有 `quadratic-v2`（动作帧 8，4 次中 3 次），所以这是 Runtime 对新写入数学卡片的测量时序问题，不是本样例的课程问题。没有为绕开它改动样例。
- 另外：`quadratic-v2` 在未改动的 `main`（2b25c43）上也稳定失败（4 次中 4 次，Beat 16/45/136/165 的 `G3_FOCUS_TOO_SMALL`），与其 ACCEPTANCE.md 记录的通过结果不一致。这是既有回退，与本样例无关，需要单独排查。

## 发现

### 1. 卡片 = Beat：成立，但宿主生成的焦点必须检查可读性

每张卡片都是“一个认知变化 + 持久白板结果 + 明确结束焦点”，与 V2 样例的 Beat 纪律一致。

第一次播放斜率课程有两个 Beat 未通过 `G3_FOCUS_TOO_SMALL`：

| Beat | 原结束焦点 | 最小卡片宽度 | 修正 |
|---|---|---|---|
| 卡片 3 | 手写快照 + 整洁公式 | 165 px（需 ≥ 240） | 只聚焦整洁公式 → 417 px |
| 卡片 4 | 整洁公式 + 函数图（相距较远） | 76 px | 只聚焦函数图 → 240 px |

含义：计划里“根据最后触碰的内容自动生成焦点”过于简单。孩子的手写快照往往很小，多目标焦点会被相机缩小到不可读。宿主生成焦点时应优先选一个可读目标，并在提交前对课程跑同一套 G3 检查；不通过时调整焦点，而不是让孩子处理。

另外，卡片 3 第二次录制沿用了第一次写下的笔迹，只重录讲述和指点。录制模型应当是：笔迹属于卡片，讲述与指点属于某一次录制。

### 2. 中途插入组件时补充变量声明：可行

宿主在提交时掌握所有已插入组件，可以一次性写出 `lesson.variables`，并在节点创建时写出 `bindings`。约束：binding 必须在节点创建时声明，`revise` 不能新增 binding（SPEC 数值 binding 一节）。所以“先插入函数图，过一会儿再与 θ 关联”无法表达为后续动作。建议在插入对话框里就让孩子选择“与 θ 联动”，而不是事后关联。

### 3. 来回拖动：多个 `animate` 即可，不需要关键帧

Riley 的拖动 0 → 1.2 → 0.6 → π/2 写成同一 Beat 里三个连续 `animate`。浏览器 Runtime 按顺序执行：推进到下一操作前先完成当前变量动画（`packages/web-runtime/src/runtime.ts` 的 `advance`）。

代价是时长被量化为三档（1× 时 brief 1.8 s、normal 3.2 s、extended 5.4 s）：孩子原本 2.1 s + 0.8 s + 1.7 s = 4.6 s，回放为 3.2 + 1.8 + 3.2 = 8.2 s。孩子的声音本来就会被 TTS 重新合成，原始节奏不保留，可以接受。V1 不需要关键帧新能力。分段规则（在方向反转或停顿 ≥ 300 ms 处切分，按长度选档）写在 `recording.json` 中。

### 4. 3D 视角变化：v0.1 无法表达

`scene3d` 只有初始 `camera`；视角变化只存在于学生任务（`scene3d_view`）和 Runtime 保存的观看状态中，没有课程内的视角动作。孩子在卡片中旋转立方体展示某个面，无法被记录。因此 V1 样例没有 3D 卡片——不是遗漏，而是无法写出。

需要新草案 E：一个表达**教学意图**的视角动作，例如“转到能看到 `cube#front-face` 的方向”或预设视角（正视/俯视/等轴），而不是原始 yaw/pitch/zoom，以符合 OLL-VIEW-002（视野操作只表达意图，实际数值由 Runtime 决定）。

### 5. 整洁版本原位显示：v0.1 无法表达

`overlay` 关系存在，但不能满足：含 `inside`/`overlay` 节点的区域会整体跳过教学布局（`packages/web-runtime/src/layout.ts`），而且 `overlay` 不隐藏锚点节点，整洁公式会叠在手写上。基线改用 `below`。草案中暂用 `place.relation: "in_place_of"`；也可以改为笔迹节点上的显示标志，留给决定记录比较。

**2026-10-31 用户决定**：录课时不沿用“学生原稿不可修改、不提供隐藏/删除”的规则——这些规则是为 AI 老师制定的，录课的作者是孩子本人。因此原位显示不再需要“保留原稿并切换”的特殊语义，可以表达为学生讲课课程中由孩子发起的替换动作（先显示手写，再替换为整洁公式）。AI 仍不能擅自改动孩子的笔迹。

### 6. “轮到你了”：可表达，但只能在课后进行，且检查对象要孩子选

- 任务的 `availability` 只有 `after_lesson`，不能在它所在的卡片处暂停让观看者操作。V1 保持课后进行，也符合 OLL-INC-009；卡片 4 的讲述因此说“After the lesson…”。
- 演示值不能自动推出检查条件：θ ≈ 4.7124 可以表示“θ = 3π/2”“sin θ = −1”或“cos θ = 0”。录制界面需要让孩子从已绑定的读数中选择要检查的量（`recording.json` 中的 `your_turn.check_picked`）。

### 7. 笔迹：快照基线能显示和指点，但丢失三样东西

以冻结快照作为 `image` 承载时，显示、区域强调和指点都正常。丢失的是：

1. **笔画重现**：整张图一次出现，不能边讲边“写出来”；
2. **作者归属**：卡片标题显示的是 `role`（如 “derivation”），除 `alt` 外没有任何东西表明这是孩子的手写；
3. **区域来源**：`image` 区域必须预先登记在 Session Context 中，而孩子的指点目标本来就是笔迹选区。

存储上的事实：`InkDocumentRecord` 是一块白板一份文档，不是每张卡片一份。按卡片引用笔迹，应当引用冻结的选区快照（v4：SVG、范围、SHA-256），这一机制已经存在。

因此修订草案 A：`kind: "ink"` 引用**选区快照**而不是可编辑的笔迹文档，这样仍符合 OLL-ENV-007（原稿独立保存、通过稳定引用关联）。需要在决定记录里处理的规则冲突：AUTHORING.md §10 规定“学生笔迹不是 Authoring Profile 的节点类型”，该规则针对模型生成；学生讲课课程由宿主生成，需要明确例外。

### 8. “整理一下”的输出应是 `math` 节点，而不是 AI 笔迹

现有选区辅助手写（`board_writing`）产生的是 AI 笔迹路径。学生讲课需要的是可寻址的 `math` 节点：卡片 4 的箭头 `neat-fraction#result → line-plot#line` 只有在整洁公式带片段时才能成立。两者用途不同，学生讲课模式使用 `math` 节点。

## schema 拒绝点

`lesson.proposed.json`（去掉 `$comment` 后）在 v0.1 Authoring schema 下的全部错误：

| 位置 | 错误 | 对应草案 |
|---|---|---|
| `/lesson` | 不允许 `author` | C：作者与播放形象 |
| `/lesson/mode` | 只允许 `explain` | B：`learner_taught` 模式 |
| `/steps/0/beats/0/actions/0/kind` | 不允许 `ink` | A：笔迹节点 |
| `/steps/0/beats/2/actions/0/kind` | 不允许 `ink` | A：笔迹节点 |
| `/steps/0/beats/2/actions/3` | 不允许 `source` | D：`write` 的来源 |
| `/steps/0/beats/2/actions/3/place/relation` | 不允许 `in_place_of` | 原位显示（第 5 条） |

没有其他拒绝点：坐标网格与结构化点、函数图、箭头、变量、动画、任务都在 v0.1 内。

## 需要决定的事项

| 编号 | 事项 | 建议 |
|---|---|---|
| S1 | 是否据此写 OLL 决定记录 | 写 A（选区快照笔迹）、B、C、D、原位显示、E（3D 视角意图）六项；每项附本样例作为回归证据 |
| S2 | 原位显示的表达方式 | 已由用户决定方向：学生讲课课程允许孩子发起的替换/隐藏/擦除动作；决定记录中定义该动作，并限定为 `learner_taught` 模式、仅由孩子的操作产生 |
| S3 | “轮到你了”是否需要卡片内即时进行 | V1 不需要，保持课后 |

## 复现

```sh
npm run check:examples
npm run teaching:observe:learner-slope
npm run teaching:observe:learner-unit-circle
```


## 实现（2026-10-31）

用户批准决定记录 0005–0008 后实现，播放器执行版本升为 0.6.0：

| 决定 | Core | Web Runtime | 证据 |
|---|---|---|---|
| 0005 学生讲课课程 | `mode: learner_taught`、不透明作者；`explain` 不能带 learner 作者 | 无新渲染 | 三个 V2/新样例；`packages/core/test/learner-taught.test.ts` |
| 0006 笔迹 | `ink` 节点（快照 + 校验值 + 选区）、`annotates`、`replaces`、`hide`、以新快照 `revise`；仅限学生讲课课程；被隐藏卡片不能再引用 | 快照渲染与笔画重现（SVG 只保留绘图元素）、缺失快照显式失败、可见白板投影（替换占位、隐藏离开）、标注附着锚点 | `learner-taught-slope-v2`；`scripts/check-learner-ink-browser.mjs`；`visible-board.test.ts` |
| 0007 来源 | `write.source`，必须是本课笔迹的选区 | 无新渲染 | 斜率 V2 卡片 3 |
| 0008 3D 视角 | `view`（`show` 高亮部件或 `preset`） | 由意图计算相机；之后学生旋转优先，更晚的意图再生效；学生旋转记录播放位置 | `learner-taught-box-v1`；`learner-view-intent.test.ts` |

与批准文本的一处形式调整：替换用 `place.relation: "replaces"` 表达，而不是独立的 `replaces` 字段，因为 `write` 本就必须带 `place`；行为不变，决定记录 0006 已同步。

浏览器教学播放检查：新样例与全部原有正向样例在 1366 × 768 与 1920 × 1080 白板下全部通过。
