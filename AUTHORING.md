# OLL Authoring Profile v0.1

状态：Exploration Draft
日期：2026-07-27

## 1. 目的

Authoring Profile 是提供给大模型的 OLL 创作形式。它只要求模型描述课程语义，不要求模型完成宿主可以确定性生成的记账工作。

Normalizer 将合法 Authoring Lesson 转换为 Canonical Lesson Events；前端 Runtime 不直接执行 Authoring Profile。

## 2. 模型负责与不负责

模型负责：

- Lesson 标题、目标和教学策略；
- Step、Beat 和讲述；
- 写、修订、强调、连接、分组、聚焦和教师动作；
- 白板内容、语义角色和相对位置；
- 对当前 Board Context 中允许引用内容的正确使用。

模型不负责：

- `lesson_id`、`board_id` 和 revision；
- 全局 node、action、step 和 beat ID；
- sequence 和幂等键；
- 绝对坐标、像素尺寸和动画毫秒；
- 持久化和资源权限；
- 修改 Learner Profile。

## 3. 顶层结构

```json
{
  "dsl": "octos.lesson",
  "version": "0.1",
  "profile": "authoring",
  "lesson": {
    "mode": "explain",
    "language": "zh-CN",
    "title": "课程标题",
    "goals": ["课程目标"]
  },
  "steps": [],
  "close": {
    "summary": "本轮完成了什么",
    "focus": ["summary-group"]
  }
}
```

v0.1 `mode` 固定为 `explain`，不能输出等待学生回答的控制动作。

## 4. 局部别名

`key`、`as` 和引用使用 Lesson 内局部别名：

```text
^[a-z][a-z0-9-]{0,63}$
```

引用节点使用别名，引用可寻址片段使用 `node#fragment`：

```text
original
original#linear
parabola#vertex
```

别名必须先定义后引用。Normalizer 将它们转换成稳定 Canonical ID。

以下内容项都可以通过 `as` 成为 fragment：

```text
fragments, curves, points, guides, regions, elements, edges
```

因此可以引用 `source-image#midpoint-marks`、`clean-diagram#point-a`、`clean-diagram#side-ab` 或 `parabola#vertex`。diagram edge 的 `from`/`to` 和 region 的 `members` 必须引用同一 diagram 中已经声明的 element。

## 5. 课程结构

```json
{
  "key": "complete-square",
  "purpose": "解释为什么要加上并减去9",
  "beats": [
    {
      "key": "add-nine",
      "say": "为了构造完全平方，我们加上9，同时也减去9。",
      "delivery": "careful",
      "actions": []
    }
  ]
}
```

- `purpose` 是可审计的教学目标，不是思维链；
- `say` 应能直接用于 TTS；
- Beat 必须包含至少一个动作；
- 一轮必须完成用户请求范围，不以等待回答结束中间步骤。

## 6. 动作

### `write`

创建新课堂对象：

```json
{
  "do": "write",
  "as": "vertex-form",
  "kind": "math",
  "role": "conclusion",
  "content": {
    "fragments": [
      {"as": "square", "latex": "(x+3)^2"},
      {"as": "shift", "latex": "-4"}
    ]
  },
  "place": {
    "relation": "below",
    "anchor": "original",
    "align": "start",
    "gap": "normal"
  }
}
```

### `revise`

显式修改已有节点，不能通过重复 `as` 覆盖。

### `emphasize`

```json
{"do": "emphasize", "target": "original#linear", "emphasis": "focus"}
```

目标可以是 node、node fragment 或 connection。例如几何辅助线由 `connect` 创建后，可以再次用其别名强调。

### `connect`

```json
{
  "do": "connect",
  "as": "formula-to-vertex",
  "from": "vertex-form#shift",
  "to": "parabola#vertex",
  "relation": "determines",
  "label": "顶点纵坐标"
}
```

### `group`

```json
{
  "do": "group",
  "as": "derivation-group",
  "role": "derivation",
  "label": "配方过程",
  "members": ["original", "balanced-expression", "vertex-form"]
}
```

### `focus`

```json
{"do": "focus", "targets": ["lesson-map"], "intent": "lesson_overview"}
```

### `point` 与 `expression`

分别控制老师指向已存在内容和有限表情 token。它们不能承载唯一教学信息。

## 7. 动作阶段

动作可以声明 `before_speech`、`during_speech` 或 `after_speech`；缺省为 `during_speech`。模型不能输出毫秒时间。

## 8. 相对位置

v0.1 关系：

```text
new_region, below, above, left_of, right_of, near, inside, overlay
```

除 `new_region` 外必须引用已经存在的 anchor。模型不输出坐标。

## 9. 确定性规范化

给定相同 Authoring Lesson 和宿主字段：

```json
{
  "lessonId": "lesson-001",
  "boardId": "board-001",
  "baseRevision": 3,
  "regionIntent": "continue_topic"
}
```

Normalizer 必须产生相同 Canonical Events。Normalization 不改写教学内容，不自动补充缺失讲解，也不修复学科错误。

## 10. 当前限制

- `image`、`diagram` 和 `table` 已在几何示例中完成第一轮表达验证，但还没有前端视觉 Runtime 证明；
- `shape` 和复杂科学流程图仍待完整示例；
- 当前完整示例覆盖数学、几何图片和英语文本，尚未覆盖同板追问；
- 模型可生成性尚未测试；
- Authoring Schema 仍可能过于冗长；
- 任何无法由真实课程解释的字段都应删除，而不是为了完整感保留。
