# 0001：区分 Authoring Profile 与 Canonical Profile

状态：Accepted for exploration
日期：2026-07-27

## 背景

最初的 OLL 草案要求模型生成 lesson ID、sequence、action ID、Board revision、全局 node ID 和 fragment 引用。这些字段对 Runtime 很重要，但不是教学内容。让模型承担它们会提高无意义的协议错误率，并使模型质量评测混入宿主记账问题。

## 决定

OLL 使用两个 Profile：

### Authoring Profile

由模型生成：

- 使用 Lesson 内局部、可读别名；
- 使用 `write`、`emphasize`、`connect`、`group`、`focus` 等教学动作；
- 描述 narration、教学目的、内容和相对位置；
- 不生成 revision、sequence、全局 ID 和幂等键。

### Canonical Profile

由确定性 Normalizer 生成：

- 使用完整 Lesson Event envelope；
- 添加 lesson、step、beat、action、node 和 group 的稳定 ID；
- 添加 sequence 和 Board base revision；
- 将局部引用解析为 Runtime 引用；
- 转换为 `board.create` 等规范 op。

## 后果

- Runtime 只执行 Canonical Profile。
- Skill 只教授 Authoring Profile。
- 模型不因机械 ID 错误而降低课堂生成成功率。
- Normalizer 成为独立 conformance 的一部分。
- Authoring Profile 仍必须接受引用和教学语义验证，不能把所有错误隐藏到 Normalizer。
