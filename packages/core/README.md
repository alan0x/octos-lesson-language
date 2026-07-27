# OLL TypeScript Core

OLL 的正式、可复用 TypeScript 核心，当前负责：

- 用 JSON Schema 检查 Authoring Profile 的结构；
- 检查局部引用、资源授权和动作语义；
- 将 Authoring Profile 确定性规范化为 Canonical Events；
- 生成可比较的 Semantic BoardState；
- 为完整课程示例提供独立测试。

Core 不调用模型，也不处理 DOM、动画、TTS 和像素布局。前端 Learning Runtime 将依赖它播放 Canonical Events；自动 eval runner 依赖它判定模型原始输出能否 first-pass 播放。
