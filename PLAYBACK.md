# OLL Headless Playback Profile

状态：Exploration Draft，面向 OLL v0.1 candidate。

## 1. 目的

Headless Playback 把 Canonical Events 编译为可逐步执行、可暂停、可恢复、可审计的课堂操作序列。它不依赖 DOM、Canvas、布局、动画、TTS 或网络，是前端 Learning Runtime 必须遵守的播放语义基准。

它回答的问题不是“最终白板能否归约”，而是：

- 板书是否按 Step → Beat → Phase → Action 渐进出现；
- narration 的开始和结束是否包围 `during_speech` 动作；
- 暂停和刷新后是否能从 checkpoint 恢复；
- 重复动作是否幂等；
- 每个可寻址动作执行时，其依赖是否已经存在；
- 完整播放的最终状态是否与批量 Reducer 完全一致。

## 2. 确定性操作序列

每个 Canonical Lesson 编译为以下操作：

```text
lesson.open
  step.begin
    beat.begin
      phase.begin(before_speech)
        action.apply*
      phase.end(before_speech)
      narration.begin?
      phase.begin(during_speech)
        action.apply*
      phase.end(during_speech)
      narration.end?
      phase.begin(after_speech)
        action.apply*
      phase.end(after_speech)
    beat.end
  step.commit
lesson.close
```

`during_speech` 只表示动作发生在 narration 区间内。v0.1 不规定动作对齐到哪个词，也不规定毫秒时间；这些属于宿主播放策略。

## 3. Projection

Player 在每个操作后产出 Playback Projection：

- `status`：`ready | playing | paused | completed`；
- `cursor` / `total_operations`；
- 当前 `step_id`、`beat_id`、`phase`；
- 当前 narration；
- 当前 Semantic BoardState。

Renderer 只能从 Projection 绘制当前课堂，不得提前读取未来动作并显示最终答案。

## 4. Step commit 与 revision

Action 逐个改变中间 BoardState，但正式 `revision` 只在 `step.commit` 增加一次。暂停在 Step 中间时，checkpoint 会保存当前中间 Projection；恢复后继续剩余动作，不能重复已经应用的 action，也不能提前提交 Step。

## 5. Checkpoint

Checkpoint 至少包含：

- Playback Profile 版本；
- Canonical program fingerprint；
- lesson ID；
- 下一个 operation cursor；
- 完整 Playback Projection。

浏览器 Runtime 若正在播放 `lesson.variable.animate`，还必须保存当前变量值以及动画动作 ID、起点、终点和完成比例。该字段属于浏览器播放恢复信息，不改变 Canonical Lesson；Headless Player 可以忽略它。

恢复时 fingerprint、lesson ID 或 cursor 不匹配必须失败。为避免刷新后自动发声，未完成 checkpoint 恢复为 `paused`，宿主显式调用 `resume()` 后继续。

学生拖动公开变量控件属于宿主输入，不新增或重放 Canonical action。Runtime 先暂停并取消当前变量自动动画，再把学生选择的值写入 Projection 和 checkpoint。之后的 Canonical 变量动作仍可显式改变它。

学生笔迹不进入 Playback Projection 或 Canonical checkpoint。宿主先恢复课程播放器，再从独立 `InkDocumentStore` 验证 SHA-256 并恢复 SVG。课程重放、seek、reset 和模型动作都不能清空或改写该资源。

## 6. Conformance

一个实现合格需要满足：

1. Canonical event sequence 连续、lesson ID 一致、open/close 边界正确；
2. 每个 action 最多改变一次正式状态；
3. 任意 action 后快照都是合法中间状态；
4. 任意 checkpoint 恢复后得到与不中断播放相同的最终状态；
5. 完整播放结果与 `reduceCanonicalEvents()` 深度相等；
6. 未知 op、重复实体 ID、缺失引用、close 后事件必须明确失败；
7. narration/TTS 失败策略由宿主决定，但不得把课堂降级为聊天气泡。

## 7. 非目标

Headless Player 不负责：

- 像素布局和无限画布视口；
- 手写动画和插图渲染；
- TTS 供应商与音频缓冲；
- 模型生成、Skill 或 Session 持久化；
- 教学内容正确性评分。
