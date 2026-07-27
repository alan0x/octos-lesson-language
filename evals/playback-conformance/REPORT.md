# OLL Headless Playback Conformance

日期：2026-07-28

Player Core revision：`1a2e6e0`

## 结果

| Source generation run | Canonical lessons | Passed | Operations | Actions |
| --- | ---: | ---: | ---: | ---: |
| unseen-cross-disciplinary-v1 | 96 | 96 / 96 | 12,645 | 2,591 |
| authoring-boundaries-v0.1 | 25 | 25 / 25 | 3,208 | 706 |
| 合计 | **121** | **121 / 121** | **15,853** | **3,297** |

每堂课均执行：

1. Canonical event sequence、lesson ID、open/close 边界检查；
2. Step → Beat → Phase → Action 的确定性操作编译；
3. 逐 action 生成中间 Playback Projection；
4. 首个、中间、最后 action checkpoint 的序列化、刷新恢复和继续播放；
5. 完整播放最终状态与 `reduceCanonicalEvents()` 深度比较。

共完成 363 次 checkpoint 恢复路径验证，未发现最终状态分歧。所有 narration 的 `during_speech` 动作都位于 `narration.begin` 与 `narration.end` 之间；Step revision 只在 `step.commit` 增加。

## 能证明什么

- 121 份真实模型生成的 Canonical Lesson 可以按课堂操作序列执行；
- 暂停或刷新不会重复已应用 action；
- 逐步播放与批量归约得到相同的正式 BoardState；
- Player Core 可以作为前端 Runtime 的无 UI 语义内核。

## 不能证明什么

- 画布布局、手写动画、视口移动和插图是否好看；
- TTS 音频与动作对齐到具体词语的质量；
- 学科内容正确性和教学法质量；
- 浏览器性能、长课程内存和真实用户操作。

详细报告：

- [`2026-07-27-unseen-v1/REPORT.md`](2026-07-27-unseen-v1/REPORT.md)
- [`2026-07-28-boundary-v01/REPORT.md`](2026-07-28-boundary-v01/REPORT.md)

下一步不再修改播放语义，而是做独立教学质量抽样；通过后冻结 OLL v0.1 candidate，并把 `@octos/lesson-language/player` 接到前端无限白板 Renderer。
