# OLL Teaching Playback Acceptance v0.1

状态：Exploration Draft
日期：2026-07-27

## 1. 目的

本规范定义一份 OLL 课程从“能够执行”进入“学生能够跟随”的最低门槛。它验收的是固定 Canonical Lesson 在参考前端 Runtime 中形成的教学体验，不验收模型生成概率，也不以最终白板看起来完整作为替代。

四个层级必须分别报告：

| 层级 | 问题 | 典型证据 |
| --- | --- | --- |
| Core-executable | 协议是否合法且可归约 | Schema、Normalizer、Reducer |
| Headless-playable | 操作顺序、暂停和恢复是否确定 | Player Core conformance |
| Browser-renderable | 对象是否真实显示且不损坏 | DOM/SVG、公式、遮挡、console |
| Teaching-comprehensible | 学生能否跟上“做了什么、为什么、推出什么” | 关键帧门禁 + 人工盲测 |

前一层通过不能推导后一层通过。“139/139 操作完成”最多证明 Headless-playable 和部分 Browser-renderable。

## 2. 验收单位

验收的最小单位是 Beat，课程级验收由一组关键 Beat 和最终 overview 组成。

每个 Beat 必须可以回答：

1. 这一刻主要想让学生理解什么？
2. 相比上一帧，唯一或主要的视觉变化是什么？
3. narration 中提到的对象在哪里？
4. 这一步依赖的旧证据是否仍然可见？
5. 学生从这一帧应该能够复述什么？

若无法明确回答，不应通过增加更多卡片来掩盖问题。

## 3. 强制门禁

### G1 Referent visibility：讲到的对象必须可见

- narration 提及的 node、fragment、connection 或 group 在对应动作发生后必须真实可见；
- diagram 内部动作必须绘制在 diagram 自己的坐标空间中；
- 唯一教学信息不能只存在于瞬时 pointer、颜色闪烁或已经消失的字幕中；
- 目标不得被不透明节点、画布边界或其他标签遮挡。
- 受控图片必须完成真实加载；region 强调必须落在图片空间的实际 overlay，而不是替代文字标签。

自动证据：目标 DOM/SVG 存在、可见、位于 viewport 或已触发明确 camera focus、无遮挡检测通过。

### G2 Progressive causality：因果链必须渐进形成

- 一个 Beat 只承担一个主要认知变化；
- 结论不得早于所需证据出现；
- 新结论出现时，它依赖的条件应仍可在当前视野中找到；
- 课程不能在最后一次性展示此前未讲过的完整知识图谱。

自动证据：关键节点首次出现顺序、每 Beat 新增教学对象数、依赖对象存在性。

### G3 Focal readability：当前内容必须可读

- active 教学目标必须处于当前 viewport；
- 自动缩放后 active node 的可见宽高不得低于基准尺寸；
- 公式、表格和 diagram 不得依赖学生手动放大才能读；
- overview 缩小只能在完整讲解之后发生。

参考基线：桌面 1280×720 下，active 卡片屏幕宽度至少 240 px；diagram 主要边长至少 120 px；正文等效字号至少 14 px。低于基线必须由人工验收解释。

### G4 Visual correspondence：对应关系必须在共同视野中表达

- “AB 对应 AC”这类关系不能只靠 narration；
- diagram fragment 的强调、表格行和公式 fragment 应在同一 Beat 形成可追踪映射；
- 同一类对应关系使用稳定视觉编码，不得在同一课程中任意换色或换符号；
- 颜色不是唯一编码，还应有文字、标记或位置对应。

这部分目前以人工关键帧验收为主；Runtime 应输出被强调 target 的结构化调试信息。

### G5 Durable explanation：关键解释必须留下板书证据

- narration 可以更自然，但关键条件、变换理由和结论必须沉淀在白板；
- 最终白板应允许学生从“已知 → 动作 → 证据 → 结论”重建课程；
- 系统内部术语不得直接充当学生板书标题；
- 不确定性说明必须与证明采用的正式条件分开，不能制造自相矛盾。

### G6 Overview coherence：最终知识图谱必须有阅读入口

- overview 必须标出起点和方向；
- group 不能只靠大虚线框表达层级；
- 主推理路径与补充说明必须可区分；
- overview 不得因为全局 fit 使核心内容缩小到不可读。

### G7 Subject correctness：学科与对应关系必须正确

- 每个结论均有可定位的先决条件；
- 图中标记、表格、公式与 narration 必须一致；
- 从图片识别出的不确定事实不能被静默升级为确定前提；
- 正确答案不能补偿错误或缺失的中间推导。

学科正确性由版本化 quality judge 和人工样板复核共同承担，不能仅由 Runtime 推断。

## 4. 自动化可检查项

Harness 必须为固定课程输出关键帧观测：

```json
{
  "beat_id": "draw-ad",
  "cursor": 56,
  "visible_targets": ["clean-diagram", "auxiliary-ad"],
  "new_nodes": 0,
  "new_connections": 1,
  "active_target_in_view": true,
  "label_node_overlaps": [],
  "math_errors": 0,
  "console_errors": 0
}
```

第一期自动门禁：

- narration 非空 Beat 至少有一个动作；
- Beat 结束时当前教学目标存在；
- 关键对象首次出现顺序符合 fixture 声明；
- active target 在 viewport 内；
- 外部 connection label 不与 node 相交；
- diagram 内部 connection 使用 diagram SVG；
- KaTeX 无解析错误；
- 任一 Beat 新建 node 超过 3 个时要求显式豁免；
- 刷新恢复到相同 Beat 后观测一致；
- console 无 error/warn。
- lesson image 不处于 pending 且 `naturalWidth > 0`。

自动门禁不判断“讲解是否聪明”“颜色是否真的帮助理解”或“学生是否学会”。

参考实现命令：

```bash
npm run teaching:observe -- --lesson geometry --output evals/teaching-playback/geometry-v2/report.json
```

当前 Observer 在真实 Chrome 中逐操作采样：`action.apply` 帧负责检查当前动作目标可见；`beat.end` 帧负责检查显式 focus、焦点节点完整入镜、最小卡片宽度、正文等效字号、diagram 主要边长和每 Beat 新增节点数。所有采样帧共同检查 KaTeX 错误、所有卡片类型的横向与纵向内容裁切、外部 connection label 与节点相交、diagram connection 内外重复渲染、图片 pending/加载失败和 console warning/error。当前四个正向基准分别为几何 11 Beat/51 动作帧、二次函数 11/45、图片科学 11/37、英语文本 11/47。

## 5. 人工盲测协议

受试者不阅读 OLL、不看调试时间线、不听开发者补充说明，只使用学生界面。

课程结束后回答：

1. 这节课要解决什么问题？
2. 老师做了哪个关键动作？为什么？
3. 结论依赖哪三条证据？
4. 能否按照白板顺序复述推理？
5. 哪一步第一次看不懂？

通过要求：核心问题、关键动作和主要因果链均能复述；局部术语遗忘不直接判失败。测试记录具体卡住的 Beat，而不是只记录“喜欢/不喜欢”。

## 6. 几何辅助线 V2 样板门

| 关键 Beat | 必须看到 | 学生应能复述 |
| --- | --- | --- |
| establish-task | 已知 `AB=AC`、`BD=DC`；求证；干净三角形 | 题目给了什么、要证明什么 |
| draw-ad | AD 在 diagram 内渐进出现并分出两个区域 | 连接 AD 得到两个可比较三角形 |
| match-equal-sides | `AB↔AC` 在图与第一条证据中同步强调 | 第一组边来自等腰条件 |
| match-halves | `BD↔DC` 同步强调 | 第二组边来自中点条件 |
| mark-common-side | `AD↔AD` 同步强调 | 第三组边是公共边 |
| conclude-sss | 三条证据保持可见，出现全等结论 | 三边分别相等，所以 SSS 全等 |
| derive-angle | 对应顶角被强调，出现角平分线结论 | 全等推出对应角相等 |
| derive-perpendicular | D 点两角和平角关系可见 | 两角相等且和为 180°，所以各为 90° |
| overview | 明确的“已知 → 连接 AD → SSS → 两个结论”路径 | 能从入口完整复述 |

## 7. 当前几何 V1 的已知失败

- 首版 diagram 内 AD 被不透明卡片遮挡，违反 G1；
- 图片识别不确定性与正式中点条件混在主推理中，违反 G5/G7；
- 三组对应边在一个 Beat 中同时强调并一次性生成完整表格，弱化 G2/G4；
- 最终 group 形成大范围虚线框但缺少稳定阅读入口，违反 G6；
- 最终 fit 后内容过小，违反 G3；
- narration 本身包含合理解释，但白板没有完整保留解释顺序，违反 G5。

修复单个渲染 bug 不会自动使 V1 通过 Teaching-comprehensible。

## 8. 非目标

- 本规范不要求每堂课都使用同一种布局；
- 不要求暴露模型思维链；
- 不用掌握度百分比代替理解证据；
- 不要求在播放过程中加入提问或等待学生回答；
- 不把课程完成后的自由拖拽作为理解门禁。
