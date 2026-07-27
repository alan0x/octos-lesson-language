# OLL Playback Harness

这是 OLL Canonical Profile 的独立浏览器播放实验室。它回答的是：一份已经通过 Schema、Normalizer、Reducer 和 headless conformance 的课程，是否能在真实浏览器里按课堂节奏逐步出现，并在刷新后继续。

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
- 语义布局、无限画布拖动、缩放和适应全课；
- text、KaTeX math、note、table、plot、image region 和结构化 SVG diagram；
- node、group、connection 与 diagram fragment 的引用呈现；
- 卡片边缘连接、窄间距绕行、标签背景和标签冲突避让；
- localStorage checkpoint 与所选课程的刷新恢复；
- 完整操作时间线和当前 step / beat / phase / revision 调试信息。

内置四份 golden lesson：二次函数配方法、几何辅助线 V2、几何图片辅助线 V1 回归课和英语定语从句。几何 V2 是当前教学可理解性样板，V1 只保留为旧协议和图片 region 回归样本。

## 边界

Harness 不调用模型、不生成 OLL、不播放真实 TTS，也不复刻 `/learn` 的产品外壳。图片暂用带 region 标记的受控占位视图；语音阶段目前以 narration 字幕和时钟代替。下一轮视觉验收会把真实 asset loader、语音时间轴和更完整的板书动画接进同一个 Player Core。

低优先后续项：课程完成后允许学生拖动白板节点。手动位置应作为每个 learner/session 的 layout override 单独持久化，不修改 Canonical OLL 或 Semantic BoardState；节点移动时需要重新计算 group 边界、connection 路径与画布 bounds。播放期间先保持自动布局，避免学生拖动与老师渐进板书争夺位置。

## 验证

```bash
npm test
```

自动测试覆盖渐进呈现、Beat 边界、checkpoint/refresh 收敛、语义布局、几何 V2 教学关键帧和完整 OLL 回归。浏览器验收另外检查课程的连续播放、画布可见性、焦点可读性、几何 SVG、公式横向裁切、暂停刷新恢复与控制台错误。教学门禁见根目录 `TEACHING-PLAYBACK-ACCEPTANCE.md`。
