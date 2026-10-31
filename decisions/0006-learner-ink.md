# 0006：学生笔迹节点与笔迹编辑

状态：Accepted
日期：2026-10-31（用户批准：2026-10-31）

## 背景

v0.1 中学生笔迹只能作为独立 SVG 资源保存（OLL-INP-006/ENV-007），AUTHORING §10 规定它不是 Authoring 节点类型，OLL-INP-001 与 OLL-BRD-008 禁止改写、隐藏或删除。这些规则是为 AI 老师制定的：AI 永远不能擦掉学生的作品。学生讲课时作者是孩子本人，用户已决定（2026-10-31）孩子可以擦除、隐藏、替换自己的笔迹。样例发现：笔迹以 `image` 承载会丢失笔画重现与作者归属；画在组件上的标注若成为独立卡片，会被自动布局移离组件；整洁公式无法原位替换手写。

## 决定

1. **笔迹节点**：新增 `write kind: "ink"`，内容引用冻结的选区快照，而不是可编辑的笔迹文档：

   ```json
   {"snapshot_id": "ink-snap:card3@v4", "sha256": "…", "replay": "stroke_order", "alt": "…",
    "selections": [{"as": "rise", "selection_id": "sel-card3-rise"}]}
   ```

   快照由宿主冻结（选区快照 v4：SVG、范围、SHA-256）；`selections` 映射为可寻址 fragment，可被 `point`/`emphasize` 引用。`replay: "stroke_order"` 时 Runtime 在 `during_speech` 按笔画顺序重现，降低动态效果时直接显示终态。快照缺失或校验失败必须显式失败。
2. **两种归属**：
   - 自由笔记：普通 `place` 关系，参与自动布局；
   - 组件上的标注：`place.relation: "annotates"`，`anchor` 为组件节点。标注不参与排版流，随锚点节点移动和缩放，使用快照记录的相对位置。
3. **笔迹编辑**（仅 `learner_taught`）：
   - `write` 的 `place` 可为 `{"relation": "replaces", "anchor": "<node>"}`：新节点占用被替换节点的位置，被替换节点隐藏但保留在状态中（“整理一下”）。实现时由独立字段 `replaces` 改为放置关系，因为 `write` 本就必须带 `place`，避免两个字段描述同一位置；行为不变；
   - `hide`：隐藏孩子自己的节点；
   - 擦除与重写用已有 `revise` 指向新的快照版本。
   编辑目标只能是本课程中由孩子操作产生的节点。`explain` 课程使用这些动作时被校验器拒绝。
4. **规则范围修订**：OLL-INP-001、OLL-BRD-008 与 AUTHORING §10 增加说明——它们约束 AI 生成的课程；`learner_taught` 课程中由孩子发起的编辑例外。
5. 能力 `node:ink`、`placement:annotates`、`placement:replaces`、`action:board.hide` 的执行版本为 0.6.0。被隐藏或替换的节点之后不能再被引用。

## 原因

引用冻结快照而非笔迹文档，保持“原稿独立保存、通过稳定引用关联”（OLL-ENV-007），课程回放也不随之后的书写变化。原位替换和隐藏是孩子作为作者的正常编辑，不是 AI 改写学生作品。

## 后果

- Core：schema、校验（模式限制、快照引用、selection fragment）、规范化、Reducer 的隐藏与替换状态。
- Web Runtime：快照渲染与笔画重现、`annotates` 布局、替换位置继承、隐藏。
- 证据：斜率样例卡片 1、3 改用 `ink`；新增标注样例（在坐标网格上圈出点 A）；`explain` 课程中的 `hide`/`replaces` 被拒绝。
