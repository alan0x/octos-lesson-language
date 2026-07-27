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

v0.1 的 `mode` 固定为 `explain`。未来互动式、练习式和复盘式课堂必须通过版本或能力协商加入。

### 5.3 字段所有权

`lesson_id`、`board_id` 和 `base_revision` 由宿主提供给生成过程，不能由模型自由选择目标。生成适配器必须核对这些值与请求上下文一致。

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
| `plot` | 坐标范围、函数表达式、点和辅助线 |
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
- `align` 为 `start`、`center`、`end`；
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

## 12. `lesson.close`

```json
{
  "dsl": "octos.lesson",
  "version": "0.1",
  "event": "lesson.close",
  "lesson_id": "lesson-quadratic-001",
  "sequence": 6,
  "result": {
    "summary": "完成配方并连接到顶点和平移关系",
    "summary_node_refs": ["vertex-form", "parabola"],
    "suggested_focus": ["group-completing-square", "parabola"]
  }
}
```

`lesson.close` 表示模型不再为本 Lesson 追加 Step。它不代表学生掌握，也不修改 Learner Context。

## 13. 完整渐进示例

以下示例省略部分内容，但展示规范顺序：

```jsonl
{"dsl":"octos.lesson","version":"0.1","event":"lesson.open","lesson_id":"lesson-q1","sequence":0,"board":{"board_id":"board-1","base_revision":0,"region_intent":"new_topic"},"lesson":{"mode":"explain","language":"zh-CN","title":"配方法","goals":["得到顶点式"]}}
{"dsl":"octos.lesson","version":"0.1","event":"lesson.step","lesson_id":"lesson-q1","sequence":1,"step":{"id":"show-problem","purpose":"呈现原式","beats":[{"id":"write-problem","narration":{"text":"我们先写下原式。"},"stage":{"before_speech":[],"during_speech":[{"action_id":"a1","op":"board.create","node":{"id":"eq1","kind":"math","role":"problem","content":{"fragments":[{"id":"all","latex":"y=x^2+6x+5"}]},"placement":{"relation":"new_region","region_role":"lesson_origin"}}}],"after_speech":[]}}]}}
{"dsl":"octos.lesson","version":"0.1","event":"lesson.step","lesson_id":"lesson-q1","sequence":2,"step":{"id":"complete-square","purpose":"完成配方","beats":[{"id":"write-result","narration":{"text":"加上并减去9，原式就能写成一个完全平方。"},"stage":{"before_speech":[],"during_speech":[{"action_id":"a2","op":"board.create","node":{"id":"eq2","kind":"math","role":"derivation","content":{"fragments":[{"id":"all","latex":"y=(x+3)^2-4"}]},"placement":{"relation":"below","anchor":"eq1","align":"start","gap":"normal"}}}],"after_speech":[]}}]}}
{"dsl":"octos.lesson","version":"0.1","event":"lesson.close","lesson_id":"lesson-q1","sequence":3,"result":{"summary":"得到顶点式","summary_node_refs":["eq2"],"suggested_focus":["eq1","eq2"]}}
```

## 14. 验证阶段

### 14.1 结构验证

检查 JSON、公共字段、类型、长度、枚举和必要字段。

### 14.2 事件流验证

检查 open/step/close 顺序、sequence、lesson ID 和重复事件。

### 14.3 语义验证

检查节点引用、fragment 引用、重复 ID、布局 anchor、组循环、资源权限和 op 条件字段。

### 14.4 Runtime 能力验证

检查当前 Runtime 是否支持所有核心 action、node kind 和 DSL version。未知核心能力必须停止当前 Step，并返回明确错误。

## 15. 错误模型

错误至少包含：

```json
{
  "code": "OLL_REFERENCE_NOT_FOUND",
  "path": "/step/beats/0/stage/during_speech/0/target/node_id",
  "message": "Node 'missing-node' does not exist",
  "lesson_id": "lesson-q1",
  "sequence": 2
}
```

v0.1 稳定错误码：

```text
OLL_INVALID_JSON
OLL_UNSUPPORTED_VERSION
OLL_INVALID_EVENT
OLL_SEQUENCE_ERROR
OLL_LESSON_ID_MISMATCH
OLL_DUPLICATE_ID
OLL_REFERENCE_NOT_FOUND
OLL_INVALID_OPERATION
OLL_INVALID_OPERATION_PAYLOAD
OLL_INVALID_PLACEMENT
OLL_GROUP_CYCLE
OLL_RESOURCE_DENIED
OLL_RESOURCE_LIMIT
OLL_BOARD_REVISION_CONFLICT
OLL_RUNTIME_CAPABILITY_MISSING
OLL_LESSON_ALREADY_CLOSED
```

错误发生时：

- 当前未应用 Step 不改变正式 BoardState；
- 已应用 Step 保持有效；
- Runtime 不生成聊天 fallback；
- 宿主可以请求模型重生成当前及后续 Step；
- 重试必须使用新的事件序列或明确替代未提交事件，不能篡改已经提交的 Step。

## 16. 确定性边界

OLL 规范保证语义确定性：节点、内容、关系、分组、revision 和最终焦点可由事件日志重建。

Runtime 同时维护两个投影：

- Committed Projection：完整合法 Step 对应的最终语义状态，是恢复和 revision 的依据；
- Playback Projection：按 Beat 和阶段逐步揭示的可见状态，是暂停、动画和回放的依据。

播放中断只改变 Playback Projection 和 checkpoint，不撤销已经提交的 Step。回放重新创建 Playback Projection，但不得再次改变 Committed Projection。

OLL 不保证像素确定性：字体度量、实际坐标、动画速度、TTS 音色和头像微动作可以因 Runtime 和设备而不同。

兼容 Runtime 必须能输出规范化 Semantic BoardState，用于跨实现 conformance 比较。

## 17. 扩展

非核心扩展必须使用命名空间，例如：

```json
{
  "extensions": {
    "com.octos.experimental.handwriting": {
      "stroke_style": "chalk"
    }
  }
}
```

未知扩展可以忽略，但未知核心 `op`、`kind` 或事件不能忽略。扩展不得改变核心动作的最终语义。
