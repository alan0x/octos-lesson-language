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

一行几个空（`numeric_row`，player 0.14.0，决定 0023 修订 1）让学生一次填一行里的几个空，例如「37 = __ + __」：

```json
"tasks": [{
  "as": "parts", "anchor": "mat", "prompt": "Write the number by places.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "row_entry"}],
  "completion": {"kind": "numeric_row", "parts": [
    {"text": "37 ="}, {"blank": {"as": "tens", "answer": "30", "label": "the tens"}},
    {"text": "+"}, {"blank": {"as": "ones", "answer": "7", "label": "the ones"}}]},
  "hints": ["What are 3 tens worth?"]
}]
```

- `parts` 有 1 到 12 段，每段是文字（`text`，至多 80 字）或一个空（`blank`）；一行有 1 到 6 个空，空的名字在这一行里唯一；
- 每个空按填数任务的规则写和判（`answer`、`tolerance`、`unit`、`form`）；`label` 是空下面的一两个词，不能是要学生找的数；
- 一次提交（`row_submit`）是一次尝试，所有空都对才算对；Runtime 只说整行对不对，不说哪个空错了；有空没填或读不成数，不算尝试；
- 和填数任务一样带 `anchor`，挂在它问的那张卡片下面。

卡片任务（`card_fact`，player 0.14.0，决定 0023）让学生在一张卡片上点按操作，自己说“做完了”，由卡片自己的程序判定：

```json
"tasks": [{
  "as": "trade",
  "start": {"kind": "practice", "variables": ["ones", "tray_ones", "tens"], "values": {"ones": 17, "tray_ones": 0, "tens": 2}},
  "prompt": "Make tens until you can't. Then tap I'm done.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "mat"}, {"kind": "card_submit"}],
  "completion": {"kind": "card_fact", "node": "mat", "fact": "no_trade_left"},
  "hints": ["Put ones in the tray; when ten fill it, make a ten."]
}]
```

- `node` 必须是本课写出的 `base_ten_trade`、`place_value_chart`、`place_value_trade` 或 `make_ten` 卡片（`place_value_trade` 和 `make_ten` 的 `complete` 任务只有 `card_tap`，见下）；`allowed_operations` 是点这张卡片（`card_tap`）和说做完了（`card_submit`），还可以加上这张卡片数位上的滑块（`{"kind": "variable_change", "variable": "ones", "controls": ["slider"]}`，见下）；
- 点按改变哪些数由卡片的规则决定（托盘只装十个，正好十个才换成一个高一位的，拆开放进空托盘）；一次点按可以同时改几个变量，作为一次 `card_tap` 操作记录。卡片上点按会改的每个数（每一位的个数、每个托盘）都必须绑定到它自己的课内变量，变量从 0 到卡片能画的最大值；
- 只在这个任务开放时卡片才能点；讲解播放时、其他任务开放时都不能点，被拒绝的点按不记录；
- 点按不算尝试；`card_submit` 才算一次尝试，卡片的事实成立就完成。`no_trade_left`：最高一位以下每一位都少于十（托盘里剩几个不满十的不影响；托盘满十时这一位已经是十个以上）；
- `count`（播放器 0.15.0，能力 `student-tasks:card_fact:count`，决定 0023 修订 5）：`{"kind": "card_fact", "node": "mat", "fact": "count", "at": "ones", "value": 7}`，孩子点按卡片，让 `at` 这一位的块数（托盘里的也算）正好是 `value`，说做完了时判定。`at` 必须是卡片有的一位，`value` 是整数；练习堆已经是这个数时拒绝；校验器从练习堆按点按规则做精确搜索，到不了的数被拒绝，并说出能到的数。只有 `count` 带 `at` 和 `value`。尝试记录这一位的块数（`actual`）和目标（`target`）。做完以后，后面没有 `start` 的题看到的是孩子自己做出的那一堆（托盘里的块放回这一位，块数不变），回放和重新打开以后也一样：`card_submit` 记录带 `pile`（说做完了时卡片每个绑定变量的值）。没有 `pile` 的旧记录才用点按能做到这个数、托盘全空的堆里离练习堆最近的那一堆；
- 卡片任务必须用 `start` 给出学生的练习堆，`start.variables` 包含所有点按会改的变量；课开始的那堆和练习堆都必须是合法的起始堆；
- 点按会改的变量不能有自己的控件（可拖动的点等），只有数位上的滑块例外（下一段）；绑定了变量的卡片不能被 `revise`（修订不带绑定，卡片会冻住）；
- 回到课里重看后，课再讲完时重新摆上练习堆。

数位表（`place_value_chart`，数学插件 0.8.0，特性 `plugin:math/place-value-chart@1`，播放器 0.16.0，决定 0025）上的卡片任务：

```json
"tasks": [{
  "as": "build",
  "start": {"kind": "practice", "variables": ["number", "count_thousands", "count_hundreds", "count_tens", "count_ones"],
            "values": {"number": 4050000, "count_thousands": 0, "count_hundreds": 0, "count_tens": 0, "count_ones": 0}},
  "prompt": "Build the number on the chart. Then tap I'm done.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "chart"}, {"kind": "card_submit"}],
  "completion": {"kind": "card_fact", "node": "chart", "fact": "built"},
  "hints": ["Read the number again, one place at a time."]
}]
```

- 点按：摆数（`mode: "build"`）时 `add`（这一位放一个圆片，第十个被拒绝）、`remove`（拿走一个）；拆数（`mode: "apart"`）时 `take_out`（这一位的圆片都移到它下面的部分，没有圆片的一位被拒绝）。每一位的 `count` 和（拆数时）`pulled` 都绑定到自己的变量，变量从 0 到 9；
- 事实（能力 `student-tasks:card_fact:built`、`student-tasks:card_fact:pulled_all`，播放器 0.16.0）：`built`，卡片上的圆片正好是这个数（只用于摆数）；`pulled_all`，每一位都拿出来了（只用于拆数）。都不带 `at`、`value`；
- 练习从它自己的数开始：卡片的数 `target` 绑定到一个变量，写成没有点的目标 `{"target": "target", "expression": "number"}`（卡片级字段，能力 `value-bindings:card-field`，播放器 0.16.0；`place_value_chart` 的 `target`，以及 `place_value_trade` 的 `a`、`b`、`finished`（播放器 0.17.0，见下）和 `make_ten` 的 `a`、`b`、`filled`、`moved`（播放器 0.18.0，见下）；其他卡片和其他名字的无点目标被拒绝）。`start` 设这个数和每个 `count`、`pulled`；这个数不能是课里的数；
- 起始的数位表：列能放下这个数；摆数时卡片是空的，拆数时这个数完整在卡片上、什么都没拿出来；按读法以外的给法会显示答案的数（展开式或拆数时只有一位不是零，「1 × 1,000」）被拒绝；已经摆好的卡片被拒绝。卡片照它的变量开始时的值检查（不只是写出来的数），每个练习的起点也检查；
- 点按的 `place` 是这一位在 `PLACE_VALUE_TAP_PLACES` 里的序号（位加三：千分位 0，个位 3，百万位 9），著作稿的 `at` 写这一位的名字（`ones`、`tenths`、`hundred-thousands`）；
- 做完以后，后面没有 `start` 的题（例如拆数之后的一行几个空）看到的是孩子自己摆出或拆开的那张表，和它的数；
- 练习开始时数立刻换成练习的数，圆片照常渐变，不会显示中间的数；
- 手机上：画板给出卡片在屏幕上最多能占的宽度（`BoardLayoutOptions.cardFitWidth`），一行放不下、圆片会小于 25 像素时，数位表按级分成几行（小数部分一行，前面是小数点），每一级不拆开。卡片宽度按缩放 1 算：宿主让镜头保持在 0.9 左右（卡片比屏幕高时上下移动画板）时，375 像素宽的屏幕上圆片和按钮约 27 像素；镜头把整张卡片缩进屏幕高度时会更小；
- 卡片自己的操作说明：`cardHowTo("place_value_chart", content)`。

在数位表上加减（`place_value_trade`，数学插件 0.9.0，特性 `plugin:math/place-value-trade@1`，播放器 0.17.0，决定 0026）：表画成竖式，进位、退位就是交换。

```json
"tasks": [{
  "as": "practice",
  "start": {"kind": "practice", "variables": ["a", "b", "finished", "col_thousands", "col_hundreds", "col_tens", "col_ones"],
            "values": {"a": 4658000, "b": 1573000, "finished": 0, "col_thousands": 0, "col_hundreds": 0, "col_tens": 0, "col_ones": 0}},
  "prompt": "Add on the chart, column by column.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "sum"}],
  "completion": {"kind": "card_fact", "node": "sum", "fact": "complete"},
  "hints": ["Start with any column."]
}, {
  "as": "total", "anchor": "sum", "prompt": "What is the total?", "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "answer_entry"}], "completion": {"kind": "numeric_answer", "answer": "6231"}, "hints": ["Read the answer row."]
}]
```

- 卡片的内容：`operation`（`add` 或 `subtract`），固定的列 `top_place`（-2 到 5；两个数和得数都小于 1 时没有个位一列，例如 0.35 + 0.48 只有十分位和百分位）和 `low_place`（0、-1、-2），两个数 `a`、`b`（整千分之一，最多两位小数），`finished`（演示做完了几列，从最右边一列数起），每一列一个 `status`（加法 0 没落下、1 落下了、2 落下并换过；减法第 1 位是拿走了、第 2 位是收到了十个）。表上每一个数都从两个数和这些状态算出来；
- 点按（只有学生点，课不点）：`down`（一列下面的 ↓：加法把两行和进位一起落下，减法拿走第二行那么多，剩下的落下，不够时拒绝并说出这一列有几个、要拿走几个）、`trade`（加法：圈好的十个换成左边一列的一个）、`break`（减法：一个圆片拆成右边一列的十个，只在右边一列需要时）。`place` 同数位表，是位加三。每个 `status` 绑定到自己的变量，变量从 0 到 2（加法）或 3（减法）；
- 事实 `complete`（能力 `student-tasks:card_fact:complete`，播放器 0.17.0）：每一列都做完了（落下来，没有剩下要换的十个），答数一行就是得数。卡片在每次点按后自己判定：让它成立的那一下点按就完成任务（播放器替孩子提交 `card_submit`），没有「我做完了」，所以这个任务的 `allowed_operations` 只有 `card_tap`，任务快照带 `auto_submit: true`（宿主不显示「做完了」）。卡片还不成立时 `submitStudentCard` 什么都不做；练习的表摆上或恢复时已经成立（完成的那一下已保存、提交没有保存），播放器立刻提交。得数是后面一道锚在这张卡片上的 `numeric_answer`，用现有的读数程序判；它打开时看到的是这一对数唯一的那张做完的表；
- 卡片级字段（没有点的绑定目标，能力 `value-bindings:card-field`）：`a`、`b`、`finished`。练习的 `start` 设两个数、`finished` 和每个 `status`；这一对数不能和课里的一样（只改一个数也算另一对）；起点是新的表：`finished` 为 0，每个 `status` 为 0。练习开始时卡片的每个绑定变量都立刻换成练习的值，不渐变；
- 卡片的每个绑定都直接写一个课内变量的名字（不能是 `finished + 0` 这样的表达式），一个变量只绑定一个字段；只用这张卡片演示的课也要求播放器 0.17.0（能力 `card:place_value_trade`）；
- 课只通过 `finished` 演示：动画到 2 就是最右边两列做完了，中间的落下、交换、拆开由程序按规则演出来。`finished` 只能是整数，只能往前走（再写同一个值，表不变）；表在演示（`finished` 大于 0）时不接受点按，练习的起点必须是 0。拒绝时说出下一个值会做完哪一列（「下一个值 3 做完百位」）。课不能 `tap` 这张卡片（手写的 `card.tap` 事件也被 Reducer 拒绝），也不能动画 `status` 的变量或两个数（两个数只在重放或练习的起点改变）；这些规则对卡片写出之前的节也成立。重放起点（`replay`）可以让 `finished` 回到较小的整数（重新演示），`status` 只能回到 0，两个数必须是卡片接受的一对；
- 编译器拒绝（错误的路径在卡片的内容里，只丢这张图）：没有任何进位或退位（`no_trade`）、超过六列（`too_wide`）、差是负数（`negative`）、超过两位小数（`decimals`）；两个数需要的列和卡片的列不一样（练习的一对和课里的一对同样形状）；点按做不到的状态；在已经做过的表上演示。卡片照它的变量开始时的值检查，每个练习的起点也检查；
- 只做桌面（约 1024 像素宽以上）：圆片按列数 34、28、24 像素，六列不超过 1024 像素宽；没有手机版面；
- 卡片自己的操作说明 `cardHowTo("place_value_trade", content)` 按加减固定；卡片上还有一行跟着表的状态变的说明（只在能点时显示）。后面几节可用的事实：`placeValueTradeFacts`（表上的样子、做完了几列、下一个值会做完哪一列）和 `placeValueTradeStepSentences`（每一步做什么）。

凑十（`make_ten`，数学插件 0.10.0，特性 `plugin:math/make-ten@1`，播放器 0.18.0，决定 0027）：两个十格框，小数那一框的圆片一个一个移过去，把大数那一框补成十。

```json
"tasks": [{
  "as": "practice",
  "start": {"kind": "practice", "variables": ["a", "b", "filled", "moved"], "values": {"a": 7, "b": 5, "filled": 7, "moved": 0}},
  "prompt": "Make a ten.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "frames"}],
  "completion": {"kind": "card_fact", "node": "frames", "fact": "complete"},
  "hints": ["How many more does the 7 need to make ten?"]
}, {
  "as": "row", "anchor": "frames", "prompt": "Write it as a number sentence.", "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "row_entry"}],
  "completion": {"kind": "numeric_row", "parts": [{"text": "7 + 5 = 7 +"}, {"blank": {"as": "to-ten", "answer": "3", "label": "to make ten"}}, {"text": "+"},
    {"blank": {"as": "rest", "answer": "2"}}, {"text": "= 10 +"}, {"blank": {"as": "ones", "answer": "2"}}, {"text": "="}, {"blank": {"as": "total", "answer": "12"}}]},
  "hints": ["Read the full frame, then the other one."]
}]
```

- 卡片的内容：两个加数 `a`、`b`（1 到 9，和大于 10），`filled`（演示：大数那一框里有几个，从大数开始，最多 10），`moved`（孩子移过去了几个，0 到 4）。补满的总是大数那一框（相等时是第一框）。四个都是卡片级字段，按名字绑定，各自一个变量；
- 点按（只有学生点，课不点）：`give`（点一个在自己框里的圆片，它移到另一框的下一个空格；大数那一框自己的圆片被拒绝：「红色的圆片留在自己的框里。」）、`back`（点一个移过去的圆片，它回去），`place` 是点到的那一框（0 第一框，1 第二框）。每一下改 `moved`；`moved` 的变量必须是 0 到 4；
- 事实 `complete`（能力 `student-tasks:card_fact:complete`）：大数那一框满十了。和 0026 一样在每次点按后判定，让它成立的那一下点按就完成任务，没有「做完了」，任务只有 `card_tap`。后面锚在这张卡片上的一行四个空（`numeric_row`）由程序写：`makeTenRow(a, b, language)`，挨着大数的那个空标着「to make ten」/「凑成十」（只认 8 + 2 + 4，不认 8 + 4 + 2）；它打开时看到的是这一对数补满十的那张卡片；
- 演示的起点从这一对数来：`filled` 开始时就是大数（8 + 6 是 8），不是 0。卡片写出时、按变量开始的值、每个练习的起点都必须正好是它，`moved` 为 0（`validateMakeTenContent(…, { start: true })`，卡片的 `demonstration.opensAtStart`）；重放可以把 `filled` 设回到大数和 10 之间的整数，`moved` 只能回到 0。课只通过 `filled` 演示，只能往前走、只能是整数，程序一个一个地移圆片；拒绝时说出下一个值做什么（「the next value, 9, moves one of the 6 into the 8's frame」）。演示中的卡片不接受点按；
- 编译器拒绝（只丢这张图）：加数不是 1 到 9（`not_one_digit`）、和小于 10（`under_ten`）、和正好是 10（`exactly_ten`，十的分与合）；`filled` 不是这一对数的起点；
- 只做桌面：每格 64 像素，圆片 50 像素，两框并排不超过 1024 像素宽；
- 卡片自己的操作说明 `cardHowTo("make_ten", content)` 说出会移的圆片的颜色；卡片上还有一行跟着状态变的说明（只在能点时显示），颜色词用那个颜色写。后面几节可用的事实：`makeTenFacts`、`makeTenStepSentences`。

演示字段（`TapCardKind.demonstration`，决定 0027 接进 OLL 时从 0026 推广）：只通过一个卡片级字段演示的卡片自己说明这个字段——`start(content)`（新卡片的值，练习的起点必须是它）、`refuseStep(content, from, to)`（课动画到这个值时拒绝的理由）、`refuseReplay(content, value)`、`outside(content, value)`、`opensAtStart`（卡片必须从起点打开），以及拒绝里用的词。`wholeForwardDemonstration` 做出「一次一个整数、只往前」的那一种；`place_value_trade` 的 `finished` 和 `make_ten` 的 `filled` 都是它。

一个数换一个单位来数（`place_value_times_ten`，数学插件 0.11.0，特性 `plugin:math/place-value-times-ten@1`，播放器 0.19.0，决定 0028）：往右一位一个变成十个，往左一位十个合成一个。

```json
"tasks": [{
  "as": "practice",
  "start": {"kind": "practice", "variables": ["amount", "target", "counted_in", "moved_once", "moved_twice"],
            "values": {"amount": 5000, "target": 10, "counted_in": 1000, "moved_once": 0, "moved_twice": 0}},
  "prompt": "Move every disk to the hundredths.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "chart"}],
  "completion": {"kind": "card_fact", "node": "chart", "fact": "complete"},
  "hints": ["Tap any disk."]
}, {
  "as": "count", "anchor": "chart", "prompt": "How many hundredths?", "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "row_entry"}],
  "completion": {"kind": "numeric_row", "parts": [{"text": "5 ones ="}, {"blank": {"as": "count", "answer": "500"}}, {"text": "hundredths"}]},
  "hints": ["Count the squares."]
}]
```

- 卡片的内容：固定的形状 `question`（`count` 数单位，或 `times` 倍数）、`toward`（`right` 拆开，`left` 合起来；倍数是 `right`）、`apart`（1 或 2；倍数是 1）；`amount`、`target`（整千分之一，0.3 写 300；倍数题大的在 `amount`）；`counted_in`（演示：现在用什么单位在数，整千分之一）；孩子的状态 `moved_once`，隔两位时还有 `moved_twice`（一组行，第 i 位是第 i 行，0 到 511）。列从数算出来（不是固定字段），所以练习可以换位置，但形状一样。问法按内容写的读：数字是 1 的相邻两位（100 和 10；1 和 0.1）写 `times` 是倍数（「100 是 10 的 ? 倍」），写 `count` 是数单位（「1 个百 = ? 个十」）（0028 修订 4）。用到这种倍数的课（写在卡片上，或由练习、重放、修改放上去）需要特性 `plugin:math/place-value-times-ten-digit-one-times@1`（数学插件 0.12.1）；
- 每个字段都是卡片级字段，按名字绑定（`amount`、`target`、`counted_in`、`moved_once`、`moved_twice`，能力 `value-bindings:card-field`），一个变量只绑定一个字段，绑定直接写变量名；`moved_once`、`moved_twice` 的变量从 0 到 511；
- 点按（只有学生点，课不点）：`move`（第几行的东西往目标走一位：一个圆片拆成右边一列的一排十个，一排十个拆成一块一百个；或者反过来合起来），倍数还有 `copy`（第几个小的数）和 `smaller`（下面那个小的数），这两种总被拒绝，拒绝的话就是那个事实（「This 70 has 3 tens; 70 is 7 tens.」）。点按的 `place` 是行号，0 到 9（`row-1` 到 `row-10`）；
- 演示：课只通过 `counted_in` 演示。它从题目说的单位开始（卡片按自己的形状和数算出起点，`placeValueTimesTenStartUnit`，不是 0），沿着路径往目标走：0.1 → 0.01 → 0.001 写成 100 → 10 → 1；倍数 700 和 70 写成 100000 → 70000。可以一次写到后面的值（程序一个一个演出中间的拆开），不能往回，不能写路径上没有的值；拒绝时说出路径和下一个可以写的值。课上写出的卡片从起点开始；重放起点可以把它设成路径上任何一个值，两组行都回到 0；
- 练习的起点：自己的 `amount`、`target`（不能和课里的一样），`counted_in` 是这道练习自己的起点单位，两组行是 0。事实 `complete`（每一行都到了目标列；倍数是十个小的数都满了）在每次点按后判定，同 0026；做完以后的那张表按这道练习自己的数算；
- 挂在卡片上、紧跟在这张卡片的任务后面的填数（`numeric_answer`）或一行几个空（`numeric_row`）问的是卡片自己的答案：一行几个空就是卡片的那几个（数单位一个，倍数两个：「7 hundreds = __ tens; 700 is __ times 70」），一个空是其中一个。别处挂在卡片上的问题不受这个限制；
- 编译器拒绝（只丢这张图）：`amount` 不是一位上一个数字（`not_one_digit`），两个单位隔三位以上或倍数不在相邻两位（`too_far`），大的单位超过 9 个（`too_many`），数不成整数（`not_whole`），形状不对（`not_same_shape`），超出百万位到千分位；
- 只做桌面（约 1024 像素宽以上）；卡片一开始就按最多的时候留好地方，做的时候不会长高。卡片自己的操作说明 `cardHowTo("place_value_times_ten", content)`；卡片上还有一行跟着表的状态变的说明（每一种能点的东西各一句），位置固定。后面几节可用的事实：`placeValueTimesTenFacts` 和 `placeValueTimesTenStepSentences`；锁着时的那句话 `placeValueTimesTenLockedText`、一行几个空 `placeValueTimesTenAnswerParts`、全对以后的那句话 `placeValueTimesTenDoneText`（倍数在这里说「1/10」）。

按数位比大小（`place_value_compare`，数学插件 0.12.0，特性 `plugin:math/place-value-compare@1`，播放器 0.20.0，决定 0029）：两个数在一张数位表上各占一行，按数位对齐（小数点对齐），从最高位比起，第一个不一样的数位决定，后面的数位不影响。

```json
"tasks": [{
  "as": "practice",
  "start": {"kind": "practice", "variables": ["a", "b", "compared", "marked", "signed"],
            "values": {"a": 625, "b": 700, "compared": 0, "marked": 0, "signed": 0}},
  "prompt": "Compare the two numbers.",
  "availability": {"kind": "after_lesson"},
  "allowed_operations": [{"kind": "card_tap", "node": "chart"}],
  "completion": {"kind": "card_fact", "node": "chart", "fact": "complete"},
  "hints": ["Start at the left."]
}]
```

- 卡片的内容：两个数 `a`、`b`（整千分之一，0.625 写 625）；`a_decimals`、`b_decimals`（可选，0 到 3：这个数写出来的小数位数，比它本身需要的多时才写，0.70 写 2；不写就是数本身的位数），所以 0.7 和 0.70 是一对；`compared`（演示：从左边起比了几列，再加一步选符号）；孩子的状态 `marked`（从左边起判断了几列，0 到 7）和 `signed`（选对了符号，0 或 1）。列从两个数算出来（从两个数最高的一位，至少到个位，到写出来的最低一位，最多七列），所以练习可以换一对数；
- 每个字段都是卡片级字段，按名字绑定（能力 `value-bindings:card-field`），一个变量只绑定一个字段，绑定直接写变量名；`marked` 的变量从 0 到 7，`signed` 从 0 到 1（和哪一对数无关）；
- 点按（只有学生点，课不点）：`same`、`different`（这一列下面的「一样」「不一样」，`place` 是数位加三，个位 3），从左边起一列一列判断，只接受对的判断；`sign`（`place` 10 到 12：>、=、<），表比完以后才能选，只接受对的符号；`column`（比完以后点一列，总被拒绝，拒绝的话就是这一列的事实：「The tens decide; the ones come after and don't matter.」）。拒绝都只说事实；选对符号以前不说哪个数大；
- 演示：课只通过 `compared` 演示，从 0 开始（卡片从 0 打开），一次一个整数往前：每一步判断一列（前面的「一样」，决定的那一列「不一样」；相等的一对一直「一样」），最后一步选对的符号；最大值是决定的那一列加二。可以一次写到后面的值：卡片的 `stepValues` 是每一个整数一步，播放器一步一步地设（每一步一个演示的时间，0026 修订 2），不能往回，不能超过最后一步。演示时卡片拒绝一切点按，也不说话（课自己讲）；孩子的状态是 0。重放起点可以把 `compared` 设成任何一步，`marked`、`signed` 回到 0；
- 练习的起点：自己的 `a`、`b`（不能和课里的一样），`compared`、`marked`、`signed` 都是 0。事实 `complete`（孩子比完并选对了符号；演示到最后不算）在每次点按后判定，选对符号的那一下就完成任务，没有「我做完了」；做完以后的那张表按这道练习自己的数算；
- 编译器拒绝（只丢这张图）：两个数写得一模一样（`same_numeral`，0.7 和 0.70 不算），超过七列（`too_wide`），超过三位小数或写的小数位数比数本身需要的少（`decimals`）；
- 只做桌面（约 1024 像素宽以上）；每一格一开始就按这一对数最多的圆片留好地方，做的时候不会长高。卡片自己的操作说明 `cardHowTo("place_value_compare", content)`；卡片上题目正下方一行跟着表的状态变的说明（只在能点时显示）。后面几节可用的事实：`placeValueCompareFacts`（演示时孩子的事实是新表的）和 `placeValueCompareStepSentences`；选对以后的那句话 `placeValueCompareDoneText`；课里的小数（mantissa、scale）用 `placeValueCompareFromDecimal` 换成卡片的数。

数位上的滑块（数学插件 0.7.0，特性 `plugin:math/base-ten-trade-slider@1`，决定 0023 修订 4）：

- 有托盘的那一位（个位；三列时也可以是十位）的个数变量可以写 `control: {"kind": "slider", "step": 10}`；步长必须正好是 10。托盘、最高一位不能有滑块，这些变量也不能有其他控件。卡片上每一位的个数和每个托盘都必须绑定到它自己的变量，范围和点按一样；
- 滑块每一格就是一次交换，按卡片自己的点按规则做，不是直接写数：往下一格是把这一位的散块放进托盘直到满十、再换成高一位的一块；往上一格是先清空托盘、拆开高一位的一块、再把十块从托盘拿出来。一次拖过几格就是几次交换，依次做；规则不让的格子到不了，滑块停在最近的能到的一格。总数从不改变，动过以后这一位的托盘是空的；
- 滑块的轨道只停在交换能到的数上（例如 6、16、26，不是 0、10、20），由 Runtime 从卡片上那一堆算出；轨道只有一格（这一堆上这一位换不动，如三列时 9 个十、没有百）时这个滑块隐藏（`variableControlModels` 仍给出它，带 `hidden: true`，宿主的控件列表因此不变，拖另一个滑块时也不变），等交换让它有了第二格再显示——这可能发生在拖另一个滑块的过程中；
- 只有开放的任务允许（`variable_change` 且 `controls` 是 `["slider"]`）时滑块才能动；讲解播放时它是灰的。课里的演示点按（`card.tap`）和 `lesson.variable.animate` 照旧；
- 目标任务（`expression_target`）可以用数位滑块：允许的变量都必须是同一张卡片的数位滑块；它必须有 `start`（`kind: "practice"`），给出卡片的每个数和托盘，和卡片任务一样。校验器从这个起始堆对交换做精确搜索，目标必须能到，而且起始堆还没有达到目标；
- 记录：每一下点按作为 `card_tap` 记录（带 `"control": "slider"`），这次拖动的 `variable_change` 排在它的点按之后；按顺序把这些点按交给卡片规则重放，得到同样的一堆；
- Web Runtime：`studentVariableLive(alias)` 说滑块现在能不能动，`variableControlModels(board, { live })` 给出轨道和是否禁用；卡片要动画时宿主把 `takeStudentCardSteps(nodeId)` 作为 `CardTapHandler.takeSteps` 交给画板，每次交换一下一下地画，和点按一样。

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

讲述文本可以带行内公式，字幕照原样渲染；送给语音合成前，宿主用 core 的 `spokenText` 把公式读成语言文字（“$x = \frac{2}{3}$” 读作 “x 等于 3 分之 2”），语音服务永远收不到公式标记。

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

面向学习者的文字（卡片文字、课程标题、练习题干与反馈、提问与答案）可以带行内公式：`$…$`、`$$…$$` 或 `\(…\)`；`\$`、没有配对的 `$` 和价格是普通文字（与 Pandoc 相同：开头的 `$` 后面紧跟非空白字符，结尾的 `$` 前面紧跟非空白字符、后面不跟数字，所以 “$5 and $10” 不是公式）。Runtime 用同一规则切分（web-runtime 导出 `inlineMathSegments` 和 `renderInlineText`），宿主自己绘制的课程文字也要用它，`$` 才在每张卡片上意思相同。

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

### 9.9a `card.tap`（0.14，决定 0023；数位表 0.16，决定 0025）

```json
{"action_id": "…", "op": "card.tap", "target": {"node_id": "…"}, "tap": {"kind": "make", "place": 0}}
```

课程像学生一样点一张 `base_ten_trade` 卡片（演示）。`kind` 为 `gather`、`ungather`、`make` 或 `break`，`place` 是位（0 = 一）。Reducer 用卡片自己的规则算出这一下改变的所有数，一次性写入它们绑定的变量（不会出现只改了一半的中间状态）。著作稿写成 `{"do": "tap", "target": "mat", "tap": "make", "at": "ones"}`；校验器按播放顺序（重放起点，再按 before、during、after 三段）推算变量的值，卡片在那时会拒绝的点按在播放前就被拒绝，并说明卡片的理由。Web Runtime 把演示的点按画成和学生点按一样的动画。数位表（`place_value_chart`）的 `kind` 为 `add`、`remove` 或 `take_out`，`place` 是这一位的序号（位加三，3 = 个位）。在数位表上加减（`place_value_trade`，决定 0026）不能被课点按：课用它的 `finished` 演示；凑十（`make_ten`，决定 0027）也不能，课用它的 `filled` 演示。

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

`measurement: "secant"` 测量前两个点（采样点或斜率参考点）：画两点连线、Δx 和 Δy 两条腿（有空间时标出 Δx、Δy），并在图下显示 Δx、Δy 和斜率；两点所在的每条曲线都是直线时读数写“斜率”，否则写“割线斜率”。其后的点（截距、顶点等标记）不影响测量；多于两个点的割线测量需要 `plot:secant-first-two`（0.11），旧播放器在这种情况下不画三角形。前两个点之一因 `hide_when_undefined` 隐藏时（例如拖到 2/(x + 1) 的 x = −1），不画连线和两条腿，读数说明函数在该点的横坐标处没有定义；这样的课程需要 `plot:secant-hide-undefined`（0.12），旧播放器会用隐藏点过时的纵坐标测量。

**分段函数**（0.11，决定记录 0018）：显式曲线可声明区间 `from`、`to`（有限的 x 值；省略一侧表示该侧无界）和端点开闭 `from_closed`、`to_closed`（省略为闭）。播放器只在区间上采样，包含端点；端点在窗口内且函数值有限时，闭端画实心点，开端画空心圆，同一处既有开端又有闭端时实心点在上。函数在端点没有有限值（如 1/x 在 0）时不画端点。同一函数的各段写相同的 `series` 名（小写字母、数字、连字符，至多 32 个字符），颜色、线型和图例按一个函数处理，探索模式里一起显示和隐藏。同一函数的各段每个 x 至多覆盖一次：区间只能在端点相接，且相接处至多一段包含该端点（否则拒绝）。隐式曲线不能带区间。

**坐标轴上的区间**（0.11，决定记录 0018）：`intervals: [{"as", "axis": "x"|"y", "from", "to", "from_closed", "to_closed", "label"}]`（至多 8 个），用于在横轴上标出定义域、在纵轴上标出值域。`from`、`to` 为有限数或 `null`（无界）；`from <= to`；单个值写成两端相同且都闭的区间。区间画在零轴上，0 不在窗口内时画在边框的下边或左边。窗口内的有限端点画实心点（闭）或空心圆（开）；无界端离开窗口时在边框处画箭头；有限端点在窗口外时不画端点。`from`、`to` 可以绑定变量。

**不存在时隐藏**：`hide_when_undefined: true` 可用于点的 `x`、`y`，函数图竖线 / 横线的 `value`（0.11）和坐标轴区间的 `from`、`to`。表达式在当前取值下没有有限值时，该点、该线或该区间不画，而不是让课程失败；初值时就没有有限值也可以（例如开始时抛物线在 x 轴上方，没有横截距）。值域随参数符号翻转时，写两条区间，各自的端点表达式只在一种符号下有定义。

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
- （0.13）`caption` 显示在场景下方，按 `\n` 分行。数学插件的 `buildSolid` 用它显示程序算出的体积、表面积或面棱顶点数（决定 0019），旧的播放器不画这一行。能力 `scene3d:caption`。
