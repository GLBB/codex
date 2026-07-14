import argparse
import json
import os
from pathlib import Path
from typing import Any

from llm_client import OpenAICompatibleClient, PROVIDER_PRESETS
from mcp_bridge import McpBridge


DEFAULT_PROMPT = (
    "请在任务板添加任务‘理解 MCP Tool bridge’，然后完成它，最后告诉我执行结果。"
)
SYSTEM_MESSAGE = """You are a task-board agent.
Use the provided tools to carry out the user's requested task-board changes.
Never invent a task ID: read it from a tool result before completing a task.
If a tool reports an error, inspect it and correct the next call when possible.
After the requested changes are complete, answer the user concisely in Chinese.
"""


def assistant_history_message(message: dict[str, Any]) -> dict[str, Any]:
    history: dict[str, Any] = {
        "role": "assistant",
        "content": message.get("content"),
    }
    if message.get("tool_calls"):
        history["tool_calls"] = message["tool_calls"]
    if message.get("reasoning_content") is not None:
        history["reasoning_content"] = message["reasoning_content"]
    return history


def parse_tool_arguments(tool_call: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    function = tool_call.get("function", {})
    name = function.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("model returned a tool call without a valid function name")

    raw_arguments = function.get("arguments", "{}")
    try:
        arguments = json.loads(raw_arguments)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError(
            f"model returned invalid JSON arguments for {name}: {error}"
        ) from error
    if not isinstance(arguments, dict):
        raise ValueError(f"model returned non-object arguments for {name}")
    return name, arguments


def tool_error(message: str) -> dict[str, Any]:
    return {
        "isError": True,
        "content": [{"type": "text", "text": message}],
    }


def run_agent(prompt: str, max_turns: int, trace_mcp: bool, provider: str) -> None:
    server_path = Path(__file__).parents[1] / "mcp-task-board" / "server.py"
    bridge = McpBridge(server_path, trace=trace_mcp)
    bridge.start()

    try:
        model_client = OpenAICompatibleClient(provider)
        model_tools = bridge.model_tools()
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prompt},
        ]

        for turn in range(1, max_turns + 1):
            print(
                f"\nAGENT turn={turn}: calling {model_client.provider} "
                f"model={model_client.model} with {len(model_tools)} tools"
            )
            assistant = model_client.complete(messages, model_tools)
            messages.append(assistant_history_message(assistant))
            tool_calls = assistant.get("tool_calls") or []

            if not tool_calls:
                content = assistant.get("content")
                if not content:
                    raise RuntimeError(
                        f"{model_client.provider} ended the turn without tool calls "
                        "or final content"
                    )
                print(f"\nAGENT FINAL\n{content}")
                print(
                    "\nHOST RESOURCE VERIFICATION\n"
                    + json.dumps(bridge.read_task_board(), ensure_ascii=False, indent=2)
                )
                return

            for tool_call in tool_calls:
                model_call_id = tool_call.get("id")
                if not isinstance(model_call_id, str) or not model_call_id:
                    raise RuntimeError(
                        f"{model_client.provider} returned a tool call without an id"
                    )

                try:
                    name, arguments = parse_tool_arguments(tool_call)
                    observation = bridge.call_tool(model_call_id, name, arguments)
                except ValueError as error:
                    observation = tool_error(str(error))

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": model_call_id,
                        "content": json.dumps(observation, ensure_ascii=False),
                    }
                )

        raise RuntimeError(f"agent exceeded the maximum of {max_turns} model turns")
    finally:
        bridge.close()


def run_check(trace_mcp: bool) -> None:
    server_path = Path(__file__).parents[1] / "mcp-task-board" / "server.py"
    bridge = McpBridge(server_path, trace=trace_mcp)
    bridge.start()
    try:
        model_tools = bridge.model_tools()
        assert [tool["function"]["name"] for tool in model_tools] == [
            "add_task",
            "complete_task",
        ]
        assert bridge.read_task_board() == {"tasks": []}
        print(json.dumps(model_tools, ensure_ascii=False, indent=2))
        print("\nCHECK PASSED: MCP discovery and model tool conversion are valid")
    finally:
        bridge.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run an OpenAI-compatible model agent over an MCP task board"
    )
    parser.add_argument("prompt", nargs="?", default=DEFAULT_PROMPT)
    parser.add_argument("--max-turns", type=int, default=8)
    parser.add_argument("--trace-mcp", action="store_true")
    parser.add_argument(
        "--provider",
        choices=PROVIDER_PRESETS,
        default=os.environ.get("LLM_PROVIDER", "openrouter"),
        help="model provider preset (default: LLM_PROVIDER or openrouter)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the local MCP bridge without calling a model API",
    )
    args = parser.parse_args()
    if args.max_turns <= 0:
        parser.error("--max-turns must be greater than zero")

    if args.check:
        run_check(args.trace_mcp)
    else:
        run_agent(args.prompt, args.max_turns, args.trace_mcp, args.provider)


if __name__ == "__main__":
    main()
