# 15 Shell 与进程生命周期：一次工具调用结束后，命令为什么还在运行

## 从一个反直觉现象开始

模型调用 `exec_command` 运行测试。短测试很快结束，工具直接返回退出码和输出；长测试等待
一段时间后却返回一个 `session_id`，随后模型通过 `write_stdin` 继续等待。第一次工具调用
已经完成，测试进程为什么还活着？

因为工具调用和操作系统进程是两种生命周期：

```text
工具调用：模型与 Agent runtime 的一次协议交互
进程：执行环境中持续占用句柄、输入、输出和权限的资源
```

快速命令可以让两者恰好同时结束；交互命令、开发服务器和长测试会让进程跨越多个工具
调用，甚至跨越当前模型 sampling step。可靠的 Shell 工具因此不是简单的 `spawn` 加
`wait`，而是一套有所有权、状态、输出预算和清理规则的进程管理系统。

## 先分清四个身份

一次长命令中常同时出现多个 id。把它们都叫“命令 id”，后续轮询和排障很快会混乱。

| 身份 | 关联什么 | 典型用途 |
| --- | --- | --- |
| `call_id` | 一次模型工具调用 | 把调用、结果、Hook 和 trace 串起来 |
| `process_id` / `session_id` | 一个持续运行的进程会话 | 后续写输入、轮询或终止 |
| `chunk_id` | 一次返回给模型的输出快照 | 区分多次观察结果 |
| executor process id | 本地或远端的具体执行实例 | 区分 sandbox retry 等实际 spawn |

一次进程可以对应最初的 `exec_command` 和多次 `write_stdin`，因此 `call_id` 不能代替
`process_id`。反过来，同一个逻辑进程 id 在 sandbox 升级重试时也可能产生新的 executor
实例；如果把两个身份合并，旧进程的迟到事件可能污染新进程。

`call_id` 解决关联，不自动提供幂等性。远程写 stdin 如果因网络超时重试，需要独立的
write id 或去重记录，否则同一段输入可能被写两次。

## One-shot 与 Interactive 是两种协议

快速命令走 one-shot 路径：

```text
exec_command
  -> spawn
  -> 等待退出
  -> drain 尾部输出
  -> 返回 exit code + output
```

长命令走 interactive 路径：

```text
exec_command
  -> spawn
  -> 等待 yield time
  -> 进程仍在运行
  -> 返回 session_id + 当前输出
  -> write_stdin(chars="") 轮询
  -> write_stdin(chars="...") 交互
  -> 退出后返回最终 exit code
```

这里的 `yield_time` 只是“本次工具调用愿意等多久”，不是进程 timeout。yield 到期后返回
控制权，让模型或用户决定下一步；进程仍由 runtime 管理。

还要区分四种时间边界：

| 边界 | 到期后的行为 |
| --- | --- |
| initial yield | 返回当前观察，进程可以继续 |
| poll wait | 本次空轮询返回，进程可以继续 |
| command timeout | 终止进程并报告超时 |
| session shutdown | 清理该 Session 拥有的全部进程 |

把这些边界合成一个 `timeout` 参数，会让“没有新输出”“命令运行太久”和“Agent 已经关闭”
变成无法区分的失败。

## 谁拥有后台进程

局部 handler future 不能成为长进程的唯一所有者。工具调用返回或被取消后，如果最后一个
进程 handle 随 future 一起释放，后台任务会意外消失。

更稳定的所有权关系是：

```text
Thread：持久化工作记录，不保存活进程
  -> Session：当前进程内的 live runtime
      -> ProcessManager
          -> bounded ProcessStore
              -> ProcessEntry
                  -> Process handle + state + output + metadata
```

ProcessManager 应在 initial yield 之前保存仍存活的进程。这样当前工具调用结束或 turn 被
打断时，进程仍有明确所有者。相应地还要守住四个不变量：

1. Thread rollout 只保存可重放事实，不序列化 OS handle。
2. `thread/resume` 创建新 Session，不能假装恢复旧进程。
3. ProcessStore 有明确容量目标和淘汰策略，不能让模型无限启动后台进程。
4. Session shutdown 主动终止并移除全部剩余进程。

这解释了第 2 课中的一个结论：进程属于 live Session，不属于可恢复的 Thread 历史。

## 状态机比一个 `exit_code` 更可靠

`exit_code: Option<i32>` 无法表达“尚未启动”“远端失联”“终止中”和“运行时失败”。教学版
至少应建立下面的状态机：

```text
Reserved
  -> Starting
      -> Running
          -> Exited(exit_code)
          -> Failed(message)
          -> Terminating -> Terminated
      -> Failed(message)
```

生产实现不一定用一个 enum 保存全部状态，但必须能回答：进程是否退出、退出码是什么、
是否有 runtime failure、是否被 sandbox 拒绝，以及终止请求是否已经确认。

下面三种结果不能混为一谈：

- `exit 1`：进程成功创建并运行，程序以非零状态结束。
- `spawn failed`：程序根本没有开始运行。
- `transport failed`：远程进程可能开始过，但 runtime 无法继续可靠观察。

模型需要根据第一种结果修改命令；后两种通常要求检查环境或明确停止，不能盲目重放有
副作用的动作。

## 输出是一份事实的多个投影

长进程输出同时服务用户界面、模型、轮询、Hook 和 trace。它们需要同源，却不能共享一个
无限字符串：

```text
PTY / remote output
  ├── live delta -> UI
  ├── retained head/tail buffer -> 后续 poll
  ├── transcript -> begin/end lifecycle item
  ├── bounded tool output -> 模型上下文
  └── preview -> telemetry
```

### 为什么保留头尾

只保留开头会丢掉最终错误，只保留末尾会丢掉命令启动信息。Head/Tail buffer 先保存固定
预算的开头，再用环形尾部保存最近输出；中间被删除时记录 omitted bytes：

```text
first lines
... 82432 bytes omitted ...
last lines including the failure
```

输出治理至少需要三层独立上限：

- retained bytes：runtime 为轮询保留多少原始输出；
- event size/count：客户端一次接收多少 delta、总共接收多少事件；
- model tokens：一次工具结果允许占用多少上下文。

Prompt 截断不能替代前两层。等到构建模型请求时才处理无限输出，进程早已可能耗尽内存或
堵塞事件队列。

### 退出不等于输出结束

子进程退出时，stdout/PTY 管道里还可能有未消费字节。正确顺序是：

```text
observe process exit
  -> 给 output producer 一个有界的关闭窗口
  -> drain 已发布的尾部 chunk
  -> 完成网络审批等迟到判定
  -> 发唯一 terminal event
```

否则 UI 可能先看到“完成”，再收到一段错误输出；模型结果和用户 transcript 也会互相
矛盾。等待必须有上限，避免损坏的输出任务让退出永远卡住。

### 字节流不保证按 UTF-8 字符切分

PTY 和网络返回的是 bytes，一个中文字符可能横跨两个 chunk。UI 事件应缓存不完整后缀，
只在有效 UTF-8 边界发文本；最终模型结果可以用明确的 lossy decoding 策略，但不能让一次
随机 chunk 边界制造乱码。

## `write_stdin` 同时承担写入和观察

对仍在运行的进程，`write_stdin` 有两种语义：

```text
chars 非空：写入交互输入，然后等待一小段输出
chars 为空：不写入，只等待新输出或退出
```

空轮询不能立即返回，否则模型容易形成消耗 CPU 和工具轮数的 busy loop；等待时间也不能
无限长，否则用户取消无法及时生效。可以分别设置空轮询的最小等待和最大后台等待。

不同进程可以并行交互，同一个进程的读、写和 drain 必须串行化。否则两个并发 poll 都会
从共享 buffer 取走一部分输出，模型得到的观察取决于竞争时序。一个 per-process
interaction lock 比把整个 ProcessStore 锁住更合适：它保护单进程协议，同时允许其他终端
继续工作。

## TTY 会改变程序行为

TTY 不只是“让输出好看”。程序会根据是否连接终端改变：

- stdout buffering；
- 是否显示提示符和颜色；
- 是否启动 pager；
- stdin 是否保持打开；
- Ctrl-C 等信号怎样传递；
- stdout/stderr 是否合并成终端 transcript。

因此，调用方必须显式选择是否需要 TTY。非 TTY 命令通常更适合机器消费，但不能在结束后
再假设 stdin 仍可写；交互式 REPL、测试选择器和登录流程则通常需要 TTY。

Agent runtime 还应构造稳定的非交互环境，例如关闭颜色和 pager，设置可预测 locale。
这不是安全边界，但能减少 ANSI 控制字符、分页卡死和平台差异。

## Cancel、Interrupt、Terminate 不是同义词

下面四个动作影响的对象不同：

| 动作 | 影响对象 | 期望语义 |
| --- | --- | --- |
| cancel tool wait | 当前工具 future | 停止等待，决定进程是否继续 |
| interrupt | 进程 | 请求程序自行中断，例如 Ctrl-C |
| terminate | 进程或进程树 | 确保不再继续产生副作用 |
| shutdown | 整个 Session | 终止 manager 拥有的所有进程 |

直接 abort Rust future 并不能证明 OS 子进程已经消失。需要终止进程组或 Windows process
tree；远程环境则需要 await 可确认的 terminate RPC，或者明确报告“终止结果未知”。

终止路径和自然退出路径还会竞争同一个 terminal event。可以用原子 terminal ownership、
状态机或串行 interaction lock 保证最终只发布一次完成事实。重复 end event 不只是 UI
瑕疵，还会让持久化、Hook 和指标重复记账。

## 本地与远程执行共享语义，不共享句柄

上层 ProcessManager 不应到处判断 `if remote`。更清晰的抽象是：

```text
Unified process interface
  -> Local PTY handle
  -> Exec-server process handle
```

两种实现都提供 write、interrupt、terminate、output events 和 exit state；本地实现调用 OS，
远程实现调用 RPC。共享的 ProcessState、output buffer 和 manager 负责把差异归一化。

远程执行还要额外处理：

- 目标环境自己的 shell、cwd 和 PathUri；
- transport 断开时“未启动、仍在运行、已经退出、未知”的区别；
- stdin write 的幂等 id；
- 重连后从哪个 output sequence 继续读取；
- executor 端也必须限制 retained output 和进程数量。

网络超时不能直接触发相同命令重放。除非能证明旧进程未启动，重新执行都可能重复发布、
删除或写入等副作用。

## 安全授权也有生命周期

第 5 课解决 spawn 前是否允许执行：permission profile、exec policy、approval 和 sandbox
共同决定实际请求。但长进程启动后，部分安全资源必须继续存活：

- sandbox 约束持续作用于进程；
- managed network approval 可能保持到进程退出；
- 网络拒绝可能在初次 yield 以后到达；
- sandbox denial retry 必须创建新的实际 executor 实例；
- Hook 和 terminal event 要归因到最初命令，而不是某次空 poll。

一个好设计会让授权对象与进程寿命对齐，而不是在 `exec_command` 返回 `session_id` 时就
提前宣告审批完成。

## ProcessStore 也需要背压

模型可以反复启动开发服务器或长测试。ProcessStore 如果无界，会持续占用进程、PTY、
输出 buffer、网络审批和 watcher task。

达到容量目标时应采用明确、可测试的策略：优先清理已退出且未被交互锁占用的 entry，再
考虑最久未使用的安全候选；不能在一个进程正发布 terminal event 时把它从 store 中抽走。
被淘汰的 live process 必须终止，相关审批和 watcher 也要收尾。当前 Codex 使用 64 个
entry 的软上限：如果已退出进程正在持有交互锁发布终局事件，可以短暂超过上限，避免为了
满足数字而误杀 live process。

全局 store lock 只保护索引和短状态变更。spawn、poll、网络结束和 terminate 等慢操作应在
释放全局锁后进行；每进程锁保护本进程交互。这种锁粒度既避免全局串行，也减少 await
期间持锁造成的死锁和延迟放大。

## 用一次长测试串起全链路

用户要求运行测试，模型调用：

```json
{
  "cmd": "just test -p codex-core",
  "yield_time_ms": 1000,
  "tty": false
}
```

运行时经历：

```text
1. handler 解析参数，解析目标 environment 和 cwd
2. policy / approval / sandbox 生成实际 ExecRequest
3. manager 预留 process id 并 spawn 本地或远端进程
4. output task 开始读取，UI 收到 begin 和 delta
5. 如果进程仍存活，在等待 initial yield 前先放入 ProcessStore
6. initial yield 到期，工具返回 session_id、chunk_id 和当前有界输出
7. 模型用空 write_stdin 等待下一批输出
8. 进程退出，output task drain 尾部内容
9. watcher 发布唯一 end event，poll 返回最终 exit code
10. manager 移除 entry，并完成随进程持有的授权资源
```

这条链中，模型看到的是第 6、7、9 步的有限快照；用户可能持续看到第 4 步的增量；进程
本身由第 3～10 步的 Session runtime 管理。三种视角必须能用 id 和 trace 对齐。

## 动手实验：实现一个最小 ProcessManager

在 `mini-codex-agent` 中加入：

```text
exec_command(command, yield_ms, tty)
write_stdin(session_id, chars, yield_ms)
interrupt_process(session_id)
```

ProcessManager 至少保存：

```text
ProcessEntry {
  process_id,
  original_call_id,
  state,
  stdin,
  output_buffer,
  interaction_lock,
  last_used_at
}
```

完成这些回放：

1. 快速命令在第一次调用内退出。
2. 长命令返回 `session_id`，空轮询最终得到退出码。
3. TTY 程序读取输入，非 TTY 程序拒绝普通 stdin 写入。
4. 大量输出保留头尾并报告 omitted bytes。
5. 多字节 UTF-8 横跨两个 chunk，UI delta 仍是合法文本。
6. 同一进程的两个并发 poll 被串行化，不重复消费输出。
7. interrupt 与自然退出竞争时只产生一个 terminal event。
8. Session shutdown 后 store 为空，进程不再运行。
9. 模拟 remote write 超时，重试没有把同一输入写两次。
10. 达到进程上限后，淘汰结果符合明确策略。

每个回放同时记录：工具结果、UI events、最终 ProcessState 和 store 内容。只断言模型收到的
字符串，无法证明资源已经正确清理。

## 常见误区

- `exec_command` 返回就表示进程结束。返回 `session_id` 时恰恰表示它仍由 manager 持有。
- yield timeout 等于 command timeout。前者结束等待，后者结束进程。
- abort future 会自动杀死子进程。OS handle 和进程树需要独立清理。
- stdout 最后一个 chunk 到达就可以发 completed。还要确认进程状态和输出关闭。
- 所有 output 都保留，最后再截断给模型。内存和事件队列会先失控。
- 用一个全局 mutex 保护所有 terminal。不同进程本应可以并发。
- remote RPC 失败后重新执行最保险。旧进程状态未知时可能重复副作用。
- 把 process handle 写进 Thread，resume 后继续用。只能恢复记录，不能恢复旧运行时资源。

## 理解之后再对照 Codex

先从 `core/src/unified_exec/mod.rs` 顶部的职责说明开始，建立模块之间的关系。接着在
`process_manager.rs` 看 `exec_command` 怎样在 initial yield 前保存 live process，再看
`write_stdin` 怎样用 per-process interaction lock 串行交互。读到返回
`ExecCommandToolOutput` 即可停止第一次纵向追踪。

第二次只追输出：从 `process.rs` 的 `OutputHandles` 看共享状态，再到
`async_watcher.rs` 的 `start_streaming_output` 和 `spawn_exit_watcher`，验证 live delta、尾部
drain 和 terminal event 为什么是不同阶段。Head/Tail 算法单独位于
`head_tail_buffer.rs`。

最后再比较 `process.rs` 中 local PTY 与 exec-server handle 的共同接口，并用
`exec-server/src/local_process.rs` 验证远端为什么还需要 output sequence、retained cap 和
stdin write 去重。安全路径只验证 `process_manager.rs` 调用 `ToolOrchestrator` 的边界，
详细策略回到[第 5 课](05-sandbox-permission.md)。更宽的远程平台设计回到
[第 10 课](10-production-ai-system-design.md)。

## 本课验收

你应该能：

1. 解释工具调用、逻辑进程和 executor 实例为什么需要不同 id。
2. 画出 one-shot 与 interactive exec 的两条路径，并区分 yield、poll 和 command timeout。
3. 说明 ProcessManager 为什么属于 Session，以及 shutdown/resume 时怎样处理进程。
4. 解释 live delta、retained buffer、模型结果和 terminal transcript 的边界。
5. 设计不会重复 terminal event、stdin 写入或副作用的取消与远程重试策略。
6. 用状态、事件和 store 证据验证长进程已经正确退出或被清理。
