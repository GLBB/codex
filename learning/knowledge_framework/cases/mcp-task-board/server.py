import json
import sys
from typing import Any


PROTOCOL_VERSION = "2025-11-25"
TASK_BOARD_URI = "task://board/current"


class TaskBoardServer:
    def __init__(self) -> None:
        self.initialized = False
        self.tasks: dict[int, dict[str, Any]] = {}
        self.next_task_id = 1

    def handle_request(self, request: dict[str, Any]) -> dict[str, Any] | None:
        method = request.get("method")
        request_id = request.get("id")
        params = request.get("params", {})

        if method == "notifications/initialized":
            self.initialized = True
            self._log("client confirmed initialization")
            return None

        if request_id is None:
            self._log(f"ignored unsupported notification: {method}")
            return None

        if method == "initialize":
            return self._result(
                request_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {
                        "resources": {},
                        "tools": {},
                    },
                    "serverInfo": {
                        "name": "teaching-task-board",
                        "version": "0.1.0",
                    },
                },
            )

        if not self.initialized:
            return self._error(request_id, -32002, "server is not initialized")

        if method == "tools/list":
            return self._result(request_id, {"tools": self._tools()})

        if method == "resources/list":
            return self._result(
                request_id,
                {
                    "resources": [
                        {
                            "uri": TASK_BOARD_URI,
                            "name": "Current task board",
                            "description": "A snapshot of all teaching-case tasks.",
                            "mimeType": "application/json",
                        }
                    ]
                },
            )

        if method == "resources/read":
            if params.get("uri") != TASK_BOARD_URI:
                return self._error(request_id, -32002, "resource not found")
            return self._result(
                request_id,
                {
                    "contents": [
                        {
                            "uri": TASK_BOARD_URI,
                            "mimeType": "application/json",
                            "text": json.dumps(
                                {"tasks": list(self.tasks.values())},
                                ensure_ascii=False,
                            ),
                        }
                    ]
                },
            )

        if method == "tools/call":
            if params.get("name") not in {"add_task", "complete_task"}:
                return self._error(request_id, -32602, "unknown tool")
            return self._result(request_id, self._call_tool(params))

        return self._error(request_id, -32601, f"method not found: {method}")

    def _tools(self) -> list[dict[str, Any]]:
        task_schema = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "title": {"type": "string"},
                "completed": {"type": "boolean"},
            },
            "required": ["id", "title", "completed"],
            "additionalProperties": False,
        }
        output_schema = {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "task": task_schema,
            },
            "required": ["message", "task"],
            "additionalProperties": False,
        }
        return [
            {
                "name": "add_task",
                "description": "Add one task to the current board.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"title": {"type": "string", "minLength": 1}},
                    "required": ["title"],
                    "additionalProperties": False,
                },
                "outputSchema": output_schema,
                "annotations": {
                    "readOnlyHint": False,
                    "destructiveHint": False,
                    "openWorldHint": False,
                },
            },
            {
                "name": "complete_task",
                "description": "Mark an existing task as completed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"taskId": {"type": "integer", "minimum": 1}},
                    "required": ["taskId"],
                    "additionalProperties": False,
                },
                "outputSchema": output_schema,
                "annotations": {
                    "readOnlyHint": False,
                    "destructiveHint": True,
                    "idempotentHint": True,
                    "openWorldHint": False,
                },
            },
        ]

    def _call_tool(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        arguments = params.get("arguments", {})

        if name == "add_task":
            title = arguments.get("title")
            if not isinstance(title, str) or not title.strip():
                return self._tool_error("title must be a non-empty string")

            task = {
                "id": self.next_task_id,
                "title": title.strip(),
                "completed": False,
            }
            self.tasks[self.next_task_id] = task
            self.next_task_id += 1
            self._log(f"added task {task['id']}")
            return self._tool_success(f"Added task {task['id']}: {task['title']}", task)

        if name == "complete_task":
            task_id = arguments.get("taskId")
            task = self.tasks.get(task_id)
            if task is None:
                return self._tool_error(f"task {task_id} does not exist")

            task["completed"] = True
            self._log(f"completed task {task_id}")
            return self._tool_success(f"Completed task {task_id}", task)

        raise AssertionError(f"unhandled tool: {name}")

    @staticmethod
    def _tool_success(message: str, task: dict[str, Any]) -> dict[str, Any]:
        structured_content = {"message": message, "task": task}
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(structured_content, ensure_ascii=False),
                }
            ],
            "structuredContent": structured_content,
            "isError": False,
        }

    @staticmethod
    def _tool_error(message: str) -> dict[str, Any]:
        return {
            "content": [{"type": "text", "text": message}],
            "isError": True,
        }

    @staticmethod
    def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }

    @staticmethod
    def _log(message: str) -> None:
        print(f"SERVER LOG: {message}", file=sys.stderr, flush=True)


def serve() -> None:
    server = TaskBoardServer()
    for line in sys.stdin:
        try:
            request = json.loads(line)
            response = server.handle_request(request)
        except (json.JSONDecodeError, TypeError) as error:
            response = server._error(None, -32700, f"parse error: {error}")

        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    serve()
