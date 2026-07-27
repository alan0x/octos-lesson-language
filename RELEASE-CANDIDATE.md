# OLL v0.1 RC1 决策

## 结论

冻结 OLL Authoring Profile 与 Canonical Profile 的 v0.1 协议表面，进入参考前端 Runtime 集成。

这是 release candidate，不是 stable。它证明当前 DSL 能表达、生成、规范化并 headless 播放跨学科课程；它没有证明真实浏览器中的白板布局、动画、TTS 节奏和儿童教学体验已经合格。

## 已通过的门

- 7 份手写 golden lesson 与 expected state，其中四个 V2 正向教学样板、三个 V1 回归/负向探针；
- 21 个未见案例 × 5 次生成，共 105 次原始输出；
- 边界修订后的旧输出离线重验 103/105；
- 5 个边界案例 × 5 次新生成，25/25 Core-executable；
- 121 堂 Canonical Lesson、15,853 个播放操作、3,297 个动作和 363 条 checkpoint 恢复路径全部收敛；
- 教学质量 v0.2 合并结果 21/21 通过，平均 31.9/32；
- 质量校准：1 个干净对照通过，算错、核心遗漏、臆测画像、交互打断 4 个缺陷样本全部拒绝；
- 当前自动测试 62/62 通过；
- 几何 V2 的真实 Chrome Observer：11/11 Beat、51/51 动作帧通过；
- 二次函数 V2 的真实 Chrome Observer：11/11 Beat、45/45 动作帧通过；
- 图片科学 V2 的真实 Chrome Observer：11/11 Beat、37/37 动作帧通过，真实 PNG 和 region overlay 已加载；
- 英语文本 V2 的真实 Chrome Observer：11/11 Beat、47/47 动作帧通过；
- 几何、二次函数与英语 V1 在同一 Observer 下保持 expected-fail，负向校准未失效。

## RC 冻结规则

- 允许：不改变外部语义的 validator、normalizer、player 和工具修复；
- 允许：新增 fixture、eval、质量合同和观测能力；
- 不允许：无 decision record 地新增 action、target、placement 或更改既有字段语义；
- 任何协议变更必须同时更新 Schema、类型、规范、golden、负例和 playback conformance。

## 已知限制

1. v0.1 只规定动作发生在 narration 前、中、后；不规定词级 cue 或毫秒时间，Beat 内分配由宿主策略负责。
2. Authoring 生成目前仍是 prompt + Schema 文本 + Core 拒绝；完整 Authoring Schema 尚未转换成 Codex response-format 支持的严格子集。
3. 质量 judge 分数存在饱和，且不是独立人类教师。已知缺陷校准降低了风险，但不能替代儿童产品上线前的人类课程审查。
4. Headless Player 与四门正向课的真实 Chrome 布局已经验证，受控图片 asset 已接入；书写动画、TTS 同步和 Octos 形象表现尚未验证。

## 下一门

固定视觉样板扩展到此停止。下一阶段为至少一门正向课接入真实 TTS 时间轴和书写动画，验证 before/during/after speech 动作、暂停恢复和刷新 checkpoint；通过后再设计与 `/learn` 的传输适配，不把旧聊天流程直接接回来。
