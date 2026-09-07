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

默认框选只确认选中的笔迹。宿主显式调用 `setSelectionTransformEnabled(true)` 后允许拖动及选择框变换，完成后传入 `false` 锁回；切换工具也会锁回。学生和 AI 笔迹使用相同交互及撤销栈。`js-draw` 自动聚焦不得改变宿主镜头。

`setPenColor()` 修改后续笔迹的颜色。框选笔迹后，`setSelectionColor()` 修改选中原稿的颜色，这项修改进入同一套撤销、保存和完整性校验流程。宿主负责提供颜色按钮和工具栏；Ink Runtime 只提供状态和操作，不加载 `js-draw` 的默认工具栏。

`InkDocumentRecord` 保存完整 SVG、格式版本、精确编辑器版本、文档版本、SHA-256 和更新时间。它必须使用独立于 `BrowserLessonSession` checkpoint 的存储键。中文、英文、公式和手绘图形使用同一种 SVG 保存方式。

`captureSelectionSnapshot(onCaptured?)` 在保存前同步冻结 SVG、范围和选区形状；可选回调供宿主在同一时刻捕获局部上下文。纯学生快照仍为 v4，含 AI 的快照为 v5；v5 的 `component_origins` 与持久组件 ID 顺序一致，一并纳入 SHA-256。读取规则保留 v1–v4。组件 ID 不发送给模型。旧解释卡片可用来源存续判断删除，已上板笔迹独立存活。

`writeAiPaths(artifactId, paths, color?)` 只追加已准备好的路径，不接受修改学生组件的命令。整份板书为一次撤销事务。组件持久携带 `data-octos-ink-origin=ai`；无来源的旧组件按 student，非法来源拒绝。复制及擦除子组件保留来源并获得新 ID。

根 SVG 的 `data-octos-ai-writing` 保存消费身份和组件映射，与 SVG 同一 SHA-256/存储记录原子落盘。文档 ID 和存储键提供会话边界，artifact ID 通常为 turn ID。用户擦除或 undo 不删除消费记录，重新发现 artifact 不补字；save 失败可重试当前文档，不重新生成路径。AI 文档使用持久化 v2，纯学生文档仍为 v1。旧客户端拒绝 v2，发布必须先满足最低读取版本；回滚保留新读取器，只关闭新输出。

回放先使用新笔迹文档，结束后 `mergeSavedDocument` 合并原笔迹和消费记录，AI 与学生笔迹一起隐藏/恢复。学习证据消费者不能将 AI/混合快照的整体 SVG 当作学生作品；辅助提问可使用该快照。

`InkRuntimeState.selection_revision` 在每次选中内容变化时递增，即使前后选中的笔迹数量相同。宿主用它取消旧识别结果并重新计算选区工具；组件编号只由 Ink Runtime 在保存选区和检查原稿是否仍存在时使用。

本包复用 `js-draw` 的笔刷、压感、橡皮、选择和撤销栈；Octos 不实现第二套笔画采样或套索算法。硬件触控笔的掌触抑制、延迟和长时间书写仍需在目标设备上验收。
