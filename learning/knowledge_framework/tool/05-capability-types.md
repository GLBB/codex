# Tool 能力类型

## 分类原则

能力类型描述 Tool 对环境做什么，不描述它通过哪种协议接入。一个 GitHub 写文件工具可以同时是 MCP Source、Function Call 形态和外部写操作能力。

评估能力时，优先比较四个维度：

```text
读取范围 + 写入副作用 + 外部边界 + 恢复难度
```

## File / Search / Patch / Image

文件读取要处理路径规范化、符号链接、敏感文件、编码和输出上限。Search 还要控制目录深度、结果数和忽略规则。Patch 应表达预期旧内容或上下文，避免盲目覆盖并便于生成 Diff。Image 工具需要考虑文件大小、格式、元数据和模型支持的细节级别。

验证重点：可读根、可写根、原子替换、冲突检测、Diff 和回滚能力。

## Shell / Process / Git

Shell 是高能力通用工具，风险不能仅靠命令字符串分类。它涉及环境变量、工作目录、登录 Shell、网络、子进程、PTY 和信号传播。

Git 既可以通过 Shell 执行，也可以由专用工具提供。提交、推送、重写历史和删除分支的副作用不同，应按实际操作而不是“Git 工具”统一授权。

验证重点：Sandbox、命令规则、环境变量过滤、进程树清理、远端副作用和凭据范围。

## Browser / Computer Use

Browser Tool 通常操作 DOM、页面或浏览器会话；Computer Use 操作屏幕、鼠标、键盘和桌面应用。后者观察精度更低、动作范围更广，确认步骤和状态核对更重要。

验证重点：目标窗口、当前页面、下载和上传、登录态、敏感字段、不可逆点击以及动作后的视觉确认。

## Web / API / Database / SaaS

这类工具跨越外部信任边界。读取结果可能过期或包含恶意内容，写操作可能产生真实业务副作用。

Database Tool 应区分只读查询、事务写入和管理操作；API/SaaS Tool 应处理 OAuth Scope、分页、速率限制、幂等键和最终一致性。

验证重点：身份、Scope、域名、数据最小披露、事务边界、重试语义和外部审计记录。

## MCP Tools / Resources / Apps

MCP Tool 是可执行动作，Resource 是可读取上下文。MCP Server 是暴露这些能力的协议端点；App 是用户安装、启用和授权的产品级集成；Connector 则是 App 背后连接外部服务、管理身份、Scope 和操作映射的集成层或历史兼容名称。MCP Server 提供的 Annotation 和 Schema 是重要输入，但 Host 仍需实施自己的过滤、审批和输出治理。

这里从 Tool 系统视角描述 MCP 接入，不表示 Resource 本身就是 Tool。完整 MCP 还包含 Prompts、Sampling、Elicitation、Transport 和生命周期，见 [MCP 学习地图](../mcp/README.md)。

验证重点：Server 信任、认证状态、工具过滤、名称冲突、Prompt Injection、Tool Timeout 和第三方数据政策。

## Plan / Ask User / Agent Control

控制类工具不一定操作文件，却会改变 Agent 的控制流：

- Plan 更新进度和后续步骤；
- Ask User 暂停当前流程并等待输入；
- Spawn / Handoff 创建新的 Agent 执行边界；
- Wait / Cancel / Interrupt 改变并发任务状态。

它们的主要风险是状态错乱、预算失控、死锁、重复委派和错误的完成传播。

验证重点：状态机、作用域、父子关系、预算继承、取消传播和结果合并。

## 选择实现方式

| 情况 | 优先方式 |
| --- | --- |
| 稳定、核心、与本地 Runtime 紧密耦合 | Core Tool |
| 模型服务原生执行 | Hosted Tool |
| 独立外部服务、需要标准化发现 | MCP / App |
| 宿主产品提供专用能力 | Extension Tool |
| 客户端按会话临时注入 | Dynamic Tool |

选择依据不是哪个名字更先进，而是执行位置、信任边界、生命周期、认证和版本责任归谁。
