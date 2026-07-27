# Authoring Profile Schema

此目录保存模型生成用 Schema。

设计原则：

- 避免 `oneOf` 和 `anyOf`，兼容结构化输出能力有限的模型供应商；
- 使用局部别名，不让模型生成全局 ID；
- 公共 JSON Schema 检查基本形状；
- 根据 `do` 的条件字段由 Reference Validator 做语义检查；
- Schema 通过不代表教学内容正确。

`v0.1.schema.json` 仍是探索版本，完成配方法、几何图片和英语结构三个示例后再冻结字段。
