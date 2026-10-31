# 0008：3D 视角意图

状态：Proposed
日期：2026-10-31

## 背景

`scene3d` 只能声明初始相机；视角变化只存在于学生任务和 Runtime 保存的观看状态中。孩子在卡片中旋转立方体展示底面，无法被记录，回放时讲述与画面不一致。

## 决定

- 新增动作 `view`，表达教学意图而非相机数值（符合 OLL-VIEW-002）：

  ```json
  {"do": "view", "target": "box", "show": "box#bottom-face"}
  {"do": "view", "target": "box", "preset": "isometric"}
  ```

  `show` 引用该场景中的 `highlights` fragment，Runtime 选择能看到它的方向；`preset` 为 `front`、`top`、`side`、`isometric`。两者二选一。
- Runtime 动画过渡；降低动态效果时直接到终态；暂停/刷新后恢复终态视角。学生手动旋转后，后续 `view` 仍生效。
- 宿主从录制生成 `view` 时，把孩子停留的视角映射为最接近的预设或所朝向的高亮部件。
- 能力 `action:scene3d.view` 的执行版本为 0.6.0。

## 原因

意图在不同设备与渲染器上稳定，且与 OLL 不让课程写相机数值的规则一致；学生任务已用同样的“朝向”判断。

## 后果

- Core：schema、校验（目标为 scene3d、`show` 为本场景 highlight）、规范化、Reducer 记录视角意图。
- Web Runtime：由意图计算相机并过渡。
- 证据：新增 3D 样例（六年级长方体表面积，孩子转到底面）。
