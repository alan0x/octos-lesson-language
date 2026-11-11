# Octos Lesson Language v0.1 规范

状态：Exploration Draft，不可视为冻结标准
日期：2026-07-27
标识：`octos.lesson`
版本：`0.1`

## 1. 范围

本规范定义 OLL v0.1 的规范数据模型、事件顺序、动作语义、错误行为和确定性边界。

v0.1 只支持线性、渐进式课程。它不包含条件分支、循环、等待学生回答、任意脚本和模型控制的绝对布局。

### 1.1 两个 Profile

OLL v0.1 实验阶段包含两个可互相转换的 Profile：

- Authoring Profile：面向大模型，使用简短局部别名和教学语义动作，避免要求模型生成 revision、全局 ID 和幂等键；
- Canonical Profile：面向 Runtime，包含完整事件 envelope、稳定 ID、sequence、revision 基线和规范动作。

模型输出 Authoring Profile；Normalizer 在确定性宿主上下文中生成 Canonical Profile；前端 Runtime 只执行 Canonical Profile。两者属于同一 OLL 的不同规范化阶段，不是两套互不兼容的协议。

本文第 4 节之后定义的 Lesson Event 是 Canonical Profile。Authoring Profile 的实验 Schema 位于 `schema/authoring/`，在三类完整课程验证前不冻结。

## 2. 规范层次

OLL 有三种相关但不同的表示：

1. 规范数据模型：本文件定义的 Lesson Event 和语义；
2. 存储表示：UTF-8 JSON Lines，每行一个完整 Lesson Event；
3. 传输表示：WebSocket、HTTP 流或其他通道中的一个完整事件对象。

传输方式不是语言语义的一部分。实现不得依赖“恰好按网络 chunk 切成一行”。

## 3. 标识符

所有标识符必须：

- 是非空字符串；
- 在所属作用域内唯一；
- 长度不超过 128 个 Unicode code point；
- 推荐使用 `[A-Za-z0-9._:-]`；
- 不能依赖显示文本生成引用。

作用域：

| ID | 作用域 |
|---|---|
| `lesson_id` | Learning Session |
| `step.id` | Lesson |
| `beat.id` | Step |
| `action_id` | Lesson |
| `node.id` | Board |
| `fragment.id` | Node |
| `group.id` | Board |

## 4. Lesson Event 公共字段

每个事件具有以下字段：

```json
{
  "dsl": "octos.lesson",
  "version": "0.1",
  "event": "lesson.open",
  "lesson_id": "lesson-quadratic-001",
  "sequence": 0
}
```

| 字段 | 类型 | 规则 |
|---|---|---|
| `dsl` | string | 必须为 `octos.lesson` |
| `version` | string | v0.1 必须为 `0.1` |
| `event` | string | `lesson.open`、`lesson.step` 或 `lesson.close` |
| `lesson_id` | string | 当前 Lesson 的稳定 ID |
| `sequence` | integer | 从 0 开始严格递增 |

所有事件必须是完整 JSON 对象。解析器不得执行半个事件。

## 5. `lesson.open`

`lesson.open` 必须是 sequence 0，并且是 Lesson 的第一个事件。

```json
{
  "dsl": "octos.lesson",
  "version": "0.1",
  "event": "lesson.open",
  "lesson_id": "lesson-quadratic-001",
  "sequence": 0,
  "board": {
    "board_id": "board-session-001",
    "base_revision": 12,
    "region_intent": "continue_topic"
  },
  "lesson": {
    "mode": "explain",
    "language": "zh-CN",
    "title": "用配方法理解二次函数",
    "goals": [
      "把一般式改写为顶点式",
      "连接顶点式与图像平移"
    ]
  },
  "adaptation": {
    "strategy": [
      "先使用图像直觉",
      "显式保留每次常数项变化"
    ],
    "context_refs": [
      "learner.strengths:function-graph",
      "learner.support-needs:constant-term"
    ]
  }
}
```

### 5.1 `board`

| 字段 | 必填 | 含义 |
|---|---|---|
| `board_id` | 是 | 目标 Board |
| `base_revision` | 是 | Lesson 开始时的语义 Board revision |
| `region_intent` | 是 | `new_topic`、`continue_topic` 或 `extend_near_anchor` |
| `anchor` | 条件必填 | `extend_near_anchor` 时的已有节点或组 ID |

Runtime 在打开 Lesson 时检查 Board 与 revision。冲突时不得猜测合并；由宿主选择重新生成上下文或显式重基。

### 5.2 `lesson`

v0.1 的 `mode` 固定为 `explain`。它可以在讲解结束后附带有限的学生操作任务；完整的练习课、复盘课和学科模拟仍须通过版本或能力协商加入。

### 5.3 字段所有权

`lesson_id`、`board_id` 和 `base_revision` 由宿主提供给生成过程，不能由模型自由选择目标。生成适配器必须核对这些值与请求上下文一致。

### 5.4 `lesson.variables`

Lesson 可以声明供多个白板节点共同读取的数值变量：

```json
"variables": [
  {"as":"theta","initial":0,"min":0,"max":6.283185307179586,"label":"旋转角 θ","unit":"rad"}
]
```

- `as` 在 Lesson 变量作用域内唯一，必须匹配 `^[a-z][a-z0-9_]{0,63}$`，且不能占用数学常量或函数名；
- `initial`、`min`、`max` 必须是有限数值，满足 `min < max` 和 `min <= initial <= max`；
- `label`、`unit` 是可选显示元数据，不能触发隐式单位换算；
- `lesson.open` 初始化 Semantic BoardState 中的变量当前值；Snapshot 必须保留该值。
- 可选 `control: {"kind":"slider","step":0.01}` 允许 Web Runtime 显示学生可拖动滑杆；`step` 必须为正数且不大于变量范围。
- 可选 `wrap: true`（0.7）表示 `min` 与 `max` 是同一个位置，例如一整圈的角度。取值仍在 `[min, max]` 内；`lesson.variable.animate` 走较短的一边，必要时从 `max` 跨到 `min`。录制拖动的宿主应把超过半圈的移动拆成几段，让回放沿原方向转。

当前版本没有派生变量。表达式只能读取 Lesson 变量，因此不存在 binding 之间的执行顺序或依赖环。

### 5.5 `lesson.tasks`

讲解课可以声明一组讲完后依次开放的短操作任务。任务不包含任意脚本，只能观察 Runtime 已记录的学生变量操作：

```json
"tasks": [{
  "as": "reach-sine-maximum",
  "prompt": "把圆周点拖到 sin θ = 1",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{
    "kind": "variable_change",
    "variable": "theta",
    "controls": ["slider", "geometry_point"]
  }],
  "completion": {
    "kind": "expression_target",
    "expression": "sin(theta)",
    "value": 1,
    "tolerance": 0.01
  },
  "hints": ["观察圆周点的纵坐标。"],
  "hint_after_attempts": 2,
  "success_message": "正确，正弦值已经达到最大值。"
}]
```

- `variable` 必须是本 Lesson 已声明的变量，`controls` 也必须真实存在；声明 `geometry_point` 时，课程中必须有对应的 `angle_control` 点；
- `completion.expression` 使用同一套受限数学表达式，不允许 JavaScript。它只能读取学生获准修改的变量，初始状态不能已经满足目标，单变量任务还必须在声明范围内存在可达到的结果；
- Runtime 只在一次学生操作提交后判定，不把拖动过程中的连续位置更新当成多次尝试；
- 讲解播放期间的探索不计入任务。Lesson 完成后只开放第一个未完成任务，完成后才开放下一个；
- 提示、尝试次数和完成状态独立于播放进度保存，刷新后恢复。重放课程不会伪造或删除学生任务记录。

填数任务（`numeric_answer`，player 0.5.0）让学生输入一个数作答，用于没有可操作画面、但答案是确定数值的练习：

```json
"tasks": [{
  "as": "diameter",
  "anchor": "circle-card",
  "prompt": "半径为 3 cm 的圆，直径是多少？",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "answer_entry"}],
  "completion": {"kind": "numeric_answer", "answer": "6", "unit": "cm"},
  "hints": ["直径是半径的两倍。"]
}]
```

- `anchor` 必须是本课写出的板书卡片，规范化后变成该卡片的 Canonical 节点 ID；只有填数任务带 `anchor`；
- `answer` 按学生能输入的写法给出：整数、小数、分数或带分数（如 `-12`、`0.75`、`3/4`、`2 3/4`）。学生输入同样四种写法，全角数字和符号按半角读取，千分位逗号可写可不写；
- 未写 `tolerance` 时按值精确比较，`6/8`、`0.75` 与 `3/4` 相等，`0.333` 不等于 `1/3`；写了 `tolerance` 时按绝对误差判定；
- `form: "simplest_fraction"` 时还要求写成整数或最简分数（带分数的分数部分也须最简），数值对但形式不对算一次未达标；`answer` 本身必须满足该形式；
- `unit` 只显示在输入框后，不参与判定；
- 无法读成数的输入不算一次尝试。

### 5.6 学生笔迹资源不属于 OLL

学生原稿不放进 `lesson.open`、Canonical Event 或 Semantic BoardState。浏览器宿主把它作为独立资源保存，最低记录如下：

```json
{
  "format": "oll.student-ink.svg",
  "format_version": 1,
  "editor": {"name": "js-draw", "version": "1.33.0"},
  "document_id": "session-123:student-ink",
  "document_version": 4,
  "checksum": {"algorithm": "sha-256", "value": "..."},
  "updated_at": "2026-08-12T12:00:00.000Z",
  "svg": "<svg>...</svg>"
}
```

手写中文、英文、公式和草图使用同一种 SVG 文档。识别结果不是这个资源的一部分。选区快照另存 `source_id`、选区 SVG、白板范围和当时的 `document_version`。宿主可以在本地快照中保存组成选区的 `js-draw` 组件编号，但这些编号只能用来判断原稿是否已被擦除，以便清理依附于原稿的辅助内容；它们不得发送给模型，不得充当原稿内容、教学语义或跨系统引用。OLL 动作没有修改或删除学生笔迹的权限。

### 5.6 同 Editor 的 AI 辅助笔迹

受控 Ink Runtime 可追加 AI 字体轮廓，不赋予 Canonical OLL 改写学生原稿的权限。组件来源为 student/ai，复制、移动、擦除及保存恢复保留来源；复制或擦除生成的新组件使用新持久 ID。AI 结果不依赖原选区的存续。

含 AI 的选区快照 v5 将逐组件来源纳入完整性校验，旧 v1–v4 规则不变。AI 笔迹文档 v2 在同一 SVG 保存消费身份与组件映射，undo/擦除后仍保留消费身份，防止刷新补字。只含学生笔迹的文档仍为 v1。旧客户端不能写入 v2；启用前需部署支持 v2/v5 的客户端，回滚保留兼容读取器。学习证据不能把混合选区整体归给学生。

## 6. `lesson.step`

一个 Step 是增量生成、验证和执行的原子单位。

```json
{
  "dsl": "octos.lesson",
  "version": "0.1",
  "event": "lesson.step",
  "lesson_id": "lesson-quadratic-001",
  "sequence": 1,
  "step": {
    "id": "present-problem",
    "purpose": "呈现原题并建立本轮目标",
    "beats": []
  }
}
```

### 6.1 Step 规则

- `purpose` 是可审计的教学目的，不是模型思维链；
- `beats` 至少包含一个 Beat；
- 一个事件包含整个 Step，不能把同一 Step 拆成多条增量 patch；
- Step 必须在完整结构和语义验证通过后才能进入 Runtime；
- Runtime 先原子追加 Step 并计算已提交 Semantic BoardState，再由 Playback Projection 按 Beat 逐步揭示内容；
- 已提交状态与播放可见状态必须分开，暂停或回放不得回滚或重复写入已提交状态；
- Runtime 对每个成功应用的 Step 将 Board revision 增加 1；
- 同一个 `lesson_id + sequence + step.id` 重复到达时按幂等事件处理。

## 7. Beat

Beat 是可感知的最小课堂节拍。

```json
{
  "id": "show-original",
  "narration": {
    "text": "我们先把原式写下来，再把它改造成能直接看出顶点的形式。"
  },
  "stage": {
    "before_speech": [],
    "during_speech": [],
    "after_speech": []
  }
}
```

### 7.1 `narration`

| 字段 | 必填 | 含义 |
|---|---|---|
| `text` | 否 | 可用于 TTS 和字幕的讲述文本 |
| `language` | 否 | 缺省继承 Lesson language |
| `delivery` | 否 | `neutral`、`patient`、`encouraging`、`careful` 或 `emphatic` |

Beat 可以没有 narration，例如只移动焦点；但 Beat 不能同时没有 narration 和动作。

### 7.2 `stage`

三个数组中的动作分别在讲述前、讲述期间和讲述后执行。`during_speech` 中多个动作按数组顺序开始，Runtime 可以根据实际语音时长分配动画。

如果 narration 为空，`during_speech` 按顺序执行，不产生人工等待。

## 8. Action 通用结构

```json
{
  "action_id": "action-write-original",
  "op": "board.create"
}
```

所有动作必须包含：

| 字段 | 类型 | 含义 |
|---|---|---|
| `action_id` | string | Lesson 内唯一的幂等动作 ID |
| `op` | string | 核心动作名称 |

为兼容部分模型供应商，模型生成 Schema v0.1 不依赖 `oneOf` 或 `anyOf` 来判别动作。公共 Schema 验证通用字段，语义 Validator 根据 `op` 验证条件字段。

## 9. 核心动作

### 9.1 `board.create`

创建一个新节点。

```json
{
  "action_id": "action-write-original",
  "op": "board.create",
  "node": {
    "id": "original-expression",
    "kind": "math",
    "role": "problem",
    "content": {
      "fragments": [
        {"id": "lhs", "latex": "y="},
        {"id": "quadratic", "latex": "x^2"},
        {"id": "linear", "latex": "+6x"},
        {"id": "constant", "latex": "+5"}
      ]
    },
    "placement": {
      "relation": "new_region",
      "region_role": "lesson_origin"
    },
    "style": {
      "emphasis": "primary"
    }
  }
}
```

节点 `kind`：

| kind | 核心内容 |
|---|---|
| `text` | plain text 或受限 markdown subset，可带 fragment |
| `math` | LaTeX fragment 序列 |
| `shape` | 受限几何图元与标签 |
| `diagram` | 节点与边组成的受限图示数据 |
| `geometry` | 等比例坐标系中的圆、点、线段、投影和角弧 |
| `plot` | 坐标范围、函数表达式、点和辅助线 |
| `scene3d` | 可旋转的基础立体、`z=f(x,y)` 曲面和轴对齐截面 |
| `image` | 受控 `asset_id`、裁剪或标注引用 |
| `table` | 行列和单元格文本或数学内容 |
| `note` | 简短结论、提示或不确定性说明 |

`role` 使用语义 token，例如：

```text
problem, observation, derivation, definition, example,
diagram, conclusion, warning, uncertainty, summary
```

Runtime 可以根据 role 选择视觉样式，但 role 不等于 CSS class。

#### Image content

`image` 必须通过受控 `asset_id` 引用 session 资源。可寻址 `regions` 使用宿主视觉预处理提供的 `source_region`：

```json
{
  "asset_id": "asset-geometry-001",
  "alt": "等腰三角形 ABC",
  "regions": [
    {
      "id": "lesson-001:node:image:fragment:midpoint",
      "source_region": "asset-geometry-001#region-midpoint",
      "label": "中点标记",
      "confidence": "medium"
    }
  ]
}
```

OLL 不保存本地路径和图片二进制。模型引用已知 region，不输出图片像素坐标。Runtime 通过受控 asset manifest 解析实际区域。

#### Diagram content

`diagram` 可以包含 `elements`、`edges` 和 `regions`，每一项都具有稳定 fragment ID。Canonical edge 的 `from`/`to` 和 region 的 `members` 必须是同一 diagram 内 fragment ID。

当 `board.connect` 的两个端点属于同一 diagram 且 relation 为 `geometry_segment` 时，Runtime 将其解释为 diagram 内几何线段，而不是两个白板卡片之间的外部连接线。

#### Geometry content

`geometry` 与 `diagram` 的职责不同：`diagram` 表示语义节点关系，`geometry`
表示必须保持度量关系的坐标几何。Runtime 必须对 x/y 使用相同像素比例，不能把圆拉伸为椭圆。

```json
{
  "kind": "geometry",
  "content": {
    "axes": {
      "x": {"min": -1.25, "max": 1.25, "label": "x"},
      "y": {"min": -1.25, "max": 1.25, "label": "y"},
      "equal_scale": true
    },
    "points": [
      {"as": "origin", "x": 0, "y": 0, "label": "O"},
      {"as": "point-p", "x": 0.5, "y": 0.8660254, "label": "P(cos θ, sin θ)"},
      {"as": "foot", "x": 0.5, "y": 0}
    ],
    "circles": [
      {"as": "unit-circle", "center": "origin", "radius": 1, "label": "r = 1"}
    ],
    "segments": [
      {"as": "radius", "from": "origin", "to": "point-p", "style": "solid"},
      {"as": "projection", "from": "point-p", "to": "foot", "label": "sin θ", "style": "projection"}
    ],
    "arcs": [
      {"as": "theta", "center": "origin", "radius": 0.28, "start_angle": 0, "end_angle": 1.0471975512, "label": "θ"}
    ]
  }
}
```

规则：

- `points` 提供几何坐标，并可通过 `visible=false` 作为隐藏构造点；
- `circles.center`、`segments.from/to` 和 `arcs.center` 必须引用同一 geometry 中声明的 point alias；
- `radius` 必须为正数；角度使用弧度，正方向为逆时针；
- `segments.style` 可以是 `solid`、`dashed` 或 `projection`；
- 所有 primitive 都通过 `as` 获得稳定 fragment ID，可以被 point/emphasize/focus 引用；
- Authoring Profile 必须声明 `equal_scale=true`，Runtime 负责确定实际像素坐标；
- 模型不得输出 SVG、路径字符串或像素坐标。

#### 数值 binding

Geometry 和 Plot 的 `content.bindings` 把 fragment 的受支持数值字段连接到 Lesson 变量：

```json
"bindings": [
  {"target":"point-p.x","expression":"cos(theta)"},
  {"target":"point-p.y","expression":"sin(theta)"}
]
```

Authoring `target` 使用同一节点内的 `fragmentAlias.property`。Normalizer 将 fragment alias 改成稳定 Canonical fragment ID。两个 binding 不能写同一目标。

受限表达式支持有限数值、圆括号、`+ - * / ^`、常量 `pi/e`，以及 `abs/acos/asin/atan/ceil/cos/exp/floor/ln/log/round/sin/sqrt/tan`。`ln` 是自然对数，`log` 是常用对数（以 10 为底）；其他底数写成 `log(x)/log(b)`。任何未知变量、未知函数、脚本语法、非有限结果或非法半径都必须以稳定错误失败。

允许目标：

| 节点 | fragment | 数值属性 |
| --- | --- | --- |
| Geometry | point | `x`, `y` |
| Geometry | circle | `radius` |
| Geometry | arc | `radius`, `start_angle`, `end_angle` |
| Plot | point | `x`, `y` |
| Plot | guide | `value` |

Reducer 在创建节点时用当前变量值计算全部 binding。当前 Authoring Profile 不允许 `revise` 新增或替换 binding；需要不同关系时应创建新的 Geometry/Plot 节点，直到修订合同被单独定义。变量更新必须从同一份变量映射重新计算所有含 binding 的节点；不得只更新当前可见节点。视觉插值不进入 Semantic BoardState。

#### 学生直接拖动几何点

需要让学生拖动的点必须明确声明 `interaction`。Runtime 不会根据 `cos`、`sin` 等表达式猜测哪些点可以拖。

```json
{
  "as": "point-p",
  "x": 1,
  "y": 0,
  "interaction": {
    "kind": "angle_control",
    "variable": "theta",
    "center": "origin"
  }
}
```

`angle_control` 表示学生绕 `center` 拖动这个点。Runtime 根据目标变量的 `unit` 写回角度：`度`、`角度`、`°`、`degree`、`deg` 使用度数；`弧度`、`radian`、`rad` 以及未声明单位时使用弧度。写回仍通过与滑杆相同的变量入口完成。点的位置由 `content.bindings` 表达；`interaction` 只说明学生操作如何反向修改变量，不保存第二份变量状态，也不允许执行模型提供的 JavaScript。

### 9.2 `board.revise`

显式修改已有节点。

```json
{
  "action_id": "action-revise-expression",
  "op": "board.revise",
  "target": {"node_id": "working-expression"},
  "revision": {
    "content": {
      "fragments": [
        {"id": "completed-square", "latex": "(x+3)^2"},
        {"id": "constant", "latex": "-4"}
      ]
    },
    "reason": "完成配方"
  }
}
```

规则：

- 目标必须存在；
- 不改变 node ID；
- Runtime 保存语义 revision；
- 不允许使用 `board.create` 的重复 ID 达到覆盖效果。

### 9.3 `board.emphasize`

```json
{
  "action_id": "action-emphasize-linear",
  "op": "board.emphasize",
  "target": {
    "node_id": "original-expression",
    "fragment_id": "linear"
  },
  "emphasis": "focus"
}
```

`emphasis`：`focus`、`supporting`、`warning`、`resolved`。实现可以使用颜色、描边、下划线或动画，但不能只依赖颜色表达含义。

`emphasis: "none"`（0.7）结束同一目标（同一 node 或同一 fragment）此前的强调，目标回到未强调的样子；它不吸引注意，Runtime 不为它移动镜头。例如孩子在一张卡片上用荧光笔标出的部件，到下一张卡片开始时结束强调。

目标可以是 node、node fragment、connection 或 group。强调 connection 不复制连接，也不改变其端点和关系语义；强调 group 作用于组的视觉边界和成员整体，不改变成员内容。

### 9.4 `board.connect`

```json
{
  "action_id": "action-connect-form-to-vertex",
  "op": "board.connect",
  "connection": {
    "id": "connection-form-vertex",
    "from": {"node_id": "vertex-form", "fragment_id": "h-value"},
    "to": {"node_id": "parabola", "fragment_id": "vertex-point"},
    "relation": "represents",
    "label": "顶点横坐标"
  }
}
```

连接端点必须在动作执行时存在。

### 9.5 `board.group`

```json
{
  "action_id": "action-group-derivation",
  "op": "board.group",
  "group": {
    "id": "group-completing-square",
    "title": "配方过程",
    "role": "derivation",
    "members": ["original-expression", "working-expression", "vertex-form"]
  }
}
```

组可以包含节点和子组，但 v0.1 禁止循环包含。

### 9.6 `board.focus`

```json
{
  "action_id": "action-focus-result",
  "op": "board.focus",
  "focus": {
    "targets": ["vertex-form", "parabola"],
    "intent": "show_relationship"
  }
}
```

这是播放提示，不改变 Board 的知识内容。用户手动浏览时可以延迟执行。

### 9.7 `teacher.point`

```json
{
  "action_id": "action-point-nine",
  "op": "teacher.point",
  "target": {"node_id": "square-nine"}
}
```

目标可以是 node、node fragment、connection 或 group。目标不可见时 Runtime 应先以不突兀的方式使目标进入可见区域；指向 group 时使用组的视觉边界或宿主选择的代表点。

### 9.8 `teacher.expression`

```json
{
  "action_id": "action-expression-careful",
  "op": "teacher.expression",
  "expression": "careful"
}
```

v0.1 表情 token：`neutral`、`encouraging`、`careful`、`celebrating`。表情是辅助信息，不得承载唯一教学含义。

### 9.9 `lesson.variable.animate`

```json
{
  "action_id": "action-rotate-one-cycle",
  "op": "lesson.variable.animate",
  "animation": {
    "variable": "theta",
    "to": 6.283185307179586,
    "easing": "linear",
    "duration_intent": "extended"
  }
}
```

动作把变量从执行前的当前值变到 `to`（`wrap` 变量走较短的一边）。`to` 必须在变量范围内。Headless Reducer 直接应用终值；Web Runtime 才生成中间帧。`duration_intent` 只表达 `brief`、`normal`、`extended` 三档教学节奏，不能换成毫秒。用户在动画中拖动变量控件时，Runtime 终止该自动动画并保存用户值。

暂停 checkpoint 额外保存动作 ID、起点、终点和完成比例。恢复后从该比例继续。开启降低动态效果时不生成中间帧，但必须应用 `to`，因此最终语义状态与 Headless Reducer 一致。

### 9.10 `board.hide`（0.6，仅学生讲课课程）

```json
{"action_id": "…", "op": "board.hide", "target": {"node_id": "…"}}
```

把孩子自己的一张卡片标记为 `hidden`。之后的动作不能再引用它；显示时它离开白板，以它为锚点的卡片改为锚定在它原来的锚点上。`board.create` 的 `placement.relation: "replaces"` 同样隐藏锚点卡片，并在其上记录 `replaced_by`，新卡片在显示时占用被替换卡片的位置。

### 9.11 `scene3d.view`（0.6）

```json
{"action_id": "…", "op": "scene3d.view", "target": {"node_id": "…"}, "view": {"show": {"node_id": "…", "fragment_id": "…"}}}
```

`view` 为 `{"show": <高亮部件>}` 或 `{"preset": "front" | "top" | "side" | "isometric"}`。Reducer 把意图记录为场景节点的 `view_intent`；Runtime 由意图计算相机（从场景物体中心朝向该部件；正上方或正下方时与屏幕对齐），保持缩放。之后学生手动旋转优先，更晚的 `view` 再次生效。

## 10. 相对布局

`placement` 的规范关系：

```text
new_region
below
above
left_of
right_of
near
inside
overlay
```

示例：

```json
{
  "relation": "below",
  "anchor": "original-expression",
  "align": "start",
  "gap": "normal"
}
```

规则：

- 除 `new_region` 外必须提供 anchor；
- anchor 必须是已有节点或组；
- `align` 为 `start`、`center`、`end`；`continues` 的数学卡片可以用 `equals`；
- `continues`（0.9，仅学生讲课课程，决定记录 0011）：笔迹或数学卡片接着写在锚点卡片上，必须带 `offset: {"x", "y"}`（离锚点左上角的白板单位，范围 ±4000），只有它能带 `offset`。一串接着写的卡片共用第一张卡片的整体：整体参与排版，各卡片按 offset 摆放，Runtime 画一个外框；`align: "equals"` 的数学卡片（接着写的，或替换接着写的笔迹的“整理一下”）横向移动，使它的“=”与整体中上面最近一行数学的“=”对齐。锚点被隐藏时，接着写的卡片接到替换它的卡片上，或接到它所接的卡片上（offset 相加），或占用它在白板上的位置；
- `gap` 为 `compact`、`normal`、`spacious`；
- Runtime 负责冲突消解和实际坐标；
- 相同 Runtime 版本对相同语义状态和动作必须产生稳定布局结果。

## 11. `plot` 节点最低能力

```json
{
  "id": "parabola",
  "kind": "plot",
  "role": "diagram",
  "content": {
    "axes": {
      "x": {"min": -8, "max": 3},
      "y": {"min": -6, "max": 8}
    },
    "curves": [
      {
        "id": "curve-main",
        "expression": "(x+3)^2-4",
        "label": "y=(x+3)²-4"
      }
    ],
    "points": [
      {"id": "vertex-point", "x": -3, "y": -4, "label": "(-3,-4)"}
    ],
    "guides": [
      {"id": "axis-symmetry", "kind": "vertical_line", "value": -3, "label": "x=-3"}
    ]
  },
  "placement": {
    "relation": "right_of",
    "anchor": "group-completing-square"
  }
}
```

表达式解析器只能执行受限数学表达式，不得使用 `eval`。

显式曲线的 `expression` 除了自变量 `x`，还可以读取本课已经声明的
Lesson 数值变量。例如两个滑杆分别声明为 `number_01` 和 `number_02`
时，`(x-number_01)^2+number_02` 表示一条顶点随两个数值变化的抛物线。
Core 必须拒绝未声明的名称；Web Runtime 必须用当前变量值重新采样整条
曲线。变量变化只更新同一份课程状态，不允许为曲线另存一份参数状态。
这类表达式关系不使用 `content.bindings`，因为它驱动的是整条函数曲线，
而不是某个 fragment 的单一数值字段。

当一条二维曲线不能写成单值的 `y=f(x)` 时，`curves[]` 可以声明
`"kind": "implicit"`，并用 `expression` 表示 `F(x,y)`、用 `level`
表示等值线 `F(x,y)=level`。例如圆可以写成
`{"kind":"implicit","expression":"x^2+y^2","level":1}`。
Runtime 在 `axes` 给出的有限范围内本地采样；表达式无效或没有可见等值线时必须明确失败，不能留下空白图块。

`axes` 可以声明可选的 `equal_scale: true`，要求横纵两轴的单位长度相等
（与 geometry content 的等单位语义一致，见第 9 节）。缺省或 `false`
时两轴各自缩放到可用空间。`axes.layout: "adaptive"` 允许等单位图按已发布的
坐标范围调整绘图区尺寸。如果尺寸上限或下限留出额外空间，播放器保持等单位
比例并从轴中心向两侧延伸可视范围，填满绘图区。探索模式的平移和缩放只改变
可视范围。

等单位卡片的高度保持在宽度的 0.55 到 1.0 倍之间；超出时播放器从轴中心延伸较短的轴，不改变已发布的坐标范围。
等单位图的两轴使用同一个主刻度步长。

`axes.x.ticks: "pi"`（或 `axes.y.ticks`）要求该轴以 π 的倍数标注刻度（`π/2`、`π`、`3π/2` 等），用于弧度制三角函数图。
曲线可声明 `holes: [{"x": 1, "y": 2}]`（至多 16 个有限点），表示可去间断点；播放器在该处画空心圆。
带有坐标的点在已发布范围之外时，播放器在边框上画指向该点的标记，而不是直接隐藏。

固定曲线的采样图可声明 `axes.follow_samples: true`。在演示动画期间，
播放器可临时纳入动画控制的采样点及其有限终点。已发布的默认坐标范围、
卡片尺寸、学生的探索视图和课程变量保持独立。

### 11.1 `scene3d` 节点最低能力

`scene3d` 描述三维对象的数学语义和初始视角，不保存 WebGL、SVG 路径或模型代码：

```json
{
  "kind": "scene3d",
  "content": {
    "title": "立方体与抛物面截面",
    "fallback": "立方体旁边是一张向上开口的抛物面，橙色平面表示水平截面。",
    "axes": true,
    "camera": {"yaw": 0.72, "pitch": 0.55, "zoom": 1},
    "objects": [
      {
        "as": "cube",
        "kind": "box",
        "center": {"x": 0, "y": 0, "z": 0},
        "size": {"x": 2, "y": 2, "z": 2},
        "color": "teal"
      },
      {
        "as": "surface",
        "kind": "surface",
        "expression": "0.3*(x^2+y^2)-1",
        "x_range": {"min": -2, "max": 2},
        "y_range": {"min": -2, "max": 2},
        "samples": 12,
        "color": "blue"
      }
    ],
    "sections": [
      {
        "as": "horizontal-section",
        "axis": "z",
        "value": 0,
        "targets": ["cube", "surface"],
        "display": "plane_and_intersection",
        "color": "orange"
      }
    ],
    "highlights": [
      {"as": "vertex-a", "kind": "point", "points": [{"x": -1, "y": -1, "z": 1}], "label": "顶点 A"},
      {"as": "edge-ab", "kind": "edge", "points": [{"x": -1, "y": -1, "z": 1}, {"x": 1, "y": -1, "z": 1}], "label": "棱 AB"},
      {"as": "top-face", "kind": "face", "points": [{"x": -1, "y": -1, "z": 1}, {"x": 1, "y": -1, "z": 1}, {"x": 1, "y": 1, "z": 1}, {"x": -1, "y": 1, "z": 1}], "label": "顶面"}
    ],
    "bindings": [
      {"target": "horizontal-section.value", "expression": "height"}
    ]
  }
}
```

规则：

- `box` 使用 `center + size`；`sphere` 使用 `center + radius`；`cylinder/cone` 使用 `center + radius + height`；
- （0.9）`prism/pyramid` 使用 `center + sides(3–12) + radius（底面外接圆半径）+ height`；`frustum`（圆台）使用 `center + radius（底）+ top_radius（顶）+ height`；`hemisphere` 使用 `center（平面的圆心）+ radius`，向上凸；`torus` 使用 `center + radius（环的半径）+ tube（管的半径，小于 radius）`；`tetrahedron/octahedron/dodecahedron/icosahedron` 使用 `center + radius（外接球半径）`。Runtime 用带外法线的小面绘制，只画朝向观看者的面并按朝向明暗；截面由同样的面切得。能力 `scene3d:more-solids`；
- （0.9）`prism/pyramid` 也可以不写 `sides + radius`，改写 `base`：3–12 个 `{x, y}` 组成的凸多边形（如直角三角形、长方形），底面按它的形心放在 `center` 下方，棱锥的顶点在形心正上方；`pyramid` 可写 `top_scale`（0 ≤ k < 1）成为棱台，顶面是底面按 k 缩小的副本；`ellipsoid`（椭球）使用 `center + radii: {x, y, z}`。能力 `scene3d:more-solids`；
- （0.9）`box/prism/pyramid/cylinder/cone` 可写 `unfold`（0 到 1）：0 是封闭的立体，1 是平放的展开图，中间是正在打开的样子。棱柱、棱锥的侧面绕底边转开，顶面跟着最前面的侧面；圆柱侧面展开成 2πr 宽的长方形，圆锥侧面展开成以母线为半径的扇形，底面贴在旁边。每个面保持原来的大小，所以展开图的面积就是表面积。`unfold` 可以由 Lesson 变量绑定（目标 `<对象 as>.unfold`，超出 0–1 时停在两端），用滑杆演示“打开盒子”。能力 `scene3d:unfold`；
- （0.10）在立体对象上设置 `face_targets: true` 后，可以用 `<场景 as>#<对象 as>-<面标识>-face` 单独标注一个面。圆柱的面标识为 `top`、`bottom` 和 `side`，转动或展开时标识保持稳定。长方体中与某个启用此选项的面四角唯一吻合的 `when_emphasized` 标注随该面展开。能力 `scene3d:face-targets`。
