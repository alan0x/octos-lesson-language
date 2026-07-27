# 配方法表达能力实验

学生请求：

> 请给我讲讲怎么把 y=x²+6x+5 化成顶点式，并说明图像发生了什么。

已知学习者背景：

- 对函数图像有较好的直觉；
- 代数变形时容易漏掉常数项。

本示例验证：

- 一轮讲解连续完成，不等待学生回答；
- 数学 fragment 可以被强调和引用；
- 推导逐步保留，而不是覆盖旧式子；
- 公式与函数图建立关系；
- Lesson 最终形成可缩放的概念组；
- 模型只输出局部别名，Normalizer 负责稳定 ID 和事件 envelope。

文件：

- `lesson.authoring.json`：模型目标输出形式；
- `lesson.canonical.jsonl`：Normalizer 的规范输出；
- `expected-state.json`：Reference Reducer 的最终语义白板。

此示例只证明语言表达和确定性规范化，不证明模型能够生成同等质量，也不证明前端视觉布局已经成立。
