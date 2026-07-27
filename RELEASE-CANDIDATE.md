# OLL v0.1 RC1 决策

## 结论

冻结 OLL Authoring Profile 与 Canonical Profile 的 v0.1 协议表面，进入参考前端 Runtime 集成。

这是 release candidate，不是 stable。它证明当前 DSL 能表达、生成、规范化并 headless 播放跨学科课程；它没有证明真实浏览器中的白板布局、动画、TTS 节奏和儿童教学体验已经合格。

## 已通过的门

- 3 份手写跨学科 golden lesson 与 expected state；
- 21 个未见案例 × 5 次生成，共 105 次原始输出；
- 边界修订后的旧输出离线重验 103/105；
- 5 个边界案例 × 5 次新生成，25/25 Core-executable；
- 121 堂 Canonical Lesson、15,853 个播放操作、3,297 个动作和 363 条 checkpoint 恢复路径全部收敛；
- 教学质量 v0.2 合并结果 21/21 通过，平均 31.9/32；
- 质量校准：1 个干净对照通过，算错、核心遗漏、臆测画像、交互打断 4 个缺陷样本全部拒绝；
- 当前自动测试 37/37 通过。

## RC 冻结规则

- 允许：不改变外部语义的 validator、normalizer、player 和工具修复；
- 允许：新增 fixture、eval、质量合同和观测能力；
- 不允许：无 decision record 地新增 action、target、placement 或更改既有字段语义；
- 任何协议变更必须同时更新 Schema、类型、规范、golden、负例和 playback conformance。

## 已知限制

1. v0.1 只规定动作发生在 narration 前、中、后；不规定词级 cue 或毫秒时间，Beat 内分配由宿主策略负责。
2. Authoring 生成目前仍是 prompt + Schema 文本 + Core 拒绝；完整 Authoring Schema 尚未转换成 Codex response-format 支持的严格子集。
3. 质量 judge 分数存在饱和，且不是独立人类教师。已知缺陷校准降低了风险，但不能替代儿童产品上线前的人类课程审查。
4. Headless Player 已验证顺序、状态和恢复，尚未验证真实白板布局、书写动画、TTS 同步和 Octos 形象表现。

## 下一门

建立独立的前端 playback harness，直接消费归档 Canonical Events，完成至少数学、图片科学、人文学科三堂课的真实视觉与语音验收，并验证暂停、刷新、恢复和无限画布缩放。通过后再设计与 `/learn` 的传输适配，不把旧聊天流程直接接回来。
