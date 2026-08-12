# OLL Ink Runtime

这是可选的学生笔迹适配包。它把 `js-draw 1.33.0` 接到 OLL Web Runtime 的镜头和输入控制接口上，但不把学生原稿写进 Canonical OLL。

宿主只在学生进入书写模式时加载本包及其样式：

```ts
const { mountInkRuntime } = await import("octos-lesson-language/ink-runtime");
await import("octos-lesson-language/ink-runtime/styles.css");

const ink = mountInkRuntime({
  board: mountedBoard.view,
  viewport: mountedBoard.elements.viewport,
  storageKey: `ink:${sessionId}`,
  documentId: `${sessionId}:student-ink`,
});
await ink.ready;
ink.setMode("draw");
```

`InkDocumentRecord` 保存完整 SVG、格式版本、精确编辑器版本、文档版本、SHA-256 和更新时间。它必须使用独立于 `BrowserLessonSession` checkpoint 的存储键。中文、英文、公式和手绘图形使用同一种 SVG 保存方式。

`captureSelectionSnapshot()` 冻结学生明确选中的 SVG、白板范围和当时的文档版本，并生成 Octos 自己的 `source_id`。它不暴露或持久化 `js-draw` 内部组件编号。识别和 AI 增强只能引用该快照，不能调用 Ink Runtime 修改原稿。

本包复用 `js-draw` 的笔刷、压感、橡皮、选择和撤销栈；Octos 不实现第二套笔画采样或套索算法。硬件触控笔的掌触抑制、延迟和长时间书写仍需在目标设备上验收。
