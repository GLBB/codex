import type { RolloutTrace } from "../shared/types";

export function sampleTrace(): RolloutTrace {
  return {
    schema_version: 1,
    trace_id: "trace-1",
    rollout_id: "rollout-1",
    root_thread_id: "thread-root",
    status: "running",
    started_at_unix_ms: 1000,
    threads: {
      "thread-root": {
        thread_id: "thread-root",
        nickname: "main",
        default_model: "gpt-5",
        execution: { status: "running", started_at_unix_ms: 1000 }
      },
      "thread-child": {
        thread_id: "thread-child",
        nickname: "worker",
        origin: { parent_thread_id: "thread-root" },
        default_model: "gpt-5-mini",
        execution: { status: "completed", started_at_unix_ms: 1500, ended_at_unix_ms: 2200 }
      }
    },
    codex_turns: {
      turn1: {
        codex_turn_id: "turn1",
        thread_id: "thread-root",
        input_item_ids: ["item-user"],
        execution: { status: "completed", started_at_unix_ms: 1100, ended_at_unix_ms: 2100 }
      }
    },
    conversation_items: {
      "item-user": {
        item_id: "item-user",
        thread_id: "thread-root",
        codex_turn_id: "turn1",
        first_seen_at_unix_ms: 1200,
        role: "user",
        kind: "message",
        body: { parts: [{ type: "input_text", text: "请分析 trace" }] }
      },
      "item-assistant": {
        item_id: "item-assistant",
        thread_id: "thread-root",
        codex_turn_id: "turn1",
        first_seen_at_unix_ms: 2000,
        role: "assistant",
        kind: "message",
        body: { parts: [{ type: "output_text", text: "分析完成" }] }
      }
    },
    inference_calls: {
      inf1: {
        inference_call_id: "inf1",
        thread_id: "thread-root",
        codex_turn_id: "turn1",
        model: "gpt-5",
        provider_name: "openai",
        request_item_ids: ["history-user", "history-assistant", "history-tool", "item-user"],
        usage: { input_tokens: 120, output_tokens: 40 },
        raw_request_payload_id: "payload-request",
        raw_response_payload_id: "payload-response",
        execution: { status: "completed", started_at_unix_ms: 1200, ended_at_unix_ms: 1800 }
      }
    },
    tool_calls: {
      tool1: {
        tool_call_id: "tool1",
        thread_id: "thread-root",
        started_by_codex_turn_id: "turn1",
        model_visible_call_id: "call_search",
        kind: { type: "mcp", server: "github", tool: "search" },
        terminal_operation_id: "term1",
        raw_invocation_payload_id: "payload-tool-invoke",
        raw_result_payload_id: "payload-tool-result",
        execution: { status: "completed", started_at_unix_ms: 1600, ended_at_unix_ms: 1700 }
      }
    },
    code_cells: {
      cell1: {
        code_cell_id: "cell1",
        thread_id: "thread-root",
        codex_turn_id: "turn1",
        language: "python",
        source: "print('trace')",
        result: { stdout: "trace\n" },
        terminal_operation_ids: ["term1"],
        raw_payload_ids: ["payload-code-cell"],
        execution: { status: "completed", started_at_unix_ms: 1650, ended_at_unix_ms: 1750 }
      }
    },
    terminal_operations: {
      term1: {
        operation_id: "term1",
        terminal_id: "terminal-1",
        tool_call_id: "tool1",
        kind: "exec",
        request: { cmd: "python cell.py" },
        result: { exit_code: 0, stdout: "trace\n" },
        raw_payload_ids: ["payload-terminal"],
        execution: { status: "completed", started_at_unix_ms: 1605, ended_at_unix_ms: 1695 }
      }
    },
    compactions: {
      compaction1: {
        compaction_id: "compaction1",
        thread_id: "thread-root",
        codex_turn_id: "turn1",
        installed_at_unix_ms: 2300,
        marker_item_id: "item-assistant",
        request_ids: ["inf1"]
      }
    },
    interaction_edges: {
      edge1: { edge_id: "edge1", edge_type: "delegates", source: "thread-root", target: "thread-child" }
    },
    raw_payloads: {
      "payload-request": { raw_payload_id: "payload-request", path: "payloads/request.json" },
      "payload-response": { raw_payload_id: "payload-response", path: "payloads/response.json" },
      "payload-tool-invoke": { raw_payload_id: "payload-tool-invoke", path: "payloads/tool-invoke.json" },
      "payload-tool-result": { raw_payload_id: "payload-tool-result", path: "payloads/tool-result.json" },
      "payload-terminal": { raw_payload_id: "payload-terminal", path: "payloads/terminal.json" },
      "payload-code-cell": { raw_payload_id: "payload-code-cell", path: "payloads/code-cell.json" }
    }
  };
}

export function sampleWireRequest() {
  return {
    model: "gpt-5",
    instructions: "你是 Codex，负责修改代码。",
    input: [
      { role: "user", content: [{ type: "input_text", text: "历史问题" }] },
      { role: "assistant", content: [{ type: "output_text", text: "历史回答" }] },
      { role: "tool", content: [{ type: "output_text", text: "工具输出" }] },
      { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
    ],
    tools: [{ type: "function", name: "shell" }],
    text: { format: { type: "text" } }
  };
}
