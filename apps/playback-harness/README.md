# OLL Playback Harness

这是 OLL Canonical Profile 的独立浏览器播放实验室。它回答的是：一份已经通过 Schema、Normalizer、Reducer 和 headless conformance 的课程，是否能在真实浏览器里按课堂节奏逐步出现，并在刷新后继续。

Harness 是 `octos-lesson-language/web-runtime` 的测试宿主，不再拥有自己的白板 Runtime。课程选择、调试时间线和 fixture catalog 留在这里；播放 session、布局、DOM/SVG 白板、样式与 Observer 来自 `packages/web-runtime`，确保未来 `/learn` 与实验室不会分叉成两套渲染实现。

## 运行

```bash
npm install
npm run harness:dev
```

打开 `http://127.0.0.1:4173`。

## 当前覆盖

- 逐操作、逐 Beat 和自动播放；
- 0.5×—4× 播放速度；
- Canonical Event → Player Core → Semantic BoardState 的唯一状态通路；
- 按语义 ID 增量更新 node/group：已有卡片在 phase、narration、focus、emphasize 等操作之间保持同一 DOM 实例，书写动画只在 `board.create` 新建卡片时触发；
- 语义布局、无限画布拖动、缩放和适应全课；
- text、KaTeX math、note、table、plot、真实受控 image asset/region 和结构化 SVG diagram；
- node、group、connection，以及 math、text、plot、image region、diagram fragment 的引用呈现；
- 卡片边缘连接、窄间距绕行、标签背景和标签冲突避让；
- localStorage checkpoint 与所选课程的刷新恢复；
- 完整操作时间线和当前 step / beat / phase / revision 调试信息。

内置七份 golden lesson：几何、二次函数和英语各有 V2 正向样板与 V1 探针，另有植物蒸腾作用 V2。四个 V2 覆盖证明、代数、图片科学和文本推理；三个 V1 只保留为旧协议、渲染和教学编排的负向回归。

## 边界

Harness 不调用模型、不生成 OLL、不播放真实 TTS，也不复刻 `/learn` 的产品外壳。图片暂用带 region 标记的受控占位视图；语音阶段目前以 narration 字幕和时钟代替。下一轮视觉验收会把真实 asset loader、语音时间轴和更完整的板书动画接进同一个 Player Core。

低优先后续项：课程完成后允许学生拖动白板节点。手动位置应作为每个 learner/session 的 layout override 单独持久化，不修改 Canonical OLL 或 Semantic BoardState；节点移动时需要重新计算 group 边界、connection 路径与画布 bounds。播放期间先保持自动布局，避免学生拖动与老师渐进板书争夺位置。

## 验证

```bash
npm test
```

自动测试覆盖渐进呈现、Beat 边界、checkpoint/refresh 收敛、语义布局、几何 V2 教学关键帧和完整 OLL 回归。浏览器验收另外检查课程的连续播放、画布可见性、焦点可读性、节点挂载身份稳定、几何 SVG、所有卡片类型的横向与纵向裁切、暂停刷新恢复与控制台错误。流式文字卡片按真实 DOM 高度回流；结构化 SVG、plot 与带固有宽高比的图片分别采用匹配其渲染模型的尺寸策略。教学门禁见根目录 `TEACHING-PLAYBACK-ACCEPTANCE.md`。

真实 Chrome 自动观测：

```bash
npm run teaching:observe:geometry
npm run teaching:observe:quadratic
npm run teaching:observe:science
npm run teaching:observe:english
```

Runner 使用 `playwright-core` 驱动已有 Chrome/Chromium，不下载独立浏览器。macOS 会自动发现 Google Chrome；其他环境可通过 `OLL_CHROME_PATH` 指定可执行文件。失败帧写入报告目录的 `screenshots/`，下一次运行会先清理旧失败截图。

`npm run teaching:observe:calibration` 运行几何 V1 负对照。它使用 `--expect fail`，只有 Observer 继续拒绝已知坏课时命令才成功。

`npm run teaching:observe:quadratic` 验收 11-Beat 的配方法 V2 正向样板；`npm run teaching:observe:quadratic-probe` 播放相同主题的旧 V1 expected-fail 探针。两者共用 Runtime 和门禁：V2 全部通过，V1 保留缺少 Beat focus、最终 overview 过小的课程级失败。

`npm run teaching:observe:science` 验收第一份真实图片正向样板。Harness 通过宿主 asset catalog 把 `asset_id` 解析为本地 URL、固有尺寸和 region bounds；Observer 会等待图片完成，并将 pending 或加载失败作为门禁错误。

`npm run teaching:observe:english` 验收 addressable text 正向样板；`npm run teaching:observe:english-probe` 保留同题 V1 expected-fail。四类正向视觉样板完成后的总门禁结论见 `evals/teaching-playback/VISUAL-GATE-RESULT.md`。

Harness 仅为观测器暴露 `window.__OLL_HARNESS__` 测试接口：加载 fixture、逐操作前进、采集 DOM 几何观测和执行确定性门禁。生产 Runtime 不应依赖这个全局接口。
