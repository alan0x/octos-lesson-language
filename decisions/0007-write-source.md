# 0007：内容来源

状态：Proposed
日期：2026-10-31

## 背景

学生输入已有选区来源（OLL-INP-007），但课程中的 `write` 不能声明“由哪个选区派生、由谁确认”。学生讲课中的“整理一下”“画出图像”“变成点”都需要这条关系，检查流程也要据此区分识别错误与孩子自己的错误。

## 决定

- `write` 可带 `source`：

  ```json
  "source": {"selection": "sel-card3-all", "confirmed_by": "learner"}
  ```

  `selection` 必须是本课程某个 `ink` 节点声明过的选区或宿主提供的选区引用；`confirmed_by` 在 v0.6 只允许 `learner`。
- 来源只是元数据，不改变渲染；Runtime 可以据此提供“查看来源”。
- 能力 `write-source` 的执行版本为 0.6.0。

## 原因

来源写在课程里，检查与审核无需旁路数据就能追溯每个整洁公式和图像来自哪段手写。

## 后果

- Schema、校验（引用存在性）、规范化；Canonical `board.create` 保留 `source`。
- 证据：斜率样例卡片 3 的整洁公式与卡片 4 的函数图带来源。
