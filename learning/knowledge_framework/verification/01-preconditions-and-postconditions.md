# Preconditions 与 Postconditions

## 契约把“应该可以”变成可检查条件

Precondition 是动作开始前必须成立的条件，Postcondition 是动作宣称成功后必须成立的条件。它们围绕一个具体动作建立局部契约：

```text
Known State
    ↓ check Preconditions
Action
    ↓ observe actual result
Check Postconditions
    ↓
Verified State Transition or Failure
```

如果条件只存在于 Prompt 的自然语言里，却没有进入 Runtime 或 Verifier，它仍然只是期望，不是强制契约。

## Preconditions 应覆盖哪些内容

一个写文件动作可能需要检查：

- 目标路径已经解析到预期 Workspace 内；
- 文件存在，或者契约明确允许创建；
- 当前内容版本、Hash 或修改时间仍与读取时一致；
- 所需权限、审批和凭据有效；
- 参数通过 Schema 与业务语义校验；
- 预算、Deadline 和取消状态仍允许开始；
- 依赖任务已经完成，互斥资源没有被占用。

其中“参数是字符串”属于结构条件，“解析后的路径不能越界”属于语义条件，“用户已经批准该目标”属于权限条件。Schema 只能覆盖第一类，不能代替其余检查。

## Postconditions 应观察真实状态

Postcondition 不应只是重复工具返回值。修改配置后可以检查：

```text
Weak
    patch tool returned success

Stronger
    target file can be read back
    expected key has the new value
    unrelated keys are unchanged
    parser accepts the resulting file
    dependent component observes the new configuration
```

越靠后的检查越接近用户真正关心的效果。实际系统应按风险选择足够强、成本合理的组合，而不是机械地执行所有检查。

## 条件的作用域

```text
Action Postcondition
    “补丁已写入并可解析”
        ↓
Task Postcondition
    “缺陷被修复且回归测试通过”
        ↓
Goal Success Criteria
    “用户场景恢复，兼容性与安全约束保持不变”
```

下层条件是上层判定的证据来源之一，不是上层条件的同义词。多个局部动作都成功，仍可能因为选错方案而没有完成 Goal。

## 谁负责检查

| 条件 | 更合适的检查者 |
| --- | --- |
| JSON 字段、类型和枚举 | Tool Adapter / Schema Validator |
| 路径、资源状态和版本 | Tool Runtime / Domain Service |
| Policy、Approval、Credential Scope | Policy Engine / Authorization Layer |
| 文件内容、进程结果和外部资源 | Post-action Verifier |
| Task 与 Goal 的完成条件 | Agent Orchestrator / Completion Verifier |

模型可以提出需要检查的条件，但权限、安全和关键状态约束不应只依赖模型自觉遵守。

## TOCTOU 与版本漂移

“读取时成立”不保证“执行时仍成立”。Agent 读取文件后，用户或另一个进程可能已经修改它；确认库存后，实际扣减前库存也可能变化。这类 Time-of-check to time-of-use 问题需要：

- 版本号、ETag、Content Hash 或 Compare-and-swap；
- 事务、锁或服务端条件写；
- 写入前在执行边界重新检查；
- 冲突后重新读取与规划，而不是覆盖最新状态。

对外部 API，最好把关键 Precondition 交给真正执行写入的服务原子检查，而不是由 Agent 先查一次再盲写。

## 失败后的状态

Precondition 不满足通常表示动作**没有开始**，但仍要确认是否存在预检查之外的副作用。Postcondition 不满足则至少有三种可能：

1. 动作失败，状态未改变；
2. 动作部分成功，留下需要清理的中间状态；
3. 动作已成功，但 Observation 或确认丢失。

这三者不能统一写成 `failed` 后直接重试。第三种情况需要 Side-Effect Reconciliation，第五篇会详细展开。

## Codex 源码阅读路线

先打开 `codex-rs/core/src/tools/handlers/apply_patch.rs`，从补丁参数进入 `codex_apply_patch::verify_apply_patch_args`，观察结构解析、目标环境选择和真正写入之间的边界。读到补丁执行及结果构造即可，不必立即展开所有 Patch Parser 实现。

随后阅读 `codex-rs/core/src/tools/registry.rs`，确认工具 Handler 外围还会经过 Hook、Telemetry 和错误处理。最后回到 `codex-rs/core/src/session/turn.rs`，观察 Tool Output 回到 Turn 后为什么仍需继续决策，而不是把一次工具成功直接归约成任务完成。

## 本篇检查

1. 每个高风险动作的 Preconditions 能否在执行边界检查？
2. Schema、语义、权限、状态和预算条件是否分开？
3. Postconditions 是否重新观察了真实世界，而非复述返回值？
4. 是否使用版本或条件写处理并发变化？
5. 条件失败时能否区分未执行、部分执行和确认丢失？
6. 动作级成功如何映射到 Task 级 Success Criteria？

---

[返回学习地图](README.md) · [下一篇：Tests、Assertions、Type Check 与静态验证](02-tests-assertions-and-type-check.md)
