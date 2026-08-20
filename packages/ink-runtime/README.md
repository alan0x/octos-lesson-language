# OLL Ink Runtime

这是学生笔迹适配包。它把 `js-draw 1.33.0` 提供的画笔、橡皮、框选和撤销能力接入 OLL 白板，但不把学生原稿写进 Canonical OLL。

书写是白板的常驻能力，不是需要进入和退出的独立模式。宿主创建白板时同时挂载 Ink Runtime，并让它跟随白板一起存活：

```ts
import { mountInkRuntime } from "octos-lesson-language/ink-runtime";
import "octos-lesson-language/ink-runtime/styles.css";

const ink = mountInkRuntime({
  board: mountedBoard.view,
  viewport: mountedBoard.elements.viewport,
  storageKey: `ink:${sessionId}`,
  documentId: `${sessionId}:student-ink`,
  locale: "zh-CN",
});
await ink.ready;
```

默认工具是 `navigate`。宿主工具栏调用 `setMode("draw")`、`setMode("erase")`、`setMode("select")` 或 `setMode("navigate")`，这只是切换白板当前工具，不会挂载、隐藏或销毁笔迹。只有整个白板卸载时才调用 `destroy()`。

Ink Runtime 和课程节点是同一个 `world` 的子元素，因此只经过一次共同的平移和缩放。它不创建独立的全屏输入层：白板视口收到的指针事件会根据当前工具交给白板导航或 Ink Runtime。`js-draw` 内部视口固定不动，浏览、缩放或教学镜头移动全部由 OLL 白板控制。

当前框选只负责确认“哪些笔迹被选中”，不会移动、缩放或旋转学生原稿。选择框出现、在选区内拖动以及 `js-draw` 的自动聚焦都不得改变笔迹坐标；颜色修改由宿主工具栏显式触发。

`setPenColor()` 修改后续笔迹的颜色。框选笔迹后，`setSelectionColor()` 修改选中原稿的颜色，这项修改进入同一套撤销、保存和完整性校验流程。宿主负责提供颜色按钮和工具栏；Ink Runtime 只提供状态和操作，不加载 `js-draw` 的默认工具栏。

`InkDocumentRecord` 保存完整 SVG、格式版本、精确编辑器版本、文档版本、SHA-256 和更新时间。它必须使用独立于 `BrowserLessonSession` checkpoint 的存储键。中文、英文、公式和手绘图形使用同一种 SVG 保存方式。

`captureSelectionSnapshot()` 冻结学生明确选中的 SVG、白板范围、选择区域和当时的文档版本，并生成 Octos 自己的 `source_id`。版本 2 把选择区域与 SVG 一起纳入 SHA-256，避免目标区域与原稿分离后被静默替换；读取方仍兼容没有区域信息的版本 1 快照。它不暴露或持久化 `js-draw` 内部组件编号。识别和 AI 增强只能引用该快照，不能调用 Ink Runtime 修改原稿。

`InkRuntimeState.selection_revision` 在每次选中内容变化时递增，即使前后选中的笔迹数量相同。宿主用它取消旧识别结果并重新计算选区工具，不需要读取 `js-draw` 私有组件编号。

本包复用 `js-draw` 的笔刷、压感、橡皮、选择和撤销栈；Octos 不实现第二套笔画采样或套索算法。硬件触控笔的掌触抑制、延迟和长时间书写仍需在目标设备上验收。
