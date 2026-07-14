import json
from pathlib import Path
import subprocess
import sys
from typing import Any


PROTOCOL_VERSION = "2025-11-25"
TASK_BOARD_URI = "task://board/current"


class McpBridgeError(RuntimeError):
    pass


class McpBridge:
    def __init__(self, server_path: Path, trace: bool = False) -> None:
        self.server_path = server_path
        self.trace = trace
        self.next_request_id = 1
        self.process: subprocess.Popen[str] | None = None
        self.tools: list[dict[str, Any]] = []
        self.allowed_tool_names: set[str] = set()

    def start(self) -> None:
        self.process = subprocess.Popen(
            [sys.executable, str(self.server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        initialize_result = self._result(
            self._request(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "mimo-agent-demo", "version": "0.1.0"},
                },
            )[1]
        )
        if initialize_result["protocolVersion"] != PROTOCOL_VERSION:
            raise McpBridgeError(
                f"server selected unsupported protocol {initialize_result['protocolVersion']}"
            )
        self._notification("notifications/initialized")
        self.tools = self._result(self._request("tools/list")[1])["tools"]
        self.allowed_tool_names = {tool["name"] for tool in self.tools}

    def close(self) -> None:
        if self.process is None:
            return
        if self.process.stdin is not None:
            self.process.stdin.close()
        return_code = self.process.wait(timeout=5)
        self.process = None
        if return_code != 0:
            raise McpBridgeError(f"MCP server exited with status {return_code}")

    def model_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool["inputSchema"],
                },
            }
            for tool in self.tools
        ]

    def call_tool(
        self,
        model_call_id: str,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        if name not in self.allowed_tool_names:
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"tool is not allowed: {name}"}],
            }

        request_id, response = self._request(
            "tools/call",
            {"name": name, "arguments": arguments},
        )
        print(
            f"BRIDGE model tool_call.id={model_call_id} "
            f"→ MCP request id={request_id} → response id={response.get('id')}"
        )
        if "error" in response:
            return {"isError": True, "protocolError": response["error"]}
        return response["result"]

    def read_task_board(self) -> dict[str, Any]:
        response = self._request("resources/read", {"uri": TASK_BOARD_URI})[1]
        contents = self._result(response)["contents"]
        return json.loads(contents[0]["text"])

    def _request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        request_id = self.next_request_id
        self.next_request_id += 1
        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params is not None:
            message["params"] = params

        self._send(message)
        process = self._running_process()
        assert process.stdout is not None
        line = process.stdout.readline()
        if not line:
            raise McpBridgeError("MCP server exited without returning a response")
        response = json.loads(line)
        if self.trace:
            self._show("MCP SERVER → HOST", response)
        if response.get("id") != request_id:
            raise McpBridgeError(
                f"MCP response id {response.get('id')} does not match request id {request_id}"
            )
        return request_id, response

    def _notification(self, method: str) -> None:
        self._send({"jsonrpc": "2.0", "method": method})

    def _send(self, message: dict[str, Any]) -> None:
        if self.trace:
            self._show("HOST → MCP SERVER", message)
        process = self._running_process()
        assert process.stdin is not None
        process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        process.stdin.flush()

    def _running_process(self) -> subprocess.Popen[str]:
        if self.process is None:
            raise McpBridgeError("MCP bridge has not been started")
        return self.process

    @staticmethod
    def _result(response: dict[str, Any]) -> dict[str, Any]:
        if "error" in response:
            raise McpBridgeError(f"MCP protocol error: {response['error']}")
        return response["result"]

    @staticmethod
    def _show(label: str, message: dict[str, Any]) -> None:
        print(f"\n{label}")
        print(json.dumps(message, ensure_ascii=False, indent=2))
