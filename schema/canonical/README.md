# Canonical Profile Schema

此目录保存前端 Runtime 消费的 Canonical Lesson Event Schema。

Canonical Profile 由确定性 Normalizer 产生，不要求模型直接生成。它包含稳定 ID、sequence、Board revision 基线、规范动作和已解析引用。

Schema 只负责结构验证；事件顺序、引用存在性、组循环和幂等由语义 Validator 检查。
