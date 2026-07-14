# 可运行案例：任务板 MCP Server

## 这个案例解决什么问题

只读规范容易记住名词，却看不到一次调用怎样在 Client、Server 和业务状态之间流动。这个案例用一个内存任务板构造最小闭环：Client 读取任务列表，调用 Tool 新增和完成任务，再次读取同一个 Resource 验证状态变化。

完成案例后，应能具体回答：

1. `initialize` 和 `notifications/initialized` 分别是谁发给谁；
2. Client 为什么要先调用 `tools/list` 和 `resources/list`；
3. Resource 读取和 Tool 调用的数据结构有何不同；
4. JSON-RPC Error 与 `isError: true` 为什么不是同一种失败；
5. Request ID 负责关联什么，不负责表达什么；
6. 为什么 stdio Server 不能把普通日志写入 stdout。

案例只使用 Python 3.10+ 标准库，不需要安装 SDK。代码有意直接展示 JSON-RPC 消息和 MCP 方法，适合学习协议主链；生产 Server 应优先使用成熟 SDK，以获得 Schema 类型、Capability、取消、并发和协议升级支持。

## 文件关系

先打开 [server.py](server.py)。`TaskBoardServer` 保存业务状态，`handle_request` 按 MCP Method 分发请求，`serve` 只负责逐行读取和写回 JSON-RPC。阅读时先关注 `initialize`、`tools/list`、`resources/read` 和 `tools/call` 四个分支；读到 `_call_tool` 后停下来，确认协议分发与业务动作已经分层。

然后打开 [run_case.py](run_case.py)。`McpStdioClient` 启动 Server 子进程并维护递增 Request ID；`request` 展示请求响应关联，`notification` 展示无需 Response 的单向消息。`run_case` 按实际生命周期组织这些 Primitive，而不是直接调用 Server 的 Python 方法。

```text
run_case.py                 server.py                 TaskBoardServer
MCP Client                  MCP Server                business state
    │                           │                           │
    ├── initialize ────────────>│                           │
    │<──────── InitializeResult─┤                           │
    ├── initialized ───────────>│                           │
    ├── tools/list ────────────>│                           │
    ├── resources/read ────────>│──────── read ────────────>│
    ├── tools/call(add_task) ──>│──────── mutate ──────────>│
    └── resources/read ────────>│──────── verify ──────────>│
```

## 运行案例

在仓库根目录执行：

```bash
python3 learning/knowledge_framework/cases/mcp-task-board/run_case.py
```

输出中的 `CLIENT → SERVER` 和 `SERVER → CLIENT` 是 stdio 上实际传输的 JSON-RPC 消息。`SERVER LOG` 来自 stderr，用来证明 stdout 必须专用于协议帧。

案例会依次完成：

1. 协商 `2025-11-25` 协议版本并确认初始化；
2. 发现一个 Resource 和两个 Tool；
3. 读取空任务板；
4. 调用 `add_task` 改变 Server 状态；
5. 重新读取 Resource，观察新增任务；
6. 尝试完成不存在的任务，观察 `isError: true`；
7. 调用不存在的 MCP Method，观察 JSON-RPC `-32601`；
8. 完成真实任务并再次读取最终状态。

`run_case.py` 内置断言。若生命周期、Tool 名称、Resource 内容或业务错误形态不符合预期，进程会以非零状态退出。

## 沿三条链理解输出

### 协议链

`initialize` 建立版本和 Capability 共识，随后 Client 发送 `notifications/initialized`。之后的 `tools/list`、`resources/list`、`resources/read` 和 `tools/call` 才是业务 Primitive。每个 Request 都携带 ID，Response 原样返回该 ID；Notification 没有 ID，也没有 Response。

### 数据链

任务板使用 `task://board/current` URI 表示一个可寻址 Resource。`resources/read` 返回当时的任务快照。`add_task` 和 `complete_task` 则是有副作用的 Tool；它们在 `content` 中返回序列化 JSON，以兼容只读取文本内容的 Client，同时在 `structuredContent` 中返回符合 `outputSchema` 的对象。

同一份任务数据没有被设计成“万能 Tool”。读取状态由 Resource 表达，改变状态由 Tool 表达，控制者、缓存方式和副作用因此更清楚。

### 失败链

完成不存在的任务是合法 MCP Request 触发的业务失败，所以 Server 返回正常 JSON-RPC Result，并在 Tool Result 中设置 `isError: true`。如果 Client 调用不存在的 MCP Method，Server 才返回 JSON-RPC `-32601 Method not found`。

这一区分让 Host 知道连接和协议仍然正常，模型也有机会根据业务反馈修改参数。HTTP 状态、JSON-RPC Error、Tool Business Error 和 Agent 最终失败不应折叠成一个布尔值。

## 有意省略的生产能力

为了让主链保持可见，案例没有实现并发 Request、分页、取消、进度通知、订阅、认证、Elicitation、Sampling、持久化和完整 JSON Schema 校验。它也没有试图成为通用 MCP SDK。

扩展时建议一次只增加一个变量：

1. 给 `resources/list` 增加两个任务板和 Cursor，观察分页属于协议契约而不是业务文本；
2. 新增 `delete_task`，在调用前加入人工审批，区分 Annotation 与最终 Policy；
3. 让长任务发送 Progress，再实现 Cancellation，观察一个 Request 的生命周期；
4. 在 `add_task` 缺少负责人时发送 Elicitation，观察 Server 到 Client 的反向 Request；
5. 将内存状态换成文件后限制可访问根目录，比较 Roots 提示与操作系统 Sandbox；
6. 把 Client 换成 Codex，追踪 MCP Tool 如何进入 Tool Catalog、Approval 和模型 Observation。

做扩展时继续保留原始消息观察器。只有同时看见协议消息、业务状态和 Host 决策，才能判断问题发生在 MCP、Server 实现还是 Agent Runtime。

完成本案例后，可继续运行 [可切换模型 Provider 的 Agent 集成 MCP](../agent-mcp-demo/README.md)。下一个案例复用这里的 Server，但把手写的固定调用顺序替换为真实模型 Tool Calling 和 Agent Loop。
