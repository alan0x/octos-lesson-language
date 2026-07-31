# Invalid fixtures

`manifest.json` 中的每个案例都声明输入基线、确定性 mutation、预期稳定错误码和 JSON path。Core 测试会读取 manifest，而不是在测试代码中隐式复制案例。

当前进入 CI 的案例覆盖 Parser、Authoring Schema、语义引用、受控资源、placement 和未知操作。尚未具备实现的限制类案例（例如数量上限）保留在 `PHASE-0-1-EXIT.md` 的发布阻断清单中，不能用待办注释冒充通过。
