import json
from pathlib import Path
import subprocess
import sys
from typing import Any


PROTOCOL_VERSION = "2025-11-25"
TASK_BOARD_URI = "task://board/current"


class McpStdioClient:
    def __init__(self, server_path: Path) -> None:
        self.next_request_id = 1
        self.process = subprocess.Popen(
            [sys.executable, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def request(
        self, method: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        request_id = self.next_request_id
        self.next_request_id += 1
        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params is not None:
            message["params"] = params

        self._send("CLIENT → SERVER", message)
        assert self.process.stdout is not None
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("MCP server exited without returning a response")
        response = json.loads(line)
        self._show("SERVER → CLIENT", response)
        if response.get("id") != request_id:
            raise RuntimeError(
                f"response id {response.get('id')} does not match request id {request_id}"
            )
        return response

    def notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        message: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._send("CLIENT → SERVER (notification, no response)", message)

    def close(self) -> None:
        if self.process.stdin is not None:
            self.process.stdin.close()
        return_code = self.process.wait(timeout=5)
        if return_code != 0:
            raise RuntimeError(f"MCP server exited with status {return_code}")

    def _send(self, label: str, message: dict[str, Any]) -> None:
        self._show(label, message)
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.process.stdin.flush()

    @staticmethod
    def _show(label: str, message: dict[str, Any]) -> None:
        print(f"\n{label}")
        print(json.dumps(message, ensure_ascii=False, indent=2))


def result(response: dict[str, Any]) -> dict[str, Any]:
    if "error" in response:
        raise RuntimeError(f"JSON-RPC error: {response['error']}")
    return response["result"]


def read_tasks(client: McpStdioClient) -> list[dict[str, Any]]:
    response = client.request("resources/read", {"uri": TASK_BOARD_URI})
    contents = result(response)["contents"]
    return json.loads(contents[0]["text"])["tasks"]


def run_case() -> None:
    server_path = Path(__file__).with_name("server.py")
    client = McpStdioClient(server_path)

    try:
        initialized = result(
            client.request(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "teaching-client", "version": "0.1.0"},
                },
            )
        )
        assert initialized["protocolVersion"] == PROTOCOL_VERSION
        client.notification("notifications/initialized")

        tools = result(client.request("tools/list"))["tools"]
        assert [tool["name"] for tool in tools] == ["add_task", "complete_task"]

        resources = result(client.request("resources/list"))["resources"]
        assert [resource["uri"] for resource in resources] == [TASK_BOARD_URI]
        assert read_tasks(client) == []

        added = result(
            client.request(
                "tools/call",
                {
                    "name": "add_task",
                    "arguments": {"title": "Trace one MCP call"},
                },
            )
        )
        assert added["isError"] is False
        task_id = added["structuredContent"]["task"]["id"]
        assert read_tasks(client) == [
            {"id": task_id, "title": "Trace one MCP call", "completed": False}
        ]

        missing = result(
            client.request(
                "tools/call",
                {"name": "complete_task", "arguments": {"taskId": 999}},
            )
        )
        assert missing["isError"] is True

        unknown_method = client.request("tasks/unknown")
        assert unknown_method["error"]["code"] == -32601

        completed = result(
            client.request(
                "tools/call",
                {"name": "complete_task", "arguments": {"taskId": task_id}},
            )
        )
        assert completed["isError"] is False
        assert read_tasks(client) == [
            {"id": task_id, "title": "Trace one MCP call", "completed": True}
        ]

        print(
            "\nCASE PASSED: lifecycle, discovery, resource reads and tool calls behaved as expected"
        )
    finally:
        client.close()


if __name__ == "__main__":
    run_case()
