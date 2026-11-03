# 0005：学生讲课课程

状态：Accepted
日期：2026-10-31（用户批准：2026-10-31）

## 背景

学生讲课模式中，孩子逐张卡片录课，宿主用确定性代码把录制翻译成 OLL 课程（见 `docs/LEARNER-TAUGHT-V1-FINDINGS.md`）。v0.1 的 `lesson.mode` 只允许 `explain`，课程也无法说明作者是谁、由哪个形象和音色播放，Runtime 会按 AI 老师课程处理。

## 决定

- `lesson.mode` 增加 `learner_taught`。
- `learner_taught` 课程必须带 `lesson.author`：

  ```json
  "author": {
    "kind": "learner",
    "learner_ref": "learner:opaque-id",
    "presented_by": {"avatar_ref": "avatar:fox", "voice_ref": "voice:learner-warm-1"}
  }
  ```

  `learner_ref` 是宿主生成的不透明引用，不得包含姓名、邮箱或学校；`avatar_ref` 与 `voice_ref` 由宿主受控目录解析。`explain` 课程不得出现 `author.kind: "learner"`。
- `learner_taught` 课程中，AI 老师人格、AI 课程专用的后续动作和模型生成提示不生效；Runtime 用 `presented_by` 选择播放形象。
- 仅 `learner_taught` 课程可以使用 0006 的笔迹编辑动作。
- 新能力 `lesson-mode:learner_taught` 的执行版本为 0.6.0；不支持的播放器明确拒绝，不得退回按 `explain` 播放。

## 原因

作者与模式必须在课程本身中声明，播放、检查、分享和审核才能区分孩子的课程与 AI 课程，而不依赖宿主旁路数据。放宽笔迹规则只能限定在作者是孩子本人的课程里。

## 后果

- Schema、校验器、规范化、Canonical `lesson.open` 增加 `mode` 与 `author`。
- 证据：`examples/learner-taught-slope-v1/lesson.proposed.json` 改为正式样例后通过；`explain` 课程带 learner 作者被拒绝。
