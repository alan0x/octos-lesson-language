# 0003：先用现有 OLL 完成教学可理解性样板

状态：Accepted for V2 experiment
日期：2026-07-27

## 背景

几何辅助线 V1 已通过协议、Reducer 和 headless playback，但学生无法从最终白板稳定复述推理。缺陷同时来自课程创作和 Runtime：diagram 内部连接曾被遮挡，fragment emphasis 未被渲染，`board.focus` 未驱动镜头，课程又把三组证据一次性展示。

OLL v0.1 RC 只允许有证据的兼容性修复。不能因为一个失败样板就立即增加颜色、时间或像素类语法。

## 决定

几何辅助线 V2 使用现有语法完成：

- Beat 表达单个认知变化；
- `connect` 表达 diagram 内 AD；
- `emphasize` 逐对强调 fragment；
- `revise` 逐行扩展 SSS 表格；
- `focus` 驱动当前镜头；
- 普通板书节点保留“已知 → 动作 → 证据 → 结论”。

Reference Runtime 必须兑现 SPEC 已定义的 fragment emphasis 和 focus 语义。实现可以选择视觉样式和镜头参数，但模型仍不能输出颜色、坐标、缩放值或毫秒。

## 当前足够的能力

| 教学需要 | 现有 OLL |
| --- | --- |
| 一步一步讲 | Step / Beat |
| 画出 AD | diagram fragment `connect` |
| 当前对应边 | fragment `emphasize` |
| 旧证据沉淀 | `resolved` emphasis + table |
| 表格逐行增加 | `revise` |
| 镜头聚焦 | `focus` + intent |
| 讲完后总结 | summary node/group + close focus |

## 暂不解决的候选缺口

- diagram 中角弧、直角符号和更精确的几何标记词汇；
- 多组对应关系的显式 visual token；
- 课程完成后的 learner layout override；
- camera transition 风格和动画时长。

只有当 V2 无法在不伪造语义的前提下通过教学可理解性验收，才为上述缺口提出新的 decision record 和 Schema 变更。

## 结果

- 保持 DSL 抽象层，不把 Canvas 实现细节泄露给模型；
- 把“语言不够”和“Runtime 没执行语言”分开；
- V2 的失败将产生可定位的语言证据，而不是主观要求“再丰富一点”。
