# OLL Lesson 质量评分

每个维度 0–4 分，协议质量与教学质量分开报告。

## A. 协议质量

1. 可解析性：是否为完整 JSON；
2. Schema：是否满足 Authoring Schema；
3. 语义引用：别名、fragment、anchor 和成员是否有效；
4. 完整性：Lesson、Step、Beat 和 close 是否完整；
5. 可规范化性：能否无修复转换为 Canonical Events。

## B. 教学质量

1. 学科正确性；
2. 请求覆盖；
3. 渐进性；
4. 讲述与板书一致性；
5. 白板利用质量；
6. 一轮连续完成；
7. 个性化是否引用真实 Context；
8. 是否产生无证据的学生判断。

## 首次实验记录

- 保留原始模型输出；
- 不做自动 JSON 修复；
- 同时记录 first-pass 和一次明确重试结果；
- 记录模型、provider、参数、Skill commit、Schema commit；
- 人工评分者必须能看到学生请求和全部 Context。
