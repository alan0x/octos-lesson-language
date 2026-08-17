# Authoring Profile Schema

此目录保存模型生成用 Schema。

设计原则：

- 避免 `oneOf` 和 `anyOf`，兼容结构化输出能力有限的模型供应商；
- 使用局部别名，不让模型生成全局 ID；
- 旧白板对象只能通过宿主写入的 `board_context` 暴露为只读别名；
- 公共 JSON Schema 检查基本形状；
- 根据 `do` 的条件字段由 Reference Validator 做语义检查；
- Schema 通过不代表教学内容正确。

`v0.1.schema.json` 仍是探索版本，完成配方法、几何图片和英语结构三个示例后再冻结字段。

`board_context` 不属于模型自由生成的课程内容。宿主把用户明确选择的旧白板对象写成稳定引用，记录目标 Board 和 revision；Normalizer 校验它们与宿主上下文一致，再把局部引用还原为已有 Canonical ID。新课程可以围绕这些对象放置内容、聚焦、指向或连接，但不能用 `revise` 改写旧对象。没有显式引用的普通课程不包含这个字段，Provider 的常规生成 Schema 也不需要为它增加解码状态。
