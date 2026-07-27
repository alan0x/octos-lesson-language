# 几何图片与辅助线表达能力实验

题目背景：等腰三角形 `ABC` 中，`AB=AC`，`D` 是 `BC` 的中点。学生想理解为什么连接 `AD`，以及这条辅助线如何证明 `AD⊥BC` 和 `∠BAD=∠CAD`。

本示例验证：

- 通过受控 `asset_id` 引用学生图片；
- 引用视觉预处理产生的图片局部 region，而不是让模型猜像素坐标；
- 从原图逐步抽象出可寻址 diagram；
- 在 diagram 内部连接两个 element，形成几何辅助线；
- 强调节点、diagram fragment 和 connection；
- 用关系和分组形成完整证明结构；
- 对视觉识别的不确定性给出明确说明。

`asset-geometry-001#region-*` 是 Session Context 预先提供的受控资源区域。OLL 只引用它们，不保存原始图片路径，也不要求模型输出图像坐标。
