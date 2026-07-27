# Changelog

## Unreleased

### Added

- 建立 OLL 独立仓库。
- 从 Octos Learn 产品文档迁入需求、规范和一致性测试基线。
- 定义 Authoring Profile 与 Canonical Profile 的边界。
- 加入第一份配方法课程表达能力实验。
- 加入几何图片辅助线和英语定语从句完整课程。
- 增加 example manifest 和统一 golden 生成/检查流程。
- 将 image region、diagram element/edge/region 纳入可寻址 fragment。
- 允许强调 connection，并在 Semantic Reducer 中保留其强调状态。
- 保存首轮真实模型 Authoring 生成基线、原始输出、验证结果和人工评分。
- 提取可安装的 `octos-lesson-language/web-runtime` 浏览器模块，统一 Harness 与生产 `/learn` 将使用的播放 session、无限白板、样式和测试门禁。
- 增加 `mountInfiniteBoard()` 宿主 API、独立 Runtime 测试命令、testing 子路径和可安装 tarball 清单。

### Fixed

- Align the Authoring Schema action payload requirements with the reference validator. In particular, `connect` now declares its stable local alias as required.
- Document reference types and the required Session resource-to-local-fragment mapping in the model Authoring contract.
- Align `close.focus` with the validator: it is a non-empty list of existing visual-object aliases, not free-form summary text.
- Allow focus actions and lesson-close focus to target visible connections; connections remain invalid as layout anchors or group members.
