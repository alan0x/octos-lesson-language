# Rust / macOS validation development log

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
