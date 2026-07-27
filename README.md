# Octos Lesson Language

Octos Lesson Language（OLL）是一种用于描述 AI 家庭教师课堂行为的渐进式 DSL。

它描述老师在无限白板、语音和虚拟教师组成的课堂中，按步骤说什么、写什么、画什么、强调什么以及如何引用已有内容。它不描述模型思维链，也不是聊天消息格式或 Canvas 绘图 API。

## 当前状态

OLL 处于 **Exploration Draft**。当前目标不是宣布 v0.1 已经成立，而是完成两个可证伪的实验：

1. 表达能力：手写 OLL 是否足以描述真实、渐进、可继续的跨学科课程；
2. 可生成性：目标大模型是否能稳定生成高质量的 OLL Authoring Profile。

在这两个实验通过前，不冻结 v0.1，不承诺兼容性。

## 两个 Profile

```text
Tutor + Learner + Session Context
                 ↓
          Skill + Model
                 ↓
       OLL Authoring Profile
                 ↓ deterministic normalization
       OLL Canonical Profile
                 ↓
      Frontend Learning Runtime
```

- Authoring Profile：模型友好的创作形式，使用局部别名和语义动作。
- Canonical Profile：Runtime 的执行形式，包含稳定 ID、事件顺序、revision 和幂等信息。

宿主生成机械字段；模型只负责课堂内容和教学语义。

## 仓库内容

```text
REQUIREMENTS.md                 语言需求
AUTHORING.md                    模型生成 Profile 规范草案
SPEC.md                         Canonical Profile 规范草案
CONFORMANCE.md                  一致性与测试计划
decisions/                      语言决策记录
schema/authoring/               模型生成 Schema
schema/canonical/               Runtime Schema
packages/reference-js/          零依赖参考 Normalizer/Validator
examples/                       完整课程示例
fixtures/                       非法和恢复测试输入
evals/                          模型可生成性评测
```

## 独立运行

要求 Node.js 20 或更高版本，不需要安装第三方依赖：

```bash
npm test
npm run check:examples
```

## 权威边界

- 本仓库拥有 OLL 规范、Schema、参考实现和 conformance fixtures。
- `learning-coach` Skill 使用已锁定版本的 Authoring Schema 教模型生成 OLL。
- `octos-web` 实现 Canonical Profile 的前端 Runtime。
- Octos 后端负责模型访问、传输、资源和通用持久化，不解释课堂动作。
- Octos Learn 产品目标和体验定义保存在 Obsidian 的 `learning_coach/learn-product-v2/`。

## 当前里程碑

第一里程碑只处理“用配方法理解二次函数”：

- 一份完整 Authoring Lesson；
- 确定性规范化结果；
- 最小结构和引用验证；
- expected semantic state；
- 不依赖浏览器和模型的测试。

完成后再加入几何图片和英语句子结构，检验语言是否过度偏向数学板书。
