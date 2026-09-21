# Rust / macOS validation development log

## 2026-09-21：最新交接与文档修订

已更新 crate README，纠正仍写仅表达式/四动作、未实现 checkpoint 与 append 的过期描述。当前是四课覆盖的受限 runtime；真实 WASM 编译和浏览器验证仍等待编译目标安装授权。

用户指出 v6 验证应用与 main 界面差异过大。main 产品界面与完整流程尚未迁移，用户未认可其为最终交付。下一 agent 优先建立 main 页面/交互迁移清单，再接入共享核心，不把技术演示当成产品。Android 安装仍需单独确认，完整语音和外围未完成。

接手先读 [Agent 交接入口](/Users/alan0x/Documents/projects/YY/working/octos-learn/2026-0919-makepad数学渲染与去webview化调研/AGENT_HANDOFF_CURRENT.md)。本轮只改文档，不改变代码、二进制或既有测试结论。下文保留历史阶段记录。

## 2026-09-21 — first independently testable migration unit

- Branch: `codex/rust-runtime-macos-validation`, based on latest remote main `2b93d67ffc30075edb3d3f34b848f799a46717f2` checked on this date.
- User selected route B: shared Rust runtime, native Makepad adapter and later WASM adapter. TypeScript cannot execute in the Octoscript environment.
- Location: `crates/oll-runtime`; no Makepad dependency in the shared core.
- Ported the expression evaluator from `packages/core/src/math-expression.ts`.
- Validation: offline cargo tests for precedence, Unicode operators, functions, JavaScript negative rounding, malformed expressions and nonfinite results passed.
- Scope: expression evaluator only; full canonical validation, scheduling, checkpoints, WASM and rendering are not claimed complete.
- Next validation course: `examples/unit-circle-sine/lesson.canonical.jsonl`, unchanged real canonical input.
- Android APK parked at user request; installation still requires explicit confirmation.

## Restricted canonical preview slice

- Loads the unchanged unit-circle-sine JSONL; validates envelope order and rejects unsupported action/node kinds explicitly.
- Implements board.create, board.connect, board.focus and lesson.variable.animate, with variable bounds and binding reevaluation. Input clock deltas are supplied by the host.
- Tests verify both diagrams at theta=pi/2, action ordering, pause-equivalent zero elapsed time, terminal focus and invalid input.
- This is deliberately named `Preview`: it does not claim schema-complete validation, production narration scheduling, checkpoint compatibility, or student-task support. The native shell uses an explicitly labelled two-second preview pace between actions, with protocol-derived animation durations.
- User's macOS-first direction permits an early visible validation slice; Android stage gates remain open. This does not mark phase 0/1 fully complete.


## 2026-09-21 — estimated-narration scheduling and reference checks

- User reviewed the first macOS app and confirmed plots, animation, play, pause, resume and restart; continue implementation without another permission gate.
- Rechecked both remote main hashes: unchanged. Continued existing feature branches.
- Added `session` and `timing`: compile 19 operations from the real unit-circle course, retain before/during/after speech boundaries, wait for estimated narration, own pause/resume and animation timing in Rust.
- Generated oracle fixtures by bundling and executing existing TypeScript with already installed esbuild, without installing tools. Includes 7 multilingual narration samples, operation delays, final state and a controlled-clock BrowserLessonSession timeline.
- Found/fixed a genuine state mismatch: mutable JSON indexing inserted absent `arcs`/`circles` arrays as null. Binding now uses non-inserting access. Numeric JSON encoding is compared by exact f64 value, not Rust integer/float enum representation.
- Preserved existing narration budgeting during animation (animation time is not deducted). No silent teaching-policy change.
- Scope remains estimated narration at 1x with the supported four actions. This is not full runtime/phase-1 completion. Next: native shell integration and native formula samples.

## 2026-09-21 配方法课程动作扩展

用户已人工验收全部公式样本，继续接入真实课程。远端 main 仍为 2b93d67，继续原特性分支；底层依赖保持项目指定版本。

新增 math/note/text 节点、board.group、board.emphasize、teacher.point、board.revise；focus 与 placement 支持已有组。强调追加到对象的 emphasis 数组，revision 整体替换 content，均依现有 TypeScript reducer。teacher.point 在语义状态中不改变白板；新增 last_point 仅供原生适配器提示“最近指向”。连接/强调/指向目标按旧 reducer 验证所属对象，未宣称替代完整 canonical schema 验证。

原版 quadratic 的全部 25 个动作逐个比较 nodes/connections/groups/focus，操作流与 TypeScript oracle 一致；完成状态和已提交步骤一致。另验证中途暂停、恢复、重新加载、revision 替换、无效组成员拒绝。cargo test --offline --locked 全部 11 项通过。尚未实现完整 checkpoint、WASM、语音与流式输入。

## 2026-09-21：空间布局与取景规则

用户确认配方法课程验证通过，继续推进。远端 main 仍为 2b93d67，沿用特性分支。新增 spatial 模块：接收渲染层测量的节点尺寸，计算相对放置、对齐、间距、碰撞避让、嵌套组范围及相机取景；核心不依赖 Makepad 或系统时钟。

范围明确为单个 canonical 区域、已按课程创建顺序出现的节点。采用 Web semantic 布局对应分支（间距 28/54/88、组外边距 34、碰撞步长 36、超长列换列），尚不包含 reading lanes、宿主障碍与附件、多区域及复杂关系重排；多区域和无法解析的锚点显式报错。相机复用 Web 无遮挡视口取景公式，缩放范围自动 0.18–1.3，手动至 2.5；具体过渡时长由宿主决定。

直接执行现有 TypeScript 生成 oracle，对两门课全部 30 个动作后的布局（统一输入尺寸）逐一对照；8 个取景案例、鼠标锚点缩放、相对对齐/overlay 通过。核心合计 14 项测试通过。原生实际测量会带来与 Web 不同的卡片尺寸，因此不承诺两端像素位置一致。

取景过渡补充：核对到 Web styles.css 的 transform 使用 680ms cubic-bezier(.22,1,.36,1)。共享 Camera 插值改用这条曲线（先反解 x，再求 y），宿主使用相同时长；测试仍全部 14 项通过。暂停时宿主冻结过渡，避免课程暂停后画面继续移动。此前说明“宿主决定时长”指 API 分工，不再使用初版试验的 450ms。

动画取景目标补充：对照 Web variableAnimationFocusTargets，只选择表达式真正引用当前变量的绑定节点及函数曲线，使用标识符边界和不区分大小写匹配，避免 theta 误匹配 theta2/mytheta。新增隔离用例通过；核心合计 15 项测试通过。

## 2026-09-21：连续推进第 1～5 步，连线路由

- 用户要求集中推进至 Android 手写与语音接入后再交付人工验证；Android 安装仍需另行确认，当前仅授权开发和打包。
- 重新核对 OLL main 为 2b93d67、应用 main 为 b670417，沿用已有 codex 特性分支。
- 将 Web 的正交路径、障碍评分及标签避让移入共享 connections 模块；Makepad 消费计算结果。
- 通过实际执行原 TypeScript 生成 16 组对照样本，覆盖四种位置、内部端点及障碍；发现并修复重复折返点压缩差异。
- 核心共 16 项测试通过。当前迁移的是路线与标签几何；原生绘制和整体第 1 步仍需验证。

## 2026-09-21：进度兼容与增量事件

- 新增 Session checkpoint/restore/append：恢复默认暂停，保留变量动画、操作等待和讲解剩余时间；增量输入完整校验后原子替换，重发去重、缺序/冲突/关闭后新增事件拒绝。
- 兼容旧 octos.playback.checkpoint 0.1：按原事件顺序计算 JSON.stringify/UTF-16 FNV 指纹，校验课程、操作序号、重建板书及变量，迁移旧动画进度。
- 决策：原生更精确的调度状态用独立 octos.rust.playback.checkpoint 0.1 profile 存储，不冒充旧格式；旧文件可读取，不原地改写。当前仍限定已支持动作，遇到未支持语义显式失败。
- 为保持属性插入顺序启用 serde_json preserve_order；离线使用缓存 indexmap 2.14.2/equivalent 1.0.2/hashbrown 0.17.1 并更新锁文件，未升级配套 Makepad。
- 直接执行现有 TS 播放器生成两门课程的动作/步骤/结束及动画中途进度样本；检查 Unicode、数值记法与整数键顺序。原生数值比较允许 1e-12 的 libm 差异，不混淆 JSON 整数/浮点表示。
- 19 项核心测试通过。恢复后的节点、分组、连线、焦点与旧播放器样本相符；本机进度 UI 重启测试另见应用日志。

## 2026-09-21：多区域与宿主布局

- 扩展共享 spatial：独立区域游标、相关图像拓扑排序、阅读栏、宿主障碍避让、已占位宽度与控件附件，以及区域范围。
- 默认 semantic 布局继续兼容原两门课程；宿主可传入与 Web 同形的 regions 配置。无法定位锚点或无法解决碰撞时返回明确错误，不生成重叠结果伪装成功。
- 执行现有 Web computeBoardLayout，新增 8 组跨区域/阅读流/障碍/附件组合对照；原 30 个动作布局及新组合全部通过。当前这部分是共享几何验证，不能替代任意文字尺寸和目标设备显示验收。

## 2026-09-21：统一宿主接口、书写状态与扩展课程

- 为同一 Rust Session 增加 JSON 宿主 API 和无 wasm-bindgen 的 UTF-8 WebAssembly ABI。Web 适配器使用原有 mountInfiniteBoard 显示共享核心输出，不运行第二套 TypeScript 播放器；新增独立四课程预览入口和真实 WASM/原生逐请求对照脚本。
- API 投影保持旧 PlaybackProjection 形状，旧 checkpoint 恢复对照通过。区分完整与增量输入模式，重复事件按旧 JSON.stringify 属性顺序判断，指针长度转换兼容 wasm32。
- 状态：原生 API 测试与 TypeScript 类型检查通过；本机缺少 wasm32-unknown-unknown 编译目标，已向用户请求安装授权，尚未安装。不得把接口代码完成等同于 WASM 编译、浏览器运行或第 4 步验收完成。
- 新增平台无关的书写接入状态：采样坐标按落笔时相机转换、时间戳去重、取消、撤销/重做及世界坐标笔宽。输入批次原子提交。当前用于服务接入验证，不包含旧编辑器笔迹文件导入、橡皮擦或笔迹持久化。
- 新增 quadratic-v2、english-relative-clause 原始课程逐动作对照和旧进度恢复，共覆盖新增 64 个动作。diagram 仅支持 sequence 形态，其他未支持类型显式拒绝。
- 最终核心 23 项测试通过；性能脚本仅测原生 tick 与完整投影序列化，不含 GPU/音频，不替代同设备旧播放器对照。四课程 p95 约 0.07～0.15ms；用户尚未确认体验验收阈值，不据此宣布整机性能达标。
