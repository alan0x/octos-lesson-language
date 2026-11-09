# 0012：学科插件

状态：Proposed（待产品负责人确认）
日期：2026-11-09（学科插件计划，决定 S1–S9：octos-learn `docs/SUBJECT_EXPANSION_PLAN.md`）
取代：[0004](0004-interactive-whiteboard-mvp-boundaries.md) 中“MVP 不实现通用插件系统”一条。0004 的其余各条（共享变量状态、Runtime 留在本仓库、学生原稿单独保存）继续有效。

## 背景

Octos Learn 从数学扩展到物理、化学、生物，并要求数学和其他学科都以插件形式接入。今天数学的能力分散在四个仓库：Coach 的 13 个能力配方和写死在提示词里的规则、Studio 单独实现的面板编译、本仓库的节点与执行能力表、课程包的声明。同一个能力在 Coach 和 Studio 各写一遍（单位圆、正多边形），新学科照此会继续成倍重复。0004 为 MVP 排除了通用插件系统，只允许以后通过“受控、版本化、宿主批准的组件注册表”加入学科组件，但这个注册表从未建立；本仓库实际只有代码内的封闭表 `OLL_NODE_KINDS`、`OLL_EXECUTION_FEATURES`。

## 决定

1. **课程保持声明式。** 课程、课程包和学生课程包只按 ID 和版本引用插件能力，不包含、不下载、不执行任何代码。宿主（Octos Learn、Coach、课程库工具）像安装其他依赖一样安装插件。

2. **插件是第一方代码包。** 先作为本仓库的 `packages/plugin-*` 发布（`plugin-shared`、`plugin-math`、`plugin-physics`……），与 Runtime 同版本演进；发布节奏分开后再迁出。暂只接受第一方插件，不设计第三方签名与审核。

3. **插件内容。** 每个插件提供：

   | 部分 | 用途 |
   | --- | --- |
   | 清单 | 稳定 ID、语义化版本、依赖的插件（如 `shared`）、支持的 OLL Core 版本范围 |
   | 学科说明 | 一句话，作为 Jev 学科判断题中的一个选项 |
   | 能力配方 | 卡片（特征、数值输入、用途、何时选用）、编写指导与示例、参数 Schema 片段、编译器（已校验参数 → OLL authoring 动作）、后续小节的程序事实 |
   | Runtime 扩展（可选） | 新节点类型或内容字段、可绑定属性、任务类型、校验器、Reducer 规则、Web 渲染、headless 测试，以及它们新增的执行能力 |
   | Studio 工具 | 插入面板项、表单、录制事件；调用同一个配方编译器 |
   | 样例与资源 | 每个配方或扩展一节样例课程与金标准输出；图片等资源逐项记录来源和许可 |

4. **配方与扩展分开。** 配方只编译成已有 OLL（含已安装的扩展），不引入新的执行语义；需要新的状态、交互或渲染时才写 Runtime 扩展。Coach 和 Studio 调用同一个配方编译器，不再各自实现。

5. **执行能力可组合。** 插件能力用命名空间 `plugin:<插件>/<能力>@<主版本>`（例如 `plugin:physics/vectors@1`），每个能力对应插件的最低版本。宿主启动时把 Core 表与已安装插件的表合成执行能力表；`deriveExecutionRequirements` 同样报告插件能力。播放器缺少插件或版本过低时，在播放前明确拒绝并说明缺什么。插件不得删除或改变已经声明过的能力版本，已发布课程因此始终可播放。

6. **校验边界不变。** 变量、受限表达式、引用和执行要求仍由 Core 校验；插件为自己的节点内容注册校验器，不能绕过 Core，也不能引入 `eval`、`Function` 或脚本扩展（沿用 0004）。

7. **来源与兼容声明。**
   - 编译出的课程在编译元数据中记录使用的插件及版本，与执行要求分开。
   - 课程包在已有的 `requiredCapabilities` 中声明插件能力。
   - Octos Learn 的学生课程包清单新增可选的 `oll: {minimumPlayerVersion, requiredCapabilities}`，与头像能力列表分开（决定 S7）。

8. **数学是第一个插件。** 现有 13 个配方连同 Coach 提示词中写死的规则和小节事实一起迁入 `plugin-math` 与 `plugin-shared`；迁移前后的模型请求逐字节相同（Coach 的离线载荷测量与上限检查验证）。

插件接口草图（以实现为准）：

```ts
interface SubjectPlugin {
  manifest: { id: string; version: string; depends: Record<string, string>; ollCore: string };
  subject?: { description: Localized };            // shared 插件没有学科选项
  recipes: Recipe[];
  runtime?: RuntimeExtension;                      // 新节点、绑定、任务、校验、渲染
  studioTools?: StudioTool[];
  samples: SampleLesson[];
}
interface Recipe {
  id: string;                                      // 例如 "physics/spring-and-mass"
  card: { features: string[]; numberInputs: string[]; purpose: Localized; whenToUse?: Localized };
  guidance: { rules: Localized; examples: unknown[] };
  parameters: JsonSchema;
  compile(input: ValidatedParameters, context: CompileContext): AuthoringAction[];
  sectionFacts?(state: VisualState): Record<string, unknown>;
}
interface RuntimeExtension {
  features: Record<string, { minimumPluginVersion: string }>;   // "plugin:physics/vectors@1"
  nodeKinds?: NodeKindDefinition[];
  bindings?: Record<string, Record<string, string[]>>;
  validate?(node: unknown, path: string): void;
  render?: WebRenderer;
}
```

## 原因

把一个学科能力的提示、Schema、编译、渲染和 Studio 工具放在同一个包里，新学科只增加一个插件，不再分散修改四个仓库，也不会在 Coach 和 Studio 重复实现。课程保持声明式，模型生成或共享下载的课程就不可能在孩子的设备上执行代码；执行能力表仍然决定播放器能否播放，兼容检查与今天相同。

## 后果

- **本仓库**：执行能力表与节点类型表改为 Core + 已安装插件的组合；新增插件注册接口、插件清单校验和一致性测试（缺少插件、插件版本过低、未知插件能力）。每个 Runtime 扩展仍需要自己的决定记录、Schema、Reducer、Web Runtime、headless 金标准和不支持时的降级（沿用 0004）。
- **learning-coach**：能力注册表、提示词规则和小节事实来自已安装插件；按 Jev 选定的插件裁剪请求，设载荷上限。
- **octos-learn**：Studio 插入面板来自插件；学生课程包清单增加 `oll` 声明；播放器启动时注册插件。
- **octos-course-library**：校验器使用合成后的执行能力表。
- 三个仓库使用同一个 OLL 版本（2026-11-09 已提交把 Coach 和课程库对齐到 `350d5e0` 的 PR：learning-coach #39、octos-course-library #10）。
