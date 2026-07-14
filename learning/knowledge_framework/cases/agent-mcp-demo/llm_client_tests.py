import json
import os
import unittest
from unittest.mock import patch

from llm_client import ModelApiError, OpenAICompatibleClient


class OpenAICompatibleClientTests(unittest.TestCase):
    def test_openrouter_uses_bearer_auth_and_free_router(self) -> None:
        with patch.dict(
            os.environ,
            {"OPENROUTER_API_KEY": "test-key"},
            clear=True,
        ):
            client = OpenAICompatibleClient("openrouter")
            payload = client._payload([], [])

        self.assertEqual(
            {
                "provider": client.provider,
                "api_url": client.api_url,
                "model": client.model,
                "headers": client._headers(),
                "payload": payload,
            },
            {
                "provider": "openrouter",
                "api_url": "https://openrouter.ai/api/v1/chat/completions",
                "model": "openrouter/free",
                "headers": {
                    "Authorization": "Bearer test-key",
                    "Content-Type": "application/json",
                },
                "payload": {
                    "model": "openrouter/free",
                    "messages": [],
                    "tools": [],
                    "tool_choice": "auto",
                    "max_tokens": 1024,
                    "stream": False,
                },
            },
        )

    def test_mimo_preserves_provider_specific_request_shape(self) -> None:
        with patch.dict(
            os.environ,
            {"MIMO_API_KEY": "test-key", "MIMO_THINKING": "enabled"},
            clear=True,
        ):
            client = OpenAICompatibleClient("mimo")
            payload = client._payload([], [])

        self.assertEqual(
            {
                "headers": client._headers(),
                "model": client.model,
                "max_completion_tokens": payload["max_completion_tokens"],
                "thinking": payload["thinking"],
            },
            {
                "headers": {
                    "api-key": "test-key",
                    "Content-Type": "application/json",
                },
                "model": "mimo-v2.5",
                "max_completion_tokens": 1024,
                "thinking": {"type": "enabled"},
            },
        )

    def test_generic_environment_variables_override_provider_defaults(self) -> None:
        with patch.dict(
            os.environ,
            {
                "LLM_API_KEY": "shared-key",
                "LLM_API_URL": "https://example.test/v1/chat/completions",
                "LLM_MODEL": "example-model",
                "LLM_TIMEOUT_SECONDS": "12.5",
            },
            clear=True,
        ):
            client = OpenAICompatibleClient("openrouter")

        self.assertEqual(
            {
                "api_key": client.api_key,
                "api_url": client.api_url,
                "model": client.model,
                "timeout_seconds": client.timeout_seconds,
            },
            {
                "api_key": "shared-key",
                "api_url": "https://example.test/v1/chat/completions",
                "model": "example-model",
                "timeout_seconds": 12.5,
            },
        )

    def test_complete_extracts_assistant_message(self) -> None:
        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self) -> bytes:
                return json.dumps(
                    {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}
                ).encode()

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}, clear=True):
            client = OpenAICompatibleClient("openrouter")
            with patch("urllib.request.urlopen", return_value=Response()) as urlopen:
                message = client.complete([], [])

        self.assertEqual(message, {"role": "assistant", "content": "ok"})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, client.api_url)
        self.assertEqual(urlopen.call_args.kwargs, {"timeout": 60.0})

    def test_rejects_unknown_provider(self) -> None:
        with self.assertRaisesRegex(ModelApiError, "unsupported LLM provider"):
            OpenAICompatibleClient("unknown")


if __name__ == "__main__":
    unittest.main()
