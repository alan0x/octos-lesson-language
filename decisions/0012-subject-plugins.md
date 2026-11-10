# 0012：学科插件

状态：Proposed（待产品负责人确认）
日期：2026-11-09（学科插件计划，决定 S1–S9：octos-learn `docs/SUBJECT_EXPANSION_PLAN.md`）
取代：[0004](0004-interactive-whiteboard-mvp-boundaries.md) 中“MVP 不实现通用插件系统”一条。0004 的其余各条（共享变量状态、Runtime 留在本仓库、学生原稿单独保存）继续有效。

## 背景

Octos Learn 从数学扩展到物理、化学、生物，并要求数学和其他学科都以插件形式接入。今天数学的能力分散在四个仓库：Coach 的 13 个能力配方和写死在提示词里的规则、Studio 单独实现的面板编译、本仓库的节点与执行能力表、课程包的声明。同一个能力在 Coach 和 Studio 各写一遍（单位圆、正多边形），新学科照此会继续成倍重复。0004 为 MVP 排除了通用插件系统，只允许以后通过“受控、版本化、宿主批准的组件注册表”加入学科组件，但这个注册表从未建立；本仓库实际只有代码内的封闭表 `OLL_NODE_KINDS`、`OLL_EXECUTION_FEATURES`。

## 决定

1. **课程保持声明式。** 课程、课程包和学生课程包只按 ID 和版本引用插件能力，不包含、不下载、不执行任何代码。宿主（Octos Learn、Coach、课程库工具）像安装其他依赖一样安装插件。

2. **插件是第一方代码包。** 先作为本仓库的 `packages/plugin-*` 发布（`plugin-shared`、`plugin-math`、`plugin-physics`……），与 Runtime 同版本演进；发布节奏分开后再迁出。暂只接受第一方插件，不设计第三方签名与审核。

3. **插件分两层。** 同一个插件 ID 分成两部分，分别放在不同仓库：

   | 层 | 位置 | 内容 | 使用者 |
   | --- | --- | --- | --- |
   | 通用层 | 本仓库 `packages/plugin-<id>`，以 `octos-lesson-language/plugin-<id>` 导出 | 清单（稳定 ID、语义化版本、依赖的插件、支持的 OLL Core 版本范围）；学科说明（Jev 学科判断题中的一个选项）；配方构建器（中立输入 → OLL authoring 内容，见下）；可选的 Runtime 扩展；样例课程与金标准输出；资源及其来源与许可 | Coach、Octos Learn（Studio 与播放器）、课程库 |
   | 生成层 | learning-coach `src/plugins/` | 提示词规则、Provider Schema 片段、配方卡片与编写指导、后续小节的程序事实、生成与校验钩子；它们只针对 Coach 的 Lesson Plan 格式 | Coach |

   配方构建器的输入不依赖 Coach 的 Lesson Plan，也不依赖 Studio 的录制格式：只有配方参数（如半径、边数初值）、绑定数值的变量表达式、文案（标题、标签，由调用方按语言给出）。输出是 OLL authoring 内容及稳定的部件名。Coach 和 Studio 各自把自己的格式转换成这个输入，再调用同一个构建器。部件名由构建器决定；调用方已保存的旧部件名（例如 Studio 录制里引用的部件）由调用方在编译时映射到新名字。

4. **配方与扩展分开。** 配方只编译成已有 OLL（含已安装的扩展），不引入新的执行语义；需要新的状态、交互或渲染时才写 Runtime 扩展。Coach 和 Studio 调用同一个配方构建器，不再各自实现。

5. **执行能力可组合。** 插件能力用命名空间 `plugin:<插件>/<能力>@<主版本>`（例如 `plugin:physics/vectors@1`），每个能力对应插件的最低版本。宿主启动时把 Core 表与已安装插件的表合成执行能力表；`deriveExecutionRequirements` 同样报告插件能力。播放器缺少插件或版本过低时，在播放前明确拒绝并说明缺什么。插件不得删除或改变已经声明过的能力版本，已发布课程因此始终可播放。

6. **校验边界不变。** 变量、受限表达式、引用和执行要求仍由 Core 校验；插件为自己的节点内容注册校验器，不能绕过 Core，也不能引入 `eval`、`Function` 或脚本扩展（沿用 0004）。

7. **来源与兼容声明。**
   - 编译出的课程在编译元数据中记录使用的插件及版本，与执行要求分开。
   - 课程包在已有的 `requiredCapabilities` 中声明插件能力。
   - Octos Learn 的学生课程包清单新增可选的 `oll: {minimumPlayerVersion, requiredCapabilities}`，与头像能力列表分开（决定 S7）。

8. **数学是第一个插件。** Coach 先在自身内部把 13 个配方、提示词规则、小节事实和钩子按 `math`、`physics`、`shared` 拆成生成层（learning-coach #43、#44），迁移前后的模型请求和生成的课程逐字节相同（请求摘要金标准，learning-coach #42）。随后逐个配方把构建器移入通用层：先迁 Coach 和 Studio 各写了一遍的单位圆与正多边形，以 Coach 现有输出为准，Studio 映射旧部件名；再迁其余配方。

插件接口草图（以实现为准）：

```ts
// 通用层：octos-lesson-language/plugin-<id>
interface SubjectPlugin {
  manifest: { id: string; version: string; depends: Record<string, string>; ollCore: string };
  subject?: { description: Localized };            // shared 插件没有学科选项
  builders: Record<string, RecipeBuilder>;         // 例如 math: unit_circle_projection
  runtime?: RuntimeExtension;                      // 新节点、绑定、任务、校验、渲染
  samples: SampleLesson[];
}
type RecipeBuilder = (input: {
  as: string;                                      // 调用方给的节点别名
  parameters: Record<string, unknown>;             // 配方参数
  numbers: Record<string, { expression: string; initial: number; min?: number; max?: number }>;
  text: Record<string, string>;                    // 标题、标签，调用方按语言给出
}) => { actions: AuthoringAction[]; parts: Record<string, string> };
interface RuntimeExtension {
  features: Record<string, { minimumPluginVersion: string }>;   // "plugin:physics/vectors@1"
  nodeKinds?: NodeKindDefinition[];
  bindings?: Record<string, Record<string, string[]>>;
  validate?(node: unknown, path: string): void;
  render?: WebRenderer;
}

// 生成层：learning-coach src/plugins/<id>.ts（只给 Coach 用）
interface CoachSubjectPlugin {
  manifest: { id: string; version: string };       // 与通用层同一个 ID
  recipes: Record<string, RegistryEntry>;          // 卡片、数值输入、部件、指导
  schema_properties: Record<string, JsonSchemaProperties>;
  prompt_rules: Partial<Record<PromptSlot, string>>;
}
```

## 原因

把一个学科能力的提示、Schema、编译、渲染和 Studio 工具放在同一个包里，新学科只增加一个插件，不再分散修改四个仓库，也不会在 Coach 和 Studio 重复实现。课程保持声明式，模型生成或共享下载的课程就不可能在孩子的设备上执行代码；执行能力表仍然决定播放器能否播放，兼容检查与今天相同。

## 后果

- **本仓库**：执行能力表与节点类型表改为 Core + 已安装插件的组合；新增插件注册接口、插件清单校验和一致性测试（缺少插件、插件版本过低、未知插件能力）。每个 Runtime 扩展仍需要自己的决定记录、Schema、Reducer、Web Runtime、headless 金标准和不支持时的降级（沿用 0004）。
- **learning-coach**：保存各插件的生成层；配方编译调用通用层构建器；按 Jev 选定的插件裁剪请求，设载荷上限。
- **octos-learn**：Studio 面板调用通用层构建器，并把已保存录制中的旧部件名映射到构建器的部件名；学生课程包清单增加 `oll` 声明；播放器启动时注册插件。
- **octos-course-library**：校验器使用合成后的执行能力表。
- 三个仓库使用同一个 OLL 版本（2026-11-09 已提交把 Coach 和课程库对齐到 `350d5e0` 的 PR：learning-coach #39、octos-course-library #10）。
