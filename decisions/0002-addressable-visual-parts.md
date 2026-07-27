# 0002：图片与图示内部元素必须可寻址

状态：Accepted for exploration
日期：2026-07-27

## 背景

几何辅助线课程要求老师能够：

- 指向学生图片中的顶点和中点标记；
- 从图片抽象出 diagram；
- 在 diagram 内部连接两个点；
- 强调已经画出的辅助线；
- 在后续证明中反复引用边、区域和线段。

仅有一个不可分割的 image 或 diagram node 无法表达这些课堂动作。

## 决定

- `regions`、`elements`、`edges` 与已有 `fragments`、`points`、`guides` 一样，都是 node 内可寻址 fragment；
- image region 引用宿主预处理产生的受控 `source_region`，模型不输出像素坐标；
- diagram edge 端点和 region 成员必须引用同一 diagram 内 element；
- Normalizer 将局部引用转换为 Canonical fragment ID；
- connection 可以成为 `emphasize` 的目标；
- 同一 diagram 内 fragment 之间的 `geometry_segment` connection 由 Runtime 渲染为图内线段。

## 后果

- 图片分析结果需要在 Session Context 中提供稳定 region ID；
- Reference Validator 必须检查 diagram 内部引用；
- 前端 Runtime 需要区分图内 connection 和白板节点间 connection；
- OLL 仍不允许模型控制图片像素或白板绝对坐标。
