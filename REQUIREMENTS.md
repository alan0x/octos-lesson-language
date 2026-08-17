# Octos Lesson DSL 需求

状态：Exploration Draft
日期：2026-07-27
语言暂定名称：Octos Lesson Language（OLL）

来源：Octos Learn 产品设计 v2。本文进入独立 OLL 仓库后成为语言需求的权威副本；产品目标仍以 Obsidian 产品文档为准。

## 1. 目的

本文定义 Lesson DSL 必须解决的问题，不规定具体代码组织。后续 Schema、类型、Runtime 和 Skill 都必须能追溯到这里的需求编号。

关键词采用以下含义：

- MUST：v0.1 必须满足，否则不能发布；
- SHOULD：强烈建议满足，可以在有明确理由时延期；
- MAY：允许实现，但不构成兼容性要求。

## 2. 语言定位

OLL 是一种声明式、渐进式、可流式传输的课堂语言。它描述老师在课堂中的可观察动作，而不是模型的内部思维过程。

OLL 的执行环境包括：

- 一块持续存在的无限白板；
- 教师语音或可访问旁白；
- 一个可以说话、指向和表达状态的虚拟教师形象；
- 支持暂停、继续、回放和恢复的前端 Runtime。

OLL 不是：

- 通用 UI 布局语言；
- Canvas 绘图 API；
- 聊天消息格式；
- 学习者画像数据库；
- 模型思维链格式；
- 可以执行任意脚本的编程语言。

## 3. 表达能力需求

### 3.1 课程结构

- OLL-STR-001 MUST：一堂 Lesson 可以分成有序 Step。
- OLL-STR-002 MUST：一个 Step 可以分成有序 Beat。
- OLL-STR-003 MUST：每个 Step 和 Beat 具有稳定 ID。
- OLL-STR-004 MUST：Step 可以声明本步的教学目的，但不得要求暴露模型隐含推理。
- OLL-STR-005 MUST：Lesson 可以声明标题、目标、语言和课堂模式。
- OLL-STR-006 MUST：v0.1 支持线性课程；不要求条件分支和循环。

### 3.2 教师讲述与动作

- OLL-TCH-001 MUST：Beat 可以包含老师讲述文本。
- OLL-TCH-002 MUST：讲述文本可以直接用于 TTS，也可以作为无语音模式下的可访问文本。
- OLL-TCH-003 MUST：Beat 可以表达老师指向一个白板节点或节点片段。
- OLL-TCH-004 SHOULD：Beat 可以表达有限、语义化的教师表情。
- OLL-TCH-005 MUST：DSL 不包含语音供应商、音频编码和具体语速实现参数。

### 3.3 白板动作

- OLL-BRD-001 MUST：创建文字、数学公式、基础图形、图示、函数图、图片和分组。
- OLL-BRD-002 MUST：强调已有节点或可寻址片段。
- OLL-BRD-003 MUST：连接两个节点并表达关系标签或方向。
- OLL-BRD-004 MUST：显式修订已有节点，不能用重复 ID 隐式覆盖。
- OLL-BRD-005 MUST：将节点组织成概念组，以支持缩放后的结构视图。
- OLL-BRD-006 MUST：表达相对位置和语义布局意图。
- OLL-BRD-007 MUST NOT：要求模型输出绝对屏幕或画布坐标。
- OLL-BRD-008 MUST NOT：v0.1 不向模型提供清空白板或任意删除动作。
- OLL-BRD-009 MUST：内容默认追加到已有 Board，而不是为每一轮创建独立临时画布。
- OLL-BRD-010 SHOULD：公式和文本中的重要片段可以获得稳定 fragment ID，以便强调和连接。

### 3.4 课堂视野

- OLL-VIEW-001 MUST：表达聚焦节点、节点组或节点关系。
- OLL-VIEW-002 MUST：视野操作只表达教学意图，实际坐标、缩放值和动画由 Runtime 决定。
- OLL-VIEW-003 MUST：用户手动控制视野时，Runtime 可以暂停自动跟随而不改变 Lesson 语义。

### 3.5 资源

- OLL-AST-001 MUST：图片和外部资源通过受控资源 ID 引用。
- OLL-AST-002 MUST NOT：DSL 不嵌入本地绝对路径、任意网络 URL 或大体积二进制。
- OLL-AST-003 MUST：资源加载失败产生明确播放状态，不能静默省略。
- OLL-AST-004 SHOULD：图片识别或生成结果可以携带不确定性说明。

### 3.6 可变化的课程内容（交互白板 MVP）

- OLL-VAR-001 MUST：Lesson 可以声明数量有限的数值变量，并为每个变量提供稳定别名、初始值和允许范围。
- OLL-VAR-002 MUST：同一个变量可以同时驱动多个白板节点；例如一个 `theta` 同时决定单位圆上的点和正弦图像上的点。
- OLL-VAR-003 MUST：变量与白板数值字段之间的关系使用受限数学表达式描述，不能执行 JavaScript、访问网络、DOM、文件或宿主对象。
- OLL-VAR-004 MUST：相同变量值和相同合法表达式在 Core、Reference Reducer 和兼容 Runtime 中得到相同有限数值；错误必须显式报告，不能静默保留旧值。
- OLL-VAR-005 MUST：变量当前值属于可恢复的语义 BoardState。刷新或恢复后，相关视图必须从该值重新得到一致结果。
- OLL-VAR-006 MUST：Validator 拒绝未声明变量、未知绑定目标、重复绑定以及越界初始值。
- OLL-VAR-007 MUST：首个实现只允许表达式读取 Lesson 数值变量，不允许表达式读取其他绑定结果。以后若加入派生变量，必须先定义依赖图和环检测语义。
- OLL-VAR-008 SHOULD：变量可以携带供界面显示的标签和单位；单位是教学元数据，不触发隐式换算。

### 3.7 学生输入与增强（交互白板 MVP）

- OLL-INP-001 MUST：学生笔迹、手绘图形和键盘输入是学生拥有的原始内容；Runtime 和 OLL 动作不得原地改写它。
- OLL-INP-002 MUST：识别、纠错、函数作图和讲解以独立建议、批注或增强节点呈现，并保留其来源。
- OLL-INP-003 MUST：识别结果在学生确认前不是正式课程事实；低置信度结果必须允许用户修正。
- OLL-INP-004 MUST：学生框选内容后，宿主可以基于选区类型提供少量明确动作，例如“问小章鱼”“生成函数图像”“解释这一步”。
- OLL-INP-005 MUST：“问小章鱼”提交选区的稳定引用、必要上下文和用户问题；返回结果进入新的 OLL Lesson/Step，不覆盖选中内容。
- OLL-INP-006 MUST：学生笔迹以独立 SVG 资源保存，外层记录格式版本、精确编辑器版本、递增文档版本和校验值；损坏资源必须显式失败。
- OLL-INP-007 MUST：选区来源使用 Octos 生成的稳定编号、选区 SVG、白板范围和当时的文档版本，不得把编辑器内部组件编号当作长期引用。
- OLL-INP-008 MUST：普通课程首屏不下载或初始化笔迹编辑器；宿主只在学生进入书写能力时按需加载。

### 3.8 动画、任务与三维（交互白板 MVP）

- OLL-MOT-001 MUST：教学动画描述变量、范围、关系和教学意图，具体帧率、插值与动画时长由 Runtime 决定。
- OLL-MOT-002 MUST：拖动控制和自动动画修改同一个课程变量，不能为每个视图维护独立副本。
- OLL-MOT-003 MUST：动画中途暂停或刷新时，Runtime 保存当前变量值和剩余动画；恢复后不得跳回起点。
- OLL-MOT-004 MUST：用户拖动变量控件时自动动画停止，用户选择的值成为当前可恢复状态。
- OLL-MOT-005 MUST：开启降低动态效果时，Runtime 不播放连续插值，但仍应用动画的语义终值并保留手动控件。
- OLL-TSK-001 MUST：互动任务显式声明学生可操作对象、目标、检查条件和反馈，不依赖任意脚本判断答案。
- OLL-3D-001 SHOULD：基础三维节点可以表达受限对象、坐标轴、相机初始意图和允许的旋转/缩放交互；设备渲染细节不属于 OLL 语义。
- OLL-3D-002 MUST：三维节点与二维节点一样接受验证、资源限制和能力协商；不支持时必须产生明确降级状态。

## 4. 渐进生成与播放需求

- OLL-INC-001 MUST：模型可以按 Step 增量生成 Lesson。
- OLL-INC-002 MUST：Runtime 收到一个完整、合法 Step 后即可开始播放，无需等待 Lesson 全部生成。
- OLL-INC-003 MUST：半个 Step 不得进入正式执行状态。
- OLL-INC-004 MUST：后续 Step 失败不得撤销已经完成的 Step。
- OLL-INC-005 MUST：每个 Lesson 具有明确的 open 和 close 边界。
- OLL-INC-006 MUST：流中断时 Lesson 状态可表示为 interrupted，并从最后一个完整 Step 继续。
- OLL-INC-007 MUST：重复投递同一 Step 不得重复创建白板内容。
- OLL-INC-008 MUST：乱序 Step 不能越过缺失 Step 被直接执行。
- OLL-INC-009 MUST：一轮默认课程中不得包含等待学生回答的控制动作。

## 5. 时间与同步需求

- OLL-TIME-001 MUST：讲述和白板动作属于同一 Beat 时间线。
- OLL-TIME-002 MUST：v0.1 使用 `before_speech`、`during_speech`、`after_speech` 等语义阶段。
- OLL-TIME-003 MUST NOT：要求模型预测毫秒级 TTS 时长。
- OLL-TIME-004 MUST：无 TTS 时仍可执行相同 Lesson，并保持相同最终白板语义。
- OLL-TIME-005 SHOULD：降低动态效果时可以缩短或跳过动画，但不能跳过教学内容。

## 6. 确定性与恢复需求

- OLL-DET-001 MUST：给定相同初始语义 BoardState 和相同合法 OLL，Reference Reducer 必须产生相同最终语义状态。
- OLL-DET-002 MUST：视觉像素和动画时长可以因设备不同而不同，不属于语义确定性范围。
- OLL-DET-003 MUST：DSL 日志足以重建 Board 的语义状态。
- OLL-DET-004 SHOULD：实现可以保存 Board Snapshot 加速恢复，但 Snapshot 不是唯一事实来源。
- OLL-DET-005 MUST：暂停点至少可以定位到 Lesson、Step、Beat 和阶段。
- OLL-DET-006 MUST：回放不能重复改变正式语义状态。

## 7. 版本和兼容性需求

- OLL-VER-001 MUST：每个 Lesson 记录包含语言名称和版本。
- OLL-VER-002 MUST：破坏性语义变化升级主版本或明确的不兼容版本。
- OLL-VER-003 MUST：未知核心动作不能被静默忽略。
- OLL-VER-004 SHOULD：扩展字段使用命名空间，避免污染核心语言。
- OLL-VER-005 MUST：规范、Schema、类型包、Reference Reducer 和 conformance fixtures 以同一版本发布。
- OLL-VER-006 MUST：模型生成 Schema 可以是规范 Schema 的兼容子集，但不能改变规范语义。

## 8. 独立可测试需求

- OLL-TST-001 MUST：DSL validator 不依赖模型、浏览器和 Octos 后端。
- OLL-TST-002 MUST：Reference Reducer 不依赖网络、TTS 和 DOM。
- OLL-TST-003 MUST：提供 valid、invalid 和 expected-state fixtures。
- OLL-TST-004 MUST：每个规范错误有稳定错误码和可定位路径。
- OLL-TST-005 MUST：任何声称兼容 OLL v0.1 的 Runtime 都必须运行同一 conformance suite。
- OLL-TST-006 MUST：模型生成质量评测与 DSL 语言一致性测试分开。
- OLL-TST-007 SHOULD：解析器和 Reducer 具有属性测试或 fuzz 测试。
- OLL-TST-008 SHOULD：前端 Runtime 为标准课程提供关键帧视觉回归测试。

## 9. 安全与资源限制

- OLL-SAFE-001 MUST：DSL 不能执行 JavaScript、HTML 脚本或任意系统命令。
- OLL-SAFE-002 MUST：富文本使用受限标记集并经过转义或清理。
- OLL-SAFE-003 MUST：Runtime 对 Lesson、Step、Beat、节点、文本和资源数量设置明确上限。
- OLL-SAFE-004 MUST：资源 ID 只能解析到当前用户和 session 可访问的资源。
- OLL-SAFE-005 MUST：Schema 合法不等于学科内容正确；产品和日志不得混淆两者。

## 10. 教师人格与学习者背景

- OLL-CTX-001 MUST：Tutor Context、Learner Context 和 Session Context 是生成 Lesson 的显式输入合同。
- OLL-CTX-002 MUST：Lesson 可以声明本轮采用的教学策略和它引用的背景记录。
- OLL-CTX-003 MUST NOT：课堂动作 DSL 不直接修改长期 Learner Context。
- OLL-CTX-004 MUST：模型提出的新学习者认识进入独立 suggestion 通道，并携带证据和置信度。
- OLL-CTX-005 MUST：讲授某知识点不得被记录为学生掌握该知识点。
- OLL-CTX-006 MUST：用户没有授权时，不向模型提供跨 session 长期学习信息。

## 11. 运行环境边界

- OLL-ENV-001 MUST：核心 DSL 不依赖 React、具体状态库或 Canvas 库。
- OLL-ENV-002 MUST：前端 Runtime 是规范执行者，负责播放、语义布局和语义 BoardState。
- OLL-ENV-003 MUST：后端可以传输和保存 OLL，但不需要成为课堂动作解释器。
- OLL-ENV-004 MUST：Skill 负责教授模型如何生成 OLL，不负责文件投递、白板布局和播放。
- OLL-ENV-005 MUST：普通聊天回复不能作为 `/learn` 的自动 fallback 课程。
- OLL-ENV-006 MUST：OLL 仓库拥有 Core、Reference Reducer 和可复用 Runtime；`octos-web` 只负责产品宿主、会话接入和界面组合，不维护另一套 OLL 解释器。
- OLL-ENV-007 MUST：学生原始笔迹使用独立持久化资源保存；Canonical OLL 日志保存课程动作，二者通过稳定引用关联，不混成一个可被 Lesson 覆盖的文档。
- OLL-ENV-008 MAY：浏览器笔迹能力由 OLL 仓库中的可选适配包提供并按需加载；具体绘图库不是 OLL 语言规范的一部分。
- OLL-ENV-009 MUST：MVP 不建立通用插件市场或允许课程加载任意第三方代码。复杂学科组件在后续阶段通过受控、版本化、宿主批准的能力注册表进入 Runtime。

## 12. v0.1 发布门槛

OLL v0.1 只有同时满足以下条件才能冻结：

1. 五个标准场景都有手写合法 DSL；
2. Reference Validator 和 Reducer 实现完成；
3. valid/invalid/expected-state fixtures 进入 CI；
4. 最小前端 Runtime 能播放全部标准场景；
5. 中断、重复、乱序和恢复测试通过；
6. 至少一个目标模型能在 Skill 引导下生成可播放 DSL；
7. DSL 测试结果与模型教学质量评测分开呈现；
8. 规范中没有实现者必须猜测的核心语义。
