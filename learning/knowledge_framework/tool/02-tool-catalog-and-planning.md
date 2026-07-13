# Tool Catalog 与规划

## 为什么需要 Catalog

生产级 Agent 往往拥有几十到数百个候选工具。把全部 Schema 永久塞进模型上下文会消耗 Token、降低选择准确率，还可能暴露当前环境不允许执行的能力。因此，工具列表是每轮规划结果，不只是静态注册表。

```text
Tool Sources
    ↓
Normalize / Filter / Deduplicate
    ↓
Exposure Planning
    ↓
Model-visible Specs + Runtime Registry
```

## 工具来源

### Core

由 Agent Runtime 自带，例如 Shell、Patch、Ask User、Plan 和 Image。定义和 Handler 随程序发布。

### Hosted

由模型服务实现和执行，例如 Hosted Web Search。Host 不提供本地 Handler，但仍要根据 Provider、Model Capability、Feature、网络模式和产品策略决定是否把 Hosted Spec 放进本轮模型请求，并填入允许域名、搜索模式或用户位置等请求配置。

因此要区分：

```text
Server implementation：服务端实际执行能力
Local request declaration：客户端为当前 Turn 启用和配置能力
```

服务端支持某项工具，不等于所有请求都自动获得该工具。

### MCP 与 App

MCP Tool 定义可以来自独立 MCP Server，也可以来自 App 后端暴露的 MCP Tool Catalog。Catalog 必须处理连接状态、认证、Allowlist、Denylist、名称清洗和服务端 Schema 变化。

这里需要区分三个层次：

| 概念 | 层次 | 主要职责 |
| --- | --- | --- |
| App | 产品层 | 用户安装、启用、授权和使用的完整外部服务集成 |
| Connector | 集成层 | 连接外部服务，管理 Provider、OAuth、用户身份、Scope 和操作映射 |
| MCP Server | 协议层 | 通过 MCP 暴露 Tools、Resources、Prompts 等能力 |

在当前 OpenAI 产品术语中，原来的 Connector 已主要改称 App，源码、配置和兼容字段仍可能保留 `connector_id` 等名称。架构上不要完全画等号：一个 Connector-backed App 可以通过 Connector 访问外部服务，自定义 App 则可以通过 MCP Server 暴露操作；一个直接配置的本地 MCP Server 未必是完整的产品级 App。参见 [OpenAI MCP 与 Apps 术语说明](https://developers.openai.com/api/docs/mcp) 和 [Apps 数据流](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors#understand-data-flow-and-security)。

```text
App
├── 产品 Metadata、启停和管理员策略
├── Connector / Connection
│   ├── Provider、OAuth、用户和租户
│   └── API Scope 与外部服务映射
└── MCP Tool Catalog
    └── Tool Definitions
```

因此 Catalog 的直接输入是 MCP Tool Definition；App 和 Connector 提供它周围的产品身份、认证、连接状态和策略上下文。

### Extension

由宿主扩展贡献执行器。它们通常通过统一 Adapter 进入核心 Registry，避免每种扩展各建一套路由。

### Dynamic

由客户端或运行期动态提供。定义可能随 Session 或 Turn 改变，因此必须明确作用域和生命周期。

## Registry 与模型可见列表

“模型可见工具集合”是当前 Turn 真正告诉模型、允许模型发现或选择的 Tool Definition 集合，包括名称、Description、Schema 和暴露方式。英文资料有时称它为 `Tool Surface`；本文不使用含义不直观的“工具表面”简称。

这两个集合不能混为一谈：

```text
Runtime Registry：系统能够路由的执行器
Model-visible Specs：本轮请求允许模型直接选择的工具
```

Codex 的 `ToolRouter` 同时持有 Registry 和模型可见 Specs。构建入口在 `codex-rs/core/src/tools/spec_plan.rs` 的 `build_tool_router`；最终拆成可见定义和 `ToolRegistry` 的逻辑位于 `build_model_visible_specs_and_registry`。

本地 Tool 通常同时贡献 Runtime 和 Spec；Hosted Tool 只贡献 Model-visible Spec：

```text
Local Tool   = model-visible spec + runtime executor
Hosted Tool  = model-visible spec；execution owned by model service
Hidden Tool  = runtime executor；not model-visible
```

在 Codex 的规划结构中，`runtimes` 最终建立 `ToolRegistry`，`hosted_specs` 只追加到模型可见列表。Hosted Tool 的调用不会再被本地 Router 分发到 Handler。

## Exposure

- `Direct`：初始请求直接暴露，也可进入适用的嵌套执行模式。
- `Deferred`：先注册，等 Tool Search 发现后再把定义交给模型。
- `DirectModelOnly`：只允许模型直接调用，不加入 Code Mode 等嵌套执行模式内部可用的工具集合。
- `Hidden`：保留路由兼容性，但不告诉模型。

打开 `codex-rs/tools/src/tool_executor.rs` 阅读 `ToolExposure`，随后回到 `spec_plan.rs` 看这些状态如何影响 Specs，而不是先研究单个工具。

## 过滤与冲突处理

Catalog 至少需要根据以下条件规划：

- Feature 是否启用；
- Model 和 Provider 是否支持对应调用形态；
- 当前是否存在本地或远程执行环境；
- 用户、项目和组织策略是否允许；
- MCP Server 是否连接并认证；
- 工具是否在 Allowlist 或 Denylist 中；
- 名称和 Namespace 是否冲突；
- Schema 是否超过上下文和协议限制。

MCP 名称规范化位于 `codex-rs/codex-mcp/src/tools.rs`。阅读 `ToolInfo` 后，继续看 `normalize_tools_for_model_with_prefix` 如何保留原始协议身份，同时生成稳定的模型可见名称。

## Deferred Loading 与 Tool Search

Deferred Loading 的目标不是增加一次搜索步骤，而是控制上下文规模：模型先根据简要搜索信息找到能力，再加载具体 Tool Definition。

需要避免两个失败模式：

- 搜索描述太弱，模型不知道该搜什么；
- 搜索结果无限增长，把节省的上下文重新消耗掉。

## Catalog 设计检查

1. Registry 和模型可见工具列表是否分离？
2. 工具定义是否按 Turn、Session 或进程作用域缓存？
3. 名称冲突时是否保留原始路由身份？
4. 不可用或未认证工具是隐藏、拒绝还是延迟加载？
5. 大型工具目录是否有搜索、分页和硬上限？
6. Model Capability 变化时，是否会重新计算本轮模型可见工具集合？
